/**
 * @file comint-ops.ts
 * @description Command-interpreter operations: spawn subprocesses via Bun.spawn
 * pipes (NOT full PTY), accumulate output in editor buffers, manage history.
 * @see SPEC-099 #165
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createBoolean, createNumber, createList } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

/** A managed comint process instance. */
interface ComintInstance {
  bufferName: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  alive: boolean;
  exitCode: number | null;
  history: string[];
  historyIndex: number;
}

/** Manages comint process instances. One per comint buffer. */
export class ComintManager {
  private instances = new Map<string, ComintInstance>();

  /** Map of buffer-name → instance for quick lookup. */

  /** Spawn a subprocess and accumulate output in a buffer. Returns buffer name. */
  run(
    command: string,
    args: string[],
    bufferName: string,
    cwd: string | undefined,
    env: Record<string, string> | undefined,
    onOutput: (bufferName: string, line: string) => void,
  ): string {
    // Kill existing instance with same buffer name
    this.kill(bufferName);

    const proc = Bun.spawn([command, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env: { ...process.env, ...env },
    });

    const instance: ComintInstance = {
      bufferName,
      proc,
      alive: true,
      exitCode: null,
      history: [],
      historyIndex: -1,
    };

    // Read stdout + stderr → onOutput callback (per line)
    const decoder = new TextDecoder();
    const readStream = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            onOutput(bufferName, line);
          }
        }
        if (buf) onOutput(bufferName, buf);
      } catch { /* stream closed */ }
    };
    readStream(proc.stdout as ReadableStream<Uint8Array>);
    readStream(proc.stderr as ReadableStream<Uint8Array>);

    // Track exit
    (async () => {
      const code = await proc.exited;
      instance.alive = false;
      instance.exitCode = code;
      instance.proc = null;
    })();

    this.instances.set(bufferName, instance);
    return bufferName;
  }

  /** Send data to the process stdin. */
  send(bufferName: string, data: string): void {
    const inst = this.instances.get(bufferName);
    if (inst?.alive && inst.proc?.stdin && typeof inst.proc.stdin === "object") {
      (inst.proc.stdin as any).write(data);
    }
  }

  /** Send SIGINT to the process. */
  sendSignal(bufferName: string, signal: string): void {
    const inst = this.instances.get(bufferName);
    if (inst?.alive && inst.proc) {
      try { inst.proc.kill(signal as any); } catch { /* already exited */ }
    }
  }

  /** Kill the process. */
  kill(bufferName: string): void {
    const inst = this.instances.get(bufferName);
    if (inst?.alive && inst.proc) {
      try { inst.proc.kill("SIGTERM"); } catch { /* already exited */ }
      inst.alive = false;
    }
  }

  /** Get process status: "running", "exited:N", or nil. */
  status(bufferName: string): string | null {
    const inst = this.instances.get(bufferName);
    if (!inst) return null;
    if (inst.alive) return "running";
    return `exited:${inst.exitCode}`;
  }

  /** Check if a buffer is a comint buffer. */
  isComint(bufferName: string): boolean {
    return this.instances.has(bufferName);
  }

  /** Add to input history. */
  pushHistory(bufferName: string, input: string): void {
    const inst = this.instances.get(bufferName);
    if (inst) {
      inst.history.push(input);
      inst.historyIndex = inst.history.length;
    }
  }

  /** Get previous history entry (M-p). */
  historyPrev(bufferName: string): string | null {
    const inst = this.instances.get(bufferName);
    if (!inst || inst.history.length === 0) return null;
    if (inst.historyIndex > 0) inst.historyIndex--;
    return inst.history[inst.historyIndex] ?? null;
  }

  /** Get next history entry (M-n). */
  historyNext(bufferName: string): string | null {
    const inst = this.instances.get(bufferName);
    if (!inst || inst.history.length === 0) return null;
    if (inst.historyIndex < inst.history.length) inst.historyIndex++;
    if (inst.historyIndex >= inst.history.length) return null;
    return inst.history[inst.historyIndex] ?? null;
  }

  /** Get the buffer name for a comint instance by index. */
  list(): string[] {
    return [...this.instances.keys()];
  }

  /** Destroy all instances (cleanup). */
  destroyAll(): void {
    for (const name of this.instances.keys()) {
      this.kill(name);
    }
    this.instances.clear();
  }
}

export function createComintOps(
  access: EditorModelAccess,
  manager: ComintManager,
  createBuffer: (name: string) => void,
  appendToBuffer: (name: string, text: string) => void,
  getBufferName: () => string,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("comint-run", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 2, "comint-run");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const cmdV = validateArgType(args[0], "string", 0, "comint-run");
    if (Either.isLeft(cmdV)) return Either.left(cmdV.left);
    const argListV = validateArgType(args[1], "list", 1, "comint-run");
    if (Either.isLeft(argListV)) return Either.left(argListV.left);

    const command = args[0]!.value as string;
    const argList = (args[1]!.value as TLispValue[]).map(v => v.type === "string" ? v.value as string : "");
    const bufferName = args.length > 2 && args[2]?.type === "string" ? args[2]!.value as string : `*${command}*`;
    const cwd = args.length > 3 && args[3]?.type === "string" ? args[3]!.value as string : undefined;
    const env: Record<string, string> | undefined = undefined;

    // Create the buffer
    createBuffer(bufferName);

    // Spawn the process, wire output to the buffer
    manager.run(command, argList, bufferName, cwd, env, (_bn, line) => {
      appendToBuffer(bufferName, line + "\n");
    });

    return Either.right(createString(bufferName));
  });

  api.set("comint-send", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 2, "comint-send");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bnV = validateArgType(args[0], "string", 0, "comint-send");
    if (Either.isLeft(bnV)) return Either.left(bnV.left);
    const dataV = validateArgType(args[1], "string", 1, "comint-send");
    if (Either.isLeft(dataV)) return Either.left(dataV.left);

    const bufferName = args[0]!.value as string;
    const data = args[1]!.value as string;
    manager.send(bufferName, data);
    manager.pushHistory(bufferName, data.trim());
    return Either.right(createNil());
  });

  api.set("comint-kill", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "comint-kill");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bnV = validateArgType(args[0], "string", 0, "comint-kill");
    if (Either.isLeft(bnV)) return Either.left(bnV.left);
    manager.kill(args[0]!.value as string);
    return Either.right(createNil());
  });

  api.set("comint-signal", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 2, "comint-signal");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bnV = validateArgType(args[0], "string", 0, "comint-signal");
    if (Either.isLeft(bnV)) return Either.left(bnV.left);
    const sigV = validateArgType(args[1], "string", 1, "comint-signal");
    if (Either.isLeft(sigV)) return Either.left(sigV.left);
    manager.sendSignal(args[0]!.value as string, args[1]!.value as string);
    return Either.right(createNil());
  });

  api.set("comint-process-status", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "comint-process-status");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bnV = validateArgType(args[0], "string", 0, "comint-process-status");
    if (Either.isLeft(bnV)) return Either.left(bnV.left);
    const status = manager.status(args[0]!.value as string);
    if (status === null) return Either.right(createNil());
    return Either.right(createString(status));
  });

  api.set("comint-buffer-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "comint-buffer-p");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bnV = validateArgType(args[0], "string", 0, "comint-buffer-p");
    if (Either.isLeft(bnV)) return Either.left(bnV.left);
    return Either.right(createBoolean(manager.isComint(args[0]!.value as string)));
  });

  api.set("comint-history-prev", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const bn = getBufferName();
    const entry = manager.historyPrev(bn);
    return Either.right(entry ? createString(entry) : createNil());
  });

  api.set("comint-history-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const bn = getBufferName();
    const entry = manager.historyNext(bn);
    return Either.right(entry ? createString(entry) : createNil());
  });

  api.set("comint-list", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    return Either.right(createList(manager.list().map(n => createString(n))));
  });

  return api;
}

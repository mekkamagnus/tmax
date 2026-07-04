/**
 * @file clipboard-ops.ts
 * @description SPEC-044 Phase 2.4 — OS clipboard bridge for `+`/`*` registers.
 *
 * Two primitives:
 * - clipboard-get: read OS clipboard text
 * - clipboard-set: write OS clipboard text
 *
 * Platform detection runs once at module load. If no tool is available,
 * both primitives no-op (set returns nil; get returns "").
 *
 * Architecture: TS primitives ONLY. T-Lisp decides when to call them
 * (see src/tlisp/core/commands/clipboard.tlisp).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import { State } from "../../utils/state.ts";
import type { EditorModel } from "../functional/model.ts";

/**
 * CHORE-39 Phase 4: `State<EditorModel, string>` reader — the text of the
 * current buffer line at the cursor, i.e. what a clipboard copy/paste operates
 * on. Pure model read; the actual OS-clipboard write happens via `clipboardSet`.
 */
export const currentLineTextState = (): State<EditorModel, string> =>
  State.gets((m: EditorModel): string => {
    if (!m.currentBuffer) return "";
    const result = m.currentBuffer.getLine(m.cursorPosition.line);
    return Either.isLeft(result) ? "" : result.right;
  });

type Platform = "darwin" | "linux" | "win32" | "other";

function detectPlatform(): Platform {
  const p = (typeof Bun !== "undefined" && Bun.env.TMAX_FAKE_PLATFORM) || process.platform;
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

type Tool = { copyCmd: string[]; copyInputEncoding: "utf8"; pasteCmd: string[] };

function detectTool(platform: Platform): Tool | null {
  if (platform === "darwin") {
    return { copyCmd: ["pbcopy"], copyInputEncoding: "utf8", pasteCmd: ["pbpaste"] };
  }
  if (platform === "linux") {
    if (hasBinary("xclip")) {
      return {
        copyCmd: ["xclip", "-selection", "clipboard"],
        copyInputEncoding: "utf8",
        pasteCmd: ["xclip", "-o", "-selection", "clipboard"],
      };
    }
    if (hasBinary("xsel")) {
      return {
        copyCmd: ["xsel", "--clipboard", "--input"],
        copyInputEncoding: "utf8",
        pasteCmd: ["xsel", "--clipboard", "--output"],
      };
    }
    if (hasBinary("wl-copy")) {
      return {
        copyCmd: ["wl-copy"],
        copyInputEncoding: "utf8",
        pasteCmd: ["wl-paste"],
      };
    }
    return null;
  }
  if (platform === "win32") {
    return {
      copyCmd: ["powershell", "-NoProfile", "-Command", "Set-Clipboard -Value $input"],
      copyInputEncoding: "utf8",
      pasteCmd: ["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
    };
  }
  return null;
}

function hasBinary(name: string): boolean {
  try {
    const proc = Bun.spawnSync(["which", name], { stdout: "ignore", stderr: "ignore" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

const PLATFORM: Platform = detectPlatform();
const TOOL: Tool | null = detectTool(PLATFORM);

/** Read OS clipboard. Returns "" if unavailable or empty. */
export function clipboardGet(): string {
  if (!TOOL) return "";
  try {
    const proc = Bun.spawnSync({
      cmd: TOOL.pasteCmd,
    });
    if (proc.exitCode !== 0) return "";
    const out = proc.stdout;
    if (!out) return "";
    return typeof out === "string" ? out : out.toString();
  } catch {
    return "";
  }
}

/** Write text to OS clipboard. Returns true on success, false otherwise. */
export function clipboardSet(text: string): boolean {
  if (!TOOL) return false;
  try {
    const proc = Bun.spawnSync({
      cmd: TOOL.copyCmd,
      stdin: new TextEncoder().encode(text),
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.exitCode === 0 || proc.exitCode === null;
  } catch {
    return false;
  }
}

/** True if a clipboard tool is available on this platform. */
export function clipboardAvailable(): boolean {
  return TOOL !== null;
}

export function createClipboardOps(): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("clipboard-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const v = validateArgsCount(args, 0, "clipboard-get");
    if (Either.isLeft(v)) return Either.left(v.left);
    return Either.right(createString(clipboardGet()));
  });

  api.set("clipboard-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const v = validateArgsCount(args, 1, "clipboard-set");
    if (Either.isLeft(v)) return Either.left(v.left);
    const textArg = args[0]!;
    const tv = validateArgType(textArg, "string", 0, "clipboard-set");
    if (Either.isLeft(tv)) return Either.left(tv.left);
    if (!clipboardSet(textArg.value as string)) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "clipboard tool unavailable",
        "clipboard",
        null,
        "available tool"
      ));
    }
    return Either.right(createNil());
  });

  api.set("clipboard-available?", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const v = validateArgsCount(args, 0, "clipboard-available?");
    if (Either.isLeft(v)) return Either.left(v.left);
    return Either.right({ type: "boolean", value: clipboardAvailable() });
  });

  return api;
}

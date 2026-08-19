/**
 * @file pty.ts
 * @description Zero-dependency PTY manager using Bun's native terminal API.
 *
 * Bun shipped first-party PTY support in v1.3.5 via `Bun.spawn({ terminal })`.
 * Under the hood it calls `openpty()` on POSIX. No node-pty (incompatible with
 * Bun — microsoft/node-pty#632 closed out-of-scope), no script(1) hack.
 *
 * @see SPEC-097 RFC-014A (shell-mode)
 * @see https://bun.com/reference/bun/Terminal
 */

/** A handle to a running PTY process. */
export interface PTYHandle {
  /** Write data to the PTY (goes to the shell/program). */
  write(data: string | Uint8Array): void;
  /** Resize the PTY. */
  resize(cols: number, rows: number): void;
  /** Set raw mode on the PTY (pass-through all keys). */
  setRawMode(enabled: boolean): void;
  /** Kill the process. */
  kill(signal?: string): void;
  /** Register a callback for PTY output. */
  onOutput(cb: (data: string) => void): void;
  /** Register a callback for process exit. */
  onExit(cb: (code: number | null) => void): void;
  /** The PID of the spawned process. */
  readonly pid: number;
}

/** Options for spawning a PTY process. */
export interface PTYSpawnOptions {
  /** Command to run (default: $SHELL or /bin/sh). */
  command?: string;
  /** Arguments to pass. */
  args?: string[];
  /** Working directory (default: cwd). */
  cwd?: string;
  /** Environment variables (default: process.env). */
  env?: Record<string, string>;
  /** Initial terminal width (default: 80). */
  cols?: number;
  /** Initial terminal height (default: 24). */
  rows?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Spawn a process with a real PTY using Bun's native terminal API.
 *
 * `Bun.spawn({ terminal })` allocates a pseudo-terminal via `openpty()`. The
 * inner process sees a real tty — `isatty()` returns true, cursor addressing
 * works, vim/htop/Claude Code render correctly.
 */
export function spawn(opts: PTYSpawnOptions = {}): PTYHandle {
  const command = opts.command ?? process.env.SHELL ?? "/bin/sh";
  const args = opts.args ?? [];
  const cwd = opts.cwd ?? process.cwd();
  const env = {
    ...process.env,
    ...(opts.env ?? {}),
    // #201: never let TERM=dumb reach the child (Ink-based CLIs like claude
    // degrade on it); unset (GUI daemon) also gets a real terminal type.
    TERM: opts.env?.TERM ?? (process.env.TERM && process.env.TERM !== "dumb" ? process.env.TERM : "xterm-256color"),
  };
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;

  const outputCallbacks: ((data: string) => void)[] = [];
  const exitCallbacks: ((code: number | null) => void)[] = [];
  const decoder = new TextDecoder();

  const proc = Bun.spawn([command, ...args], {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      data(_term, data: Uint8Array) {
        const text = decoder.decode(data, { stream: true });
        for (const cb of outputCallbacks) cb(text);
      },
      exit(_term, code: number, _signal: string | null) {
        for (const cb of exitCallbacks) cb(code);
      },
    },
  });

  return {
    pid: proc.pid!,
    write(data: string | Uint8Array): void {
      proc.terminal!.write(data);
    },
    resize(c: number, r: number): void {
      proc.terminal!.resize(c, r);
    },
    setRawMode(enabled: boolean): void {
      proc.terminal!.setRawMode(enabled);
    },
    kill(signal?: string): void {
      try {
        proc.kill(signal as any ?? "SIGTERM");
      } catch {
        // Already exited
      }
    },
    onOutput(cb: (data: string) => void): void {
      outputCallbacks.push(cb);
    },
    onExit(cb: (code: number | null) => void): void {
      exitCallbacks.push(cb);
    },
  };
}

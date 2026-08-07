/**
 * @file pty.ts
 * @description Zero-dependency PTY manager using `script(1)` + Bun.spawn.
 *
 * node-pty (the standard Node.js PTY library) is INCOMPATIBLE with Bun — its
 * native addon calls `posix_spawnp` which fails under Bun's runtime. Instead,
 * we use the Unix `script` command (available on macOS + Linux) to allocate a
 * real PTY, communicating via Bun.spawn's stdin/stdout pipes.
 *
 * The inner process (shell, vim, htop, Claude Code) sees a REAL tty — they can
 * call `isatty()`, use cursor addressing, full-screen TUI, colors, etc. The
 * tradeoff vs node-pty: no direct SIGWINCH forwarding (resize via `stty` inside
 * the PTY instead) and a thin layer of echo/latency from the `script` wrapper.
 *
 * Architecture:
 *   tmax ←(pipes)→ script ←(PTY)→ shell/agent
 *
 * @see SPEC-097 RFC-014A (shell-mode)
 */

/** A handle to a running PTY process. */
export interface PTYHandle {
  /** Write data to the PTY's stdin (goes to the shell/program). */
  write(data: string | Uint8Array): void;
  /** Resize the PTY (sends `stty cols W rows H` into the PTY). */
  resize(cols: number, rows: number): void;
  /** Kill the process. */
  kill(signal?: string): void;
  /** Register a callback for PTY output (stdout+stderr combined). */
  onOutput(cb: (data: string) => void): void;
  /** Register a callback for process exit. */
  onExit(cb: (code: number | null) => void): void;
  /** The PID of the spawned process (for process-state queries). */
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

/** Default terminal dimensions. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Spawn a process with a real PTY using `script(1)`.
 *
 * `script -q /dev/null <command>` allocates a pseudo-terminal for the inner
 * command. tmax communicates with `script` via Bun.spawn's stdin/stdout pipes.
 * The inner process sees a real tty (/dev/ttys* or /dev/pts/*).
 */
export function spawn(opts: PTYSpawnOptions = {}): PTYHandle {
  const command = opts.command ?? process.env.SHELL ?? "/bin/sh";
  const args = opts.args ?? [];
  const cwd = opts.cwd ?? process.cwd();
  const env = {
    ...process.env,
    ...(opts.env ?? {}),
    TERM: opts.env?.TERM ?? process.env.TERM ?? "xterm-256color",
    // Force line-buffered output for responsiveness
    LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
  };
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;

  // Build the script(1) command line. On macOS: `script -q /dev/null cmd args...`
  // On Linux: `script -qec "cmd args" /dev/null` (different flag syntax).
  // Detect the platform.
  const isLinux = process.platform === "linux";
  const fullCommand = [command, ...args];

  let scriptArgs: string[];
  if (isLinux) {
    // Linux script: `script -qec "command" /dev/null`
    scriptArgs = ["-qe", "-c", fullCommand.join(" "), "/dev/null"];
  } else {
    // macOS script: `script -q /dev/null command args...`
    scriptArgs = ["-q", "/dev/null", ...fullCommand];
  }

  const proc = Bun.spawn(["script", ...scriptArgs], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env,
  });

  const outputCallbacks: ((data: string) => void)[] = [];
  const exitCallbacks: ((code: number | null) => void)[] = [];
  let exited = false;

  // Set initial terminal size inside the PTY
  proc.stdin.write(`stty cols ${cols} rows ${rows} 2>/dev/null;`);

  // Read stdout (PTY output goes here)
  const decoder = new TextDecoder();
  (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const cb of outputCallbacks) cb(text);
      }
    } catch {
      // Stream closed
    }
  })();

  // Read stderr (some output may go here)
  (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const cb of outputCallbacks) cb(text);
      }
    } catch {
      // Stream closed
    }
  })();

  // Handle exit
  (async () => {
    const code = await proc.exited;
    if (exited) return;
    exited = true;
    for (const cb of exitCallbacks) cb(code);
  })();

  return {
    pid: proc.pid!,
    write(data: string | Uint8Array): void {
      if (exited) return;
      proc.stdin.write(data);
    },
    resize(c: number, r: number): void {
      if (exited) return;
      // Send stty resize into the PTY (script doesn't forward SIGWINCH).
      // The shell processes stty and updates the terminal dimensions.
      proc.stdin.write(`stty cols ${c} rows ${r} 2>/dev/null;`);
    },
    kill(signal?: string): void {
      if (exited) return;
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

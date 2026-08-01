/**
 * @file embedded-instance.ts
 * @description EmbeddedEditor — lifecycle for the SINGLE-PROCESS embedded
 *   editor (`bun src/main.ts <file>`), driven as a black box over tmux.
 *
 * Why this exists (BUG-58 / CHORE-69): every daemon-RPC save test exercises
 * `Editor.openFile()`, which sets `bufferMetadata.filename` correctly. The bug
 * lived in `src/main.ts`'s CLI bootstrap, which did NOT — and `buffer-insert`
 * re-derives `currentFilename` from that (absent) metadata on the first
 * keystroke. A socket-only test can never reproduce that, because it opens the
 * file via RPC. The ONLY faithful reproduction is to launch the embedded editor
 * with the file as an argv argument and drive the real TUI.
 *
 * This driver spawns `bun src/main.ts <file>` under an ISOLATED `HOME` and a
 * UNIQUE `TMAX_SOCKET`, so:
 *   - no user config/workspace leaks in or out;
 *   - the launch cannot route through a pre-existing daemon (the launcher does
 *     that only when a daemon answers on $TMAX_SOCKET — ours is unique + empty);
 *   - `launch()` verifies the embedded server actually bound our socket AND that
 *     the bootstrap opened the file we named (a hijack — or the cleanStart
 *     `*scratch*` reset from BUG-58 — would leave a different buffer), failing
 *     loudly otherwise.
 *
 * Plain Promise API (not TaskEither) so tests can `await` it directly inside
 * the tmax-use `test()` harness.
 */

import { exec } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { connect } from 'net';

const execAsync = promisify(exec);

const PROJECT_ROOT = resolve(new URL('..', import.meta.url).pathname, '..');
/** Repo-local embedded entry point — never a global install (learnings.md). */
export const EMBEDDED_ENTRY = join(PROJECT_ROOT, 'src', 'main.ts');

export interface EmbeddedOptions {
  /** File passed as argv — the bootstrap target (the BUG-58 code path). */
  readonly file: string;
  /** tmux columns (default 80). */
  readonly width?: number;
  /** tmux rows (default 24). */
  readonly height?: number;
}

export interface Capture {
  readonly lines: string[];
  readonly raw: string;
}

/**
 * Drives the embedded editor as a black box. One tmux session = one editor
 * process. Always tear down with `close()`.
 */
export class EmbeddedEditor {
  readonly session: string;
  readonly socketPath: string;
  readonly home: string;
  readonly file: string;
  private readonly width: number;
  private readonly height: number;
  private closed = false;

  private constructor(opts: EmbeddedOptions, session: string, socketPath: string, home: string) {
    this.file = resolve(opts.file);
    this.session = session;
    this.socketPath = socketPath;
    this.home = home;
    this.width = opts.width ?? 80;
    this.height = opts.height ?? 24;
  }

  /**
   * Spawn the embedded editor on `file` and wait for readiness. Throws if the
   * embedded server does not bind our unique socket, or if the bootstrap did
   * not open `file` (which indicates the launch was hijacked by another daemon
   * or reset to `*scratch*` — the BUG-58-class silent-pass we want to catch).
   */
  static async launch(opts: EmbeddedOptions, readyMs = 15_000): Promise<EmbeddedEditor> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const home = mkdtempSync(join(tmpdir(), 'tmax-embedded-home-'));
    const socketPath = join(home, 'editor.sock'); // unique + inside isolated HOME
    const session = `tmax-embedded-${token}`;
    const ed = new EmbeddedEditor(opts, session, socketPath, home);

    try { await execAsync(`tmux kill-session -t ${ed.session} 2>/dev/null || true`); } catch { /* none */ }

    // Spawn the embedded editor. TMAX_SOCKET is unique + empty, so the
    // bin/tmax daemon-reroute path is impossible; we invoke src/main.ts
    // directly so the CLI bootstrap (the BUG-58 site) is exactly what runs.
    // Inline env prefix guarantees the child sees HOME/TMAX_SOCKET regardless
    // of tmux env forwarding.
    const cmd =
      `tmux new-session -d -x ${ed.width} -y ${ed.height} -s ${ed.session} ` +
      `"HOME=${sh(home)} TMAX_SOCKET=${sh(socketPath)} bun ${sh(EMBEDDED_ENTRY)} ${sh(ed.file)}"`;
    await execAsync(cmd, { cwd: PROJECT_ROOT });

    try {
      await ed.waitReady(readyMs);
    } catch (err) {
      // Don't orphan the tmux session + isolated HOME if readiness fails.
      await ed.close().catch(() => undefined);
      throw err;
    }
    return ed;
  }

  /** Wait for the embedded socket + verify the bootstrap opened our file. */
  private async waitReady(readyMs: number): Promise<void> {
    const deadline = Date.now() + readyMs;
    while (Date.now() < deadline) {
      if (existsSync(this.socketPath)) break;
      await sleep(100);
    }
    if (!existsSync(this.socketPath)) {
      const cap = await this.capture().catch(() => ({ raw: '<no capture>' }));
      throw new Error(`embedded editor did not bind socket ${this.socketPath} within ${readyMs}ms.\n--- pane ---\n${cap.raw}`);
    }
    // The bootstrap must have opened the file we named. A daemon hijack or a
    // cleanStart `*scratch*` reset (BUG-58 cause #1) leaves a different buffer.
    let filename: string | undefined;
    while (Date.now() < deadline) {
      filename = await evalExpr(this.socketPath, '(buffer-filename)').catch(() => undefined);
      if (filename && filename !== 'nil') break;
      await sleep(100);
    }
    if (filename !== this.file) {
      throw new Error(
        `embedded bootstrap did not open ${this.file}: (buffer-filename)=${JSON.stringify(filename)} ` +
        `(possible daemon hijack or *scratch* reset — BUG-58 class)`,
      );
    }
  }

  /** Send a literal key sequence (printable chars) to the editor's pane. */
  async send(text: string): Promise<void> {
    await execAsync(`tmux send-keys -t ${this.session} -l ${sh(text)}`);
    await sleep(150); // let the async key handler settle
  }

  /** Send a named special key (Escape, Enter, Tab, …) via tmux key name. */
  async sendKey(key: string): Promise<void> {
    await execAsync(`tmux send-keys -t ${this.session} ${key}`);
    await sleep(150);
  }

  /** Wait for the editor's async key handler to settle (use around mode switches). */
  async wait(ms: number): Promise<void> { await sleep(ms); }

  /** Poll until the status line shows `mode` (NORMAL/COMMAND/…), or time out. */
  async waitForMode(mode: string, timeoutMs = 3_000): Promise<void> {
    const needle = `--${mode.toUpperCase()}--`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cap = await this.capture();
      if (cap.lines.some((l) => l.includes(needle))) return;
      await sleep(100);
    }
    const cap = await this.capture();
    throw new Error(`did not reach ${mode} mode within ${timeoutMs}ms.\n--- pane ---\n${cap.raw}`);
  }

  /**
   * Evaluate a T-Lisp expression on the embedded editor's socket and return its
   * value (assertion helper). NOTE: this is NOT JavaScript `eval()` — `code` is
   * a T-Lisp source string sent to the editor's own interpreter over JSON-RPC,
   * which is how the editor is driven/extensed. No untrusted JS is evaluated.
   */
  async eval(code: string): Promise<string | undefined> {
    return evalExpr(this.socketPath, code);
  }

  /** Capture the current pane content. */
  async capture(): Promise<Capture> {
    const raw = (await execAsync(`tmux capture-pane -t ${this.session} -p`)).stdout;
    return { lines: raw.replace(/\s+$/, '').split('\n'), raw };
  }

  /** Tear down the tmux session + isolated HOME. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await execAsync(`tmux kill-session -t ${this.session} 2>/dev/null || true`); } catch { /* none */ }
    try { rmSync(this.home, { recursive: true, force: true }); } catch { /* none */ }
  }
}

/** Eval a T-Lisp expression on a socket; return its value as a string. */
async function evalExpr(socketPath: string, code: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    const timer = setTimeout(() => { sock.destroy(); resolve(undefined); }, 3000);
    let buf = '';
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eval', params: { code } }) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      sock.destroy();
      try {
        const resp = JSON.parse(buf.slice(0, nl));
        // eval RPC returns the T-Lisp value: a string, or {type,value}, or {error}.
        const result = resp.result;
        if (resp.error) return resolve(undefined);
        if (typeof result === 'string') return resolve(result);
        if (result && typeof result === 'object') {
          const v = (result as { value?: unknown }).value;
          return resolve(typeof v === 'string' ? v : JSON.stringify(result));
        }
        return resolve(String(result));
      } catch {
        resolve(undefined);
      }
    });
    sock.on('error', () => { clearTimeout(timer); resolve(undefined); });
  });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Shell-quote a value for safe interpolation into a tmux/shell command. */
function sh(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * @file launcher.ts
 * @description #250 — the `tmax` CLI launcher, ported from bin/tmax so the
 *   compiled binary is a drop-in `tmax`. Verbatim behavior port of the bash
 *   launcher (flags, daemon startup choreography, routing); every terminal
 *   verb exits the process exactly like the bash `exec` did. Returns
 *   `'embedded'` when the single-process editor should take over (main.ts
 *   then runs its existing embedded path), `'daemon'` for the --daemon path.
 *
 *   Client verbs route in-process through runTmaxClient (src/client/cli.ts);
 *   sweep delegates to src/server/sweep.ts's exported main; daemon/TUI
 *   children spawn via exec-target.ts (source tree vs $bunfs binary aware).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { TmaxClient } from '../client/rpc-client.ts';
import { runTmaxClient } from '../client/cli.ts';
import { daemonSpawnTarget } from './exec-target.ts';
import { main as sweepMain } from '../server/sweep.ts';
import { readLockRaw } from '../server/lock-file.ts';

export type LauncherRoute = 'embedded' | 'daemon';

const SOCKET = process.env.TMAX_SOCKET ?? `/tmp/tmax-${userInfo().uid}/server`;
const LAST_WS_FILE = `${process.env.HOME ?? ''}/.config/tmax/last-workspace`;

function usage(): never {
  console.log(`Usage: tmax [options] [file]

Options:
  --daemon       Start daemon only (no TUI frame)
  -w, --workspace NAME  Open/connect to workspace NAME
  -w new:NAME    Create workspace NAME, then connect to it
  --workspaces   List workspaces
  --workspace-kill NAME  Delete workspace NAME
  -e EXPR        Evaluate T-Lisp expression (like emacsclient -e)
  --init-file FILE  Use custom init file (default: ~/.config/tmax/init.tlisp)
  --clean           Start with a fresh *scratch* (skip workspace restore)
  --stop         Stop the running daemon
  --sweep        List orphaned tmax daemons + stale sockets (dry-run)
  --sweep --apply  Reap orphans (SIGTERM→SIGKILL) + remove stale sockets/locks
  --sweep --force  Also include the canonical daemon (off by default)
  --capture      Capture current frame as ANSI (colors preserved)
  --capture-html Capture current frame as standalone HTML
  --test         Run the trt native test suite (exit 0 pass / 1 fail / 2 no-tests)
  --json         With --test: emit JSON results (parseable by jq)
  -t             Open a new terminal frame
  -h, --help     Show this help message

Examples:
  tmax                  Start daemon + open TUI frame
  tmax file.txt         Start daemon + open TUI with file
  tmax --daemon         Start daemon only
  tmax -e '(buffer-text)'  Evaluate T-Lisp
  tmax --capture        Dump current frame with colors
  tmax --capture-html > /tmp/frame.html && open /tmp/frame.html
  tmax --stop           Stop daemon`);
  process.exit(0);
}

/** Ping the daemon on $SOCKET (bash is_running). */
async function isRunning(): Promise<boolean> {
  const client = new TmaxClient(SOCKET);
  try {
    await client.connect();
    const alive = await client.ping();
    client.close();
    return alive;
  } catch {
    return false;
  }
}

/** Wait for the daemon socket to answer; clear a stale (dead-pid) lock so a
 *  racing start can retry. 25 × 200ms, like the bash launcher. */
async function waitForDaemon(): Promise<boolean> {
  for (let attempts = 0; attempts < 25; attempts++) {
    if (await isRunning()) return true;
    const lockFile = `${SOCKET}.lock`;
    if (existsSync(lockFile)) {
      const raw = readLockRaw(lockFile);
      const pid = typeof raw?.pid === 'number' ? raw.pid : undefined;
      let alive = false;
      if (pid !== undefined) {
        try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      }
      if (!alive) {
        // stale lock from dead process — remove it so we can retry
        try { unlinkSync(lockFile); } catch { /* best-effort */ }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Start a daemon child if none is running (bash ensure_daemon). */
async function ensureDaemon(opts: { initFile: string; cleanStart: boolean }): Promise<void> {
  if (await isRunning()) return;

  // Trailing-X template: BSD/macOS mktemp only substitutes a TRAILING run of
  // X's (BUG-35). mkdtemp needs the directory to exist; /tmp always does.
  const logFile = join(mkdtempSync(join(tmpdir(), 'tmax-daemon-start.')), 'log');

  const target = daemonSpawnTarget();
  const daemonArgs = [...target.args];
  if (opts.initFile) daemonArgs.push('--init-file', opts.initFile);
  if (opts.cleanStart) daemonArgs.push('--clean');
  // Like the bash `>"$daemon_log" 2>&1`: capture child stdout+stderr in the
  // log file so a failed start can show its tail.
  const logFd = openSync(logFile, 'a');
  const child = spawn(target.cmd, daemonArgs, {
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, TMAX_SOCKET: SOCKET },
    detached: true,
  });
  child.unref();

  if (await waitForDaemon()) {
    try { rmSync(logFile, { force: true }); } catch { /* fine */ }
    return;
  }

  console.error(`Error: Failed to start daemon (pid ${child.pid})`);
  try {
    const content = readFileSync(logFile, 'utf8');
    if (content.length > 0) {
      console.error('--- daemon log ---');
      console.error(content.split('\n').slice(-20).join('\n'));
      console.error('--- end ---');
    }
  } catch { /* no log */ }
  try { rmSync(logFile, { force: true }); } catch { /* fine */ }
  process.exit(1);
}

interface ParsedArgs {
  daemonOnly: boolean;
  evalExpr: string;
  stop: boolean;
  sweep: boolean;
  sweepApply: boolean;
  sweepForce: boolean;
  capture: '' | 'ansi' | 'html';
  workspace: string;
  workspaces: boolean;
  workspaceKill: string;
  testMode: boolean;
  testJson: boolean;
  testTarget: string;
  initFile: string;
  cleanStart: boolean;
  files: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const p: ParsedArgs = {
    daemonOnly: false, evalExpr: '', stop: false, sweep: false, sweepApply: false,
    sweepForce: false, capture: '', workspace: '', workspaces: false, workspaceKill: '',
    testMode: false, testJson: false, testTarget: '', initFile: '', cleanStart: false,
    files: [],
  };
  let shiftMode: 'workspace' | 'workspace_kill' | 'eval' | 'init_file' | '' = '';
  let endOfOpts = false;

  for (const arg of argv) {
    if (endOfOpts) {
      p.files.push(arg);
      continue;
    }
    switch (arg) {
      case '--daemon': p.daemonOnly = true; break;
      case '-w': case '--workspace': shiftMode = 'workspace'; break;
      case '--workspaces': p.workspaces = true; break;
      case '--workspace-kill': shiftMode = 'workspace_kill'; break;
      case '-e': shiftMode = 'eval'; break;
      case '--init-file': shiftMode = 'init_file'; break;
      case '--clean': p.cleanStart = true; break;
      case '--stop': p.stop = true; break;
      case '--sweep': p.sweep = true; break;
      case '--apply': p.sweepApply = true; break;
      case '--force': p.sweepForce = true; break;
      case '--capture': p.capture = 'ansi'; break;
      case '--capture-html': p.capture = 'html'; break;
      case '--test': p.testMode = true; break;
      case '--json': p.testJson = true; break;
      case '-t': break; // -t is default behavior (open terminal frame)
      case '-h': case '--help': usage(); break;
      case '--': endOfOpts = true; break; // POSIX end-of-options: rest are files
      default: {
        if (shiftMode === 'eval') { p.evalExpr = arg; shiftMode = ''; }
        else if (shiftMode === 'workspace') { p.workspace = arg; shiftMode = ''; }
        else if (shiftMode === 'workspace_kill') { p.workspaceKill = arg; shiftMode = ''; }
        else if (shiftMode === 'init_file') { p.initFile = arg; shiftMode = ''; }
        else if (p.testMode && p.testTarget === '') { p.testTarget = arg; }
        else if (arg.startsWith('-')) {
          // Unknown flag: error loudly instead of silently dropping it /
          // launching the TUI. #47 / BUG-41. (Embedded-editor dev flags
          // --dev/--no-tty and --version/-v pass through to main.ts.)
          if (arg !== '--dev' && arg !== '--no-tty' && arg !== '--version' && arg !== '-v') {
            console.error(`Error: unknown flag '${arg}'. Use --help for usage.`);
            process.exit(1);
          }
        } else {
          p.files.push(arg);
        }
        break;
      }
    }
  }

  // I6: flags that expected an argument but didn't get one
  if (shiftMode === 'workspace') { console.error('Error: -w requires a workspace name argument'); process.exit(1); }
  if (shiftMode === 'workspace_kill') { console.error('Error: --workspace-kill requires a workspace name argument'); process.exit(1); }
  if (shiftMode === 'eval') { console.error('Error: -e requires an expression argument'); process.exit(1); }
  if (shiftMode === 'init_file') { console.error('Error: --init-file requires a file path argument'); process.exit(1); }
  return p;
}

/** Diagnostic one-shot client flags: dispatch straight to tmaxclient with the
 *  ORIGINAL argv (pass-through preserves modifiers --json/--frame/-n). No
 *  auto-start — diagnostics need real state. #47 / BUG-41. */
const DIAGNOSTIC_FLAGS = new Set([
  '--messages', '--last-error', '--backtrace', '--diagnostics', '--status', '--ping',
  '--frames', '--clients', '--list-buffers', '--server-info', '--capture', '--capture-html',
]);

/** Run the trt native suite on the daemon and exit with its code
 *  (0 all-pass / 1 any-fail / 2 no-tests). In-process client — no output
 *  quoting to strip, unlike the bash $(client --eval …) round-trip. */
async function runTrtSuite(p: ParsedArgs): Promise<never> {
  await ensureDaemon(p);
  const client = new TmaxClient(SOCKET);
  await client.connect();
  try {
    const loadExpr = p.testTarget
      ? `(trt-load-file "${p.testTarget}")`
      : `(trt-load-directory "test/tlisp/")`;
    await client.sendRequest('eval', { code: `(progn ${loadExpr} (trt-run-all))` });
    const report = await client.sendRequest('eval', {
      code: p.testJson ? '(trt-results-json)' : '(trt-print-report)',
    });
    console.log(typeof report === 'string' ? report : JSON.stringify(report));
    const exitCodeRaw = await client.sendRequest('eval', { code: '(trt-exit-code-ts)' });
    const exitCode = Number(exitCodeRaw);
    process.exit(exitCode === 0 || exitCode === 1 || exitCode === 2 ? exitCode : 2);
  } finally {
    client.close();
  }
}

/** Attach the TUI by delegating to the client CLI's --tui mode — the exact
 *  bash flow (`exec tmaxclient -s … --tui [files…]`): tmaxclient opens any
 *  files through the daemon BEFORE spawning the TUI child (#52/BUG-34), and
 *  its TUI spawn is exec-target aware (source: bun tui-client.ts; binary:
 *  self-exec --tui-client). */
async function attachTui(args: string[]): Promise<never> {
  await runTmaxClient(['-s', SOCKET, '--tui', ...args]);
  process.exit(0);
}

/**
 * The launcher. Handles every terminal verb (exiting exactly where the bash
 * launcher `exec`'d) and returns the route for the two in-process paths.
 */
export async function runLauncher(argv: string[]): Promise<LauncherRoute> {
  // Diagnostic passthrough first, like the bash pre-parse loop.
  for (const arg of argv) {
    if (DIAGNOSTIC_FLAGS.has(arg)) {
      await runTmaxClient(['-s', SOCKET, ...argv]);
      process.exit(0);
    }
  }

  const p = parseArgs(argv);

  // --stop: graceful shutdown, SIGTERM fallback, always clean socket/lock
  // (#69 / BUG-55).
  if (p.stop) {
    if (await isRunning()) {
      const stopper = new TmaxClient(SOCKET);
      try {
        await stopper.connect();
        await stopper.sendRequest('shutdown', {});
        stopper.close();
      } catch { /* surfaced by the re-check below */ }
      await new Promise((r) => setTimeout(r, 1000));
      if (await isRunning()) {
        console.error('Warning: daemon did not stop gracefully, sending SIGTERM');
        const res = spawnSync('lsof', ['-t', '-U', SOCKET], { encoding: 'utf8' });
        const pid = Number((res.stdout ?? '').trim().split('\n')[0]);
        if (Number.isFinite(pid) && pid > 0) {
          try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      console.log('Daemon stopped');
    } else {
      console.log('Daemon not running');
    }
    for (const f of [SOCKET, `${SOCKET}.lock`]) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
    }
    process.exit(0);
  }

  // --sweep: delegate to the sweep CLI (BUG-29).
  if (p.sweep) {
    const sweepArgv: string[] = [];
    if (p.sweepApply) sweepArgv.push('--apply');
    if (p.sweepForce) sweepArgv.push('--force');
    process.exit(await sweepMain(sweepArgv));
  }

  // --test: trt native runner.
  if (p.testMode) await runTrtSuite(p);

  // -e: eval only, no TUI.
  if (p.evalExpr) {
    await ensureDaemon(p);
    if (p.workspace) {
      await runTmaxClient(['--workspace', p.workspace, '--eval', p.evalExpr]);
    } else {
      await runTmaxClient(['--eval', p.evalExpr]);
    }
    process.exit(0);
  }

  // Workspace management.
  if (p.workspaces) {
    await ensureDaemon(p);
    await runTmaxClient(['-s', SOCKET, '--workspaces']);
    process.exit(0);
  }
  if (p.workspaceKill) {
    await ensureDaemon(p);
    await runTmaxClient(['-s', SOCKET, '--workspace-kill', p.workspaceKill]);
    process.exit(0);
  }

  // --capture / --capture-html.
  if (p.capture) {
    await ensureDaemon(p);
    await runTmaxClient(['-s', SOCKET, p.capture === 'html' ? '--capture-html' : '--capture']);
    process.exit(0);
  }

  // --daemon only: loud failure on an occupied socket (#235 / SPEC-235);
  // the in-process daemon path lives in main.ts.
  if (p.daemonOnly) {
    if (await isRunning()) {
      console.error('Daemon already running');
      process.exit(1);
    }
    return 'daemon';
  }

  // Workspace routing: create (`new:`) then attach the TUI.
  if (p.workspace) {
    await ensureDaemon(p);
    let ws = p.workspace;
    if (ws.startsWith('new:')) {
      const created = ws.slice('new:'.length);
      const maker = new TmaxClient(SOCKET);
      try {
        await maker.connect();
        await maker.sendRequest('workspace-new', { workspaceId: created });
        maker.close();
        ws = created;
      } catch (error) {
        console.error(`Error: Failed to create workspace '${created}'`, error instanceof Error ? error.message : error);
        process.exit(1);
      }
    }
    attachTui(['--workspace', ws]);
  }

  // Last-workspace persistence, only for the bare `tmax` case (SPEC-040,
  // #52/BUG-34: with a file we must open THAT file).
  if (!p.workspace && p.files.length === 0 && existsSync(LAST_WS_FILE) && await isRunning()) {
    const lastWs = readFileSync(LAST_WS_FILE, 'utf8').trim();
    if (lastWs) {
      attachTui(['--workspace', lastWs]);
    }
  }

  // Files + a running daemon: route the files THROUGH the daemon and attach
  // the TUI (the embedded editor cannot share the daemon's state). #52/BUG-34.
  if (p.files.length > 0 && await isRunning()) {
    attachTui([...p.files]);
  }

  // No daemon: the single-process embedded editor (emacs-style — the editor
  // IS the process, socket in-process). main.ts takes over.
  return 'embedded';
}

/** Exposed for the launcher unit tests. */
export const __internals = { parseArgs, SOCKET, isRunning, waitForDaemon };

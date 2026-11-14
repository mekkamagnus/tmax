/**
 * @file exec-target.ts
 * @description #250 — process-spawn targets that work in BOTH runtimes:
 *   the source tree (`bun <entry.ts>`) and the `bun build --compile` binary,
 *   where `import.meta.dir` is the virtual root "/$bunfs/root" (ADR-0271
 *   ground truth) and `process.execPath` is the binary itself. A compiled
 *   binary cannot spawn `bin/*` scripts or `bun <src>` — it re-execs itself
 *   with an internal flag that main.ts routes in-process of the child.
 */

import { resolve } from "node:path";

/** True when running inside a `bun build --compile` binary ($bunfs layout). */
export function isCompiledBinary(): boolean {
  return import.meta.dir.startsWith("/$bunfs");
}

/** Spawn target for the TUI client child process (raw-mode/SIGINT isolation
 *  is part of the TUI design, so the launcher always spawns a child). */
export function tuiSpawnTarget(): { cmd: string; args: string[] } {
  if (isCompiledBinary()) {
    return { cmd: process.execPath, args: ["--tui-client"] };
  }
  return { cmd: process.execPath, args: [resolve(`${import.meta.dir}/../client/tui-client.ts`)] };
}

/** Spawn target for a fresh daemon process (`tmax --daemon` semantics). */
export function daemonSpawnTarget(): { cmd: string; args: string[]; cwd?: string } {
  if (isCompiledBinary()) {
    // No source tree exists; the daemon keeps the caller's cwd (a compiled
    // binary's --test is repo-checkout-scoped by nature — test/tlisp is not
    // bundled).
    return { cmd: process.execPath, args: ["--daemon"] };
  }
  // Source parity with the bash launcher's `cd "$PROJECT_DIR" && bun
  // server.ts`: the daemon resolves RELATIVE paths (notably trt's
  // test/tlisp/) against the repo root, so -e/--test work from any cwd.
  // (exec-target.ts lives at <repo>/src/cli → the repo root is two levels up.)
  return {
    cmd: process.execPath,
    args: [resolve(`${import.meta.dir}/../server/server.ts`)],
    cwd: resolve(`${import.meta.dir}/../..`),
  };
}

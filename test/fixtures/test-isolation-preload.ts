/**
 * @file test-isolation-preload.ts
 * @description Process-wide log isolation, loaded by bunfig.toml ([test]
 * preload) before every test file (#354).
 *
 * #354: 13 test files construct `new TmaxServer(socket, true)` — when no
 * editor is injected, the server builds its own Editor whose SPEC-055 log
 * defaults to ~/.config/tmax/messages.log — and
 * test/unit/fikra-thread-context.test.ts constructs an Editor directly. Both
 * wrote into the developer's real HOME unless an editor-fixture call happened
 * to run first in the same process and set TMAX_LOG_PATH. Setting the env
 * HERE, before any test code runs, isolates every Editor any test constructs,
 * whatever the test file imports.
 *
 * editor-fixture.ts still overrides this per editor (its own log file inside
 * its own per-test-file directory) — this value is only the default for
 * everything that constructs an Editor without the fixture.
 *
 * Cleanup of the temp dir this creates:
 *  - afterAll removes this process's own dir (fires per PROCESS: once per
 *    file under --isolate/--parallel, once per run in a shared-registry run).
 *    Bun's test runner does NOT run process "exit" handlers (measured), so
 *    afterAll is the only in-run hook that fires.
 *  - A later run sweeps dirs left by DEAD pids (SIGKILLed runs, or the tail
 *    of a shared-registry run). Entries are addressed by the exact
 *    `tmax-test-env-` prefix only; live pids' dirs are never touched.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "tmax-test-env-";

/** Remove `tmax-test-env-<pid>-*` dirs whose owning process is dead (#354). */
function sweepStaleEnvDirs(): void {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return; // best-effort only
  }
  for (const entry of entries) {
    if (!entry.startsWith(PREFIX)) continue;
    const pid = Number(entry.slice(PREFIX.length).split("-", 1)[0]);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0); // throws ESRCH when the pid is gone
        continue; // a live run owns it — never touch
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") continue; // alive, not ours
        // ESRCH: dead owner — stale, remove below
      }
    }
    try {
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
    } catch {
      // best-effort only
    }
  }
}

sweepStaleEnvDirs();

if (!process.env.TMAX_LOG_PATH) {
  const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${process.pid}-`));
  process.env.TMAX_LOG_PATH = join(dir, "messages.log");
  afterAll(async () => {
    // Yield one tick first — a test can leave an object that logs after the
    // last test returned, and that write would re-create the removed dir
    // (same trick as editor-fixture.ts).
    await Bun.sleep(0);
    rmSync(dir, { recursive: true, force: true });
  });
}

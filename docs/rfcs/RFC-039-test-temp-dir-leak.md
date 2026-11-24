# RFC-039: Test temp-directory leak — `tmax-test-log-*`

**Status:** Proposed. §2.3 (the backlog removal) is done, on 2026-11-25. §2.1 and §2.2 are not implemented; they are tracked in #352. #349 is open.

**Related:** #349 (the bug), #352 (execution of §2.1 and §2.2), #353 (the launcher leak), [SPEC-055](../specs/SPEC-055-unified-observability.md) (the log isolation the fixture implements), `test/helpers/editor-fixture.ts`, `src/editor/log-persist.ts`, `scripts/run-unit-tests.ts`

---

## 1. Problem

### 1.1 What happens

Every editor started through the fixture creates one directory in the system temp folder. Nothing removes it. On 2026-11-24 the temp folder on the development machine held **532,518** of them.

All figures in this RFC were measured on that machine on 2026-11-24.

| Measure | Value |
|---|---|
| `tmax-test-log-*` directories in `$TMPDIR` | 532,518 (527,282 at 12:06 local, when #349 was filed) |
| Share of all entries in `$TMPDIR` | 532,518 of 568,128 (93.7%) |
| Added by one full `bun run test:unit` | about 2,200 (#349's measurement) |
| Test files that start an editor through the fixture | 183 (177 unit, 6 integration) |
| Age (sample of 24,834 directories) | oldest 2026-11-16 03:35, newest 2026-11-24 15:18: about 62,000 a day |
| Content (sample of 250 directories) | one `messages.log`, or nothing: 193 hold the file, 57 are empty |
| Symlinks, non-directories | 0 |
| Disk | about 1.8 GB (sample average: 3,457 bytes per directory) |
| Leaking since | commit `e845b860`, 2026-06-20 |

### 1.2 Why it matters

- **The folder belongs to every program on the machine.** One lookup in it now costs about 0.3 ms, so a scan of 568,128 entries takes minutes. `/usr/bin/find -maxdepth 1 -name 'tmax-test-log-*'` took 120 s. `ls` runs past two minutes (#349), and a `du` in the session that found this exceeded a 3-minute limit.
- **The cost lands on the next caller.** Another project's test run, a backup or indexing tool, or an agent's shell command pays it. The caller then investigates a hang that is not one.
- **Nothing measures it.** The suite is green, so the leak grew for five months unseen.
- **Nothing in tmax removes the directories.** The oldest one is eight days old.

### 1.3 Cause

```ts
// test/helpers/editor-fixture.ts:186
function isolatedLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tmax-test-log-"));
  return join(dir, "messages.log");
}
// …
process.env.TMAX_LOG_PATH = isolatedLogPath();   // line 212, once per editor
```

The isolation is right and must stay (SPEC-055). Each fixture editor reads `TMAX_LOG_PATH` once, when its `LoggingRuntime` is constructed (`src/editor/runtime/logging-runtime.ts:34`). So each editor starts with an empty log, and no test appends to the developer's real `~/.config/tmax/messages.log`.

The directory is the part that nobody owns. `createEditorFixture` has a teardown: `afterEach` disposes the compatibility fixtures, and `dispose()` stops the editor and its timer. The teardown does not know the directory. No test reads the file back: `rg 'tmax-test-log|TMAX_LOG_PATH' test` finds only the helper. The one test that names `messages.log`, `test/unit/log-persist.test.ts`, uses a directory of its own and removes it.

### 1.4 The existing directories can be removed

Checked on 2026-11-24 before proposing the cleanup in §2.3:

- **Content.** Only `messages.log` or nothing (table above).
- **Not in use.** A full `lsof` run (12,962 rows) shows no process with a file, a current directory or a socket inside one. No live process has `TMAX_LOG_PATH` in its environment. No test process was running. The newest directory in the sample was written at 15:18, about 90 minutes before the check.
- **`lsof` alone is not proof.** `appendEntry` opens the log file, writes one line and closes it (`src/editor/log-persist.ts:53`), so an idle log has no descriptor. That is why the environment check is listed too.
- **A removed log directory comes back on the next write, without its earlier entries.** `appendEntry` creates a missing directory before it writes (`log-persist.ts:43`). The editor keeps working, but the entries written before the removal are gone. For these directories that is no loss: they hold the logs of finished tests.

## 2. Proposal

Parts 2.1 to 2.3 close #349. Parts 2.1 and 2.2 are tracked in #352. Part 2.4 is a follow-up with its own decision.

### 2.1 The fixture removes what it creates

One directory per test file, one log file per editor, and a module-level `afterAll` that removes the directory. All of it is inside `test/helpers/editor-fixture.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";

/** Log directory of this test file. Created on first use, removed in afterAll. */
let logRoot: string | undefined;
let logCount = 0;

function isolatedLogPath(): string {
  if (!logRoot || !existsSync(logRoot)) {
    logRoot = mkdtempSync(join(tmpdir(), "tmax-test-log-"));
  }
  return join(logRoot, `messages-${++logCount}.log`);
}

afterAll(() => {
  if (!logRoot) return;
  try {
    rmSync(logRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`[editor-fixture] could not remove ${logRoot}`, error);
  }
  logRoot = undefined;
});
```

Each editor still gets a path of its own and reads `TMAX_LOG_PATH` once, so the SPEC-055 isolation is unchanged: an empty log per editor, and a rotation file (`<path>.1`) per editor.

**Why one directory per test file.** What gets removed depends on where a module-level hook fires. That was measured on 2026-11-25 with Bun 1.4.4, on two test files that share one helper module:

| How the files are run | The module-level `afterAll` fires | One directory per editor | One directory per test file |
|---|---|---|---|
| `--parallel` (the wrapper's default) | once per file | 0 left | 0 left |
| `--isolate` (the wrapper's opt-out) | once per file | 0 left | 0 left |
| One file alone | once | 0 left | 0 left |
| Several files, no flag: one shared module | for the first file only | every later file's directories | 1 per process |

"Left" means entries whose name starts with `tmax-test-log-` after the run.

In the last row the helper is evaluated once, so its hook exists for the first file only. With one directory per test file, the later files share that directory. The first file's hook removes it, the next fixture call creates it again (`existsSync` above), and no later hook removes it. One directory is the floor for this mode. `exit` and `beforeExit` handlers do not run under `bun test`, in any of the four rows (measured the same day), so there is no later moment to sweep.

Two rules are easy to get wrong:

- **Do not clear `TMAX_LOG_PATH` in `afterAll`.** A directly constructed editor inherits the path of the last fixture editor: `test/unit/fikra-thread-context.test.ts:350` builds `new Editor(...)` without the fixture. Without the variable, that editor appends to the developer's real log.
- **Report a failed removal. Do not throw.** The `console.error` above keeps the failure visible in the output of the run and does not fail a test file. §2.2 is the check that reports a leak.

Cost: one `mkdtemp` per test file that starts an editor (about 180 per full run; the code makes about 2,200 today) and one `rmSync`.

**Limit.** `SIGKILL` runs no hook or exit handler. The wrapper sends it on inactivity and, if needed, two seconds after the summary (`run-unit-tests.ts:161` and `:136`); a forced termination can leave directories behind. §2.4 is a separate follow-up. A test may read its log while it is running; `TMAX_LOG_PATH` changes when the next fixture is created.

### 2.2 Two tests

**(a) The leak test.** A new file, `test/unit/fixture-temp-hygiene.test.ts`:

1. Create an empty directory `box` with `mkdtemp`. Remove it in the test's own `afterAll`.
2. Add two small child files under `test/fixtures/`. Their names must end in `.test.ts`, because `bun test` runs no other name. Each child starts an editor through `createStartedEditor` and does not call `dispose()`. Each then writes a marker with `editor.logMessage(...)`, waits a tick, and checks that the marker is in the file named by `TMAX_LOG_PATH`. So the test cannot pass because nothing was written. The second child also constructs `new Editor(...)` after its fixture and writes a second marker. Both children skip themselves unless `TMAX_FIXTURE_CHILD=1` is set. A plain `bun test` then never runs them, and the parent cannot find itself.
3. Run `bun test` in a child process with `TMPDIR=<box>/tmp` and `HOME=<box>/home`. Give each child a bounded timeout and keep its output. Run three children: the pair with `--parallel`, the pair with `--isolate`, and the pair with no flag.
4. For each child, assert that its tests ran and that it exited with code 0.
5. Assert what is left in `<box>/tmp`. After the first two children: no name that starts with `tmax-test-log-`. After the third: at most one such name, and it is a directory (§2.1).
6. Assert that `<box>/home/.config/tmax/messages.log` does not exist. Then no child editor fell back to the default log path.

The test must be seen to fail on the code before the fix, and the failure must be a leftover `tmax-test-log-*` entry. A spawn failure or a timeout is not that failure. Paste both runs into #352 ([learnings](../learnings.md), "a regression test must be SEEN to fail on the previous commit").

**(b) The isolation test.** No test pins the isolation today; only the helper mentions `TMAX_LOG_PATH`. Add one that exercises the paths, the writes and the tail-load:

1. Create two fixtures in one file. Read `TMAX_LOG_PATH` right after each creation.
2. Assert that the two paths differ, that both are under `tmpdir()`, and that neither is `~/.config/tmax/messages.log`.
3. Write a unique marker through each editor with `logMessage`. Wait for the queued write. Assert that each file holds its own marker and not the other one's.
4. Start a third editor on the second path. Assert that its loaded log holds the second marker and not the first.
5. Put back every environment variable the test changed.

This is a characterization of the isolation. It may pass before §2.1 exists; it is not the leak regression.

### 2.3 Remove the backlog once, on each machine that runs the suite

1. Confirm that no test run is active. This prints nothing when none is:

   ```sh
   ps -axo pid=,command= | grep -E '[b]un test([[:space:]]|$)|run-unit-tests\.ts|[b]un run test'
   ```

   Other `bun` processes are not a test run (§3 lists leaked ones). The `-mmin +30` in step 3 protects a run that starts anyway.
2. Record the count. The command reads names only and takes about a second:

   ```sh
   python3 -c "import os; print(sum(1 for n in os.listdir(os.environ['TMPDIR'] or '/tmp') if n.startswith('tmax-test-log-')))"
   ```

3. Run the removal detached. The scan alone took 147 s when measured. On the development machine the whole command took 490 s (see the record below).

   ```sh
   find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'tmax-test-log-*' -type d -mmin +30 -exec rm -rf {} +
   ```

4. Repeat step 2. Expect 0.

| Part of the command | What it protects |
|---|---|
| `-maxdepth 1` | Stays in the top level of the temp folder |
| `-name 'tmax-test-log-*'` | The exact prefix |
| `-type d` | Never follows a symlink |
| `-mmin +30` | A test that starts during the run keeps its directories |
| `-exec … {} +` | Batches the removals |

The same command without `-exec` was run on 2026-11-24 as a dry run. It matched 532,518 directories.

Do not use `rm -rf "$TMPDIR"/tmax*`, and do not remove the folder itself. The folder also holds 31,230 entries that do not belong to tmax, and §3 lists the other tmax entries.

**Executed on the development machine, 2026-11-25, by the lead.** The pre-check in step 1 printed nothing. The count was 532,518 before and 0 after. The command ran for 490 s. `$TMPDIR` went from 568,130 entries to 35,616. The scan with the command's own predicate went from 147 s to 0.34 s. The other tmax entries (§3) are unchanged: 4,380.

CI runners start empty, so they need nothing. Any other machine that runs the suite still needs the four steps.

### 2.4 Follow-up: keep the suite's temp files out of the real temp folder

This part needs its own decision. It is not required to close #349.

**The gap.** §3 shows two things: other code in the repository leaves temp directories behind, and a removal hook does not run when the process is killed. After 2.1, everything the suite leaves behind still goes into the developer's real temp folder.

**The design.** `scripts/run-unit-tests.ts` already runs `bun test` as a child (`:118`). Three changes:

1. Give the child a private run directory: `TMPDIR=<run directory>`.
2. Remove the run directory on every exit path.
3. At start, remove run directories that earlier runs left behind. The wrapper itself can be killed, so a stale run directory must not live forever.

The wrapper can then print how many entries a run left behind. That number is a leak count in the output of every run.

**What it buys.** It covers every creator, including future ones, and it bounds what a killed run leaves to one directory.

**Its limit.** It covers only runs that go through the wrapper. `bun test` run directly, by an agent or by the adw pipeline, relies on 2.1.

## 3. Same class, other creators

The same folder holds 4,380 other entries whose name starts with `tmax`: 4,378 directories and 2 files. They are 0.8% of the entries, so they are not part of the cleanup in §2.3. They are listed here because 2.4 is the measure that fits them.

| Prefix | Directories | Created by | Removed by its own code |
|---|---|---|---|
| `tmax-sync-home-` | 865 | `test/unit/server-frame-sync.test.ts:70` | Yes, in `afterEach` (`:105`) |
| `tmax-ws-` | 793 | `test/unit/window-tree.test.ts:134`, `test/unit/workspace-special-buffer-restore.test.ts:55,74,119` | No |
| `tmax-harden-home-` | 747 | `test/unit/server-daemon-hardening.test.ts:108` | Yes, in `afterEach` (`:125`) |
| `tmax-sweep-` | 361 | `test/unit/sweep-reap-escalation.test.ts:47,84` | No |
| `tmax-proj-` | 254 | `test/unit/project-ops.test.ts:21` | No |
| `tmax-bench-` | 267 | `bench/editor-harness.ts:25` | No |
| `tmax-cwd-` | 265 | `test/unit/process-ops.test.ts:35` | No |
| `tmax-snip-` | 262 | `test/unit/snippet-mode.test.ts:10` | No |
| `tmax-home-` | 253 | `test/unit/markdown-daily-note.test.ts:89`, `test/unit/server-save-file.test.ts:118`, `test/integration/workspace-lifecycle.test.ts:23` | Yes, except in the integration file (3 `mkdtemp`, 2 removals) |
| `tmax-daemon-start.` | 172 | `src/cli/launcher.ts:113` (product code) | Removes the log file, not the directory |
| `tmax-man-` | 53 | `test/unit/man-page-viewer.test.ts:27` | Yes |
| `tmax-capture-home-` | 28 | `test/unit/daemon-capture-parity.test.ts:81` | Yes |
| `tmax-capture-` | 21 | `test/unit/capture-daily.test.ts` | Yes, each one |
| `tmax-ledger-scrape-` | 2 files | `scripts/ledger-scrapers.sh:38` | Not litter: the scraper logs |
| other `tmax*` | 37 | `tmax-re-` (`test/unit/remote-editor.test.ts:31`), `tmax-vault*` (wiki-link tests), not classified | Partly |

Four findings follow from the table:

- **The launcher leaks one empty directory each time it starts a daemon.** `ensureDaemon` creates `tmax-daemon-start.XXXX/log` (`src/cli/launcher.ts:113`). It removes the log file after the daemon starts (`:131`, `:144`) and leaves the directory. There are 172, the oldest from 2026-11-14. The fix is to remove the directory instead of the file. This is product code, so it has its own issue: #353.
- **A removal hook does not guarantee removal.** Several creators remove their directories during teardown, yet at least 1,714 of their directories are present. Two reasons are visible in the code and the data. First, `SIGKILL` runs no hook: 14 `tmax-capture-*` directories were created between 01:47 and 01:57 on 2026-11-24 and are still there, although `capture-daily.test.ts` removes every directory it creates. Second, the hook may not know the directory: `server-frame-sync.test.ts` creates its directory at `:70`, and `afterEach` learns the path only at `:97`, after the server has started.
- **One test writes to the default log when it is run alone.** `test/unit/fikra-thread-context.test.ts:350` constructs `new Editor(...)` without the fixture, so it is isolated only when a fixture ran earlier in the same process. Run with a name filter and a private `HOME`, it wrote 36 lines to `$HOME/.config/tmax/messages.log` (2026-11-25). In a developer's session that file is the real log. §2.1 does not change this. It needs a small issue of its own.
- **Not a temp directory, found in the same check.** 44 `bun` processes leaked from `test/unit/adw-process-cleanup.test.ts` on 2026-11-22 are still running. They ignore `SIGTERM` and use about 625 MB. This also deserves its own issue.

## 4. Alternatives considered

| Alternative | Why it was not chosen |
|---|---|
| One directory per editor, removed in `afterAll` (the first design of this RFC) | In a shared-module run the hook exists for the first file only, so every later file's directories stay (§2.1). |
| An extra sweep in a process `exit` handler | `exit` and `beforeExit` handlers do not run under `bun test` (§2.1). |
| A sweep hook registered from inside a test | Measured: it sweeps after every test, in every mode. It removes directories while earlier editors of the file can still write to them, and it relies on undocumented hook timing. |
| A switch that turns log persistence off in tests | The tests would no longer exercise the logging path that the product uses. |
| A periodic cleanup, with no code change | It treats the symptom. About 62,000 directories arrive each day, and each cleanup pays for a scan of the folder. |
| Runner containment only (§2.4) | It protects the real temp folder, but `bun test` run directly still leaks. The leak must stop at its source. |
| `fs.mkdtempDisposable` | It is not available in the installed Bun (`typeof fs.mkdtempDisposable` is `undefined`). |
| Wait for the OS, or reboot | Not relied on. Nothing removed these directories in eight days. A reboot may clear the folder; that was not verified. |

## 5. Acceptance criteria

- [ ] **AC1.** The leak test (§2.2a) fails on the code before the fix and passes after it. Both outputs are in #352.
- [ ] **AC2.** The isolation test (§2.2b) passes, including the writes and the tail-load. In the full run of AC3, which uses a private `HOME`, no `.config/tmax/messages.log` appears under that `HOME`.
- [ ] **AC3.** One full `bun run test:unit` run with `TMPDIR` set to a new empty directory leaves no `tmax-test-log-*` entry in it. The count and the suite result are in #352. A run that was killed before its summary line does not count.
- [x] **AC4.** The backlog is removed on the development machine (2026-11-25): 532,518 before, 0 after. `$TMPDIR` holds 35,616 entries.
- [x] **AC5.** The launcher leak (§3) has an issue of its own. The issue created during review is [#353](https://github.com/mekkamagnus/tmax/issues/353).

## 6. Open questions

1. **When does §2.4 happen?** Recommendation: after 2.1 to 2.3, in its own issue.
2. **Fix the other test creators one by one, or let §2.4 cover them?** Recommendation: §2.4 covers the suite. The launcher is fixed on its own, because it is product code.
3. **Which other machines run the suite, and what do their temp folders hold?** mekkapi mirrors the repository. The count command in §2.3 works there too.
4. **What removed the directories older than 2026-11-16 03:35?** The code has leaked since June. Entries of other families from 2026-11-10 are still present, so it was not a system-wide clean. The cause was not found.
5. **Does a workflow exist that reads a test's log after the run?** None is documented and no test does it. If one exists, §2.1 needs a way to keep the directories of failed tests.
6. **Does the filtered-run hole in §3 get its own issue?** Recommendation: yes. The fix is small: give that one direct construction an isolated path.

## 7. Review record

2026-11-25

Reviewed by: codex

Checked: #349 and its comments; the fixture and logging runtime/persistence; unit runner modes and termination paths; the cited test and launcher code; the regression-test learning; the RFC's design, tests, acceptance criteria, scope and open questions. Historical measurements and the backlog removal were accepted as the lead's records, not re-measured.

Changes:
- Qualified the per-editor leak claim: the cited allocation is in the fixture.
- Added a normal-exit sweep and retained directory tracking: shared module caches and later writes can outlive a file hook.
- Made lifecycle and direct-editor assumptions explicit: hook timing, queued writes and inherited paths require verification.
- Specified contained child tests across runner modes and real log isolation: prevent vacuous leak and isolation checks.
- Strengthened AC1–AC3 and moved evidence to the implementation ledger: measurable results must not depend on modifying #349.
- Qualified the deletion claim: recreation does not preserve deleted log contents.
- Corrected the teardown description: `capture-daily.test.ts` uses `finally`, not a hook.
- Recorded the execution issue [#352](https://github.com/mekkamagnus/tmax/issues/352) and launcher issue [#353](https://github.com/mekkamagnus/tmax/issues/353): make both follow-ups traceable.

Not verified: Bun's hook and process-exit behavior in each mode, queued-write timing, filtered direct-editor isolation, and the proposed tests' old/new results; this review ran no tests. Historical machine measurements and cleanup were not rechecked. The normal-exit sweep is a design to validate, not a guarantee for SIGKILL.

### Lead's check of the review, 2026-11-25

The review ran no tests. Each of its design claims was measured before it was accepted (Bun 1.4.4; two test files sharing one helper module).

- **Kept.** The qualified claims in §1, the teardown wording in §3, the stricter isolation test, the rule against clearing `TMAX_LOG_PATH`, and the link to #353.
- **Replaced: the sweep in a process `exit` handler.** `exit` and `beforeExit` handlers registered by the helper did not run under `bun test` in any mode. A sweep there never happens.
- **Replaced: the design.** One directory per editor with an `afterAll` sweep leaves every later file's directories in a shared-module run. §2.1 now uses one directory per test file, which leaves one directory per process in that run (table in §2.1).
- **Replaced: "the implementation ledger".** The evidence goes to #352.
- **Corrected: the child files.** `bun test` runs no file whose name does not end in `.test.ts`, so the children cannot sit outside that pattern. They skip themselves unless a marker variable is set.
- **Corrected: AC3.** The suite on `main` fails 21 known tests (#345) and the wrapper force-exits it after its summary line, so "a forced or failed run does not satisfy" could not be met. AC3 now excludes only a run that was killed before its summary line.
- **Measured: the filtered-run hole.** The review called it unverified. It is real, and §3 records it.

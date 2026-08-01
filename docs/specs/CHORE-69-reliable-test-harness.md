# Chore: Reliable test harness for the embedded-editor path (BUG-58 class)

## Chore Description
BUG-58 (`tmax file.md` → `:w` wrote nothing to disk) reached users despite a
"green" test suite. This chore closes the structural coverage gap that let it
through and hardens the suite so the same class of bug cannot ship again.

This is a **master spec**; the work is tracked as 4 GitHub issues (A–D below),
each implemented through the issue-burn-down loop with its own verify-gate + ADR.

## Root cause (why BUG-58 slipped through)
Confirmed independently by Claude + `codex exec` (gpt-5.6-sol), reading the
actual files:

1. **Two sources of truth for the filename.** A buffer's filename lives in
   `bufferMetadata[name].filename`, while the model exposes a *derived*
   `currentFilename` that `setCurrentBuffer` re-derives from that metadata on
   every `buffer-insert` (`editor.ts` ~351-354). Two stores that can diverge.
2. **Two file-open bootstrap paths that drifted.** `Editor.openFile()`
   (`editor.ts`) sets `bufferMetadata.filename`; `src/main.ts`'s bootstrap did
   NOT (CHORE-44 Change 10). They are parallel implementations of the same user
   operation.
3. **All save/`:w` coverage exercises only the daemon RPC path**
   (`server-save-file.test.ts`, `save-chain.test.ts`, `wq-save-gate.test.ts`) —
   all green, all hitting `openFile`, never `main.ts`.
4. **`tmax-use` only ever spawns `src/server/server.ts`**
   (`tmax-use/src/instance.ts:60`); its headed mode just launches `tmaxclient`
   against that daemon. The embedded `src/main.ts` path — what users hit with
   `tmax file.md` when no daemon is up (`bin/tmax:359/361`) — is invisible to the
   entire e2e layer.
5. **The one existing `:w` playbook asserts only the `"Saved"` *message*, not
   disk content** — so it would pass even when nothing was written.
6. **`server-daemon.test.ts:19` shells to GNU `timeout`** (absent on stock
   macOS) — a culturally-tolerated-red test that erodes "red = real".

Codex's recommended sequence (accepted): **regression test → unify → keep the
black-box test.** First prove a black-box test fails against `7d3f0c8^`, then
unify the file-open path into one Editor-owned primitive, then retain the
black-box test to catch what unit tests cannot.

## Relevant Files
- `tmax-use/src/instance.ts` — current daemon-only spawn harness; model for the new embedded-instance.
- `tmax-use/tests/*.tmax-use.ts` — existing e2e test pattern to follow.
- `src/editor/editor.ts` — `openFile()` (~2282), `createBuffer()` (~2236), `associateBufferFilename()`, the `setCurrentBuffer` filename re-derivation (~351-354).
- `src/main.ts` — bootstrap (the file-open path to unify, ~247-253).
- `src/server/server.ts` — `startEditor()` cleanStart semantics (~916-926).
- `bin/tmax` — launcher routing (embedded vs daemon, ~354-361).
- `test/unit/server-daemon.test.ts` — the `timeout` test to fix.
- `test/integration/{save-chain,wq-save-gate}.test.ts`, `test/unit/server-save-file.test.ts` — existing daemon-path coverage to preserve.

## Issues (tracking)
- **#77 (alpha-blocker)** — Issue A — Embedded-editor black-box e2e: drive real `bin/tmax`, `:w`, assert disk. **Done first.**
- **#80 (refactor, blocked by #77)** — Issue B — Unify file-open into one Editor-owned `open-or-create-file`.
- **#78 (test)** — Issue C — `cleanStart` semantics unit test.
- **#79 (test)** — Issue D — Fix `server-daemon.test.ts` `timeout` → Bun-native deadline.

---

## Step by Step Tasks
Each issue is implemented independently through the burn-down loop. Completion
criteria below are what each issue's verify-gate checks.

### Issue A — Embedded-editor black-box save e2e (alpha-blocker)

**Goal**: a black-box test that drives the REAL `bin/tmax` embedded editor,
saves, and asserts the file landed on disk — the test that would have caught
BUG-58.

- Create `tmax-use/src/embedded-instance.ts`: a minimal reusable lifecycle that
  spawns `bun src/main.ts <file>` (repo-local) under an **isolated `HOME`** and a
  **unique `TMAX_SOCKET`**, drives keystrokes over a PTY/tmux, and tears down
  deterministically. It MUST **fail loudly if the launch silently routes through
  a pre-existing daemon** (per `docs/learnings.md`: "Repository-local tmax must
  run repository code" + `bin/tmax` daemon-routing at ~354).
- Create `tmax-use/tests/embedded-save.tmax-use.ts`: open a NEW file, drive
  `i` → type `MARKER-<n>` → `Escape` → `:` → `w` → `Enter`, then assert the file
  exists on disk with EXACT content `MARKER-<n>` (not the `"Saved"` message).
  Also cover an EXISTING file (append + save preserves prior content).
- **Regression proof**: temporarily check out `7d3f0c8^` and show the new test
  FAILS there (the embedded path wrote nothing). Record the failure output in
  the issue close comment + ADR.

**Completion Criteria (verify-gate)**:
- [ ] `tmax-use/src/embedded-instance.ts` spawns `src/main.ts` (not the daemon) with isolated HOME + socket.
- [ ] `embedded-save.tmax-use.ts` asserts EXACT disk content after `:w` for both a new file and an existing file.
- [ ] The harness fails loudly (test error, not silent pass) if a pre-existing daemon would hijack the launch.
- [ ] Demonstrated (in the issue/ADR) that the test FAILS on `7d3f0c8^` and PASSES on the fixed tree.
- [ ] `bun run typecheck:tmax-use` clean; `bin/tmax-use test` green.

### Issue B — Unify file-open into `open-or-create-file` (refactor, blocked by A)

**Goal**: one Editor-owned file-open primitive so `main.ts` and the daemon RPC
cannot drift again. Issue A's e2e must land first so unification regressions are
caught.

- Add `Editor.openOrCreateFile(filename)` (or equivalent) that: reads the file
  (existing content) OR treats ENOENT as "new file" (empty buffer + `New file:`
  status), then does `createBuffer` + `SetCurrentFilename` +
  `associateBufferFilename` + major-mode activation — the shared post-read setup.
  **Do NOT blindly call current `openFile()`**: its read-failure leaves the
  previous buffer intact, whereas CLI startup must CREATE a new-file buffer
  (codex).
- Route `src/main.ts`'s bootstrap through it (replacing the manual
  `createBuffer` + `SetCurrentFilename` + `associateBufferFilename` block).
- Keep the daemon `open` RPC working (it may call the same primitive or keep
  `openFile` — but the buffer-metadata setup must be shared, not duplicated).
- Add `test/unit/editor-open-file.test.ts`: the unified path preserves
  `(buffer-filename)` after a `buffer-insert` (the exact BUG-58 invariant), and
  saves both an existing and a new file.

**Completion Criteria (verify-gate)**:
- [ ] `main.ts` and the daemon open path share ONE buffer-metadata/filename setup (no duplicated truth).
- [ ] `(buffer-filename)` survives `buffer-insert` on the unified path (unit test).
- [ ] Existing-file and new-file (ENOENT) cases both save correctly (unit test).
- [ ] Daemon-path save tests (`server-save-file`, `save-chain`, `wq-save-gate`) stay green — no regression.
- [ ] Issue A's embedded-save e2e stays green after the refactor.
- [ ] `bun run typecheck` clean.

### Issue C — `cleanStart` semantics unit test

**Goal**: lock the BUG-58 server.ts fix (cleanStart must not discard a preloaded
file) with a fast unit test.

- Add `test/unit/server-start-editor.test.ts`: construct a `TmaxServer` with
  `cleanStart=true` over an editor that already has a file buffer + `currentFilename`
  set; after `startEditor()`, assert `currentFilename` is unchanged AND the buffer
  was NOT switched to `*scratch*`. Separately, with no file preloaded, assert it
  DOES land on `*scratch*`.

**Completion Criteria (verify-gate)**:
- [ ] `cleanStart=true` + preloaded file ⇒ `currentFilename` preserved, buffer unchanged.
- [ ] `cleanStart=true` + no file ⇒ lands on `*scratch*`.
- [ ] Test fails on the pre-fix `server.ts` (guard removed) and passes after.
- [ ] `bun run test:unit` green for this file.

### Issue D — Fix `server-daemon.test.ts` `timeout` (Bun-native deadline)

**Goal**: kill the tolerated-red test by replacing the non-portable `timeout`
shell command with a Bun-native child deadline so it runs (and passes) on macOS
and Linux.

- Replace `execAsync(\`... timeout 8s bun run src/main.ts --daemon || true\`)`
  with `Bun.spawn` (argv form), wait for the "tmax server listening" readiness
  line, then `SIGTERM` → bounded `SIGKILL` → `await exit`. Assert readiness output
  contains "tmax server listening" and no "error:".
- Deterministic teardown: ensure the spawned daemon + socket are reaped
  (`sweepTestSockets()` already runs in finally).

**Completion Criteria (verify-gate)**:
- [ ] No `timeout`/coreutils dependency; uses `Bun.spawn` + a JS deadline.
- [ ] Test PASSES on macOS (the platform it currently fails on).
- [ ] Spawned daemon + socket are deterministically reaped.
- [ ] `bun run test:unit` green for this file.

## Validation Commands
- `bun run typecheck` — clean (covers src + test).
- `bun run typecheck:tmax-use` — clean.
- `bun run test:unit` — green (incl. new `editor-open-file`, `server-start-editor`, fixed `server-daemon`).
- `bin/tmax-use test` — green (incl. new `embedded-save`).
- Regression proof for Issue A: the new e2e FAILS on `7d3f0c8^`, PASSES on HEAD.

## Notes
- Codex review (gpt-5.6-sol) is posted as a "Codex review" comment on each issue;
  the burn-down verify-gate consumes it.
- Issue A is `alpha-blocker` (highest selection priority). Issue B carries the
  `blocked` label with a `> ⛔ **Blocked by #<A>**` banner; the burn-down
  auto-unblocks it when A lands. C and D are independent `test` issues and may
  batch with each other (non-overlapping files) but should not batch with B
  (B touches `src/`).
- The deeper architectural lesson (two filename truths) is recorded in
  ADR-0163; this chore makes the test layer enforce it.

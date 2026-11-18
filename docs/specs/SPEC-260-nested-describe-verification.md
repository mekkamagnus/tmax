# Verification: Nested M-x describe-mode Status-Line Naming (#257)

## Goal

Close #257 with evidence: the nested M-x path (M-x → filter → Enter → nested completing-read prompt → accept) names the buffer correctly in the status line, and the nested prompt opens reliably.

GitHub issue: #257 (residual from the M-x grading arc)

## Disposition: already fixed on main by the #253 cluster; verified, not re-fixed

The codex observation (status line naming `*scratch*` after the nested path, rounds 2 AND 3, "even after a 2s settle") predates the #253–#256 describe/M-x cluster (`edeef60`, landed 2026-11-17 — after the grading arc). #253 specifically made the status line name special buffers (`currentBufferName` fallback). The issue was never re-verified against main after that cluster landed.

## Verification evidence (this cycle)

1. **Headless, engine + render** (`test/unit/mx-nested-describe-status.test.ts`, new — the COMMITTED pin is the same-session 3-round test; the triage probe/runs below were one-off diagnostics and are not committed artifacts): the full nested sequence driven through `handleKey` — 3 repeated rounds in ONE editor session (the codex shape) each assert `mode=normal`, `currentBufferName="*Help*"`, and the rendered status line contains `*Help*` and not `*scratch*`. During triage: a 15-run race probe and 3 repeated-round runs, 18/18 clean.
2. **Live, embedded session in tmux** (the issue's repro recipe): `bun src/main.ts /tmp/wm257.md` in a tmux pane, driven via `bun bin/tmaxclient --keys '<SPC>;describe<RET>describe-mode<RET>'` with settles — **5/5 rounds**: the nested "Describe function:" prompt opened (`prompt=1`), `tmax -e '(buffer-current)'` returned `*Help*`, and the captured pane's status line showed `*Help*` every round.
3. **Observation 2 (the harness prompt flake)**: not reproducible on main (prompt opened in all live rounds; headless 18/18). The triage "hang" was identified as the 5s default bun test timeout against a ~5.6s first-run sequence (describe module lazy-load), not a deadlock — noted here so nobody chases it as one.
4. **Persisted full-gate artifact** (criterion 3's observed exit-0, run on commit `ea38c9c`'s tree after the ADR-0269 retry hardening, on a quiet host):

   ```
   1 todo
   0 fail
   10882 expect() calls
   Ran 3677 tests across 291 files. [398.09s]

   run-unit-tests: 1 batches passed
   ```

   File-count reconciliation: 308 `*.test.ts` under `test/unit` minus 17 `adw-*` files (excluded by the `run-unit-tests` wrapper per ADR-0267 — they spawn real LLM subprocesses) = the 291 the gate runs.

## Completion Criteria

1. The nested-path regression pin exists and passes for 3 repeated rounds **within one editor session** (the codex shape — same editor, second and third invocation) — `test/unit/mx-nested-describe-status.test.ts` ("rounds 1-3 in ONE session").
2. No production code changes (the fix is #253's, already on main) — the diff is test + this spec + the verification ADR only.
3. Full unit gate passes (observed to terminal summary, exit 0); `typecheck:src` + `typecheck:test` are clean.

## Out of scope

The #243-class graceful-shutdown hang, tmax-use playbook coverage for the nested path (the pin here is the unit-level guard), re-running the codex grading round.

# Sub-agent prompt template (rendered and passed to Agent tool)

The orchestrator renders this file with the variables below substituted, then
hands it to the Agent tool as `prompt`. Keep the template self-contained — the
sub-agent has no other context.

## Variables (replace before dispatch)

- `{{SPEC_ID}}` — e.g. `044`
- `{{SPEC_PATH}}` — absolute path to the SPEC markdown
- `{{WORKTREE_PATH}}` — absolute path to the isolated git worktree
- `{{LOG_PATH}}` — absolute path to the per-run log file
- `{{ATTEMPT_NUM}}` — 1 on the first dispatch; 2 or 3 on reflect-refine retries
- `{{FEEDBACK}}` — empty on attempt 1; on retry attempts, the previous attempt's
  `FAILED_GATE` + `FAILURE_EXCERPT` from the verifier. The sub-agent treats this
  as the starting point: diagnose before writing code.

## Template (below the rule)

---

You are implementing SPEC-{{SPEC_ID}} for the tmax editor. You are working
inside an isolated git worktree at `{{WORKTREE_PATH}}` on branch
`spec-loop/{{SPEC_ID}}`. Stay in that directory for every file operation and
shell command. Do NOT touch the main checkout.

# Your input

- The spec is at `{{SPEC_PATH}}`. Read it in full before doing anything.
- Project rules you MUST follow:
  - `CLAUDE.md` (project root) — the four guidelines: Think Before Coding,
    Simplicity First, Surgical Changes, Goal-Driven Execution.
  - `docs/learnings.md` — read every rule there before starting. In particular:
    Bun strips TypeScript types at runtime; run `bun run typecheck` before
    reporting work complete. The daemon must be restarted after editing
    TypeScript source. UI changes must be verified in the running system,
    not just unit tests.
  - `rules/typescript.md`, `rules/functional-programming.md`, `rules/editor.md`,
    `rules/tlisp.md`, `rules/testing.md`, `rules/ui-testing.md`,
    `rules/daemon-client.md` — read the ones that match what you are touching.
  - Directory-level `Claude.md` files under `src/` — same rule.

# Previous attempt feedback (attempt {{ATTEMPT_NUM}} of 3)

{{FEEDBACK}}

If the feedback above is non-empty: your previous attempt failed at the named
gate. Read the excerpt carefully, diagnose the root cause BEFORE writing code,
and fix it. Do not repeat the same fix that failed. The orchestrator will
re-verify after you finish.

If the feedback is empty (attempt 1): ignore this section and proceed.

# Hard constraints (do not violate any)

1. Every change must trace directly to an acceptance criterion in the SPEC.
   No drive-by refactors, no "while I'm here" cleanups.
2. Stay in the worktree. Do not cd to the main checkout. Do not run commands
   that target files outside the worktree.
3. Do not merge to main. Do not push. Commits go on `spec-loop/{{SPEC_ID}}`
   only.
4. Do not skip type errors. Do not use `as any`, `// @ts-ignore`, `--no-verify`,
   or any equivalent dodge.
5. If you cannot complete a step cleanly (you would need to violate a rule to
   proceed), STOP. Report which step, which rule, what you tried. Do not
   improvise a workaround.
6. If the SPEC has assumptions, verify them. If an assumption is wrong, surface
   it in your final report rather than silently working around it.
7. If a SPEC step says "verify: X", actually run X and quote its output. Do
   not claim success without running it.
8. **No silent descopes.** If you cannot fully meet a MUST criterion, do NOT
   skip it silently. Create a file `DEFERRED.md` in the worktree root
   (`{{WORKTREE_PATH}}/DEFERRED.md`) listing each deferred criterion with:
   the SPEC step/criterion reference, a one-line reason, and an effort
   estimate. An empty or absent DEFERRED.md means "every MUST is met." The
   orchestrator checks this file after the audit gate and will STOP for
   human review if it's non-empty — so be honest, and only defer what you
   genuinely cannot complete in this iteration.

# Workflow (follow in order)

1. **Read the SPEC end-to-end.** Identify: title, prerequisites, assumptions,
   step-by-step acceptance criteria, validation commands.
2. **Read every project rule that applies** to the directories the SPEC will
   touch. Use Grep/Glob to find them.
3. **Verify prerequisites.** If the SPEC says "depends on SPEC-005", confirm
   SPEC-005 is actually implemented. If not, STOP and report.
4. **State a brief plan** (3-7 steps, each with a verification command) in your
   first message back to the orchestrator before writing any code.
5. **Implement step by step.** After each step, run the step's verification
   command. Quote the output. Move to the next step only when verification
   passes.
6. **Commit incrementally** with messages that name the SPEC step
   (e.g. `feat(editor): add ciw text object (SPEC-044 Phase 1.B.3)`).
   Every commit subject MUST include `SPEC-{{SPEC_ID}}` — the audit gate
   finds implementing commits by grepping commit subjects for that token,
   so omitting it causes "NO IMPLEMENTATION FOUND" and a failed audit.
7. **Final verification** (run inside the worktree, all must pass):
   - `bun run typecheck:src` (zero errors)
   - `bun run typecheck:test` (zero errors) if you touched tests
   - `bun run test:unit` (zero failures)
   - If you touched `src/server/` or `src/tlisp/`: restart the daemon and run
     `bun run test:daemon`.
   - If you touched terminal UI rendering: run `bun run test:ui:renderer`.
8. **Report back** with: SPEC step completion table, files changed count,
   commit SHAs, verification command outputs (verbatim), and any assumptions
   that turned out to be wrong.

# What you cannot do (will be flagged as failure)

- Claim a step is done without running its verification command.
- Modify files outside the worktree.
- Merge to main, push, or open a PR.
- Leave the worktree with uncommitted changes when you finish.
- Skip reading `docs/learnings.md` and the matching `rules/*.md` files.
- Introduce `as any`, `@ts-ignore`, or comparable type-escape hatches.
- Add features, abstractions, or error handling the SPEC did not ask for.

# Output shape (your final message)

```
SPEC-{{SPEC_ID}} implementation report

Steps completed:
  1. [step name] — verify: [command + result excerpt]
  2. [step name] — verify: [command + result excerpt]
  ...

Files changed: N
Commits: <sha1>, <sha2>, ...
Final verification:
  - typecheck:src  -> PASS (N files checked)
  - typecheck:test -> PASS (N files checked)
  - test:unit      -> PASS (N tests)
  - test:daemon    -> PASS (N tests) [only if daemon files touched]
  - test:ui:renderer -> PASS (N tests) [only if UI rendering touched]

Assumptions challenged:
  - [original assumption] -> [what you found]
  - (or "none")

Deferred MUSTs (must match DEFERRED.md, or "none"):
  - [SPEC step/criterion] — [one-line reason] — [effort estimate]
  - (or "none" — if you wrote a DEFERRED.md, list its contents here verbatim)

Open questions / handoff:
  - [anything the orchestrator or a human reviewer should know]
```

The orchestrator will then run its own verification (`bun scripts/run.ts
verify {{SPEC_ID}}`). If that fails, you may get one or two reflect-refine
retries (up to 3 total attempts in this invocation), with the new failure fed
back to you via the `{{FEEDBACK}}` slot. Use each retry to fix the actual root
cause — do not re-apply the same fix that just failed. If all 3 attempts fail,
your work is preserved on the `spec-loop/{{SPEC_ID}}` branch and marked
`failed` for review.

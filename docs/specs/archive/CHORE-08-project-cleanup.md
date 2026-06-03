# Chore: Project Cleanup — Remove Stale and Unnecessary Files

## Chore Description
The project has accumulated files from early development that are no longer needed: one-off test scripts, implemented specs, generated HTML, empty directories, and Deno remnants. Remove them to leave only code and documentation that is necessary and up-to-date.

## Relevant Files

All files listed below are candidates for deletion. No new files are created.

### New Files
None.

## Step by Step Tasks

### Step 1: Delete one-off test scripts in `scripts/` (15 files)

These were ad-hoc debugging scripts used during development. Functionality is now covered by `bun test` and `test/ui/`.

```
scripts/test-binding.ts
scripts/test-command-mode-entry.ts
scripts/test-command-pipeline.ts
scripts/test-commands.ts
scripts/test-core-bindings-loading.ts
scripts/test-core-line-by-line.ts
scripts/test-final-commands.ts
scripts/test-immediate-display.ts
scripts/test-init.ts
scripts/test-insert-mode.ts
scripts/test-keys.ts
scripts/test-real-insert-mode.ts
scripts/test-real-usage.ts
scripts/test-render.ts
scripts/test-terminal-flush.ts
```

**Keep:** `scripts/repl.ts`, `scripts/install.sh`, `scripts/update-adr-status.sh`, `scripts/build-binaries.ts`

### Step 2: Delete implemented/stale SPECs in `specs/` (27 files)

These specs describe work that is either fully implemented, superseded by later specs, or was a transient status summary.

```
specs/SPEC-001-update-delete-notes.md              — basic notes, long implemented
specs/SPEC-002-spec-prompt-template.md              — template, no longer needed
specs/SPEC-004-tlisp-core-bindings-migration.md     — implemented
specs/SPEC-005-tlisp-centric-keybindings.md         — implemented
specs/SPEC-006-implementation-spec-save.md           — superseded by SPEC-008 then SPEC-032
specs/SPEC-007-design-save-functionality.md          — superseded by SPEC-032
specs/SPEC-008-implementation-spec-save-improved.md  — superseded by SPEC-032
specs/SPEC-009-migrate-ui-to-deno-ink.md             — implemented
specs/SPEC-011-chore_terminal_ui_event_loop.md       — implemented
specs/SPEC-012-chore_fix_typescript_errors.md        — implemented
specs/SPEC-013-chore_keybinding_migration_phase1.md  — implemented
specs/SPEC-014-chore_keybinding_phase2.md            — implemented
specs/SPEC-015-chore_ui_test_suite_tmux.md           — implemented
specs/SPEC-016-typescript_error_fixes_summary.md     — transient status summary
specs/SPEC-017-terminal_ui_complete.md               — implemented
specs/SPEC-018-terminal_ui_implementation_status.md  — transient status summary
specs/SPEC-019-test_window_management_fix.md         — implemented
specs/SPEC-020-ui_test_status.md                     — transient status summary
specs/SPEC-021-terminal_ui_final_status.md            — transient status summary
specs/SPEC-022-fix-character-insertion-bug.md        — implemented
specs/SPEC-023-deno-ink-tui-completion.md            — implemented
specs/SPEC-024-chore_ui_test_refactoring.md          — implemented
specs/SPEC-025-init-file-refactor.md                 — implemented
specs/SPEC-026-test-failures-investigation.md        — investigation complete
specs/SPEC-027-ci-cdx-pipeline-and-code-quality-improvements.md — implemented
specs/SPEC-028-binary-compilation-and-distribution.md — implemented
specs/SPEC-029-chore-remove-deno-tests.md            — implemented
specs/SPEC-030-fix-k-key-and-quit.md                 — implemented
```

**Also delete:**
- `specs/SPECS_INDEX.md` — references deleted specs, would need full rewrite
- `specs/archive/SPEC-024-chore_functional_refactoring.md` — archived and stale

**Keep:**
- `SPEC-003-core-editor.md` — core PRD, still canonical
- `SPEC-031-test-suite-health-and-optimization.md` — recent and relevant
- `SPEC-032-save-file.md` — recent implementation spec
- `SPEC-033-messages-buffer.md` — recent implementation spec
- `SPEC-034-emacs-daemon-client-parity.md` — recent, architecture direction
- `SPEC-035-daily-drivers.md` — recent comprehensive roadmap
- All BUG-* and CHORE-* files (current issues)
- `prd.md` — active PRD

### Step 3: Delete generated HTML files (4 files)

These are rendered versions of markdown specs/docs that can be regenerated if needed.

```
architecture.html
CHORE-02-interchangeable-frontend.html
docs/srs.html
specs/CHORE-04-system-improvements.html
```

### Step 4: Delete `coverage/` directory (39 files)

Coverage reports are regenerable. Should not be in the repo.

```
rm -rf coverage/
```

### Step 5: Delete Deno remnant

```
deno.lock
```

### Step 6: Delete empty `docs/api/` directory

Empty directory — no content.

### Step 7: Delete interactive demo scripts from `test/ui/` (2 files)

Not part of the actual test suite, just interactive demos.

```
test/ui/demo-interactive.sh
test/ui/interactive-test.sh
```

### Step 8: Update `.gitignore`

Ensure these are covered:
```
coverage/
*.html
```

### Step 9: Validate

Run type checking and tests to confirm nothing references deleted files.

## Validation Commands
- `bunx tsc --noEmit` — confirm no type errors (deleted scripts shouldn't break anything, but verify)
- `bun test` — confirm all tests still pass
- `git status` — review the full diff of deletions before committing

## Notes
- **Do NOT delete:** `scripts/repl.ts`, `scripts/install.sh`, `scripts/update-adr-status.sh`, `scripts/build-binaries.ts`, any `rules/` files, any `examples/` files
- The remaining `docs/` files (ADRs, manual, contributing, examples) are kept — they are user-facing documentation
- `docs/ROADMAP.md` is kept as it describes the long-term vision, even if the project status has evolved
- `docs/srs.md` is kept as the formal requirements specification
- Total: ~88 files/dirs deleted, leaving a clean project with only active code and current documentation

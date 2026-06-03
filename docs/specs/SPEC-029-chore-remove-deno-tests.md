# Chore: Remove All Deno Tests

## Chore Description
Remove all remaining Deno-style tests and references to Deno testing framework from the codebase. The project has been migrated from Deno to Bun runtime, but there are still leftover test files and documentation references that need to be cleaned up.

The `test/frontend-disabled/` directory contains tests that still use `Deno.test()` syntax and are meant to be disabled. Additionally, there are `.bak` backup files and markdown documentation that references the old `deno test` command.

## Relevant Files
Use these files to resolve the chore:

### Files to Delete
- `test/frontend-disabled/editor-component.test.tsx` - Contains Deno.test() syntax and uses deno-ink imports
- `test/frontend-disabled/ink-adapter.test.ts` - Part of disabled frontend tests
- `test/frontend-disabled/ink-adapter-error-handling.test.ts` - Part of disabled frontend tests
- `test/frontend-disabled/edge-cases.test.ts` - Part of disabled frontend tests
- `test/frontend-disabled/file-io-error-handling.test.ts` - Part of disabled frontend tests
- `test/frontend-disabled/us-011-terminal-resize-core.test.ts` - Part of disabled frontend tests
- `test/frontend-disabled/us-011-terminal-resize.test.ts` - Part of disabled frontend tests
- `test/unit/test-better-cli-output.test.ts.bak` - Backup file
- `test/unit/text-objects.test.ts.bak` - Backup file
- `test/frontend-disabled/` - The entire directory (after deleting files)

### Files to Update (Documentation References)
- `CLAUDE.md` - Remove `deno test` command examples from "Testing Strategy" section
- `AGENTS.md` - Update Deno test command reference
- `TEST_CONVERSION_SUMMARY.md` - Archive or update (migration complete document)
- `specs/SPEC-013-chore_keybinding_migration_phase1.md` - Historical spec with Deno references
- `specs/SPEC-014-chore_keybinding_phase2.md` - Historical spec with Deno references
- `specs/SPEC-009-migrate-ui-to-deno-ink.md` - Historical spec with Deno references

### Files to Keep (No Changes Needed)
- All `test/unit/*.test.ts` files - Already using `bun:test`
- All `test/integration/*.test.ts` files - Already using `bun:test`
- `test/ui/` - Shell-based UI tests, not Deno tests

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete the frontend-disabled test directory
The `test/frontend-disabled/` directory contains tests that were part of the Deno migration and are intentionally disabled. They use `Deno.test()` syntax and have incompatible imports.

- Delete `test/frontend-disabled/editor-component.test.tsx`
- Delete `test/frontend-disabled/ink-adapter.test.ts`
- Delete `test/frontend-disabled/ink-adapter-error-handling.test.ts`
- Delete `test/frontend-disabled/edge-cases.test.ts`
- Delete `test/frontend-disabled/file-io-error-handling.test.ts`
- Delete `test/frontend-disabled/us-011-terminal-resize-core.test.ts`
- Delete `test/frontend-disabled/us-011-terminal-resize.test.ts`
- Delete the entire `test/frontend-disabled/` directory

### Step 2: Delete .bak backup files in test directory
Remove backup test files that are no longer needed.

- Delete `test/unit/test-better-cli-output.test.ts.bak`
- Delete `test/unit/text-objects.test.ts.bak`

### Step 3: Update CLAUDE.md
Remove Deno test command references from the Testing Strategy section.

- Remove or update the "Bun Migration Notes" section to remove Deno.test() to bun:test conversion notes (already complete)
- Update test command examples from `deno test` to `bun test` if any remain

### Step 4: Archive or update historical spec files
The spec files contain historical references to Deno. These can either be updated with a note that migration is complete, or left as historical documents.

- For `specs/SPEC-013-chore_keybinding_migration_phase1.md`: Add "MIGRATION COMPLETE" header note
- For `specs/SPEC-014-chore_keybinding_phase2.md`: Add "MIGRATION COMPLETE" header note
- For `specs/SPEC-009-migrate-ui-to-deno-ink.md`: Add "MIGRATION COMPLETE" header note

### Step 5: Update package.json files exclusion
Verify that `package.json` already excludes test files (it does with `"!**/*.test.ts"`).

- Confirm `package.json` files array excludes `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`

### Step 6: Verify no Deno.test() imports remain
Search the codebase to ensure no actual Deno test syntax remains.

- Run `grep -r "Deno\.test" test/` to verify no Deno.test() calls remain
- Run `grep -r "from \"deno\"" test/` to verify no Deno imports remain

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun test` - Run all tests to ensure remaining tests still pass
- `ls test/frontend-disabled/ 2>&1 | grep "No such file"` - Verify directory is deleted
- `find test/ -name "*.bak" | wc -l` - Should return 0 (no .bak files)
- `grep -r "Deno\.test" test/ 2>&1 | wc -l` - Should return 0 (no Deno.test() calls)
- `grep -r "from \"deno\"" test/ 2>&1 | wc -l` - Should return 0 (no Deno imports)

## Notes
- The project has been fully migrated to Bun runtime. All active tests use `bun:test` framework with `describe`, `test`, and `expect` from `bun:test`.
- The `test/frontend-disabled/` directory was intentionally disabled during the migration and can be safely removed.
- UI tests in `test/ui/` are shell-based tmux tests and are not affected.
- Historical spec files can keep their Deno references as documentation of the migration process, just add completion notes.

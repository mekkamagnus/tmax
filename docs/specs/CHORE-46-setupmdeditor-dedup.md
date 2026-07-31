# Chore: Dedup setupMdEditor (byte-identical in two markdown test files)

## Chore Description
`setupMdEditor` is a byte-identical local helper in `test/unit/markdown-spec-039.test.ts:16-25` and `test/unit/markdown-follow-link.test.ts:15-24`. Extract one shared exported helper beside `createStartedEditor` in `test/helpers/editor-fixture.ts`. (Codex-approved refactor — GitHub issue #34.)

## Relevant Files
- `test/helpers/editor-fixture.ts` — add exported `setupMdEditor` beside `createStartedEditor` (do NOT broaden `createStartedEditor`).
- `test/unit/markdown-spec-039.test.ts` — import `setupMdEditor`; remove local copy; drop now-unused `Editor` + `createStartedEditor` imports.
- `test/unit/markdown-follow-link.test.ts` — same.

## Completion Criteria
- [ ] `setupMdEditor` is exported from `test/helpers/editor-fixture.ts`, beside `createStartedEditor`, preserving initialization order exactly (require markdown → require find-file → createBuffer → set-buffer-filename).
- [ ] Both markdown test files import `setupMdEditor` from the helper; their local copies are removed.
- [ ] Now-unused imports dropped (`Editor` type and `createStartedEditor` in both files).
- [ ] `createStartedEditor` is NOT broadened (a separate `setupMdEditor` is added).
- [ ] Both markdown test files pass unchanged; `bun run typecheck` clean.

## Step by Step Tasks
### Task 1 — Add shared setupMdEditor to editor-fixture.ts
- Add `export async function setupMdEditor(content, filename?)` beside `createStartedEditor`, preserving init order exactly.

### Task 2 — Update both markdown test files
- Import `setupMdEditor`; remove the local copies; drop the now-unused `Editor` and `createStartedEditor` imports.

### Task 3 — Validate
- `bun run typecheck` clean; both markdown test files pass.

## Validation Commands
- `bun run typecheck`
- `bun test test/unit/markdown-spec-039.test.ts test/unit/markdown-follow-link.test.ts`

## Notes
- Codex review (#34): APPROVE, behavior-preserving. Do not broaden `createStartedEditor` (many unrelated callers); remove now-unused `Editor` imports; add a dedicated `setupMdEditor` beside `createStartedEditor`, preserving init order.

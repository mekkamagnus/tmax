# SPEC-228: Migrate 15 grandfathered test files off direct Editor construction

**Issue:** #228 (test debt / CHORE-44 Change 12)
**Status:** Implemented 2026-08-23

## Goal

The 15 test files grandfathered during the #198 CI tail now use
`createEditorFixture` (the Change-12 convention); the allow-list shrinks
to the two entries with permanent justified reasons.

## Design

All 15 files shared the identical `startedEditor()` helper:

```ts
const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
const server = new TmaxServer(undefined, true, editor, undefined, true);
await server.startEditor();
```

The migration swaps ONLY the construction line for the fixture (the
server wrap is these files' subject under test — it stays):

```ts
const fixture = await createEditorFixture();
const server = new TmaxServer(undefined, true, fixture.editor, undefined, true);
await server.startEditor();
return { editor: fixture.editor, server };
```

The return shape is unchanged — every call site (destructure
`{ editor, server }`, `server.shutdown()` in finally) is untouched. The
fixture's teardown owns disposal (the pre-migration code never disposed
either; the fixture's legacy-compat handles cover per-test teardown).
Now-unused `TerminalIOImpl`/`FileSystemImpl` imports removed; the
`Editor` type import stays (used in signatures).

The allow-list in `editor-fixture-isolation.test.ts` loses all 15
entries (and the grandfathering comment) — back to the two permanent
entries (`server-start-editor`, `editor-open-file`, each with a
structural reason).

## Completion Criteria

- [x] None of the 15 files constructs an Editor directly (the AC12.1
      scan passes with the shrunk allow-list — 10/10).
- [x] The allow-list contains only the two permanent justified entries.
- [x] All 15 migrated suites pass (the 16-suite batch incl. the
      isolation suite: green).
- [x] typecheck:test green.

## Notes

- Mechanical per-file diff: one construction line + imports; zero call
  sites touched.

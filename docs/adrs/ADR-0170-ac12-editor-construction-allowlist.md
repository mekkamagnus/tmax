# ADR-0170 — AC12.1 allow-list for justified direct-`Editor` test construction (#116 / BUG-67)

## Status

Accepted

## Context

CHORE-44 Change 12 introduced the `AC12.1` static guard: **no** file under
`test/unit` or `test/integration` may contain `new Editor(` — every test must go
through `createEditorFixture` / `createStartedEditor` (the single constructor site,
in `test/helpers/editor-fixture.ts`) for consistent isolation. The guard asserted
`offenders === []`.

Two later tests legitimately construct a **real** `Editor` directly:

- `test/unit/server-start-editor.test.ts` — exercises `cleanStart`/`startEditor`
  with REAL `TerminalIOImpl` + `FileSystemImpl` (the BUG-58 cleanStart guard). The
  fixture's setup does not match this server-startup path.
- `test/unit/editor-open-file.test.ts` — wraps `Editor` in a `TmaxServer` and calls
  `startEditor()` to test `open-file` through the server. `createEditorFixture`
  produces a standalone `Editor` with no server.

Both test contexts (server lifecycle / startup with real deps) are outside what the
standalone fixture covers. Forcing them through the fixture would require extending
it to support `TmaxServer` wrapping + real `TerminalIO`/`FileSystem`, a larger
refactor that does not match what those tests are verifying. With the strict
`offenders === []` assertion, AC12.1 was red — masking its own value (it could no
longer catch a NEW unwanted direct construction; it just always failed).

## Decision

Make AC12.1's invariant accurate rather than absolute: maintain an explicit, -
justified **allow-list** of files permitted to construct `Editor` directly, each
with a one-line reason. The assertion becomes "no offenders BEYOND the allow-list"
(`newOffenders === []`), so the guard still catches any NEW direct construction not
listed. A second loop requires every allow-list entry to STILL exist and STILL
contain `new Editor(` — a migrated or deleted allow-listed file fails that check, so
the allow-list cannot silently rot (entries must be removed when a test is migrated
to the fixture).

This matches the BUG-67 spec, which explicitly sanctions allow-listing ("...OR
explicitly allow-listed") as a valid resolution alongside routing through the fixture.

## Consequences

- **Easier:** AC12.1 is green and meaningful again — it catches new unwanted direct
  construction while acknowledging the two legitimate server-lifecycle cases.
- **Easier:** the stale-entry guard keeps the allow-list honest over time (no
  orphan entries after a migration).
- **Harder:** adding a new direct-constructing test now requires also adding it to
  the allow-list with a reason — a small friction that is the point (it makes the
  exception deliberate, not accidental).
- The fixture remains the default; the allow-list is the narrow exception, not a
  general escape hatch.

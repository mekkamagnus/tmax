# SPEC-337 — Repair the adw plan stage's import of the retired adt.ts (CHORE-61 regression)

## Goal

`bun adws/adw-plan.ts` — and therefore every free-text adw pipeline
(`adw-launch.ts "description"`) — crashes at startup with
`Cannot find module '../src/utils/adt.ts'`: CHORE-61 (`100c040c`)
retired the module while `adw-plan.ts` still imported its `match`.
The breakage was invisible to CI because no typecheck project
covers `adws/` (only the base tsconfig lists it; the per-project
configs that the typecheck scripts run all omit it).

## Completion criteria

- [x] `adws/adw-plan.ts` no longer imports `src/utils/adt.ts`; the
      two `match(outcome, {...})` sites switch on the union's
      `kind` discriminator directly (CHORE-61's standardized shape).
- [x] The plan stage starts: `bun adws/adw-plan.ts` under the
      cleanup-probe env announces (verified live).
- [x] The three red `adw-process-cleanup` probes (success /
      SIGTERM-143 / SIGHUP-129) pass.
- [x] The root cause is closed: `adws/**/*` joins the
      `tsconfig.test.json` include so `typecheck:test` covers the
      runner scripts (the missing-module class of breakage becomes
      a compile error again) — verified clean across the whole adws
      tree.

## Notes

- `DispatchOutcome`'s vestigial `_tag` fields (they existed for the
  retired matcher) are left in place — removing them touches the
  constructors beyond this repair's scope.

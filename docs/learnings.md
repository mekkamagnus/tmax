# Learnings

## Type Safety: Bun does not enforce TypeScript

Bun strips types at runtime without checking them. `bun test` and `bun run start` pass even with hundreds of type errors. ALWAYS run `bunx tsc --noEmit` (or the `typecheck` script) after changes. The CI pipeline enforces this, but run it locally before pushing.

**Rule:** Every PR must pass `bun run typecheck` with zero errors.

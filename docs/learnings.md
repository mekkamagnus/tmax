# Learnings

## Type Safety: Bun does not enforce TypeScript

Bun strips types at runtime without checking them. `bun test` and `bun run start` pass even with hundreds of type errors. ALWAYS run `bunx tsc --noEmit` (or the `typecheck` script) after changes. The CI pipeline enforces this, but run it locally before pushing.

**Rule:** Every PR must pass `bun run typecheck` with zero errors.

## Architecture: Completion is editor logic

Treat completion and minibuffer behavior as editor logic under the Emacs C/Lisp split. T-Lisp owns completion tables, matching styles, annotations, candidate ordering, navigation, selection, key semantics, and commands. TypeScript may expose only factual/runtime/display primitives, generic frame-local transport, and rendering of a T-Lisp-produced view model.

## Workflow: Debug tmax through the daemon first

When debugging tmax, start with the daemon/client API (`tmaxclient --status`, `--frames`, `--messages`, `--key`, `--eval`) before creating tmux sessions or injecting terminal keys. Use the existing `tmax` tmux session for manual observation, and create isolated `tmax-ui-*` sessions only through the UI harness for renderer tests. Stale `tmax-ui-*` sessions should be audited before starting new manual sessions.

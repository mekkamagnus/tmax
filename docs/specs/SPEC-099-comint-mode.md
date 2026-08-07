# Feature: comint-mode — generalized command-interpreter (`#165`)

## Feature Description

A generalized minor mode for interactive subprocess communication via pipes (not
full PTY). The foundation for REPLs (`M-x purs-repl`, `M-x node-repl`), build
tools (`M-x compile`), and line-oriented shell interaction. Output accumulates in
a normal editor buffer; input is typed at the bottom.

## Acceptance Criteria

- [ ] `(comint-run "command" (list "arg"))` spawns a subprocess, creates a comint buffer, returns its name
- [ ] Output (stdout+stderr) accumulates in the buffer as lines arrive
- [ ] `(comint-send buffer-name "input\n")` writes to stdin
- [ ] `(comint-kill buffer-name)` terminates the process
- [ ] `(comint-process-status buffer-name)` returns `running`, `exited:N`, or `nil`
- [ ] Multiple comint buffers coexist
- [ ] Input history: `(comint-history-prev)` / `(comint-history-next)` cycle through inputs
- [ ] `M-x run-node` convenience command: `(comint-run "node" (list))`
- [ ] RET sends input, C-c C-c sends SIGINT (key bindings in comint buffer)
- [ ] `bun run typecheck` clean; tests pass; core-bindings green

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/comint-mode.test.ts`
- `bun test test/unit/core-bindings.test.ts`

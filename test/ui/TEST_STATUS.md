# UI Test Suite Status

Updated: 2026-06-04

The isolated Python harness is authoritative. The Bash harness remains only as
legacy reference.

| Category | Command | Contract |
|----------|---------|----------|
| Daemon API integration | `bun run test:daemon` | Direct JSON-RPC/T-Lisp state checks; no renderer claims |
| Renderer E2E | `bun run test:ui:renderer` | Real tmux keys plus captured visible output |
| Full Python suite | `bun run test:ui` | Both categories |
| Harness helpers | `bun run test:ui:helpers` | Isolation, parsing, and assertion semantics |

Each scenario uses a unique socket, tmux session, and temporary root. Cleanup
only targets resources owned by that run and executes after success, failure,
or timeout.

Assertions report pass, fail, skip, and expected failure separately. Daemon
query failures fail the scenario. Renderer assertions outside a renderer mode
skip explicitly instead of passing.

Current renderer coverage includes startup observability, layout, real-key Vim
insert/editing behavior, splits, focus, resizing, tabs, and relative line
numbers.

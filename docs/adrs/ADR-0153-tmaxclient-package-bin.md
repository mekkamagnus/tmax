# ADR-0153 — tmaxclient in package.json bin (#44)
## Status: Accepted
## Context
`package.json`'s `bin` field installed only `tmax`, `tlisp`, `trt`, `tmax-use` —
`tmaxclient` was omitted, so `npm`/`bun install -g` never linked a `tmaxclient`
command, even though the texinfo manual documents it as the user-facing diagnostic
CLI (`--messages`/`--list-buffers`/`--ping`/`--eval`/…).

## Decision
Add `"tmaxclient": "./bin/tmaxclient"` to the `bin` field. `bin/tmaxclient` is
already executable with a `#!/usr/bin/env bun` shebang, and there is no `files`
field, so it ships in the tarball and links on install.

## Consequences
- A fresh global install provides `tmaxclient`; `npm pack --dry-run` lists
  `bin/tmaxclient` (31.9kB); `tmaxclient --help` works. Verified.
- Scope is "reachability," not the structured-output contract — the verify-gate
  noted the `--diagnostics --json` path already emits `JSON.stringify(errors)`
  (the spec/codex overstated what was missing); genuine structured envelopes exist
  at several sites. Any further structured-output work is a separate item.
- Unblocks #47 (the unified launcher dispatching diagnostic flags to tmaxclient)
  via AUTO-UNBLOCK — the LAST dependency-blocked alpha-blocker.

Spec: [BUG-40](../specs/BUG-40-tmaxclient-package-bin.md). Issue: #44.
Verify-gate: PASS.

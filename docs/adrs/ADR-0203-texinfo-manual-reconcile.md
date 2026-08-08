# ADR-0203 — Canonicalize `docs/tmax/` Texinfo; remove legacy; add drift guard (`#173` / SPEC-106)

## Status
Accepted

## Context
tmax had two Texinfo sources contradicting each other: `docs/manual/tmax.texi`
(the Deno-era manual CHORE-09 kept "for backward compatibility" — referenced
Deno, called visual mode "planned," undercounted the API) and `docs/tmax/tmax.texinfo`
(the canonical rewrite). The canonical manual had also drifted from the code: it
documented only ~8 of the 22 registered major modes and omitted the mode-detection
chain and save-as re-detection.

## Decision
1. **Canonicalize `docs/tmax/`.** Added a new **Major Modes** chapter to
   `tmax.texinfo` documenting all 22 registered language major modes (a
   `@multitable` with extensions + highlighter), a **Mode Detection** section
   (precedence: file-local `mode:` > filename `auto-mode-alist` > magic content >
   configurable `default-major-mode`), save-as re-detection, and the minor modes
   (which-key, snippet, comint) + terminal/project. Rebuilt `tmax.info`.
2. **Remove the legacy manual.** Deleted the stale `docs/manual/tmax.texi` +
   `tmax.html`; `docs/manual/index.md` is now a redirect to `docs/tmax/`.
   `docs/Makefile` delegates to `docs/tmax/Makefile`.
3. **Make `make html` real.** Added the missing `html` target to
   `docs/tmax/Makefile` (it was advertised in `index.md` but absent).
4. **Durable drift guard.** Added a runnable `make drift-check` target that
   extracts every `major-mode-register "<mode>"` from `src/tlisp/core/modes/*.tlisp`
   and asserts each has an `@code{<mode>}` entry in the manual (exits 1 on a miss),
   plus an `@c` maintainer comment above the table. This prevents the next mode
   addition from silently re-drifting.

## Consequences
- One canonical manual; the Deno-era contradictions are gone.
- Adding a major mode now requires a manual entry (CI/local `make drift-check`
  catches omissions).
- Historical Deno references in `docs/specs/`, `docs/adrs/`, `docs/memos/`,
  `docs/rfcs/` are intentionally preserved (correct history), not scrubbed.
- `.info` artifacts are committed; `.html` is gitignored (regenerable via
  `make html`).

## Verification
`make info && make html` succeed; `make validate` clean; `make drift-check`
passes (exit 0, all 22 modes documented). No Deno refs in `docs/tmax/`.
Verify-gate (adversarial, 2-agent) verdict: **PASS**.

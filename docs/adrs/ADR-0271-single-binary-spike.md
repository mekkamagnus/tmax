# Single-binary distribution spike: build path adopted, distribution deferred

## Status

Accepted (2026-11-10) — resolves #244 / SPEC-244. Builds on #233 (Bun
1.4.4 `--asset` with real fs semantics over embedded directories).

## Context

The TS→Rust tradeoff analysis named one Rust win worth having — a single
static binary. Bun 1.4's `--compile --asset` purports to deliver it
without Rust. Spike question: does a single tmax binary with the 16.7k-LOC
`.tlisp` runtime embedded actually work, at what size/startup cost, and
should we distribute that way?

Probed ground truth (SPEC-244 appendix B): `--compile` bundles modules at
the virtual root (`import.meta.dir === /$bunfs/root`); `--asset` embeds a
directory under its **basename**; `$bunfs` does **not** normalize `..`
path segments; the entry point occupies the outfile's basename (so a
`docs/tmax` directory asset collides with a `tmax` outfile). The
pre-existing `build:tmax` (no assets) produced a binary that fails at
startup (keymap ENOENT) — the compiled build was already broken.

## Decision

1. **Adopted**: `build:tmax` embeds `./src/tlisp/core` plus the two
   runtime-read texinfo files (`--asset`), producing a working binary.
2. **Adopted**: layout-aware exported asset roots — `TLISP_CORE_DIR` /
   `DOCS_TMAX_DIR` (editor.ts) and `TRT_CORE_DIR` (trt/bootstrap.ts) —
   probe the dev layout first (in-repo behavior byte-identical), falling
   back to the compiled layout. All constructed paths are
   `node:path.normalize`d (the `$bunfs` no-`..` lesson, applied at the
   source).
3. **Deferred**: actual distribution. The binary works, but there is no
   release pipeline (no CI release job, no codesign/notarization for
   macOS), the darwin-arm64 and linux-x64 cross-targets are built but
   **not run** (Intel host; Linux mirror box unreachable), and the client
   story (`bin/tmax`, `tmaxclient`, TUI) still assumes a bun checkout.
4. **Measured, not adopted**: `--bytecode` — warm startup halves
   (80–90 → 40–50 ms) but the first run costs 2.0 s and +4.3 MB; a
   visible cold hit on an editor. Reopen if startup becomes a complaint.

## Consequences

- `bun run build:tmax` now yields a functional ~100 MB binary (the Bun
  runtime is ~99 MB of it; the whole `.tlisp` runtime + docs corpus add
  <1 MB) with startup at parity with running from source (80–90 ms).
- Daemon, RPC eval (incl. helpgrep over the embedded corpus), and
  embedded Steep (interactive insert + `:wq` write) all verified from the
  binary in a neutral cwd with a fresh HOME — SPEC-244 appendix C–E.
- Asset resolution is pinned by `test/unit/bundled-asset-roots.test.ts`
  (dev layout); the compiled branch is e2e-verified (spec appendix), not
  unit-tested — building a binary in the unit suite would be too slow.
- Follow-ups if distribution is ever pursued: release CI + signing; run-
  verify the arm64/Linux targets; decide the client-side story (compile
  `tui-client.ts` too, or a fat `bin/tmax` that prefers the binary);
  `build:tlisp`/`build:tmax-use` may need the same asset treatment.
- Gates: `bun run typecheck` (all configs) clean ✅; `bun run test:unit`
  3590/0 across 274 files ✅.

# SPEC-244 — Single-binary distribution spike (`bun build --compile --asset`)

Issue: #244. Status: in progress (branch `issue-244`); lands on main only
after verify-gate PASS + CI green (ADR-0271).

## Goal

Determine whether tmax can ship as a single self-contained binary with the
~16.7k-LOC `.tlisp` runtime (and the helpgrep texinfo corpus) embedded,
via Bun 1.4's `--compile --asset`; verify daemon, embedded Steep, and
eval/shell launch from the binary; record size and startup numbers; record
a verdict for the distribution question.

## Ground truth (probed, Bun 1.4.4, macOS x64 host)

Probes ran in a scratch project (`/tmp/spike244/probe`, since deleted;
commands recorded verbatim in the appendix):

1. **Module virtual paths**: `bun build --compile` bundles every module at
   the virtual root — `import.meta.dir` inside the binary is
   `/$bunfs/root` regardless of the source layout (`--root` does not
   change this).
2. **`--asset` placement**: a directory asset embeds under its **basename**
   (`--asset ./src/tlisp/core` → `/$bunfs/root/core/…`, subtree preserved);
   `readdirSync` works over the embedded tree (real fs semantics). A
   trailing slash does NOT flatten contents.
3. **No `..` normalization in `$bunfs`**: opening
   `/$bunfs/root/core/trt/../commands/x.tlisp` fails ENOENT even when
   `/$bunfs/root/core/commands/x.tlisp` exists — paths must be normalized
   (`node:path.normalize`) before every read.
4. **Entry/asset collision**: the entry lands at the outfile's basename, so
   `--outfile dist/tmax` + `--asset ./docs/tmax` collide ("would embed at
   the same path as the entry point") → the two runtime-read texinfo files
   are embedded flat instead of as a directory.
5. **Baseline (before this spike)**: `bun run build:tmax` (no `--asset`)
   produced a binary that **cannot start**: `Failed to load required
   keymap /$bunfs/root/../tlisp/core/keymaps.tlisp: ENOENT` — the
   pre-existing compiled build was already broken, not merely incomplete.

Runtime asset-read sites: `src/editor/editor.ts` (tlisp core ×4 sites,
docs corpus ×2) and `src/tlisp/trt/bootstrap.ts` (trt framework ×4 sites —
loaded by the **daemon constructor**, not dev-only as first assumed).

## Decision

1. **Adopted — the build path**: `build:tmax` now embeds the assets
   (`--asset ./src/tlisp/core` + the two texinfo files) and produces a
   **working** single binary; the previous asset-less recipe produced a
   binary that fails at startup.
2. **Adopted — layout-aware asset roots** (the enabler): exported
   `TLISP_CORE_DIR` / `DOCS_TMAX_DIR` (editor.ts) and `TRT_CORE_DIR`
   (trt/bootstrap.ts) probe the dev layout first (behavior in the repo is
   byte-identical), falling back to the compiled layout
   (`/$bunfs/root/core`, `/$bunfs/root` for the flat corpus files,
   `/$bunfs/root/core` for trt). Dev-side paths are `normalize`d at
   construction; the trt file-list join normalizes per-file (`..` entry).
3. **Deferred — distribution**: the binary works and is cheap to build,
   but shipping it is deferred: no release pipeline/signing exists;
   darwin-arm64 and linux-x64 cross-targets are **built but not run**
   (host is macOS x64; the Linux mirror box was unreachable — mDNS);
   `bin/tmax`/`tmaxclient`/TUI still assume a bun checkout; bytecode
   measured and rejected for now.
4. **Measured, not adopted — `--bytecode`**: warm startup 40–50 ms vs
   80–90 ms plain, but first-run 2.0 s and +4.3 MB; a 2 s cold hit on an
   editor binary is user-visible. Reopen if startup ever becomes a
   complaint.

## Numbers (macOS x64 host, 2026-11-10)

| Artifact | Size | Startup (`--version`) |
|---|---|---|
| `dist/tmax` asset-less (old, broken at startup) | 99,675,616 B | — |
| `dist/tmax` with assets (**this spike**) | 100,543,968 B (+0.87 MB) | 80–90 ms warm, ~118 ms cold |
| `dist/tmax-linux-x64` (cross, built not run) | 111,503,536 B | — |
| `dist/tmax-darwin-arm64` (cross, built not run) | 91,554,146 B | — |
| `--bytecode` variant | 104,820,192 B | 40–50 ms warm, **2,010 ms first run** |
| dev mode (`bun src/main.ts --version`) | — | 80–100 ms |

The Bun runtime dominates the size (~99 MB); the entire `.tlisp` runtime +
docs corpus adds under 1 MB. Startup is at parity with running from source.

## Completion Criteria

1. `bun run build:tmax` embeds the tlisp core tree and both texinfo
   corpus files; the command is in `package.json` and reproducible from a
   clean checkout.
2. Asset roots are layout-aware with the dev layout probed first
   (in-repo behavior byte-identical), exported, and pinned by
   `test/unit/bundled-asset-roots.test.ts` (dev layout only — the compiled
   branch is covered by the e2e evidence below).
3. All three launch modes verified from the **built binary** in a neutral
   cwd with a fresh `HOME`: daemon (socket up, RPC eval), eval/shell
   (`(+ 1 2)` → 3, helpgrep over the embedded corpus → 11 hits), and
   embedded Steep (file rendered, interactive insert, `:wq` wrote the
   file). Evidence verbatim in the appendix.
4. Committed diff (`git diff main..issue-244`) touches only:
   `package.json` (build:tmax line), `src/editor/editor.ts`,
   `src/tlisp/trt/bootstrap.ts`, `test/unit/bundled-asset-roots.test.ts`,
   and docs (this spec + ADR-0271 + index row). `dist/` is git-ignored —
   no binaries committed.
5. `bun run typecheck` (all four configs) clean AND `bun run test:unit`
   full suite green.
6. Size/startup/bytecode numbers + verdict + deferred list recorded
   above.

## Appendix — evidence (verbatim)

**A. Baseline (asset-less binary, before the fix):**
```
$ HOME=$(mktemp -d) ./dist/tmax -e '(+ 1 2)'
Failed to load bindings from /$bunfs/root/../tlisp/core/keymaps.tlisp: … ENOENT
Error starting tmax: Failed to load required keymap /$bunfs/root/../tlisp/core/keymaps.tlisp
```

**B. Probe — module dir + asset placement (`/tmp/spike244/probe`):**
```
$ bun build --compile ./entry.ts --asset src/tlisp/core --outfile probe-bin
$ ./probe-bin
import.meta.dir = /$bunfs/root
LIST /$bunfs/root -> [ "probe-bin", "core" ]        # basename placement
LIST /$bunfs/root/../tlisp/core -> ERR ENOENT       # .. not normalized
```

**C. Daemon + eval from the final binary** (neutral cwd, fresh HOME):
```
$ dist/tmax --daemon &          # … socket /tmp/tmax-501/server appears
DAEMON UP ✓
$ bin/tmaxclient --eval '(+ 1 2)'
3
$ bin/tmaxclient --eval '(length (helpgrep-search "parse"))'
11                                                # embedded texinfo corpus
```

**D. Embedded Steep from the binary** (tmux, 100×30):
```
 1 │hello from single-binary steep
  ~ ~
--NORMAL--  t244-file.txt  L1 C1 [text] (Indent Wiki WikiC Ln)
# after i → "EDITED-BY-BINARY" → Escape → :wq:
 1 │EDITED-BY-BINARYhello from single-binary steep
--NORMAL--  t244-file.txt  L1 C17 [text]
$ cat /tmp/t244-file.txt
EDITED-BY-BINARYhello from single-binary steep
```

**E. No-repo dependence**: binary copied to `/tmp/tmax-standalone`, run
from `/` with fresh HOME → `tmax v0.2.0 (T-Lisp powered terminal editor)`.

**F. Cross-compile:**
```
$ bun build --compile --target=bun-linux-x64 ./src/main.ts --asset … --outfile dist/tmax-linux-x64
[5.0s] compile dist/tmax-linux-x64 bun-linux-x64-v1.4.4
$ file dist/tmax-linux-x64
ELF 64-bit LSB executable, x86-64 … for GNU/Linux 3.2.0
$ bun build --compile --target=bun-darwin-arm64 … --outfile dist/tmax-darwin-arm64
[4.8s] compile dist/tmax-darwin-arm64 bun-darwin-aarch64-v1.4.4
$ file dist/tmax-darwin-arm64
Mach-O 64-bit executable arm64
```

**G. Full gates:** `bun run typecheck` clean (src/test/tmax-use/bench);
`bun run test:unit` → `3590 tests … 0 fail … 274 files [125.17s]`.

# SPEC-309 — grep: the standard-grep fallback backend

## Goal

The fallback search backend (RFC-031 §2.2) for environments without
rg: one-grep-per-file transport over `project-files-walk`
enumeration, exit-code aggregation, ASCII smart-case emulation, `-I`
feature detection, and the `project-ignore-dirs` read-only builtin.
Reuses #307's producer interface and #308's backend matrix, process
discipline, and generation guards — restated only where the fallback
differs.

## Normative

### File transport (one file per invocation, `-H` OFF)

1. Enumerate with the EXISTING `project-files-walk` primitive (arity:
   ONE argument — the scope dir; DEFAULT_IGNORES applies internally).
2. One grep per file: `["grep", "-n", "-I", "-e", pattern, "--", file]`
   (plus `-i` per the case rule). Single operand ⇒ grep omits the
   filename; output is exactly `linenum:text`; the FIRST colon
   terminates the number; match text may contain any characters; the
   FILE is known from the invocation. Newline-containing paths are
   argv-safe.
3. Sequential (enumeration order); progress counter on the searching
   placeholder every 25 files. Col = 1 (documented divergence from
   rg). Hits via `grep-buffer-append-hit`. A hit whose text contains
   a NUL is truncated at the NUL and counted as binary-skipped.
4. Exit aggregation + final completion: per file, 0 = hits, 1 = no
   match (normal), ≥2 = STOP enumerating → `complete "error"` naming
   the file + exit. After ALL files: any file matched → `complete
   "done"` (diagnostic suffix `K of N files matched` when K < N);
   none matched → `complete "no-matches"`; empty enumeration →
   `complete "no-matches"` WITHOUT spawning. Mixed 0/1 sequences are
   the normal case. Missing executable → #308's named class; spawn
   failure mid-sequence → #308 rollback. Cancellation (quit / new
   search / `g`): kill the running grep, stop enumerating —
   superseded-generation guards drop the rest.
5. Glob filters (#311): filter the enumerated list in T-Lisp BEFORE
   invocation — `--include` never used.

### Case semantics

- ASCII-only smart-case emulation: pattern contains no ASCII
  uppercase → append `-i`; any ASCII uppercase → case-sensitive.
- Documented divergences (recorded in the ADR, not claimed as
  parity): grep BRE vs rg's regex flavor; Unicode case-folding NOT
  attempted (rg folds `É`→`é` under smart-case; grep does not). The
  parity tests use ASCII-case fixtures only.

### Ignore list

Enumeration ignores come from `project-files-walk`'s internal
DEFAULT_IGNORES; EXPOSED as a read-only `project-ignore-dirs`
builtin (the ADR names it).

### Portability + `-I` detection

- Supported: BSD grep AND GNU grep for `-n -e --` single-operand
  (tests record which answered via `grep --version`).
- `-I` feature-detected ONCE at backend init: a probe run (grep -I
  on an empty temp file; unsupported flags error distinctively) —
  unsupported → flag dropped, binary files skipped by a T-Lisp NUL
  check limited to the FIRST line (documented limitation: later NULs
  leak and hit the §3 truncation rule).

## Completion criteria

- [ ] Transport proof: colon-path + newline-path fixtures; match text with colons; NUL truncation
- [ ] Aggregation: mixed 0/1 exits → done with diagnostic; all-1 → no-matches; empty enumeration no-spawn; ≥2 stops; cancellation; rollback
- [ ] ASCII smart-case emulation vs rg on identical ASCII fixtures; Unicode divergence recorded in the ADR
- [ ] `-I` both branches; `project-ignore-dirs` exposed; forced-backend + PATH-stubbed fallback; BSD/GNU recorded

## Dependencies

#307 (producer interface) — landed. #308 (backend matrix) — landed.
#310 (scope commands) — blocked; NOT a dependency (the backend
registers through #308's matrix independently).

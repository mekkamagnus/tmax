# RFC-041: File management — `mkdir`, interactive file operations, `dired`

**Status:** Proposed 2026-11-27 — prepped as the file-management spec-arc. Units #359 and #361 are fully pinned and may start immediately. Unit #360 (dired) starts after the user approves §3.

**Related:** #359 (`mkdir`), #360 (dired mode), #361 (file-ops family), [RFC-003](RFC-003-emacs-parity-roadmap.md) (evil-first parity), `src/tlisp/core/commands/find-file.tlisp`, `src/editor/api/file-ops.ts`, `src/editor/tlisp-api.ts`, `src/tlisp/core/commands/dired.tlisp`, `src/editor/api/dired-ops.ts`, [ADR-0168](../adrs/ADR-0168-async-completing-read-state-machine.md)

---

## 1. Problem

tmax reads and writes files but cannot manage them. There is no interactive `mkdir`, `rm`, `mv`, `cp`, or `rmdir`, and no directory browser — the user leaves the editor for every file-management action. A dired stub exists (six defuns plus display helpers) with no mode and no key bindings, reachable only through M-x.

## 2. What exists

| Piece | Where | State |
|---|---|---|
| `file-mkdir` (recursive, tilde-expanded) | `src/editor/api/file-ops.ts:409` | primitive only |
| `file-rename` | `src/editor/tlisp-api.ts:1596` | primitive only |
| `file-copy` | `src/editor/api/file-ops.ts` | primitive only |
| `file-remove` | `src/editor/api/file-ops.ts:353` | files only (`unlink`); the async path swallows errors |
| `directory-files` | `src/tlisp/io-ops.ts:112` | primitive only |
| dired stub | `src/tlisp/core/commands/dired.tlisp` + `src/editor/api/dired-ops.ts` | required from `normal.tlisp:86`; unbound; no mode |
| `write-file`, `revert-buffer`, `insert-file` | commands modules | exist — out of scope |

## 3. Design decisions

- **3.1 Keymap philosophy** (user, 2026-11-27): vim-motion based. Emacs dired is the reference for *semantics* — which operations exist — never for the keymap. tmax is evil-first (RFC-003).
- **3.2 dired keys, pinned by the user**: `j`/`k` entry motion; `h` up to parent; `l` descend into a directory **and** open a file (`find-file`), with `RET` a full alias of `l`; `d`/`u`/`x` delete mark / unmark / execute; `R` rename; `C` copy; `+` create directory (the #359 command); `q` quit to the previous buffer.
- **3.3 Provisional keys** (pin at review): refresh `r`; sort `s`; hidden-files toggle `.`.
- **3.4 Destructive safety.** `delete-file` and `delete-directory` confirm through the two-stage minibuffer state machine (ADR-0168). A guard refuses `/`, `$HOME`, and the process working directory. `file-remove`'s swallowed failures (`.catch(() => createNil())`) become honest error returns before any interactive use.
- **3.5 Command shape.** All new commands follow the `find-file` two-stage minibuffer pattern (`find-file` → `find-file-accept`), default the prompt to the current file's directory, and rely on the primitives' tilde expansion.

## 4. Units, in order

| Unit | Issue | Content |
|---|---|---|
| U1 | #359 | `mkdir`. Smallest; establishes the shared command pattern for the arc. |
| U2 | #361 | File-ops family. Tier 1: expose delete/rename/copy + fix `file-remove` errors. Tier 2: recursive-remove primitive, `delete-directory`, guards. |
| U3 | #360 | Dired. Tier 1: mode foundation (major mode, lighter, keymap, `j`/`k`/`h`/`l`/`RET`/`q`). Tier 2: operations wiring U1+U2 (`d`/`u`/`x`, `R`, `C`, `+`). Tier 3: quality of life (refresh, sort, hidden). Per-tier commits. |

**Verification per unit:** all four typecheck projects; targeted unit tests through the fixture (the capture-daily pattern); the full-suite failure-set diff at arc end and after U3 tier 1. At arc start, one full run fixes the arc's baseline failure set; later runs diff against it.

## 5. Out of scope

External openers (`xdg-open`), file previews, wildcard/regex marks, `dired-do-search`, remote files, `chmod`/`touch`, and copy-flag matrices beyond the defaults.

## 6. Acceptance

The per-unit criteria in #359, #360 and #361 are binding. Arc-level: the full suite stays within the baseline diff, and every landing passes the lead's independent verification before it reaches `main` (the engagement model).

# Feature: Man-page viewer (`man` / `woman`) for shell commands

## Feature Description
A man-page viewer that renders system man pages in a read-only `man-mode` buffer,
mirroring Emacs `Man` + `WoMan`. Used to document **shell commands** (the things
you run in `comint`/`shell-mode`), not tmax itself — a third-party-doc help
source, orthogonal to the tmax-self-documentation set (#173–#180).

Two backends:
1. **`woman` (pure-TS roff formatter)** — parses man-page *source* files
   (`/usr/share/man/manS/topic.S[.gz]`) and renders nroff/troff with no external
   binary. Fits tmax's **zero-dependency** principle; default.
2. **`man` (binary wrapper)** — spawns the system `man` (or `man -l`) and renders
   its formatted output. Faster + maximally accurate; used when `man` is present.

Auto-pick: `man` backend when the `man` binary exists, else `woman`. Both are
shipped (not a fallback-only stub).

## Goals
- `:man <topic>` / `M-x man` renders a man page in read-only `man-mode`.
- Section selection: `:man 3 printf`, `:man printf(3)`, `:man ls`.
- `man-mode`: jump sections (NAME/SYNOPSIS/DESCRIPTION/…), follow `SEE ALSO`
  cross-refs to other man pages, full-text within-page search, history back,
  `q` quit.
- comint/shell integration: on a command word, `K` (or a leader key) opens its
  man page.
- Cross-platform: macOS (`/usr/share/man/man*/...`, `.gz`), Linux paths + `MANSECT`.
- Zero-dep by default (the `woman` backend needs no `man` binary).

## User Story
As a user, when I'm in a shell/comint buffer and don't remember a flag for `tar`
or `printf`, I want to view its man page inside tmax — and jump from `tar`'s
`SEE ALSO` to `gzip(1)` — without leaving the editor.

## Problem Statement
tmax has comint/shell modes that run real commands, but no way to look up a
command's documentation in-editor. Users context-switch to a terminal `man` or a
browser. Emacs solves this with `Man`/`WoMan`; tmax has the rendering primitives
(markdown/monospace buffers, read-only modes) but no man-page path.

## Solution Statement
1. **Resolver** — given `(topic, section?)`, search `MANPATH`/`/usr/share/man`
   (and `/opt/homebrew/share/man`, `/usr/local/share/man`) for a matching
   `topic.S` or `topic.S.gz`; honor `MANSECT` ordering. Decompress `.gz` for the
   formatter.
2. **`woman` roff formatter** — a TS nroff/troff renderer covering the common
   requests/escapes that real man pages use (`.TH`/`.SH`/`.SS`/`.LP`/`.PP`/`.TP`,
   `.B`/`.I`/`.BI`/`.BR`/`.IR`/`.RB`, font escapes `\fB`/`\fI`/`\fR`/`\fP`,
   `\-`, `\\`, `.RS`/`.RE`, `.br`, macros via `.de` best-effort). Bold/underline
   map to terminal SGR.
3. **`man` wrapper backend** — spawn `man -l <file>` (or `man <topic>`), capture,
   strip overstrike (backspace bold) to SGR, render.
4. **`man-mode`** — read-only; section jumps (`{`/`}` or `NAME`/`SYNOPSIS` menu);
   `SEE ALSO` tokens like `printf(3)` are followable; within-page `occur`-style
   search; history stack; `q`.
5. **comint/shell integration** — `K` (or `SPC m h` mode key) on the command word
   under point opens `:man <word>`; `:man` with no arg uses the word at point.

## Relevant Files
- New: `src/editor/man/resolver.ts` — locate + decompress a man-page source.
- New: `src/editor/man/woman.ts` — pure-TS nroff/troff renderer.
- New: `src/editor/man/man-backend.ts` — `man`-binary spawn + overstrip conversion.
- New: `src/editor/man/manpage.ts` — backend selector (man if present, else woman).
- New: `src/tlisp/core/modes/man-mode.tlisp` — read-only navigation mode.
- New: `src/tlisp/core/commands/man.tlisp` — `man`, `man-follow`, `man-goto-section`.
- `src/editor/api/comint-ops.ts`, `shell-ops.ts` — `K`/man-on-word wiring.
- `src/frontend/render/` — render the formatted page (monospace + SGR).

## Implementation Plan
### Phase 1: Resolver + woman formatter
Locate a page; render the common roff subset to text+SGR. Ship the zero-dep path
first so it works without `man`.

### Phase 2: man wrapper backend + selector
Spawn `man`, convert overstrike; selector picks `man` when available.

### Phase 3: man-mode + navigation
Sections, SEE ALSO following, within-page search, history, `q`.

### Phase 4: comint/shell integration
`K` on a command word → man page.

## Step by Step Tasks
### Task 1: resolver + woman roff renderer
**Acceptance Criteria**:
- [ ] Resolves `ls` → `/usr/share/man/man1/ls.1(.gz)`; handles MANPATH + `.gz`.
- [ ] Renders the common roff subset for a real page (`ls.1`, `printf.3`):
      section headings, bold/italic, indented `TP` lists, hyphens.

### Task 2: man wrapper + selector
**Acceptance Criteria**:
- [ ] `man` backend spawns `man -l`/`man`, converts overstrike → SGR.
- [ ] Selector uses `man` when the binary exists, else `woman` (transparent).

### Task 3: man-mode
**Acceptance Criteria**:
- [ ] Read-only buffer; jump sections; `SEE ALSO` `topic(N)` tokens follow.
- [ ] Within-page search; history back; `q` quits.

### Task 4: section syntax + comint/shell `K`
**Acceptance Criteria**:
- [ ] `:man 3 printf`, `:man printf(3)`, `:man ls` all work.
- [ ] In comint/shell, `K` (or mode key) on a command word opens its man page.

## Testing Strategy
- Unit: resolver finds pages; `.gz` decompression.
- Unit: woman renderer on fixture `.1`/`.3` files → expected section headings + SGR.
- Unit: selector chooses correct backend (mock `man` presence).
- Manual: `:man tar`, `:man 3 printf`, follow SEE ALSO, in-page search, comint `K`.

## Acceptance Criteria (Completion)
- [ ] `:man <topic>` renders the page via an auto-selected backend (`man` if present, else `woman`).
- [ ] Section syntax (`:man 3 printf`, `printf(3)`) works.
- [ ] `man-mode`: section jumps, `SEE ALSO` follow, within-page search, history, `q`.
- [ ] **Zero-dep default** — the `woman` backend renders real pages with no `man` binary.
- [ ] comint/shell `K` opens the man page for the command under point.
- [ ] Cross-platform (macOS + Linux man paths).

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/man-viewer.test.ts` (new)
- Manual: `:man ls`; `:man 3 printf`; comint `K` on `grep`.

## Notes
- **Orthogonal to #173–#180** — those document *tmax itself* (describe-*/Info/helpgrep); this documents *shell commands* run in comint/shell. Separate concern, separate mode.
- Per the agentic-coding rule (CLAUDE.md §7b), **both backends ship**, not MVP-first. The `woman` roff renderer is the substantial subsystem; targeting the common `mdoc`/`man`-macro subset (not every troff macro) is a **scope/correctness** decision — it covers the real pages users hit — not an effort-trim. The long-term cost to respect is keeping the renderer correct as odd macro usage is encountered; pin it with fixture-page tests.
- Emacs refs: `man.el` (`M-x man`, Man-mode), `woman.el` (`M-x woman`, pure-Elisp roff).

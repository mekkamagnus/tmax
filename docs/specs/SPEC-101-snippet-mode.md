# Feature: snippet-mode — yasnippet-style template expansion (`#167`)

## Feature Description

Provide Emacs YASnippet-equivalent snippet expansion for tmax. Type an
abbreviation, press Tab, and it expands into a parameterized template with
navigable placeholders (`$1`, `$2`, `$0`). Snippets are plain-text files in
`~/.config/tmax/snippets/<major-mode>/` — any file extension or no extension at
all, exactly like yasnippet.

### Snippet file format (yasnippet-compatible)

```
# key: fun
# name: function declaration
# condition: t
# --
function ${1:name}(${2:args}) {
  $0
}
```

- Lines before `# --` are headers (`# key:`, `# name:`, `# condition:`).
- Lines after `# --` are the template body.
- Files are plain text — `.txt`, `.tlisp`, no extension, anything works.

### Placeholder syntax

| Syntax | Meaning |
|--------|---------|
| `$1`, `$2`, … | Tab-order placeholders (Tab cycles forward) |
| `$0` | Final cursor position after all fields |
| `${1:default}` | Placeholder with default text pre-filled |
| `$1` (repeated) | Mirror field — all copies update as you type |
| `` `(...)` `` | T-Lisp expression evaluated at expansion time (embedded default) |

### Snippet directory structure

```
~/.config/tmax/snippets/
├── typescript-mode/
│   ├── fun          ← no extension, key=fun
│   ├── class
│   └── for
├── python-mode/
│   ├── def
│   └── class
├── text-mode/       ← global fallback (loaded for all modes)
│   ├── lorem
│   └── date
└── lisp-mode/
    └── defun
```

## User Story

As a tmax user writing code,
I want to type `fun` + Tab and get a function template with placeholders I can
Tab through,
So that I avoid repetitive typing without leaving the keyboard.

## Problem Statement

tmax has no code-template or snippet expansion. The registered `abbrev-mode`
(#153) is an empty stub. Users type every character by hand — no way to define
abbreviations that expand into multi-line templates with fill-in fields.

## Solution Statement

### Phase 1: Core expansion engine (TS primitives)

**SnippetManager** (`src/editor/api/snippet-ops.ts`):
- `loadSnippets(modeName, dirPath)` — reads all files in a snippet directory,
  parses the `# key:`/`# name:`/`# --` format, returns a list of
  `{ key, name, body }` records.
- `expandSnippet(body, line, col)` — inserts the template at the cursor position,
  parses `$1`/`${1:default}`/`$0` placeholders into field markers (regions in the
  buffer), selects the first field, enters snippet-navigation state.
- `nextField()` / `prevField()` — move cursor between field regions; when `$0` is
  reached, exit snippet state.
- `exitSnippet()` — clear field markers + navigation state.
- `fieldActiveP()` — returns true while navigating fields.

**Field marker model:**
```typescript
interface SnippetField {
  id: number;           // $1, $2, ... (0 = final position)
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  mirrors: Position[];  // other positions with the same $N
  defaultText?: string;
}
```

When the user types in a field, the text is mirrored to all mirror positions.

### Phase 2: T-Lisp layer + minor mode

**`src/tlisp/core/modes/snippet-mode.tlisp`:**
```lisp
(define-minor-mode "snippet" "Snippet expansion" "Snip")

(defun snippet-mode (&optional arg) ...)

(defun snippet-try-expand ()
  "Look up the word before cursor as a snippet key. Expand if found."
  (let* ((word (word-before-cursor))
         (snippet (snippet-lookup word (major-mode-get))))
    (if snippet
      (progn
        (snippet-delete-word-before-cursor (length word))
        (snippet-expand snippet))
      nil)))  ; return nil → caller falls through to normal Tab
```

**Tab hook in insert-handler.ts:**
When snippet-mode is active and the user presses Tab:
1. If a field IS active → `(snippet-next-field)`.
2. If no field is active → `(snippet-try-expand)`. If it returns nil → normal Tab behavior (`insert-tab`).

### Phase 3: Snippet loading + caching

- On startup: load snippets from `~/.config/tmax/snippets/text-mode/` (global).
- On major-mode-set: load `~/.config/tmax/snippets/<mode>/` if it exists.
- `(snippet-reload)` re-reads from disk.
- `(snippet-list)` returns `(key name)` pairs for completion.
- Cache: `defvar *snippet-cache* (hashmap)` keyed by mode name.

### Phase 4: Mirror fields

When the user types in a field with `$1` mirrors:
- After each keystroke, read the field's current text.
- Replace all mirror positions with the same text.
- This requires a buffer-insert hook (like electric-pair) or a post-insert
  check in the insert handler.

## Relevant Files

**Existing (read, understand, extend):**
- `src/editor/handlers/insert-handler.ts` — Tab key handler (insertion point for the snippet try-expand)
- `src/tlisp/core/modes/` — minor-mode pattern (line-numbers-mode, electric-pair-mode)
- `src/editor/api/buffer-ops.ts` — buffer-insert, buffer-delete-range (for template insertion)
- `src/tlisp/core/commands/insert-entries.tlisp` — insert-tab (the fallthrough)

**New files:**
- `src/editor/api/snippet-ops.ts` — SnippetManager + TS primitives
- `src/tlisp/core/modes/snippet-mode.tlisp` — minor mode + T-Lisp commands
- `src/tlisp/core/commands/snippet.tlisp` — snippet loading, expansion commands
- `test/unit/snippet-mode.test.ts` — unit tests
- `examples/snippets/` — example snippet directory

## Implementation Plan

### Phase 1: Snippet loading + parsing
- `loadSnippets(modeName, dirPath)` reads files, parses `# key:`/`# name:`/`# --` headers
- Returns list of `{ key, name, body }`
- Test: load a test snippet dir, verify key/name/body parsed

### Phase 2: Template expansion (no placeholders first)
- `expandSnippet(body)` inserts template text at cursor
- Handles `$0` (final cursor position — just moves cursor there)
- Test: expand a simple template, cursor at `$0`

### Phase 3: Placeholder navigation
- Parse `$1`, `${1:default}` into field markers
- Tab → next field, S-Tab → prev field
- Field text selected (cursor positioned at field start; field region tracked)
- When `$0` reached → exit snippet state
- Test: expand `function $1($2) { $0 }`, Tab through fields

### Phase 4: Mirror fields
- `$1` appearing multiple times → all mirrors
- On type in field → update all mirrors
- Test: expand `${1:var} = ${1:var} + 1`, type at first → second updates

### Phase 5: Tab hook + minor mode
- `snippet-mode` minor mode registration
- Tab handler: try-expand → if match, expand; else fallthrough
- S-Tab handler: prev field
- Test: type `fun` + Tab in typescript-mode → expands

### Phase 6: Caching + reload
- Load on startup + on major-mode-set
- `(snippet-reload)` re-reads
- `(snippet-list)` for completion
- Test: reload picks up new files

## Step by Step Tasks

### Task 1: SnippetManager + parsing (`src/editor/api/snippet-ops.ts`)
- `SnippetManager` class: `loadDir(path)`, `lookup(key, mode)`, `expand(body, line, col)`
- File parser: read `# key:`, `# name:`, find `# --`, extract body
- Placeholder parser: scan body for `$N`, `${N:default}`, `$0`
- Returns: `{ key, name, body, fields: [{id, defaultText, positions: [{line, col}, ...]}] }`

### Task 2: Template insertion + field tracking
- `expandSnippet(body, fields)` inserts text at cursor, creates field markers
- First field selected (highlight or cursor positioning)
- Snippet state: `activeFields: SnippetField[]`, `currentFieldIndex: number`

### Task 3: Field navigation
- `nextField()`: advance index, select next field's region
- `prevField()`: decrement index, select previous field's region
- At `$0`: `exitSnippet()`

### Task 4: Mirror fields
- Track all positions of each `$N`
- On buffer-insert while in a field: re-read field text, update all mirror positions
- Requires hooking into the insert handler or post-insert check

### Task 5: T-Lisp primitives + minor mode
- `(snippet-load-dir path)` — returns list of snippets
- `(snippet-expand key)` — expand by key for current mode
- `(snippet-next-field)` / `(snippet-prev-field)` / `(snippet-exit)`
- `(snippet-field-active-p)`
- `(snippet-list)` — list snippets for current mode
- `(snippet-reload)`
- `(snippet-mode)` — minor mode toggle

### Task 6: Tab hook in insert handler
- When Tab pressed + snippet-mode active + no field active → `(snippet-try-expand)`
- When Tab pressed + field active → `(snippet-next-field)`
- When S-Tab pressed + field active → `(snippet-prev-field)`
- Fallthrough to `(insert-tab)` when no snippet matches

### Task 7: Snippet directory management
- On startup: load `~/.config/tmax/snippets/text-mode/` (global)
- On major-mode-set: load `~/.config/tmax/snippets/<mode>/`
- `(snippet-reload)` re-reads from disk
- Create directory if it doesn't exist

### Task 8: Tests
- Unit: parse snippet file (header + body), extract placeholders
- Unit: expand template → fields created, cursor at first field
- Unit: navigate fields (next/prev/exit)
- Unit: mirror fields update on type
- Integration: type abbreviation + Tab → expansion
- Edge cases: no snippets loaded, abbreviation not found, nested snippets

## Testing Strategy

### Unit Tests
- Snippet file parser: `# key:`, `# name:`, `# --` separator, body extraction
- Placeholder parser: `$1`, `${1:default}`, `$0`, mirror `$1` `$1`
- Expansion: template inserted at cursor, field markers created
- Navigation: Tab cycles fields, `$0` exits
- Mirrors: typing in field updates all mirrors

### Integration Tests (manual)
- Create `~/.config/tmax/snippets/typescript-mode/fun` with a function template
- `M-x snippet-mode` → type `fun` → Tab → template expands
- Tab through `name`, `args`, `body` placeholders
- Type in a mirror field → all mirrors update

### Edge Cases
- No snippet directory → `snippet-list` returns empty, Tab falls through
- Snippet file without `# --` → treat entire file as body (no key → use filename)
- `$0` without numbered fields → cursor at `$0`, no navigation
- Nested expansion: expand a snippet inside a field → inner snippet navigates first
- Unicode in snippet body

## Acceptance Criteria

- [ ] `(snippet-mode t)` activates snippet expansion
- [ ] Snippet files loaded from `~/.config/tmax/snippets/<mode>/` (any extension, plain text)
- [ ] File format: `# key:` + `# name:` + `# --` + body
- [ ] `$1`, `$2`, `$0` placeholders — Tab forward, S-Tab backward
- [ ] `${1:default}` — default text pre-filled
- [ ] Mirror `$1` `$1` — typing at one updates all
- [ ] Typing key + Tab expands (falls through if no match)
- [ ] Mode-scoped + global fallback (`text-mode/`)
- [ ] `(snippet-list)` returns loaded snippets
- [ ] `(snippet-reload)` re-reads from disk
- [ ] `bun run typecheck` clean; tests pass

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/snippet-mode.test.ts`
- `bun test test/unit/core-bindings.test.ts`
- Manual: create `~/.config/tmax/snippets/typescript-mode/fun`, `M-x snippet-mode`, type `fun` + Tab

## Notes

- **Supersedes abbrev-mode (#153)**: the registered abbrev-mode stub is empty;
  snippet-mode is the real implementation. abbrev-mode can be removed or kept as
  an alias.
- **Zero dependencies**: all parsing/expansion is in TypeScript + T-Lisp. No
  external snippet library.
- **Buffer identity**: snippet expansion uses buffer-insert/buffer-delete-range
  (existing primitives). Field markers are tracked in the SnippetManager (TS-side),
  not in the buffer — so they don't survive buffer switches (matching yasnippet
  behavior — snippets are per-expansion, not persistent).
- **Embedded T-Lisp**: `` `(...)` `` in `${1:$(...)}` evaluates the T-Lisp
  expression at expansion time (e.g., `` `(buffer-filename)` `` inserts the
  current filename). This is Phase 5+ — defer from the MVP.
- **Performance**: snippet loading is lazy (only when snippet-mode activates for a
  mode). Caching prevents re-reads.

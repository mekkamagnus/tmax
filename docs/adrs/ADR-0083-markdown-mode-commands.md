# Markdown Mode Commands and Navigation

## Status

Accepted

## Context

Markdown files were opened in fundamental mode with no structure-aware navigation or editing commands. Users had to manually count heading levels, navigate links by searching, and manage checkboxes by editing the raw text.

## Decision

Add a `markdown-mode.tlisp` minor mode with structure navigation and editing commands:

**Navigation** (`markdown.tlisp`):
- `g h` — jump to parent heading (up one heading level)
- `g O` — heading outline (jump to heading by number)
- `g x` — toggle checkbox (`[ ]` ↔ `[x]`)
- `g b` — jump back to previous position after outline navigation

**Editing commands**:
- Heading promotion/demotion (adjust `#` prefix level)
- Checkbox cycling through states
- List item continuation (insert new `- ` item on Enter)
- Link following (extract URL from markdown link, open via `browse-url`)

**Syntax** (`markdown.ts`):
- Add link region detection to the tokenizer for `follow-link` command support

**Key bindings** registered under the `g` prefix via T-Lisp keymap, consistent with the unified keymap dispatch (ADR-0047).

## Consequences

- **Easier**: Markdown editing becomes structured — heading navigation, checkbox toggling, and link following are single-key operations. The `g`-prefix groups all "go to" commands naturally.
- **Harder**: The markdown command library is large (~940 lines of T-Lisp) and covers many edge cases around heading depth, checkbox indentation, and list item nesting.

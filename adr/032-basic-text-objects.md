# Basic Text Objects

## Status

Accepted

## Context

Vim-style text objects for precise editing:
- `iw` - Inner word
- `aw` - A word
- `i"` - Inner double quotes
- `a"` - A double quotes
- `i(` - Inner parentheses
- `a(` - A parentheses
- Work with operators: `ci"`, `daw`, etc.

## Decision

Implement basic text objects:

### Text Object Definition

```typescript
export interface TextObject {
  find(buffer: Buffer, cursor: Position): Range;
}

export class WordTextObject implements TextObject {
  inner: boolean;

  find(buffer: Buffer, cursor: Position): Range {
    const line = buffer.getLine(cursor.line);

    if (this.inner) {
      // Inner word: word characters only
      const start = findWordStart(line, cursor.column);
      const end = findWordEnd(line, cursor.column);
      return { start: { line: cursor.line, column: start }, end: { line: cursor.line, column: end } };
    } else {
      // A word: word + trailing whitespace
      const start = findWordStart(line, cursor.column);
      const end = findWordEnd(line, cursor.column);
      const whitespaceEnd = findWhitespaceEnd(line, end);
      return { start: { line: cursor.line, column: start }, end: { line: cursor.line, column: whitespaceEnd } };
    }
  }
}
```

### Text Object Types

```lisp
;; Word text objects
iw  ; => Inner word (word characters only)
aw  ; => A word (word + trailing space)

;; Quoted text objects
i"  ; => Inner double quotes (excluding quotes)
a"  ; => A double quotes (including quotes)
i'  ; => Inner single quotes
a'  ; => A single quotes
i`  ; => Inner backticks
a`  ; => A backticks

;; Parentheses/brackets
i(  ; => Inner parentheses (excluding parens)
a(  ; => A parentheses (including parens)
i)  ; => Same as i(
a)  ; => Same as a(
ib  ; => Same as i(
ab  ; => Same as a(
i[  ; => Inner brackets
a[  ; => A brackets
i]  ; => Same as i[
a]  ; => Same as a[
i{  ; => Inner braces
a{  ; => A braces
i}  ; => Same as i{
a}  ; => Same as a{
```

### Operator Usage

```lisp
;; Change inner word
ciw  ; => Delete word, enter insert mode

;; Delete a quote
da"  ; => Delete quoted string including quotes

;; Yank inner parentheses
yi(  ; => Yank text inside parentheses

;; Change inner braces
ci{  ; => Delete text inside braces, enter insert mode
```

### Implementation

Created `src/editor/text-objects.ts`:
- Text object definitions
- Inner/outer logic
- Quote matching
- Parentheses matching
- Word boundary detection

### Key Bindings

Text objects used with operators:
```lisp
;; Operators trigger text object mode
(key-bind "d" "delete-operator-pending" "normal")
(key-bind "c" "change-operator-pending" "normal")
(key-bind "y" "yank-operator-pending" "normal")
```

## Consequences

### Benefits

1. **Precision**: Edit text objects precisely
2. **Efficiency**: Quick edits on syntactic units
3. **Vim Compatibility**: Standard vim text objects
4. **Composability**: Works with all operators

### Trade-offs

1. **Complexity**: Text object parsing is complex
2. **Nested Structures**: Handling nested objects
3. **Mismatched Pairs**: Unclosed quotes/parens
4. **Performance**: Finding boundaries can be slow

### Future Considerations

1. **More Text Objects**: `it`, `at` (tags), `i<`, `a<` (HTML tags)
2. **Sentence Objects**: `is`, `as` (sentences)
3. **Paragraph Objects**: `ip`, `ap` (paragraphs)
4. **Function Objects**: `if`, `af` (functions)
5. **Block Objects**: `iB`, `aB` (blocks)

### Testing

Created `test/unit/editor.test.ts`:
- `iw` selects inner word
- `aw` selects a word
- `i"` selects inner quotes
- `a"` selects a quotes
- `i(` selects inner parentheses
- `a(` selects a parentheses
- Operators work with text objects
- Cursor positioning correct
- Works with nested structures

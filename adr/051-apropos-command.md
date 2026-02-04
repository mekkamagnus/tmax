# Apropos Command

## Status

Accepted

## Context

Command search by keyword needed:
- Search functions by keyword
- Search variables by keyword
- Search bindings by keyword
- Show matching results

## Decision

Implement apropos command:

### Apropos Search

```typescript
export function apropos(keyword: string): AproposMatch[] {
  const matches: AproposMatch[] = [];

  // Search functions
  for (const [name, doc] of functionRegistry) {
    if (name.includes(keyword) || doc.description.includes(keyword)) {
      matches.push({
        type: 'function',
        name,
        description: doc.description
      });
    }
  }

  // Search variables
  for (const [name, doc] of variableRegistry) {
    if (name.includes(keyword) || doc.description.includes(keyword)) {
      matches.push({
        type: 'variable',
        name,
        description: doc.description
      });
    }
  }

  // Search bindings
  for (const [key, binding] of keymap) {
    if (key.includes(keyword) || binding.command.includes(keyword)) {
      matches.push({
        type: 'binding',
        name: key,
        description: binding.description
      });
    }
  }

  return matches;
}
```

### Apropos Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Apropos: buffer

Matches for "buffer":

  Functions:
    buffer-create           Create a new buffer
    buffer-switch           Switch to buffer
    buffer-delete           Delete buffer
    buffer-list             List all buffers

  Variables:
    buffer-list             List of all buffers
    current-buffer          Currently active buffer

  Bindings:
    C-x b                   Switch buffer
    C-x k                   Kill buffer

Type RET to view, or ESC to cancel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Apropos Commands

```lisp
;; Apropos search
C-h a keyword      ; => Apropos search (all)
C-h a f keyword   ; => Apropos functions only
C-h a v keyword   ; => Apropos variables only
C-h a b keyword   ; => Apropos bindings only

;; Interactive apropos
M-x apropos       ; => Interactive apropos
```

### Implementation

Created `src/editor/apropos.ts`:
- Keyword search
- Multi-registry search
- Result ranking
- UI rendering

## Consequences

### Benefits

1. **Discovery**: Find functions by keyword
2. **Search**: Search all namespaces
3. **Learning**: Learn about editor features
4. **Exploration**: Explore available commands

### Trade-offs

1. **Performance**: Search can be slow
2. **False Positives**: Matches may be irrelevant
3. **Overwhelming**: Too many results
4. **Keyword Choice**: Users must know good keywords

### Future Considerations

1. **Fuzzy Apropos`: Fuzzy matching
2. **Category Filter`: Filter by type
3. **Relevance Ranking`: Smart ranking
4. **Apropos History`: Recent searches

### Testing

Created `test/unit/editor.test.ts`:
- Apropos searches correctly
- Multiple namespaces searched
- Results ranked appropriately
- Display renders correctly
- Filtering works
- RET shows details
- ESC cancels

# Describe Function

## Status

Accepted

## Context

Function documentation needed:
- Show function signature
- Show function description
- Show function usage
- Show related functions

## Decision

Implement describe-function:

### Function Documentation

```typescript
export interface FunctionDoc {
  name: string;
  signature: string;
  description: string;
  parameters: ParameterDoc[];
  returns: string;
  examples: string[];
  related: string[];
}

export function describeFunction(functionName: string): FunctionDoc | null {
  return functionRegistry.getDocumentation(functionName) || null;
}
```

### Describe Function Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
cursor-move

Move cursor to specified position.

Signature: (cursor-move line column)

Parameters:
  line    - Line number (0-indexed)
  column  - Column number (0-indexed)

Returns: Position

Examples:
  (cursor-move 10 5)    ; Move to line 10, column 5
  (cursor-move 0 0)     ; Move to beginning

Related:
  cursor-up, cursor-down, cursor-left, cursor-right
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Function Commands

```lisp
;; Describe function
C-h f function-name    ; => Describe function (with completion)
M-x describe-function  ; => Interactive describe

;; Apropos
C-h a keyword         ; => Search for functions by keyword
```

### Implementation

Created `src/editor/describe.ts`:
- Function registry
- Documentation lookup
- Signature parsing
- UI rendering

## Consequences

### Benefits

1. **Help**: Function reference
2. **Learning**: Learn function usage
3. **Discovery**: Find related functions
4. **Development**: Aid plugin development

### Trade-offs

1. **Maintenance**: Docs must be updated
2. **Completeness**: Not all functions have docs
3. **Accuracy**: Docs can become outdated
4. **Complex Functions**: Complex functions need good docs

### Future Considerations

1. **Auto-Generated Docs**: Generate from source
2. **Type Hints**: Show type information
3. **Source Link**: Link to source code
4. **Version Info**: Show version introduced

### Testing

Created `test/unit/editor.test.ts`:
- Function lookup works
- Documentation displays
- Parameters listed
- Examples shown
- Related functions listed
- Completion works
- Unbound functions show error

# LSP Diagnostics

## Status

Accepted

## Context

LSP diagnostic display needed:
- Show errors/warnings in UI
- Navigate to diagnostics
- Quick fix suggestions
- Diagnostic severity levels

## Decision

Implement LSP diagnostics display:

### Diagnostic Types

```typescript
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
}
```

### Diagnostic Display

```lisp
;; Show diagnostics in buffer
(lsp-show-diagnostics)

;; Navigate diagnostics
(lsp-next-error)    ; => Go to next diagnostic
(lsp-previous-error)  ; => Go to previous diagnostic

;; Quick fix
(lsp-code-action)   ; => Apply code action at cursor
```

### Diagnostic UI

```
Buffer: example.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function foo() {
  const x = 10;  [Error] 'x' is assigned but never used
  return 20;
}

Diagnostics: 1 error, 0 warnings
Press ] to go to next error
```

### Implementation

Created `src/lsp/diagnostics.ts`:
- Diagnostic storage
- UI rendering
- Navigation commands
- Quick fix integration

## Consequences

### Benefits

1. **Error Detection**: Real-time error feedback
2. **Navigation**: Quick navigation to errors
3. **Code Actions**: Automated fixes
4. **Standard**: LSP standard diagnostic format

### Trade-offs

1. **UI Complexity**: Diagnostic display is complex
2. **Performance**: Frequent diagnostics impact performance
3. **False Positives**: Not all diagnostics are accurate
4. **Spam**: Too many diagnostics can overwhelm user

### Future Considerations

1. **Diagnostic Filtering**: Filter by severity/source
2. **Diagnostic Grouping**: Group related diagnostics
3. **Diagnostic Persistence**: Save diagnostics to disk
4. **Diagnostic Search**: Search diagnostics

### Testing

Created `test/unit/editor.test.ts`:
- Diagnostics display correctly
- Navigation works
- Quick fixes apply correctly
- Severity levels render correctly
- Multiple diagnostics handled

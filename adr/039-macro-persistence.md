# Macro Persistence

## Status

**proposed**

## Context

Macros need to persist across editor sessions:
- Save macros to disk
- Load macros at startup
- Share macros between sessions

## Decision

Implement macro persistence:

### Macro Storage

```
~/.tmaxrc.d/macros/
├── register-a.tlisp
├── register-b.tlisp
└── register-q.tlisp
```

### Macro Serialization

```lisp
;; Macro file format
;; ~/.tmaxrc.d/macros/register-a.tlisp
((macro-command "cursor-down")
 (macro-command "insert" "Hello")
 (macro-command "escape"))
```

### Save/Load Macros

```typescript
export async function saveMacro(register: string, macro: MacroCommand[]): Promise<void> {
  const macroDir = path.join(homedir(), '.tmaxrc.d', 'macros');
  await fs.mkdir(macroDir, { recursive: true });

  const macroFile = path.join(macroDir, `register-${register}.tlisp`);
  const serialized = serializeMacro(macro);
  await fs.writeFile(macroFile, serialized);
}

export async function loadMacro(register: string): Promise<MacroCommand[]> {
  const macroFile = path.join(homedir(), '.tmaxrc.d', 'macros', `register-${register}.tlisp`);

  if (await fs.exists(macroFile)) {
    const content = await fs.readFile(macroFile);
    return deserializeMacro(content);
  }

  return [];
}
```

### T-Lisp Interface

```lisp
;; Save macro
(macro-save "a")

;; Load macro
(macro-load "a")

;; Save all macros
(macro-save-all)

;; List persisted macros
(macro-list)
```

### Implementation

Created `src/editor/macros.ts`:
- Macro serialization/deserialization
- File I/O for macros
- Auto-save on record
- Auto-load on startup

## Consequences

### Benefits

1. **Persistence**: Macros survive editor restart
2. **Portability**: Macros can be backed up and shared
3. **Automation**: Macros available immediately
4. **Recovery**: No lost work on crash

### Trade-offs

1. **File I/O**: Disk operations on macro record
2. **Disk Space**: Macros consume disk space
3. **Versioning**: Macro format changes break compatibility
4. **Security**: Macro files can contain malicious code

### Future Considerations

1. **Macro Sync**: Sync macros across machines
2. **Macro Cloud**: Store macros in cloud
3. **Macro Sharing**: Share macros with others
4. **Macro Versioning**: Version control for macros

### Testing

Created `test/unit/editor.test.ts`:
- Macros save to disk
- Macros load from disk
- Save all macros works
- Load non-existent macro returns empty
- File format is valid T-Lisp
- Auto-save on record stop

# Macro Recording

## Status

Accepted

## Context

Vim-style macro recording:
- `q{register}` - Start recording to register
- `q` - Stop recording
- `@{register}` - Replay macro
- Automatic macro execution

## Decision

Implement macro recording system:

### Macro Recording

```typescript
export class MacroRecorder {
  private recording: boolean = false;
  private currentRegister: string | null = null;
  private macros: Map<string, MacroCommand[]> = new Map();

  startRecording(register: string): void {
    this.recording = true;
    this.currentRegister = register;
    this.macros.set(register, []);
  }

  stopRecording(): void {
    this.recording = false;
    this.currentRegister = null;
  }

  recordCommand(command: MacroCommand): void {
    if (this.recording && this.currentRegister) {
      this.macros.get(this.currentRegister)!.push(command);
    }
  }

  playback(register: string, count: number = 1): void {
    const macro = this.macros.get(register);
    if (!macro) return;

    for (let i = 0; i < count; i++) {
      for (const cmd of macro) {
        cmd.execute();
      }
    }
  }
}
```

### Macro Commands

```lisp
;; Start recording
qa  ; => Start recording to register a

;; Stop recording
q   ; => Stop recording

;; Replay macro
@a  ; => Execute macro in register a
@@  ; => Replay last macro
3@a  ; => Execute macro 3 times
```

### Macro Editing

```lisp
;; Show macro contents
(macro-show "a")

;; Edit macro
(macro-edit "a" '(("cursor-down") ("insert" "Hello") ("escape")))

;; Clear macro
(macro-clear "a")
```

### Implementation

Created `src/editor/macros.ts`:
- Macro recording state
- Command capture
- Macro playback
- Register storage

### Key Bindings

```lisp
;; Macro recording
(key-bind "q" "macro-record-pending" "normal")
(key-bind "@" "macro-play-pending" "normal")
(key-bind "@" "macro-play-last" "normal" :count true)
```

## Consequences

### Benefits

1. **Automation**: Automate repetitive tasks
2. **Vim Compatibility**: Standard vim macro system
3. **Efficiency**: Quick task automation
4. **Flexibility**: Complex multi-step operations

### Trade-offs

1. **State Management**: Must track recording state
2. **Register Limits**: Limited to single-character registers
3. **Editing**: Editing macros is complex
4. **Debugging**: Hard to debug macros

### Future Considerations

1. **Visual Macro Editor**: GUI for editing macros
2. **Macro Serialization**: Save macros to files
3. **Macro Libraries**: Shareable macro collections
4. **Conditional Macros**: Macros with branching logic
5. **Macro Arguments**: Parameterized macros

### Testing

Created `test/unit/editor.test.ts`:
- `qa` starts recording
- `q` stops recording
- `@a` replays macro
- `3@a` replays 3 times
- `@@` replays last macro
- Macros execute commands correctly
- Recording state tracked correctly

# Minibuffer Input

## Status

Accepted

## Context

Command input interface needed:
- Minibuffer for command entry
- Command history
- Tab completion
- Multi-line input

## Decision

Implement minibuffer input system:

### Minibuffer UI

```typescript
export class Minibuffer {
  private input: string = '';
  private cursor: number = 0;
  private history: string[] = [];
  private historyIndex: number = -1;
  private prompt: string = '';

  constructor(prompt: string) {
    this.prompt = prompt;
  }

  setInput(text: string): void {
    this.input = text;
    this.cursor = text.length;
  }

  insert(text: string): void {
    this.input = this.input.slice(0, this.cursor) + text + this.input.slice(this.cursor);
    this.cursor += text.length;
  }

  delete(count: number = 1): void {
    const start = Math.max(0, this.cursor - count);
    const end = this.cursor;
    this.input = this.input.slice(0, start) + this.input.slice(end);
    this.cursor = start;
  }

  cursorLeft(count: number = 1): void {
    this.cursor = Math.max(0, this.cursor - count);
  }

  cursorRight(count: number = 1): void {
    this.cursor = Math.min(this.input.length, this.cursor + count);
  }

  historyNext(): string | null {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.input = this.history[this.historyIndex];
      this.cursor = this.input.length;
      return this.input;
    }
    return null;
  }

  historyPrevious(): string | null {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.input = this.history[this.historyIndex];
      this.cursor = this.input.length;
      return this.input;
    } else if (this.historyIndex === -1 && this.history.length > 0) {
      this.historyIndex = this.history.length - 1;
      this.input = this.history[this.historyIndex];
      this.cursor = this.input.length;
      return this.input;
    }
    return null;
  }

  submit(): string {
    if (this.input) {
      this.history.push(this.input);
      this.historyIndex = this.history.length;
    }
    return this.input;
  }
}
```

### Minibuffer Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
:hello world█
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

History (↑/↓): [previous commands...]
Completion (Tab): [completions...]
```

### Key Bindings

```lisp
;; Minibuffer navigation
C-a     ; => Beginning of line
C-e     ; => End of line
C-b     ; => Backward character
C-f     ; => Forward character
M-b     ; => Backward word
M-f     ; => Forward word
C-u     ; => Delete to beginning
C-k     ; => Delete to end
C-p / ↑ ; => Previous history
C-n / ↓ ; => Next history
C-g     ; => Cancel
RET     ; => Submit
TAB     ; => Complete
```

### Implementation

Created `src/editor/minibuffer.ts`:
- Minibuffer state
- Input handling
- History management
- Completion integration

## Consequences

### Benefits

1. **Command Input**: Structured command entry
2. **History**: Easy access to previous commands
3. **Completion**: Tab completion support
4. **Standard**: Emacs-style minibuffer

### Trade-offs

1. **Screen Space**: Minibuffer consumes screen space
2. **Mode Switch**: Must enter minibuffer mode
3. **Complexity**: Minibuffer state management
4. **Multi-line**: Multi-line input is complex

### Future Considerations

1. **Multi-line Input**: Support for multi-line commands
2. **Prompt Customization`: Custom prompts
3. **Input Validation`: Real-time validation
4. **Auto-complete`: Auto-show completions

### Testing

Created `test/unit/editor.test.ts`:
- Minibuffer opens correctly
- Input accepts characters
- Backspace deletes characters
- Cursor navigation works
- History navigation works
- Submit executes command
- Cancel closes minibuffer

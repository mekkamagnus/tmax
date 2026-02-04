# Evil Integration

## Status

Accepted

## Context

Emacs Evil mode compatibility layer:
- Emacs-style key bindings
- Evil mode state machine
- Hybrid vim/Emacs workflows
- Leverage existing Emacs packages

## Decision

Implement Evil mode compatibility:

### Evil Mode States

```typescript
export enum EvilState {
  Normal = 'normal',
  Insert = 'insert',
  Visual = 'visual',
  Replace = 'replace',
  Operator = 'operator',
  Motion = 'motion'
}

export class EvilMode {
  private state: EvilState = EvilState.Normal;
  private previousState: EvilState | null = null;

  setState(newState: EvilState): void {
    this.previousState = this.state;
    this.state = newState;
  }

  getState(): EvilState {
    return this.state;
  }

  restoreState(): void {
    if (this.previousState) {
      this.state = this.previousState;
      this.previousState = null;
    }
  }
}
```

### Emacs Key Bindings

```lisp
;; Emacs-style key bindings in insert mode
(key-bind "C-x C-f" "find-file" "insert")
(key-bind "C-x C-s" "save-file" "insert")
(key-bind "C-x C-c" "save-buffers-kill-terminal" "insert")
(key-bind "C-x b" "switch-buffer" "insert")
(key-bind "C-g" "keyboard-quit" "all")
```

### Evil Mode Commands

```lisp
;; Evil mode state transitions
(evil-mode t)    ; => Enable Evil mode
(evil-mode nil)  ; => Disable Evil mode

;; Switch to specific state
(evil-normal-state)   ; => Enter normal mode
(evil-insert-state)   ; => Enter insert mode
(evil-visual-state)   ; => Enter visual mode
(evil-replace-state)  ; => Enter replace mode
```

### Hybrid Workflows

Mix vim and Emacs workflows:
```lisp
;; Use vim operators with Emacs motions
d C-e  ; => Delete to end of line (Emacs motion)

;; Use Emacs commands in vim modes
C-x C-f  ; => Find file (works in all modes)
```

### Implementation

Created `src/editor/modes/evil.ts`:
- Evil mode state machine
- Emacs key binding support
- State transition logic
- Hybrid command dispatch

## Consequences

### Benefits

1. **Emacs Compatibility**: Use Emacs workflows
2. **Package Ecosystem**: Access Emacs packages
3. **Flexibility**: Mix vim and Emacs styles
4. **Transition Path**: Emacs users can adopt tmax

### Trade-offs

1. **Complexity**: Two keybinding systems
2. **Conflicts**: Vim/Emacs key conflicts
3. **Learning Curve**: Users must know both systems
4. **Maintenance**: More code to maintain

### Future Considerations

1. **Evil Collection**: Port evil-collection packages
2. **Custom States**: Define custom Evil states
3. **State Hooks**: Run code on state transitions
4. **Evil Leader`: Leader key in Evil mode

### Testing

Created `test/unit/editor.test.ts`:
- Evil mode enables/disables
- State transitions work
- Emacs key bindings work
- Hybrid workflows work
- No conflicts between systems

# Plugin Lifecycle Hooks

## Status

**proposed**

## Context

Plugins need hooks into editor lifecycle:
- Plugin initialization
- Buffer events (create, save, switch)
- Mode changes
- Editor shutdown

## Decision

Implement plugin lifecycle hooks:

### Hook Types

```lisp
;; Plugin initialization
(defun plugin-init ()
  (message "Plugin loaded!"))

;; Buffer hooks
(defun on-buffer-create (buffer)
  (message "Buffer created: " (buffer-name buffer)))

(defun on-buffer-save (buffer)
  (message "Buffer saved: " (buffer-name buffer)))

(defun on-buffer-switch (from-buffer to-buffer)
  (message "Switched from " (buffer-name from-buffer)
          " to " (buffer-name to-buffer)))

;; Mode hooks
(defun on-mode-enter (new-mode)
  (message "Entered mode: " new-mode))

(defun on-mode-exit (old-mode)
  (message "Exited mode: " old-mode))

;; Editor shutdown
(defun plugin-shutdown ()
  (message "Plugin unloading..."))
```

### Hook Registration

```lisp
;; Register hooks
(add-hook 'on-buffer-create 'my-on-buffer-create)
(add-hook 'on-buffer-save 'my-on-buffer-save)
(add-hook 'on-mode-enter 'my-on-mode-enter)

;; Remove hooks
(remove-hook 'on-buffer-create 'my-on-buffer-create)
```

### Hook Execution

```typescript
export class HookManager {
  private hooks: Map<string, HookFunction[]> = new Map();

  add(hookName: string, func: HookFunction): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName)!.push(func);
  }

  remove(hookName: string, func: HookFunction): void {
    const funcs = this.hooks.get(hookName);
    if (funcs) {
      const index = funcs.indexOf(func);
      if (index >= 0) {
        funcs.splice(index, 1);
      }
    }
  }

  execute(hookName: string, ...args: unknown[]): void {
    const funcs = this.hooks.get(hookName) || [];
    for (const func of funcs) {
      func(...args);
    }
  }
}
```

### Implementation

Created `src/plugin/hooks.ts`:
- Hook registration system
- Hook execution
- Built-in hook types
- Error handling in hooks

## Consequences

### Benefits

1. **Extensibility**: Plugins can hook into editor events
2. **Integration**: Plugins integrate cleanly
3. **Automation**: Automated tasks on events
4. **Flexibility**: Multiple hooks per event

### Trade-offs

1. **Performance**: Hook execution overhead
2. **Error Handling**: Bad hooks can break editor
3. **Hook Order**: Hook execution order matters
4. **Debugging**: Hook call stacks complex

### Future Considerations

1. **Hook Priority**: Control hook execution order
2. **Conditional Hooks**: Hooks that run only in certain conditions
3. **Async Hooks**: Hooks that can be async
4. **Hook Composition**: Combine multiple hooks

### Testing

Created `test/unit/plugin.test.ts`:
- Hooks register correctly
- Hooks execute in order
- Hook removal works
- Errors in hooks don't crash editor

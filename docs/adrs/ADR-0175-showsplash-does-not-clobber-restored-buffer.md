# ADR-0175 — `showSplashIfEmpty` must not clobber a restored name-only buffer (#114 / BUG-65)

## Status

Accepted

## Context

After a daemon restart, a buffer held by a window (e.g. a durable `durable.ts`
created with `(buffer-create "durable.ts")` — a name-only buffer with no
associated file) was silently dropped from its window: the restored frame
rendered `*scratch*` instead of the durable buffer. Pre-existing (stash-confirmed
against `main`); the single `test:integration` red.

Investigation proved the workspace **restore path is correct** — after
`initializeWorkspaces` → `Editor.applyWorkspace`, the model genuinely holds
`windows[0].bufferName = "durable.ts"` and `currentBuffer = durable.ts`. The
window→buffer assignment is lost **after** restore, in `Editor.showSplashIfEmpty`
(`src/editor/editor.ts`), which `TmaxServer.startEditor` runs immediately after
`initializeWorkspaces`.

`showSplashIfEmpty`'s only guard was `if (this.model.currentFilename) return;`.
That protects **file** buffers, but a name-only buffer has `currentFilename ===
undefined`, so the guard does not fire. With `*scratch*` empty (a fresh scratch
on the restarted daemon), `showSplashIfEmpty` then calls
`createBuffer("*scratch*", SPLASH_TEXT)`, whose "current window follows the new
buffer" branch overwrites the restored window to `*scratch*` — destroying the
`durable.ts` assignment. Same bug family as BUG-58 (startup code displacing a
correctly loaded buffer).

## Decision

Tighten the `showSplashIfEmpty` guard so the splash only seeds when the current
window is genuinely `*scratch*` (or there is no current window). Concretely,
after the existing `currentFilename` check, also early-return when the current
window holds a non-`*scratch*` buffer:

```ts
if (this.model.currentFilename) return;
const currentWindow = this.model.windows?.[this.model.currentWindowIndex ?? 0];
if (currentWindow && currentWindow.bufferName !== "*scratch*") return;
```

This mirrors how `createBuffer` itself reads the current window
(`windows[currentWindowIndex ?? 0]`). It is the minimal change (two lines) and
preserves splash-on-fresh-start: when no workspace was restored, `model.windows`
is empty or `[scratch]`, so `currentWindow` is undefined or scratch and the
splash seeds normally.

`createBuffer` is deliberately **not** changed — its window-follows-new-buffer
behavior is correct for the normal "user created/switched a buffer" flow. The
defect was solely that `showSplashIfEmpty` reached `createBuffer` in a state
where the current window legitimately belonged to a restored buffer. Fix the
caller, not the callee. The restore path (`applyWorkspace`,
`initializeWorkspaces`, `frameToEditorState`) is also unchanged — verified
correct.

## Consequences

- A durable name-only buffer held by a window survives a daemon restart and is
  restored to that window in the rendered frame (`test:integration`
  `workspace-move-window target save failure leaves source durable on disk` now
  green; `test:integration` exit 0 — 82/0).
- Splash-on-fresh-start is unchanged, pinned by a new focused unit test
  (`test/unit/show-splash.test.ts`) covering both guard branches: seeds splash
  on an empty `*scratch*`, and leaves a restored non-`*scratch*` current window
  alone.
- Name-only buffers (the `module--private` / `durable.ts` convention) are now
  first-class with respect to the startup splash — they are not displaced just
  because they lack a filename.

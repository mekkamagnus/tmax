# ADR-0282: Directional Window Navigation on Flat-Layout Cell Geometry

## Status

Accepted

## Context

Issue #261: only cyclic `C-w w` was bound; `h/j/k/l/o/r/W` were unbound. The issue assumed directional navigation needed #260's layout tree — but #259's `computeLayout` already assigns every window a real cell (x/y/width/height), so direction is computable on the flat single-axis layout. Two hygiene items rode along: C-w chords split across two files, and `delete-other-windows` implemented twice.

## Decision

1. **Direction is a geometry query in TS; commands/bindings in T-Lisp.** `window-move-focus <direction>` computes the focused cell, picks the nearest candidate strictly on the target side (sharing perpendicular extent; largest overlap breaks distance ties), and routes through the switch port (#262 full context rebind). T-Lisp `windmove-*` defuns wrap it; `C-w h/j/k/l` bind them. No candidate → nil no-op. `window-rotate` swaps the focused record with the next (cyclic) and re-routes the switch port so the model rebinds to the slot's new occupant.
2. **`computeLayout`/`renderSeparators` moved to `src/core/window-layout.ts`** (pure geometry the editor layer needs; compatibility re-export keeps frontend importers). Same layering move as #258's viewport clamp.
3. **Dedup verdict on `delete-other-windows`, decided by evidence**: TS builtins win symbol resolution over same-named T-Lisp defuns, so the TS primitive was the live implementation (removing it failed the #262 cursor-absorb test) and the T-Lisp loop was dead code — and worse, it restored sibling records mid-loop, losing the model cursor. The defun is deleted; the primitive keeps the name and gains `C-w o`. The issue's original "prefer the T-Lisp one" suggestion was inverted by the test evidence.
4. **`switchWindow` is instance-staleness-proof end to end**: the restore prefers the registry's live instance (`this.buffers.get(record.bufferName) ?? record.buffer` — immutable inserts swap buffer instances in the registry + the focused record while unfocused copies keep stale references; restoring a stale instance left `(buffer-current)` nil), and the same-index no-op guard + leave-save condition compare by buffer **name** rather than instance (a stale instance would spuriously defeat the guard or skip a legitimate save). Found by the directional tests, fixed at the switch seam (every focus change heals the entering pane's record).
5. All 16 C-w chords consolidated in `windows.tlisp`.

Deliberately out of scope: `C-w H/J/K/L` move-window and mixed-axis directional accuracy (#260), unfocused-pane stale-instance *display* (the known unfocused-pane liveness gap, ADR-0279 family — the switch-seam healing covers the rebind, not the stale render).

## Consequences

- The vim C-w chord set is complete on flat layouts; directional semantics degrade gracefully (nearest-edge heuristic) once #260's tree lands.
- A latent instance-desync class is closed at the focus seam: entering a pane always binds the registry's live buffer for that pane's name.
- Symbol resolution order (TS builtins > T-Lisp defuns) is now documented behavior that dedup decisions can rely on — and same-named defuns are dead code by construction (worth grepping for in future hygiene passes).
- Which-key C-w popup grew 9 → 16 entries (count assertions updated).

## Related

- [SPEC-256](../specs/SPEC-256-window-directional-navigation.md), issue #261
- [ADR-0280](ADR-0280-window-stored-dimension-layout.md) (#259 — the cell geometry), [ADR-0278](ADR-0278-window-focus-context-rebind.md) (#262 — the rebind seam), #260 (layout tree — move-window deferred), #263

# ADR-0291: Capture composes in a bottom-split popup with a commit-stripped skeleton

## Status

Accepted

## Context

Issue #285: the landed capture (#278, ADR-0290) switched the whole buffer — the mockup (verified live against Emacs 30.1) specifies org-capture's popup geometry: `org-display-buffer-split` collapses to one window and splits 50/50 (direction adapts to frame width; `:return-to-wconf` restores), skeleton in the buffer with point at `%?` and `%U` stamped at open.

## Decision

`capture-daily` splits the single window 50/50 bottom (tmax fixes the direction Emacs leaves to width — the preferred shape) or reuses the current window when a layout already exists (friendlier than Emacs's collapse). The compose buffer seeds a `capture -> <path>` header plus the `- [open-time ts] ` prefix. Commit strips the skeleton in three stages — header drop (`capture-strip-skeleton`), untouched-prefix removal with the bare-prefix and trim-eaten-space cases matched explicitly (`capture-body`), edited-prefix passthrough vs re-add (`capture-entry`) — so the skeleton guides the eye and never reaches the file. Restore closes the popup only when we opened it.

## Consequences

- The compose-then-commit contract (#277) now has its full Emacs-parity front-end; fikra's draft line (#268) remains the inline variant.
- Timestamps are captured at open and survive regardless of when the entry is filed.
- Date assertions in tests must use tmax's own `date` (Bun's sv-SE locale returns the UTC date).

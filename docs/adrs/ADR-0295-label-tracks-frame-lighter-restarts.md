# ADR-0295 — #300: the label was never on the wire; the lighter already per-frame

- **Status**: Accepted
- **Date**: 2026-11-20
- **Issue**: #300
- **Spec**: SPEC-269

## Context

Two frame-sync cosmetics treated as separate failures: (A) the mode line
kept `*scratch*` while *Fikra* content rendered after switching back;
(B) the `fikra:` lighter vanished after 3 client restarts.

## Decision

(A) Root cause: `editorStateToJson` omitted `currentBufferName`
entirely — and the deserializer never read it — so
`renderStatusLine`'s `"*scratch*"` fallback (status-line.ts) labeled
every no-filename buffer on every frame. Fix (gate r1 caught the
client-side last mile): the wire carries the field, the deserializer
reads it onto EditorState, and `frameToEditorState` attaches its
resolved frame/workspace buffer name. The label is frame state derived per render — never
latched at switch time. (B) The lighter is already derived per frame
from the buffer's minor-mode registration; the headless harness pins it
across 3 disconnect/reconnect cycles (green) — the registration
survives frame teardown by construction.

## Consequences

- The wire grows one optional field (backward-compatible: absent → the
  old default).
- The label-tracks-frame harness doubles as the frame-sync regression
  for any future third-copy latching (the workspace/frame/editor triple
  this bug exposed).

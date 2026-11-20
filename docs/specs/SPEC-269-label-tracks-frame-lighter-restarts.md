# SPEC-269 — stale mode-line label + lighter across restarts (#300)

## Goal

A: the mode-line buffer label reflects the CURRENT buffer on EVERY
rendered frame (frame state, not latched). B: the fikra lighter renders
on every *Fikra* frame across 3 client restarts (derived per frame from
the buffer's minor-mode registration).

## Cause (A) + fix

`editorStateToJson` never emitted `currentBufferName` — every
render-state frame deserialized to the `"*scratch*"` default for
no-filename buffers (*Fikra*, *Help*): the stale label while the correct
content rendered. The wire type gains the field;
`frameToEditorState` attaches its already-resolved frame/workspace
buffer name.

## B verification

`fikra-start`'s minor-mode registration survives frame teardown: 3
disconnect (frame delete) + reconnect (new frame, same daemon +
workspace) cycles each render `*Fikra*` + the `fikra` lighter
(deterministic captures in the headless harness).

## Completion criteria

- [x] A: label-tracks-frame test — a named-buffer switch sequence
      (uniquely-named special buffers; fikra owns the *Fikra* name
      variants, so the harness mints its own) through real keypress
      round-trips, every frame's label asserted on BOTH the keypress
      response and render-state via the client pipeline; the *Fikra*
      label itself is asserted throughout B
- [x] B: lighter present on every *Fikra* frame across 3
      disconnect/reconnect cycles; per-frame derivation verified

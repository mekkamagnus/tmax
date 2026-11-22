# SPEC-291 — the *grep* hit-buffer subsystem (#307)

## Goal

The generic cross-file hit buffer every search backend feeds
(RFC-031 §2.1): a generation-scoped producer interface, structured
hits, display, navigation, RET landing, and recency-based q
restoration. Ships with a TEST PRODUCER (no #308/#309 dependency).

## Design (the issue's normative text, verbatim contract)

- **Producer interface**: grep-buffer-register (hashmap with EXACTLY
  backend/pattern/scope/rerun — unknown keys error naming them;
  pattern MAY be empty → `<glob-only>` display) → generation id;
  grep-buffer-append-hit (EXACTLY file/line/col/text; file
  non-empty; text may be empty; line/col ≥ 1) — superseded or
  completed generations silently drop well-formed appends;
  grep-buffer-complete (done|error|no-matches; error requires a
  message); grep-buffer-rollback (ONLY the newest generation;
  older → error `rollback: not the latest generation`; completed →
  error `rollback: generation already complete`; restores the
  previous generation's content; a restored generation's id is
  RETIRED — no further callbacks).
- **Precedence**: malformed arguments error EVEN on stale
  generations (validation before staleness).
- **Display**: `file:line:col:text` (paths as given; display text
  never parsed); `searching…` placeholder until first hit or
  completion; done-with-zero-hits → `no matches for <pattern>`;
  error → the message.
- **Streaming**: point stays on the first hit; appends never move
  it; n/p traverse as hits arrive.
- **Keymap**: RET opens (file at line/col; line clamp + status
  note; col clamp silent); n/p wrap with count stride + echo; g
  calls rerun; q kills + recency-restores (never deletes windows).
- **Edges**: empty results → n/p/RET no-op with status; deleted
  file → `file gone: <path>`; read-only buffer.

## Completion criteria

- [ ] The test producer drives the FULL validation matrix
      (field-class errors incl. unknown keys, empty text/pattern),
      validation-before-staleness precedence, generation drops,
      post-completion drops, all three complete states, rollback
      (latest-only, completed-refused, restore fidelity, retired
      ids)
- [ ] RET landing exactness + both clamps; deleted file
- [ ] n/p wrap with count; g re-runs; q recency restore
- [ ] Streaming: selection stable while hits append

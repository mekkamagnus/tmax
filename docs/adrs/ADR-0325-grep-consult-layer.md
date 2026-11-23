
## Addendum — valve rounds 1–2 (2026-11-23)

The verify-gate (r1: 9 defects, r2: 5 incl. the zombie-prompt
render stomp, r3: 13/13 criteria + 4 residuals) and the codex valve
(r1: 5/10, six TOP_FIXES) drove three decisions beyond the original
design:

- **Exit-kind threading, not cancel-functions.** `minibuffer-close`
  passes `"accept"|"cancel"` to the on-close hook rather than
  growing `completing-read` a cancel-function parameter. One seam,
  enriched; `completing-read`'s signature stays stable for its other
  callers. Ordering matters: close precedes the accept fn, so the
  cancel contract must branch on the KIND, not on session state.
- **Structural snapshot restore.** The input-change/cancel restore
  uses `grep-buffer-rollback` to the completed generation — content
  AND hits/selection/state — not a text re-render over a newer
  generation's structural state. A text-only restore left RET and
  navigation disagreeing with the display.
- **Class-escaped glob translation.** The T-Lisp reader strips
  backslashes from string literals, so `\.`-style regex escapes
  are unwritable in .tlisp source. Literal glob characters
  class-escape instead (`[.]`, `[$]`, …); `[class]` passes through
  verbatim (fnmatch `[^…]` negation composes); the unescapable set
  (bare `^`, backslash, `[]`) is untranslatable — the entry is
  ignored with a status note.
- **The prompt's candidates are the hits.** The completion table
  returns the current generation's hits; Up/Down select; a
  `minibuffer-on-select` hook echoes; RET resolves the selected
  value to its hit row and jumps via #307. The r1 spec's
  free-text-table narrowing was a misread of the issue's
  Navigation clause (corrected in SPEC-311).

# Bug: TUI input tokenizer mangles Home/End/F-keys/modified arrows

## Bug Description
The tokenizer (src/frontend/render/input.ts) only recognized 7 escape sequences.
Home, End, SS3 variants, Ctrl/Shift-arrows, and F-keys all fell through to a
per-codepoint branch — each byte sent as a separate keypress RPC. In insert mode,
pressing Home dropped to normal mode (the ESC) then fired bogus `[` and `H` keys.

## Solution
Extended the escapeSequenceMap with 24 new entries: Home/End (CSI + SS3),
Ctrl-arrows (modifier 5), Shift-arrows (modifier 2), F1-F12 (SS3 F1-F4, CSI F5-F12).
The tokenizer's existing find(startsWith) + partial-wait logic handles the extended
map correctly (no ambiguous prefixes).

## Validation
- `bun test test/unit/input-tokenizer.test.ts`

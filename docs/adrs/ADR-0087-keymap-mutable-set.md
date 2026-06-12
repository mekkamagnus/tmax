# Keymap Mutable Set for Performance

## Status

Accepted

## Context

Keymaps are represented as T-Lisp hashmaps. Adding a binding via the functional approach (`hashmap-set`) copies the entire map on each addition. When loading large keymaps with dozens or hundreds of bindings during startup, this creates O(n^2) memory allocation from repeated full-map copies.

## Decision

Add `keymap-mutable-set!` to the T-Lisp standard library (`stdlib.ts`). This function mutates the hashmap's internal `Map` in-place via `.set()` and returns the hashmap. Used during keymap initialization to avoid copy overhead.

## Consequences

- **Easier**: Keymap loading is significantly faster — O(n) instead of O(n^2) for n bindings.
- **Harder**: Introduces mutable operations into the T-Lisp standard library. Callers must understand that `keymap-mutable-set!` modifies the existing map rather than returning a new one. This is acceptable because keymaps are built during initialization and then read-only during normal operation.

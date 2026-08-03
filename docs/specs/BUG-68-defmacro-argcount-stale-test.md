# Bug (pre-existing): `defmacro` arg-count unit test is stale (asserts pre-docstring message)

## Goals

- `test:unit` fully green — this is the last red after #113/#115/#116 (revealed by the first full-suite survey, which the batched runner had masked by aborting at incremental-search).

## Completion Criteria (Definition of Done)

- [x] `test/unit/macros.test.ts:209` asserts the **current** `defmacro` validation message.
- [x] `bun run test:unit` exit 0 (full suite green end-to-end).

## Bug Description

`test/unit/macros.test.ts:209` ("error handling - defmacro wrong argument count") asserts the message contains `"defmacro requires exactly 3 arguments"`. But `defmacro` was updated to accept an optional **docstring** (4th arg), so `src/tlisp/evaluator.ts:1535` now throws `"defmacro requires 3 or 4 arguments: name, parameters, [docstring], and body"`. The test went stale (asserts the pre-docstring message). Same stale-message pattern as #115 (loadInitFile).

## Solution

Update the assertion to the current message (a stable substring: `"defmacro requires 3 or 4 arguments"`). No production change — the docstring support is intentional.

## Notes

No ADR — stale-test catch-up to the docstring feature (an existing decision), like #115 to #74.

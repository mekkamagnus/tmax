# json-encode and append-file: the JSONL persistence pair

## Status

Accepted (2026-08-21, #209 / [SPEC-209](../specs/SPEC-209-json-encode-append-file.md))

## Context

FAEP threads persist as append-only JSONL event logs. T-Lisp could READ JSON
(json-read-from-string) and write whole files (write-file-content) but could
not encode JSON or append without rewriting — every event would be a
read-modify-write of the whole log.

## Decision

- `(json-encode v)`: the inverse of json-read-from-string. Since T-Lisp has
  no dotted pairs, alists ARE lists of 2-element lists — the exact shape
  json-read produces — so the mapping mirrors 1:1: non-empty lists whose
  every element is a string-headed 2-list encode as objects; other lists as
  arrays; hashmaps as objects; `t`/`nil` symbols as true/false; other
  symbols as their names (pragmatic tag-enum choice); nil as null.
- `(append-file path text)`: create-or-append with the write-file-content
  conventions — synchronous on-disk before return in the default mode (the
  BUG-33/#45 data-loss rationale), an async-mode branch via EvalContext,
  identical validation and error surfacing.

## Consequences

- Event logging is O(event) per append, not O(log).
- Shape heuristic limitation: a JSON array of pairs re-encodes as an object;
  acceptable for event logs, documented in the spec.
- Round-trip (read ∘ encode) is pinned by test on object-shaped data.

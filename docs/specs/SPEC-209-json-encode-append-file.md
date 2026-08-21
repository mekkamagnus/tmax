# SPEC-209: json-encode + append-file primitives

**Issue:** #209 (fikra-p0 / RFC-027 §D2, §Phase 0; RFC-018 Tier 1 subset)
**Status:** Implemented 2026-08-21

## Goal

The persistence pair FAEP's append-only JSONL event logs need:
`(json-encode <value>)` (T-Lisp → JSON, inverse of json-read-from-string)
and `(append-file <path> <text>)` (append counterpart to write-file-content).

## Completion Criteria

- [x] json-encode maps: alist of ("key" v) 2-element lists → JSON object
      (non-empty list, every element a 2-list with a string head); plain
      lists → arrays; hashmaps with string keys → objects; string/number/
      boolean/nil → their JSON scalars; `t`/`nil` symbols → true/false;
      other symbols → their name (documented pragmatic choice for tag
      enums); nil → null.
- [x] Round-trip: json-read-from-string ∘ json-encode is identity on
      object-shaped data (pinned).
- [x] append-file: creates when absent, appends in order across calls,
      composes after write-file-content without truncation; sync by default
      (on disk before return, same rationale as write-file-content —
      BUG-33/#45), async-mode variant via the same EvalContext convention;
      arity/type validation mirrors write-file-content.
- [x] FAEP-shaped event encodes losslessly (pinned: nested object with
      array-valued field, booleans, null).
- [x] Tests: test/unit/io-encode.test.ts (10) — encode (6) + append (4,
      incl. fixture cleanup).
- [x] `bun run typecheck` (all projects) green; io/file suites green
      (io-encode, file-primitives, fikra-primitives, filesystem: 66/66).

## Notes

- T-Lisp has no dotted-pair syntax — alists ARE lists of 2-element lists,
  which is the exact shape json-read-from-string produces; the encode rule
  mirrors it 1:1.
- Object-vs-array rule is a heuristic on shape (non-empty list of string-
  headed 2-lists ⇒ object); a JSON array OF PAIRS re-encodes as an object —
  documented limitation, acceptable for event logs.
- Fully generic: no Fikra references.

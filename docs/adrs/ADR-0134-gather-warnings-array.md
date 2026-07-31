# ADR-0134 — gatherContext warnings via array (#26)
## Status: Accepted
## Context: addWarning used closure-captured `let gitWarning` string concatenation (mutable-string-threading).
## Decision: Collect warnings into `string[]`; join once at the end. Matches buildUntrackedDiff pattern.
## Consequences: Cleaner accumulation; same "; "-separated output; gather tests pass.

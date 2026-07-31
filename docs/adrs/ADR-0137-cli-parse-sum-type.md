# ADR-0137 — Sum type for adw-patch-review CLI parse (#24)
## Status: Accepted
## Context: parseArgs used Either<string, ParsedArgs> with __help__/__usage__ sentinel strings embedded in Left.
## Decision: PatchReviewParseResult sum type (help/usage/error/run). main() matches on kind. 4th variant (usage) per codex.

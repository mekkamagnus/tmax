# ADR-0209 — In-editor Info reader (`#179` / SPEC-112)

## Status
Accepted

## Decision
Added `(info)` / `M-x info` — opens the canonical `docs/tmax/tmax.info` in a
read-only `*Info*` buffer in major-mode "info". Two TS primitives: `info-parse`
(splits on \x1f, extracts Node:/Next:/Prev:/Up: headers) and `info-parse-links`
(regex-extracts `* Name::` menu items + `*Note target::` cross-refs).

Navigation: n/p/u/t (Next/Prev/Up/Top), m (menu-follow: prompts for a menu item
node name parsed from the current node's text via info-parse-links), i (opens the
Index node — the manual's index; search within via s/occur), q (bury).

Parser fix: header line must include BOTH "File:" AND "Node:" to skip Tag Table
entries. Single-file .info only (canonical manual is single-file; Indirect
multi-file not handled — documented as a known limitation).

## Verification
`bun run typecheck` clean; 35/35 tests across 6 help-related files.
Verify-gate: the canonical manual has ZERO *Note references (verified), so the
*Note-follow gap has no live surface; menu-follow + index-open are tested.

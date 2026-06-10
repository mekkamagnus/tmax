# Feature: [Title]

**Vision alignment:** [Pillar A/B/C] — [reason].
**Depends on:** [linked specs/RFCs]

### Prerequisites (must pass before implementation)

1. **[SPEC-NNN](link)** — [what it provides and why this spec needs it]
2. ...

## Feature Description

[1-2 paragraphs]

## User Story

As a [role]
I want [capability]
So that [outcome]

## Problem Statement

[What's missing or broken today]

## Solution Statement

[Numbered summary of what will be built]

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| New state | RFC-009 | Must live in `EditorState`, return-state pattern |
| Mode activation | `rules/editor.md` | Hook-driven, not load-driven |
| Shell commands | Security (OWASP) | Must escape interpolated values |
| Render pipeline | RFC-008 | Pure function of `EditorState -> Frame` |
| T-Lisp primitives | `rules/tlisp.md` | Register in `tlisp-api.ts`, follow naming conventions |
| Syntax highlighting | `rules/tlisp.md` | Token-level state in `StateTransitions`, line-level in tokenizer |
| Testing | `rules/testing.md` | TDD, `bun test`, renderer tests send real keys |

Fill this table **before writing steps.** If a row can't be filled, the spec isn't ready.

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/foo/bar.ts` | [what] | [governing rule/RFC] |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/foo/baz.ts` | [what] | [governing rule/RFC] |

## Implementation Phases

### Phase N: [Name] — [1-line goal]

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] [specific constraint from Architecture Constraints table]
- [ ] [specific constraint]

#### Step K: [Title]

**User story:** As a [role], I want [capability], so that [outcome].

**Description:** [What to build]

**MUST:**
- [positive requirement]

**MUST NOT:**
- [explicit prohibition]

**Convention source:** `rules/[file].md` section, [RFC-NNN](../rfcs/RFC-NNN.md) section

**Acceptance criteria:**
- [ ] [testable criterion — what the user sees or can do]
- [ ] [testable criterion — edge case or error condition]
- [ ] [constraints from Architecture Constraints table are met]

#### Step K+1: ...

### Phase N+1: ...

[Same structure]

## Acceptance Criteria

1. [Numbered, testable criteria]

## Validation Commands

- `bun run typecheck:src` — Zero type errors
- `bun run typecheck:test` — Zero type errors
- `bun run typecheck` — Zero type errors
- `bun test` — All tests pass (existing + new)
- `bun run test:daemon` — Daemon starts and serves correctly
- `bun run test:ui:renderer` — Renderer tests pass (for UI changes)

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| [what was chosen] | [why] | [what was considered and why it lost] |

**Deferred to follow-up:**
- [explicit list of things intentionally excluded]

## Edge Cases

- [Bulleted list]

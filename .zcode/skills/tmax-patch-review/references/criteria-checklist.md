# Audit rubric — how to score each dimension

Reference for the auditor sub-agent. Read once before auditing; consult
per-criterion when judging.

## Dimension 1 — Criterion implementation

For each acceptance criterion in the SPEC, score:

| Score | Meaning |
|---|---|
| `IMPLEMENTED` | Code exists at the cited location, behavior matches the criterion, no obvious bug. **Citation required.** |
| `PARTIAL` | Code exists but is wrong, incomplete, or buggy in a way that breaks the criterion's intent. Cite and explain. |
| `MISSING` | No code implements this criterion. Describe what should be there. |

### What "matches the criterion" means

Read the criterion's verb carefully:

- **"must" / "shall"** → hard requirement. Any deviation is PARTIAL or
  MISSING.
- **"should"** → soft requirement. Deviation is a note, not a gap, unless
  the SPEC ties it to an acceptance check.
- **"verify: X"** / **"acceptance: X"** → there must be a runnable X
  somewhere. If X is a test command, it must be in the test suite. If X
  is a manual check, the implemented behavior must support it.
- **"Phase N.B.M"** style steps → each numbered step is its own criterion.

### Common PARTIAL patterns

- Implementation exists but the SPEC named a different function/file.
- Implementation works for the happy path but throws on the SPEC's stated
  inputs.
- Implementation regressed a behavior the SPEC explicitly said to
  preserve.
- Implementation has a `TODO`/`FIXME`/`@ts-ignore`/`as any` in the path
  of the criterion.

### What does NOT count as a gap

- Style nits the SPEC doesn't mention.
- Performance the SPEC doesn't quantify.
- Code that does more than the criterion asks (don't punish
  thoroughness — but flag it under "Edge cases / observations" if it
  introduces risk).

## Dimension 2 — Test coverage

For each implemented behavior (not each criterion — behaviors may map
many-to-one), judge:

| Score | Meaning |
|---|---|
| `COVERED` | There is a test that exercises this behavior and asserts the right outcome. Cite the test. |
| `UNCOVERED` | No test, or the test that exists doesn't actually assert the behavior. |

### What counts as "a test"

- `test/unit/*.test.ts` for unit-level behavior.
- `tmax-use/playbooks/*.yaml` (tmax-use e2e) for terminal-rendering and user-visible behavior.
- T-Lisp-level tests in `src/tlisp/core/**/*.tlisp` IF they are wired
  into a test runner that the gate actually executes. Stash-only test
  files that no runner picks up do not count.

### Specific rules (from `rules/testing.md`)

- Visual/rendering fixes must have a tmax-use e2e playbook that drives
  real keys and asserts on observed editor state. Unit tests of the
  renderer do not suffice.
- Type errors are not "covered" by typecheck alone — typecheck proves
  the types compile, not that the behavior is right.

## Dimension 3 — Edge cases

For each implemented behavior, scan for these edge cases. Flag `MISSED`
only when a reasonable user would hit it AND the SPEC's intent covers
that scenario. Don't invent adversarial inputs the SPEC never asked to
defend against.

| Category | What to ask |
|---|---|
| **Empty / null** | What happens with `""`, `[]`, `0`, no buffer, empty file? |
| **Single element** | What happens with exactly one line, one char, one item? |
| **Boundary** | Line 0, last line, column 0, end-of-line, end-of-buffer? |
| **Off-by-one** | `n`, `n-1`, `n+1` for any limit `n`? |
| **Mode interaction** | Does it work in normal/insert/visual/command/mx mode? Does it survive mode switches mid-operation? |
| **Readonly / restricted** | Does it respect `buffer-set-read-only`? |
| **Multi-buffer** | Does it work when more than one buffer exists? Does it leak state between buffers? |
| **Daemon path** | If the code is reachable through the daemon, does it work over JSON-RPC? Does state survive a client reconnect? |
| **Error paths** | File not found, permission denied, invalid input, type mismatch — does it fail cleanly or crash? |
| **Unicode / wide chars** | Does it work with multi-byte characters? CJK wide chars? Emoji? |
| **Large input** | Does it scale to a big file (10k+ lines) or does it OOM / hang? |

### When to flag MISSED vs note

- **MISSED**: the SPEC's intent clearly covers this scenario (e.g., SPEC
  says "navigate by heading in markdown" — failing on the last heading
  is MISSED).
- **Note**: the SPEC is silent. Record under "Edge cases /
  observations" with a soft recommendation; do not block PASS.

## Dimension 4 — Assumptions

If the SPEC had a "Prerequisites" or "Assumptions" section, verify each
one held. Common assumptions:

- "Depends on SPEC-NNN" → is SPEC-NNN actually implemented?
- "Bun version X+" → does the code use APIs from that version?
- "Daemon protocol vN" → does the current protocol match?

A failed assumption is not automatically a GAPS verdict — the
implementation might be correct anyway. Surface it as an "Assumption
challenged" entry and use judgment for the verdict.

## Verdict calculus

Walk the matrix:

```
all criteria IMPLEMENTED?         no  -> GAPS
all behaviors COVERED?            no  -> GAPS
no edge cases MISSED?             no  -> GAPS
all gates green?                  no  -> GAPS
                                  yes -> PASS
```

One failure anywhere → GAPS. The orchestrator will format the gaps into
a SPEC update; you don't have to draft the SPEC text.

## Citation format

Use `path/to/file.ts:start-end` for line ranges, `path/to/file.ts:N`
for single lines. Paths are relative to the project root. Example:

```
IMPLEMENTED [src/editor/editor.ts:142-168]
```

If the implementation spans many small touches in one file, cite the
function name instead of a huge range:

```
IMPLEMENTED [src/tlisp/core/commands/markdown.tlisp:fn markdown-heading-next]
```

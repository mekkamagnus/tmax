# Architecture Decision Record (ADR) Workflow

This document explains the workflow for creating, managing, and maintaining Architecture Decision Records (ADRs) in the tmax project.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that describes an important architectural decision, its context, and consequences. ADRs serve as:

- **Historical record**: Why decisions were made
- **Communication tool**: Sharing rationale with the team
- **Prevention tool**: Avoiding revisiting settled decisions
- **Onboarding aid**: Helping new contributors understand the architecture

## ADR Status Lifecycle

ADRs move through a well-defined lifecycle:

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────────┐
│ Proposed │ ──▶ │ Accepted │ ──▶ │ Deprecated   │ ──▶ │ Superseded   │
└──────────┘     └──────────┘     └──────────────┘     └──────────────┘
                      │                                      │
                      └──────────────────────────────────────┘
                            (replaced by newer ADR)
```

### Status Values

#### **Proposed** 📋
- **Meaning**: Under consideration, not yet decided
- **When to use**: New ADRs under discussion or review
- **Next step**: Team review and approval
- **Example**: A new feature approach being evaluated

#### **Accepted** ✅
- **Meaning**: Decision made and implemented
- **When to use**: Decision ratified by team and code is merged
- **Format**: `Accepted` or `Accepted (YYYY-MM-DD)`
- **Example**: Core architecture decisions (ADRs 001-005)

#### **Deprecated** ⚠️
- **Meaning**: No longer recommended, but still in use
- **When to use**: Valid approach that shouldn't be used for new work
- **Next step**: Eventually superseded or removed
- **Example**: Legacy approach that new code shouldn't follow

#### **Superseded** 🔄
- **Meaning**: Replaced by a newer decision
- **When to use**: A newer ADR provides a better approach
- **Format**: `Superseded by [ADR XXX](link) (YYYY-MM-DD)`
- **Example**: ADR 002 mentions it's superseded by ADR 003

## ADR Template

All ADRs should follow this structure:

```markdown
# [Short, Descriptive Title]

## Status

**[proposed|accepted|deprecated|superseded]** [(YYYY-MM-DD)]

[(Optional: Superseded by [ADR XXX](path))]

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

- **Positive**: Benefits and advantages
- **Negative**: Drawbacks and trade-offs
- **Neutral**: Things that stay the same
```

## Creating an ADR

### 1. Create the ADR File

Use the ADR template and follow the naming convention:

```bash
# ADRs are numbered sequentially with three digits
cp adr/adr-template.md adr/XXX-descriptive-title.md

# Example:
cp adr/adr-template.md adr/056-plugin-system-refactor.md
```

### 2. Fill in the Content

- **Status**: Start with `proposed`
- **Title**: Short, descriptive, uses kebab-case
- **Context**: What problem are we solving?
- **Decision**: What are we doing?
- **Consequences**: What are the trade-offs?

### 3. Propose for Review

- Create a pull request with the new ADR
- Tag relevant team members for review
- Discuss and iterate on the proposal

### 4. Accept or Reject

**If accepted:**
1. Change status to `Accepted (YYYY-MM-DD)`
2. Implement the decision
3. Link to implementation PRs
4. Merge the ADR

**If rejected:**
1. Document rationale in comments
2. Keep the ADR for historical reference
3. Mark as `rejected` (custom status for rejected proposals)

## ADR Organization

### Current Structure

```
adr/
├── adr-template.md           # Template for new ADRs
├── 001-*.md                  # Accepted ADRs (1-5)
├── 002-*.md
├── 003-*.md
├── 004-*.md
├── 005-*.md
├── 006-*.md                  # Proposed ADRs (6+)
├── ...
└── 055-*.md
```

### ADR Categories

- **001-005**: Core architecture decisions (Accepted)
- **006-020**: Infrastructure and testing (Proposed)
- **021-035**: Editor features and navigation (Proposed)
- **036-050**: Plugin system and extensibility (Proposed)
- **051-055**: Documentation and tooling (Proposed)

## Updating ADRs

### When an ADR is Superseded

Update the superseded ADR:

```markdown
## Status

**Superseded** by [ADR 035](035-evil-integration.md) (2026-01-15)
```

### When an ADR is Deprecated

Update the deprecated ADR:

```markdown
## Status

**Deprecated** (2026-01-15)

**Reason**: This approach is still valid but new code should use [ADR XXX](link) instead.
```

### Adding Implementation Notes

As ADRs are implemented, add links to:

- Pull requests that implemented the decision
- Specs or design docs that elaborate on the decision
- Test files that validate the decision

```markdown
## Implementation

- PR #123: Implemented core functionality
- SPEC-045: Detailed specification
- test/unit/feature.test.ts: Test coverage
```

## ADR Review Guidelines

When reviewing an ADR, consider:

### Content Quality
- [ ] Is the context clear and motivating?
- [ ] Is the decision well-defined?
- [ ] Are consequences thoroughly considered?
- [ ] Are trade-offs explicitly stated?

### Alignment with Project
- [ ] Does it align with tmax architecture?
- [ ] Does it follow T-Lisp-first approach?
- [ ] Does it maintain simplicity?
- [ ] Are dependencies justified?

### Completeness
- [ ] Are implementation considerations included?
- [ ] Are migration paths documented (if applicable)?
- [ ] Are alternatives considered and rejected?
- [ ] Is the impact on existing code assessed?

## Best Practices

### Do ✅

1. **Be concise**: ADRs should be 1-2 pages max
2. **Focus on "why"**: Context is more important than implementation details
3. **Consider trade-offs**: Every decision has consequences
4. **Link related ADRs**: Build a web of knowledge
5. **Update when superseded**: Don't delete, reference the new ADR
6. **Use dates**: When accepting, superseding, or deprecating

### Don't ❌

1. **Don't delete ADRs**: They're historical records
2. **Don't leave ADRs in "proposed" indefinitely**: Make a decision
3. **Don't ignore consequences**: Every decision has trade-offs
4. **Don't be too detailed**: ADRs aren't implementation specs
5. **Don't forget to update**: When a better approach emerges, supersede the old one

## ADR vs Spec vs RFC

The tmax project uses three types of documents:

| Document | Purpose | Status | Audience |
|----------|---------|--------|----------|
| **ADR**  | Record architectural decisions | Proposed → Accepted | Team & contributors |
| **Spec** | Detailed implementation plans | Draft → Final | Implementers |
| **RFC**  | Request for comments on major changes | Proposed → Accepted | Community |

**When to use which:**
- **ADR**: Decisions made (post-decision documentation)
- **Spec**: How to implement (pre-implementation planning)
- **RFC**: Major changes seeking community input (pre-decision discussion)

## Examples

### Accepted ADR Example

```markdown
# ADR 003: Final Architecture - T-Lisp First with Deno-ink UI

## Status
**Accepted** (2026-01-30)

## Context
The tmax editor project underwent a significant architectural evolution...

## Decision
Adopt a T-Lisp-first architecture with Deno-ink UI...

## Consequences
- **Positive**: Better extensibility, testability
- **Negative**: Steeper learning curve for contributors
```

### Proposed ADR Example

```markdown
# ADR 056: Plugin System Refactor

## Status
**proposed**

## Context
Current plugin system has limited hook points and no dependency injection...

## Decision
Implement a new plugin system with:
- Lifecycle hooks: init, enable, disable, unload
- Dependency injection container
- Plugin sandboxing

## Consequences
- **Positive**: More powerful plugins, better isolation
- **Negative**: Breaking change for existing plugins
```

### Superseded ADR Example

```markdown
# ADR 002: Terminal UI Implementation

## Status
**Superseded** by [ADR 003](003-final-architecture-tlisp-first.md) (2026-01-30)

## Context
[Original context preserved]

## Decision
[Original decision preserved]

## Consequences
[Original consequences preserved]
```

## Tools and Automation

### Creating a New ADR

```bash
# Use the template
cp adr/adr-template.md adr/$(printf "%03d" $(( $(ls adr/*.md | wc -l) )))-my-decision.md

# Edit the new ADR
vim adr/XXX-my-decision.md
```

### Checking ADR Status

```bash
# List all proposed ADRs
grep -l "^**proposed**" adr/*.md

# List all accepted ADRs
grep -l "^**Accepted**" adr/*.md

# List all superseded ADRs
grep -l "Superseded" adr/*.md
```

### Validating ADR Format

```bash
# Check that all ADRs have required sections
for file in adr/*.md; do
  echo "Checking $file"
  grep -q "^## Status" "$file" || echo "  ❌ Missing Status"
  grep -q "^## Context" "$file" || echo "  ❌ Missing Context"
  grep -q "^## Decision" "$file" || echo "  ❌ Missing Decision"
  grep -q "^## Consequences" "$file" || echo "  ❌ Missing Consequences"
done
```

## Further Reading

- [Michael Nygard's original ADR pattern](https://c2.com/cgi/wiki?ArchitectureDecisionRecord)
- [ThoughtWorks Architecture Decision Records](https://www.thoughtworks.com/radar/techniques/architecture-decision-record)
- [tmax ADR Template](../adr/adr-template.md)
- [tmax README](../README.md)

## Summary

ADRs are a critical tool for maintaining architectural clarity in the tmax project. By following this workflow, we ensure that:

1. ✅ All major decisions are documented
2. ✅ Decisions can be revisited with proper context
3. ✅ New contributors can understand architectural evolution
4. ✅ The team maintains a shared understanding of the system

When in doubt, write an ADR. It's better to document a decision and later supersede it than to have no record at all.

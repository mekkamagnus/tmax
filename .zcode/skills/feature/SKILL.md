---
name: feature
description: "Plan new features with user stories, acceptance criteria, and implementation phases. Use when the user wants to add new functionality, implement a feature, build a new capability, or extend the application. Triggers on: feature, new functionality, add capability, implement, build, create new, extend, enhancement. Also use when the user describes what they want the app to do that it doesn't currently do."
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "python3 /Users/mekael/Documents/programming/typescript/tmax/.zcode/skills/feature/validate_spec_name.py"
---

# Feature Planning

Create a new plan in docs/specs/*.md to implement the `Feature` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Instructions

- You're writing a plan to implement a net new feature that will add value to the application.
- Create the plan in the `docs/specs/` directory. The filename MUST follow the format `SPEC-###-{slug}.md` where `###` is a zero-padded sequential number. Run the numbering script to determine the next number:
  ```bash
  python3 .zcode/skills/feature/next_spec.py ./docs/specs <feature-slug>
  ```
  Run from the project root. Example: `python3 .zcode/skills/feature/next_spec.py ./docs/specs auth-login` → outputs `SPEC-002-auth-login.md` (if SPEC-001 already exists).
  The slug should be a short kebab-case name derived from the feature description.
- Use the `Plan Format` below to create the plan. 
- Research the codebase to understand existing patterns, architecture, and conventions before planning the feature.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to implement the feature successfully.
- Use your reasoning model: THINK HARD about the feature requirements, design, and implementation approach.
- Follow existing patterns and conventions in the codebase. Don't reinvent the wheel.
- Design for extensibility and maintainability.
- If you need a new library, use `uv add` and be sure to report it in the `Notes` section of the `Plan Format`.
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `app/server/**` - Contains the codebase server.
- `app/client/**` - Contains the codebase client.
- `scripts/**` - Contains the scripts to start and stop the server + client.

Ignore all other files in the codebase.

## Plan Format

```md
# Feature: <feature name>

## Feature Description
<describe the feature in detail, including its purpose and value to users>

## User Story
As a <type of user>
I want to <action/goal>
So that <benefit/value>

## Problem Statement
<clearly define the specific problem or opportunity this feature addresses>

## Solution Statement
<describe the proposed solution approach and how it solves the problem>

## Relevant Files
Use these files to implement the feature:

<find and list the files that are relevant to the feature describe why they are relevant in bullet points. If there are new files that need to be created to implement the feature, list them in an h3 'New Files' section.>

## Implementation Plan
### Phase 1: Foundation
<describe the foundational work needed before implementing the main feature>

### Phase 2: Core Implementation
<describe the main implementation work for the feature>

### Phase 3: Integration
<describe how the feature will integrate with existing functionality>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to implement the feature. Order matters, start with the foundational shared changes required then move on to the specific implementation. Include creating tests throughout the implementation process. Your last step should be running the `Validation Commands` to validate the feature works correctly with zero regressions.>

## Testing Strategy
### Unit Tests
<describe unit tests needed for the feature>

### Integration Tests
<describe integration tests needed for the feature>

### Edge Cases
<list edge cases that need to be tested>

## Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete>

## Tests & E2E Playbooks

This feature must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

### Unit tests
- Identify which `test/unit/*.test.ts` files need new or updated tests for the behavior changed by this work.
- Each new behavior gets at least one unit test that would fail without the change.
- Targeted unit tests must pass: `bun run test:unit`.

### tmax-use e2e playbook
- Read 2–3 existing playbooks in `tmax-use/playbooks/` (e.g. `eval-01-cursor-movement.yaml`, `_smoke.yaml`) and the schema in `tmax-use/playbooks/README.md` before authoring.
- Create `tmax-use/playbooks/<feature-slug>.yaml` that exercises the user-visible behavior end-to-end: setup file → steps (open/keys/eval) → `expect` assertions (mode, cursor, buffer_contains, screen_contains as appropriate) → `cleanup: true`.
- The playbook name should be the feature slug, kebab-case. Do not weaken assertions to make a playbook pass; if an assertion is genuinely wrong, say so in the spec's Notes.
- Run it locally: `bin/tmax-use test tmax-use/playbooks/<feature-slug>.yaml`.
- If the feature is not user-visible (no editor behavior to drive via keys/eval), state that explicitly and skip the playbook — unit tests alone suffice.

### New Files
<list every new test file and playbook created above with a one-line purpose. If no playbook is needed, say so.>

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

<list commands you'll use to validate with 100% confidence the feature is implemented correctly with zero regressions. every command must execute without errors so be specific about what you want to run to validate the feature works as expected. Include commands to test the feature end-to-end.>
- `bun run test:unit` - Run unit tests with zero regressions.
- `bun run test:tmax-use` - Run all tmax-use e2e playbooks + tests.

## Notes
<optionally list any additional notes, future considerations, or context that are relevant to the feature that will be helpful to the developer>
```

## Feature
$ARGUMENTS
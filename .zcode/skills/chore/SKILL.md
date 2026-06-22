---
name: chore
description: "Plan maintenance tasks, cleanups, refactoring, and other non-feature non-bug work. Use when the user wants to plan a chore, maintenance task, dependency update, code cleanup, refactoring, configuration change, or any technical work that isn't a bug fix or new feature. Triggers on: chore, cleanup, refactor, maintenance, update deps, tidy, reorganize, rename, migrate."
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "python3 /Users/mekael/Documents/programming/typescript/tmax/.zcode/skills/chore/validate_chore_name.py"
---

# Chore Planning

Create a new plan in docs/specs/*.md to resolve the `Chore` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Instructions

- You're writing a plan to resolve a chore, it should be simple but we need to be thorough and precise so we don't miss anything or waste time with any second round of changes.
- Create the plan in the `docs/specs/` directory. The filename MUST follow the format `CHORE-##-{slug}.md` where `##` is a sequential number. Run the numbering script to determine the next number:
  ```bash
  python3 .zcode/skills/chore/next_chore.py ./docs/specs <chore-slug>
  ```
  Run from the project root. Example: `python3 .zcode/skills/chore/next_chore.py ./docs/specs update-deps` → outputs `CHORE-01-update-deps.md`.
  The slug should be a short kebab-case name derived from the chore description.
- Use the plan format below to create the plan. 
- Research the codebase and put together a plan to accomplish the chore.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to accomplish the chore.
- Use your reasoning model: THINK HARD about the plan and the steps to accomplish the chore.
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `app/**` - Contains the codebase client/server.
- `scripts/**` - Contains the scripts to start and stop the server + client.

Ignore all other files in the codebase.

## Plan Format

```md
# Chore: <chore name>

## Chore Description
<describe the chore in detail>

## Relevant Files
Use these files to resolve the chore:

<find and list the files that are relevant to the chore describe why they are relevant in bullet points. If there are new files that need to be created to accomplish the chore, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to accomplish the chore. Order matters, start with the foundational shared changes required to fix the chore then move on to the specific changes required to fix the chore. Your last step should be running the `Validation Commands` to validate the chore is complete with zero regressions.>

## Tests & E2E Playbooks

This chore must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

### Unit tests
- Identify which `test/unit/*.test.ts` files need new or updated tests for the behavior changed by this work.
- Each new behavior gets at least one unit test that would fail without the change.
- Targeted unit tests must pass: `bun run test:unit`.

### tmax-use e2e playbook
- Read 2–3 existing playbooks in `tmax-use/playbooks/` (e.g. `eval-01-cursor-movement.yaml`, `_smoke.yaml`) and the schema in `tmax-use/playbooks/README.md` before authoring.
- Create `tmax-use/playbooks/<chore-slug>.yaml` that exercises the user-visible behavior end-to-end: setup file → steps (open/keys/eval) → `expect` assertions (mode, cursor, buffer_contains, screen_contains as appropriate) → `cleanup: true`.
- The playbook name should be the chore slug, kebab-case. Do not weaken assertions to make a playbook pass; if an assertion is genuinely wrong, say so in the spec's Notes.
- Run it locally: `bin/tmax-use test tmax-use/playbooks/<chore-slug>.yaml`.
- If the chore is not user-visible (no editor behavior to drive via keys/eval), state that explicitly and skip the playbook — unit tests alone suffice.

### New Files
<list every new test file and playbook created above with a one-line purpose. If no playbook is needed, say so.>

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

<list commands you'll use to validate with 100% confidence the chore is complete with zero regressions. every command must execute without errors so be specific about what you want to run to validate the chore is complete with zero regressions. Don't validate with curl commands.>
- `bun run test:unit` - Run unit tests with zero regressions.
- `bun run test:tmax-use` - Run all tmax-use e2e playbooks + tests.

## Notes
<optionally list any additional notes or context that are relevant to the chore that will be helpful to the developer>
```

## Chore
$ARGUMENTS
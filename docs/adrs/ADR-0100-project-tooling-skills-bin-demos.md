# Project Tooling — Skills, Bin Launchers, Demos

## Status

Accepted

## Context

The project lacked standardized tooling for common development workflows: launching the adw pipeline, running TRT tests, creating specs/bugs/chores, and recording demos. Each was done ad-hoc with manual commands. The `bin/` directory had `tmax` and `tmaxclient` but no wrappers for the new adw/trt tooling.

## Decision

Add project-level tooling:

1. **`.zcode/skills/`** — four skill directories (`bug/`, `chore/`, `feature/`, `implement/`) each with a `SKILL.md`, a `next_*.py` numbering script, and a `validate_*.py` name validator. These are invoked by the adw pipeline's plan stage (`claude -p /feature`, `/bug`, `/chore`) and the `/implement` skill.
2. **`bin/trt`** — launcher for the TRT test runner (`tmax --test`).
3. **`bin/tmax` + `bin/tmaxclient`** (modified) — updated for new daemon/client features.
4. **`demos/*.yaml`** — demo playbooks (`markdown-all-features`, `markdown-keys-demo`, `trt-walkthrough`, `trt`) for the e2e test runner.
5. **`package.json`** — new scripts for typecheck, test, and build commands.

## Consequences

**Easier:** Standardized entry points for all development workflows. Skills are self-documenting (each has a SKILL.md). Demo playbooks are reproducible.

**Harder:** The `.zcode/skills/` directory is tool-specific (ZCode agent skills); contributors using other agents need equivalent wrappers. The `bin/` scripts assume `bun` is on PATH.

**Related:** ADR-0094 (adw pipeline uses the skills), ADR-0097 (TRT runner via `bin/trt`), ADR-0093 (daemon features in `bin/tmax`).

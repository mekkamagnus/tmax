# docs/ — tmax Documentation Hub

Everything about tmax that isn't code. Specs drive implementation, RFCs propose changes, ADRs record decisions, memos explore tradeoffs.

## Top-Level Documents

| File | Description |
|------|-------------|
| [ROADMAP.md](ROADMAP.md) | Development roadmap — phases, milestones, current priorities |
| [srs.md](srs.md) | Software Requirements Specification — user stories and acceptance criteria |
| [technical-vision.md](technical-vision.md) | Technical vision — architecture pillars and design philosophy |
| [INSTALLATION.md](INSTALLATION.md) | Installation instructions for end users |
| [README.md](README.md) | Project overview and quick-start guide |
| [adr-workflow.md](adr-workflow.md) | How to write and manage ADRs |
| [learnings.md](learnings.md) | Persistent lessons from development (read at start of every task) |
| [completion.md](completion.md) | Minibuffer completion system design |
| [lisp-ownership-map.md](lisp-ownership-map.md) | Map of which editor features are owned by T-Lisp vs TypeScript |
| [ralph-loop-performance-analysis.md](ralph-loop-performance-analysis.md) | Performance analysis of the Ralph Loop autonomous agent |
| [runtime-logging-examples.md](runtime-logging-examples.md) | Examples of runtime logging patterns |
| [tmux-send-keys-guide.md](tmux-send-keys-guide.md) | Guide for tmux send-keys automation |
| [ui-test-python-vs-bash-analysis.md](ui-test-python-vs-bash-analysis.md) | Comparison of Python vs Bash for UI testing |
| [ui-test-refactoring-opportunities.md](ui-test-refactoring-opportunities.md) | Opportunities for UI test refactoring |

## Subdirectories

| Directory | Index | Description |
|-----------|-------|-------------|
| [specs/](specs/index.md) | [index.md](specs/index.md) | Feature specs, bug reports, chores, and the PRD |
| [specs/archive/](specs/archive/index.md) | [index.md](specs/archive/index.md) | Completed and superseded specs |
| [rfcs/](rfcs/index.md) | [index.md](rfcs/index.md) | Requests for Comments — architectural proposals |
| [adrs/](adrs/index.md) | [index.md](adrs/index.md) | Architecture Decision Records |
| [memos/](memos/index.md) | [index.md](memos/index.md) | Decision memos and tradeoff analysis |
| [tmax/](tmax/index.md) | [index.md](tmax/index.md) | Texinfo manuals (source and compiled) |
| [examples/](examples/index.md) | [index.md](examples/index.md) | T-Lisp configuration examples |
| [contributing/](contributing/index.md) | [index.md](contributing/index.md) | Contribution guidelines |
| [manual/](manual/index.md) | [index.md](manual/index.md) | Standalone HTML manual |

## Document Relationships

- **[prd.md](specs/prd.md)** (master requirements) feeds into **[srs.md](srs.md)** (user stories) and **[ROADMAP.md](ROADMAP.md)** (timeline)
- **[rfcs/](rfcs/index.md)** propose changes; accepted ones become **[specs/](specs/index.md)** and **[adrs/](adrs/index.md)**
- **[memos/](memos/index.md)** inform RFCs and ADRs with tradeoff analysis
- **[adrs/](adrs/index.md)** record irreversible decisions that specs reference
- **[technical-vision.md](technical-vision.md)** sets the pillars that all specs should align with
- **[learnings.md](learnings.md)** captures runtime lessons that affect all future work

# tmax-use

A two-layer system for programmatically driving and testing [tmax](../CLAUDE.md)
— analogous to Playwright. Layer 1 is a control library; layer 2 is a test
runner. Both layers use the existing daemon/client JSON-RPC plumbing and
introduce **zero new dependencies**.

## Layers

### Layer 1 — Control library (`tmax-use/src/`)

Programmatic control of a tmax daemon:

```typescript
import { TmaxInstance } from './src/instance.ts';
import { expect } from './assert/index.ts';

const instance = await TmaxInstance.launch({}).run().then(r => r._tag === 'Right' ? r.right : null!);
const frame = instance.frame('demo');

await frame.openFile('README.md').run();
await frame.keys('gg').run();
await expect(frame).toHaveMode('normal').run();
await instance.close().run();
```

Public API:

- **`TmaxInstance.launch(opts)`** — spawn + poll a fresh daemon.
- **`TmaxInstance.connect(opts)`** — attach to an existing daemon.
- **`instance.frame(name)`** — return a `Frame` bound to that buffer name.
- **`Frame`** — `openFile`, `keys`, `eval` (T-Lisp RPC, not JS `eval`),
  `mode`, `cursor`, `bufferText`, `capture`, `captureHtml`, `waitForMode`,
  `waitForTextContains`, `waitForRender`.
- **`assert/`** — Playwright-style fluent `expect(frame)` builder plus
  discrete assertion helpers (`assertMode`, `assertCursorAt`,
  `assertScreenContains`, `matchBaseline`, ...).

### Layer 2 — Test runner (`tmax-use/test/`)

Declarative end-to-end test execution:

- **YAML playbooks** (see `tmax-use/playbooks/README.md`) for data-driven
  scenarios.
- **TypeScript test files** (`*.tmax-use.ts`) for imperative ones. Use
  `import { test, expect } from '../test/index.ts'`. Do not import `bun:test`
  in tmax-use suites — these tests are loaded only by the tmax-use runner.
- **Headless-first**: every visual capture uses the daemon's `capture` RPC.
  No tmux required in CI.
- **Reporters**: terminal (immediate), HTML (timeline + captured frames),
  JUnit XML (CI integration).
- **Baselines**: visual snapshots under `tmax-use/baselines/`, compared via
  a zero-dependency HTML tokenizer. Auto-create locally, fail-on-missing in
  CI, refresh explicitly with `--update-baselines`.

## CLI

```bash
# Run every discovered playbook + TypeScript test:
tmax-use

# Run specific files / dirs:
tmax-use tmax-use/playbooks/markdown.yaml

# Force headless, write reports to ./out:
tmax-use --headless --output ./out

# Refresh visual baselines (review the diff before committing!):
tmax-use --update-baselines

# Force headed (tmux) for steps that opt in:
tmax-use --headed
```

Exit codes: `0` = pass, `1` = failure, `2` = CLI usage error.

## Directory layout

```
tmax-use/
├── src/                  # Layer 1: control library
│   ├── errors.ts         # Tagged-union TmaxUseError + helpers
│   ├── keys.ts           # Key syntax parser (<Esc>, <C-a>, <M-x>, ...)
│   ├── client.ts         # JSON-RPC client (eval, keys, status, capture)
│   ├── capture.ts        # Frame capture + ANSI stripping
│   ├── instance.ts       # Daemon lifecycle (launch/connect/close)
│   └── frame.ts          # Per-buffer Frame API
├── assert/               # Assertion library (fluent + discrete)
│   ├── text.ts           # Mode/cursor/buffer/status assertions
│   ├── screen.ts         # Headless screen substring assertions
│   ├── baseline.ts       # HTML baseline comparison
│   └── index.ts          # expect(frame) fluent builder
├── test/                 # Layer 2: test runner
│   ├── playbook.ts       # YAML parser + Validation-based linter
│   ├── runner.ts         # Orchestrator: daemons, steps, results
│   ├── headed.ts         # Optional tmux support
│   ├── reporter-term.ts  # Terminal output
│   ├── reporter-html.ts  # Standalone HTML report
│   ├── reporter-junit.ts # JUnit XML
│   ├── cli.ts            # tmax-use CLI entry
│   └── index.ts          # test(name, fn) + public types
├── playbooks/            # *.yaml playbooks
├── baselines/            # *.html visual baselines
└── tests/                # *.tmax-use.ts TypeScript tests
```

## Reporting

- **Terminal**: `PASS/FAIL <source> (XXms)` per test + summary footer.
- **HTML**: `report.html` in the output directory with one card per test,
  per-step timeline, captured frame (rendered as monospaced text), and
  failure messages inline.
- **JUnit**: `junit.xml` in the output directory, compatible with GitHub
  Actions, Jenkins, and CircleCI test reporters.

## Relationship to `adws/adw-run-e2e.ts`

tmax-use is the successor to `adw-run-e2e.ts`. The existing runner is
preserved. tmax-use adds headless capture, baselines, reporting, and a
reusable control library. New playbooks and tests should target tmax-use.

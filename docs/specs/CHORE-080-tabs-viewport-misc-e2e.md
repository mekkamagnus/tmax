# Chore: e2e coverage for tabs, viewport, clipboard, documentation, browse, and trt commands

## Goals

- Lock the tab, viewport, clipboard, documentation, browse-doc/git, and trt
  T-Lisp/M-x command surfaces with end-to-end coverage (`eval-47`) so
  regressions in tab lifecycle, viewport top/left setting, OS-clipboard
  bridging, documentation lookup, RFC/spec reference resolution, GitHub-remote
  detection, and trt test execution fail loudly in `test:tmax-use`.
- Because the surface spans six otherwise-unrelated modules, the playbook is
  multi-part (clearly fenced sections) but ships as ONE `eval-47` file (the
  runner discovers one YAML).
- Capture any defect surfaced while writing assertions as a `BUG-##` spec
  referenced inline. The chore ships no new implementation, only the playbook
  (+ any trivial runner tweak a missing matcher forces).

## Completion Criteria (Definition of Done)

- [ ] Playbook `eval-47` exists at
  `tmax-use/playbooks/eval-47-tabs-viewport-misc.yaml` and passes green via
  `bun run test:tmax-use` (or a scoped
  `bun tmax-use/test/cli.ts playbooks/eval-47-tabs-viewport-misc.yaml`).
- [ ] **Tabs:** `(tab-new "alpha")` then `(tab-new "beta")` then
  `(tab-list)` returns a list containing both labels; `(tab-next)` advances
  the index (observable via the active buffer name); `(tab-switch 0)` returns
  to the first; `(tab-count)` returns the count; `(tab-close)` reduces it by
  one (and never closes the last tab) — eval-47.
- [ ] **Viewport:** `(viewport-top-set 3)` then `(viewport-top-get)` returns
  `3`; `(viewport-left-set 2)` then `(viewport-left-get)` returns `2`; both
  clamp negative inputs to 0 — eval-47.
- [ ] **Clipboard:** `(clipboard-available?)` returns a boolean (the playbook
  must tolerate a `false` environment without a clipboard tool); when
  available, `(clipboard-set "tmax-clip-marker")` then `(clipboard-get)`
  round-trips the string — eval-47 (guard the round-trip on
  `clipboard-available?` so it stays green on headless CI).
- [ ] **Documentation:** `(documentation-categories)` returns a non-empty
  list; `(documentation-search "buffer")` returns a list whose entries
  include a buffer-related function; `(documentation-get "find-file")` (or
  another core documented function) returns a multi-line string containing
  the function's signature — eval-47.
- [ ] **Browse (negatives are the safe path):** `(browse-doc-reference
  "SPEC-9999" "spec")` returns a hashmap with `ok` = nil and
  `error` = `docs-reference-not-found` (no such spec) — eval-47; a positive
  resolution against a real spec like `SPEC-070` returns `ok` = t and a
  `file://` URL — eval-47. `(browse-git-github-remote)` returns a hashmap
  with `ok` = t and a github.com URL when run inside the tmax repo, OR
  `ok` = nil with `error` = `github-remote-not-found` outside one — eval-47
  (assert the shape, tolerate the env).
- [ ] **trt:** `(trt-run-tests)` runs the embedded trt suite and posts a
  `trt:` message to `*Messages*` (assert via `status_message` or the
  `*Messages*` buffer); `(trt-find-test "nonexistent-test-xyz")` posts a
  `not found in test/tlisp/` message — eval-47. (Run these last, as they
  spawn subprocess work; keep `wait` generous.)
- [ ] Any defect uncovered is filed as `BUG-##` and listed here (write
  `None found.` if the surface is clean). Expect likely defects in the
  tab→buffer-switch interaction and the clipboard round-trip on headless CI.
- [ ] `bun run typecheck:src` and `bun run typecheck:test` unchanged.

## Description

Six editor surfaces — tabs (`tab-ops.ts`), viewport (`jump-ops.ts` — NOT
`window-ops.ts`), clipboard (`clipboard-ops.ts`), documentation
(`documentation.ts`), browse (`browse-url-ops.ts`), and the trt test runner
(`trt-commands.tlisp`) — ship a T-Lisp/M-x command surface that is **almost
entirely uncovered** by the current e2e playbook set. `eval-16` covers
browse-*url* negatives but not `browse-doc-reference` / `browse-git-github-remote`;
nothing covers tabs, viewport setters, the clipboard bridge, the documentation
browser, or the trt commands. This chore adds `eval-47`, a single (sectioned)
playbook. It is a TEST-ONLY chore: no feature code, no behavioral change. The
notable structural finding (recorded because it is easy to get wrong) is that
`viewport-top-set`/`viewport-left-set` live in **`jump-ops.ts`**, not
`window-ops.ts` — the spec the implementer should follow is explicit about
this.

## User Story

As a **tmax maintainer about to ship tab/window-management, clipboard, and
documentation improvements** I want **a green e2e playbook covering every
tab, viewport, clipboard, documentation, browse, and trt command** So that **a
regression in tab lifecycle, viewport scrolling, OS-clipboard bridging,
documentation lookup, doc/git reference resolution, or trt execution is caught
in `test:tmax-use` before it lands — and the environment-sensitive commands
(clipboard, github-remote) have a known-tolerant assertion shape CI can rely
on.**

## Problem Statement

Per the prior alpha audit (`alpha-audit-2026-08-01` in user memory), these
six command surfaces are implemented at the T-Lisp/M-x layer but have **no
e2e coverage**. The existing playbook set covers cursor/insert/line/visual/
multi-buffer/save/scroll/which-key/M-x/command-mode/syntax-load/unicode/
long-lines/empty/boundary-nav/browse-url-negatives/rapid-keys/macros/
text-objects/search/vim-macros — i.e. none of: `tab-new/close/next/switch/
list`, `viewport-top-set`/`viewport-left-set`, `clipboard-set`/`clipboard-get`,
`documentation-list`/`documentation-search`/`documentation-categories`,
`browse-doc-reference`/`browse-git-github-remote`, or `trt-run-tests`/
`trt-run-failing`/`trt-find-test`. The trt commands in particular are the
TDD red-green loop accelerator and have a structured `*Tests*` logging path
(SPEC-055) that nothing exercises end-to-end. This chore closes the blind
spot.

## Solution Statement

Write one e2e playbook `eval-47` (this is a chore, so "solution" = "write the
playbook + wire it into the runner"). The runner at
`tmax-use/test/runner.ts:737` (`discoverTargets`) auto-discovers every
`*.yaml` under `tmax-use/playbooks/`, so wiring is just authoring the file.
The playbook is organized into six fenced sections (tabs / viewport /
clipboard / docs / browse / trt) with a comment banner per section. The two
environment-sensitive surfaces (clipboard needs an OS tool; github-remote
needs a `.git` remote) are asserted on their *shape* with a guard on
`clipboard-available?` and a tolerance for the `ok = nil` branch — this keeps
the playbook green on headless CI without weakening the assertions when the
tool IS present. The trt section runs last with a generous `wait` because the
trt commands spawn real test work.

## Relevant Files

Read these before designing assertions (paths are real, verified):

- **`src/editor/api/tab-ops.ts`** — tab surface.
  - `tab-new` (line 20): `(name?)` → creates a buffer + tab, appends, sets
    current index to the new one, switches to its buffer; returns the tab id
    string.
  - `tab-close` (line 34): `(index?)` → no-op if only one tab; otherwise
    removes, clamps index, switches to the new current tab.
  - `tab-next` (line 50) / `tab-prev` (line 59): wrap-around index advance.
  - `tab-switch` (line 68): `(index)` → errors (RuntimeError) on out-of-range.
  - `tab-list` (line 82): list of `(index label)`.
  - `tab-count` (line 90).
- **`src/editor/api/jump-ops.ts`** — **viewport surface lives HERE**
  (lines 598-654), not in `window-ops.ts`.
  - `viewport-top-get` (line 598) / `viewport-top-set` (line 606): set clamps
    to `>= 0`, returns the (clamped) value.
  - `viewport-left-get` (line 631) / `viewport-left-set` (line 639): same
    clamp behavior.
  - Also `terminal-height-get` (line 623) / `terminal-width-get` (line 656)
    for sizing context.
- **`src/editor/api/window-ops.ts`** — window split/next/prev/close/list/
  resize; NOT the viewport setters. Relevant only if the playbook also covers
  window splitting (optional, lower priority — tabs are the focus).
- **`src/editor/api/clipboard-ops.ts`** — OS clipboard bridge (SPEC-044).
  - `clipboard-get` (line 136): returns `""` if no tool.
  - `clipboard-set` (line 142): `(text)` → returns nil on success, or a
    `ConstraintViolation` ("clipboard tool unavailable") if no tool.
  - `clipboard-available?` (line 160): boolean — **guard the round-trip on
    this** so headless CI without pbcopy/xclip stays green.
  - Platform detection runs once at module load (`detectPlatform`/
    `detectTool`); macOS uses `pbcopy`/`pbpaste`, Linux uses xclip/xsel/wl-copy.
- **`src/editor/api/documentation.ts`** — documentation browser.
  - `documentation-list` (line 455): list of `(name category signature)`.
  - `documentation-search` (line 470): `(pattern)` → same shape; bad-arg
    returns an error *string* (not an exception) — note this.
  - `documentation-get` (line 498): `(name)` → formatted multi-line string, or
    an error string if not found.
  - `documentation-categories` (line 525): list of category strings.
  - `documentation-by-category` (line 533).
  - The doc DB is seeded from the registered functions; pick a known-stable
    name like `find-file` or `find-references` for the `documentation-get`
    positive case (verify the exact name by running
    `(documentation-search "find")` once while iterating).
- **`src/editor/api/browse-url-ops.ts`** — doc/git reference resolution.
  - `browse-doc-reference` (line 655): `(reference kind)` where kind is
    `"rfc"` or `"spec"`; returns a hashmap. `ok=t` with `path`+`url`
    (`file://...`) on hit; `ok=nil` with `error="docs-reference-not-found"`
    on miss; `ok=nil` with `error="file-url-not-allowed"` on a symlink escape
    or directory. Resolves against `docs/rfcs` or `docs/specs` under the
    daemon's cwd, matching files by `${reference}-` prefix.
  - `browse-git-github-remote` (line 760): walks up from the current buffer
    path (or cwd) to find `.git`, parses the remote, returns a hashmap
    `ok=t owner/repo/remote/url/worktree` or `ok=nil
    error="github-remote-not-found"`.
- **`src/tlisp/core/commands/trt-commands.tlisp`** — the trt M-x commands.
  - `trt-run-tests` (line 25): resets, loads `trt-test-dir`, runs all, posts
    `trt: N passed, ...` to `*Messages*`; on failure also lists failing names;
    structured entry mirrored to `*Tests*` (SPEC-055).
  - `trt-run-failing` (line 48): re-runs the last run's failures; posts
    `trt: re-ran ...`.
  - `trt-find-test` (line 69): `(name)` → searches `test/tlisp/*.test.tlisp`
    for `(deftest <name>`, posts `trt: <name> defined at <file>:<line>` or
    `trt: test <name> not found in test/tlisp/`.
  - `trt-run-test` (line 88): `(name)` → runs one test, posts PASSED/FAILED.
  - The underlying trt TS primitives live in `src/tlisp/trt/bootstrap.ts`
    (registered as `trt-*`); the T-Lisp commands compose them.
- **`src/editor/editor.ts:238`** — confirms `*Tests*` is a reserved virtual
  buffer created at startup (so the trt section can assert against it).
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** —
  `command-detail-interactive-p`: a function shows in M-x IFF it has a
  docstring OR a keybinding. All trt commands carry docstrings (so they ARE
  M-x discoverable); the TS primitives are present regardless.
- **`tmax-use/test/runner.ts:737`** — `discoverTargets` auto-discovers
  `*.yaml` in `tmax-use/playbooks/`.
- **`tmax-use/playbooks/README.md`** — playbook schema + the backslash lint
  guard. The trt section must avoid `\` in `eval` (use `keys` if a path with
  backslashes is needed — unlikely here).
- **`tmax-use/playbooks/eval-16-browse-url-negatives.yaml`** — the closest
  existing playbook; mirror its browse-negatives assertion style for the
  `browse-doc-reference` miss case.

### New Files

- **`tmax-use/playbooks/eval-47-tabs-viewport-misc.yaml`** — the playbook.

## Implementation Plan

1. **Tabs section.** `(tab-new "alpha")` → `(tab-new "beta")` →
   `(tab-list)` (assert `result_contains: alpha` and `beta`); `(tab-count)`
   (assert `>= 2`); `(tab-switch 0)` then check the active buffer name
   reflects tab 0; `(tab-next)` then active reflects tab 1; `(tab-close)`
   reduces count by one; assert `(tab-count)` after closing only the
   non-last tab. Note: tab ops switch the underlying buffer, so the active
   buffer name is the cleanest observable for next/prev/switch.
2. **Viewport section.** `(viewport-top-set 3)` → `(viewport-top-get)` →
   assert `result_contains: 3`; `(viewport-top-set -1)` →
   `(viewport-top-get)` → assert `result_contains: 0` (clamp). Repeat for
   `viewport-left-set`/`viewport-left-get`.
3. **Clipboard section.** `(clipboard-available?)` → record boolean. If `t`,
   run the round-trip: `(clipboard-set "tmax-clip-marker")` →
   `(clipboard-get)` → `result_contains: tmax-clip-marker`. If the env
   reports not available, skip the round-trip (the playbook YAML can express
   this by asserting only `clipboard-available?` returns a boolean — there is
   no first-class "skip-if" in the schema, so structure the round-trip as a
   separate step whose `expect.result_contains` tolerates both the marker and
   an empty string, OR file a runner gap as a sub-task). Prefer asserting the
   `clipboard-available?` boolean cleanly and the round-trip as best-effort.
4. **Documentation section.** `(documentation-categories)` → non-empty list;
   `(documentation-search "buffer")` → `result_contains` a buffer fn name;
   `(documentation-get "<known-fn>")` → `result_contains` the signature
   prefix (verify the exact name by running search once while iterating).
5. **Browse section.** `(browse-doc-reference "SPEC-9999" "spec")` →
   `result_contains: docs-reference-not-found` AND
   `result_contains: ok` (shape); `(browse-doc-reference "SPEC-070" "spec")`
   → `result_contains: file://` AND `result_contains: SPEC-070` (positive,
   using a spec that exists in `docs/specs/`). `(browse-git-github-remote)`
   → assert `result_contains: ok` (tolerate either branch); when run in the
   tmax repo it should be `ok=t` with a github.com URL — assert that shape but
   keep the step tolerant.
6. **trt section (last, generous wait).** `(trt-run-tests)` → assert
   `status_message` (or `*Messages*` buffer) contains `trt:`. The suite runs
   the embedded trt tests, so expect a passing run; if the run is flaky under
   concurrent daemon load (per project memory, `test:tmax-use` full-suite can
   false-fail environmentally), scope the playbook run in CI. Then
   `(trt-find-test "nonexistent-test-xyz")` →
   `result_contains: not found in test/tlisp/`.
7. **Iterate to green** with `bun tmax-use/test/cli.ts
   playbooks/eval-47-tabs-viewport-misc.yaml`.
8. **File defects.** Likely sources: tab→buffer-switch interaction,
   clipboard round-trip on headless CI, trt subprocess timing. For each gap,
   file `BUG-##`, soften the assertion to the current contract, add
   `# TODO(BUG-##)` in the YAML, list the BUG above.

## Test Plan

- **Primary:** `tmax-use/playbooks/eval-47-tabs-viewport-misc.yaml`.
  Section-by-section key assertions are enumerated in the Completion Criteria
  and Implementation Plan above.
- **Regression:** `eval-16` (browse-url negatives) and `eval-05`
  (multi-buffer) must remain green — they share the browse and buffer-switch
  code paths.
- **Environment notes:**
  - Clipboard round-trip requires `pbcopy`/`pbpaste` (macOS) or
    xclip/xsel/wl-copy (Linux). On headless CI without one, assert only
    `clipboard-available?` returns a boolean; do NOT hard-fail on the missing
    round-trip — file a runner-gap sub-task if the YAML schema cannot express
    the tolerance cleanly.
  - `browse-git-github-remote` requires the tmax repo to have a github
    remote. In the dev checkout this is true; in a pristine CI clone it
    should also be true. Assert the shape, tolerate the `ok=nil` branch.
  - trt commands spawn real test work; keep `wait` ≥ 400ms on those steps.
- **No unit tests are added or changed.**

## M-x Discoverability

All commands under test are either TypeScript primitives (tabs, viewport,
clipboard, documentation, browse — registered by their respective
`create*Ops` factories) or T-Lisp commands with docstrings (the trt
commands in `trt-commands.tlisp` lines 25/48/69/88 each carry a docstring).
Per `command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`, a function
appears in **M-x completion** IFF it has a docstring OR a keybinding — so the
trt commands are M-x-discoverable today, and the TS primitives are callable
regardless. The chore adds no new commands and no bindings, so M-x visibility
is unchanged. No SPEC-067 concern: no `C-x <key>` bindings are proposed (C-x
is the vim decrement prefix per SPEC-067, not an Emacs-style prefix); if a
future feature wants tab/viewport bindings, it must use SPC-led or Meta
bindings (e.g. SPC t n for tab-new) and is out of scope here.

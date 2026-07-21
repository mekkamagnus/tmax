# Bug: Which-Key Missing from the Repository-Local Normal Launch

## Bug Description

Running `tmax` during development can execute a stale compiled or globally installed entrypoint instead of the current repository source, and the repository-local normal editor frontend does not paint the delayed which-key popup after the user presses `SPC`.

The symptoms are misleading because the underlying which-key state and pure overlay renderer work:

- After `SPC` and the configured delay, `(which-key-active)` returns `true`, `(which-key-prefix)` returns `"SPC"`, and `(which-key-bindings)` contains `SPC ;` and `SPC x`.
- `bin/tmaxclient --capture` can render `SPC — leader`, `execute-extended-command`, and the nested `x` prefix from that state.
- `bun test test/unit/which-key-popup.test.ts test/unit/which-key-overlay.test.ts` currently passes all 45 tests.
- `bin/tmax-use test tmax-use/playbooks/which-key.yaml` currently reports PASS even though it does not launch the normal `tmax` frontend. The playbook's screen assertions use headless daemon capture unless the runner has actually created a headed session. Even `--headed=strict` does not create a headed session for this playbook because none of its steps has `headed: true`; `--session` is currently required to force real TUI dispatch.

Actual behavior under the requested normal workflow:

1. A shell may resolve `tmax` to a stale compiled binary or another installation instead of the checkout's `bin/tmax`. In the reproduced environment, `/usr/local/bin/tmax` points to `dist/tmax`, while another Bun-global installation also exists. `scripts/link.sh` links the developer command to `dist/tmax` and only rebuilds when the file is absent, so source edits do not automatically become the code executed by `tmax`.
2. When the checkout's `bin/tmax` does launch the current source, its default path runs `src/main.ts` with `SteepFrontend`. Pressing `SPC` activates which-key state after the timeout, but no popup appears in the terminal.

Expected behavior:

- From this repository's supported developer setup, `tmax` resolves to the checkout's source launcher and therefore runs the current code without requiring a stale `dist/tmax` rebuild.
- In a normal interactive `tmax` session, pressing `SPC` in normal mode and waiting longer than `whichKeyTimeout` paints the `SPC — leader` popup with the `;` command and `x` nested prefix.
- Pressing `Escape` dismisses the popup.
- Completing a prefix before the timeout (for example `SPC ;`) performs the command without flashing a stale popup later.
- A tmax-use playbook launches the same repository-local `tmax` command in a real terminal, sends real keys, captures the actual pane, and fails if it cannot exercise that surface.

## Problem Statement

The repository currently has no reliable end-to-end contract connecting developer command resolution, the normal `bin/tmax` launch path, timer-driven state changes, and the Steep terminal renderer. The source-level state tests and daemon capture tests can all pass while the user-facing normal editor is broken. The existing which-key playbook reinforces the false green because it claims real-screen coverage but normally executes through the daemon/headless capture path.

The fix must make the developer `tmax` command source-current, add the missing which-key layer to the normal frontend, and make the e2e harness capable of proving that exact launch path rather than a substitute frontend.

## Solution Statement

Use the repository's `bin/tmax` shell launcher as the stable developer command target instead of `dist/tmax`, and make the developer linking/setup flow refresh that target deterministically. Add the existing shared which-key overlay renderer to `SteepFrontend` using the same bottom-of-buffer placement contract as the daemon TUI and capture renderer. Preserve the existing per-editor timeout and `applyUpdate` notification behavior; do not add a polling loop or a second which-key state owner.

Extend the tmax-use playbook schema with an explicit normal-launch surface. A normal-launch playbook must start `PROJECT_ROOT/bin/tmax` in an isolated tmux session with a unique `TMAX_SOCKET`, connect the harness to the embedded server for assertions, dispatch all user keys through tmux, capture the real pane, and fail if tmux or the normal frontend is unavailable. Add a dedicated regression playbook for `SPC`, dismissal, and quick completion. Keep the existing daemon/headless mode as the default for all other playbooks.

## Steps to Reproduce

1. From the repository root, inspect command resolution:
   ```bash
   command -v tmax
   readlink "$(command -v tmax)"
   ls -l dist/tmax bin/tmax
   ```
2. Observe that the developer link targets `dist/tmax`, which is not rebuilt when source files change unless it is absent or a build is run manually.
3. Launch the current source explicitly to remove command-resolution ambiguity:
   ```bash
   TMAX_SOCKET=/tmp/tmax-which-key-repro.sock bin/tmax
   ```
4. In normal mode, press `SPC` and wait longer than one second.
5. Observe that no `SPC — leader` popup is painted by the normal Steep frontend.
6. While the embedded server is alive, query the state from another shell:
   ```bash
   TMAX_SOCKET=/tmp/tmax-which-key-repro.sock bin/tmaxclient --eval '(which-key-active)'
   TMAX_SOCKET=/tmp/tmax-which-key-repro.sock bin/tmaxclient --eval '(which-key-prefix)'
   TMAX_SOCKET=/tmp/tmax-which-key-repro.sock bin/tmaxclient --capture
   ```
7. Observe that state reports active prefix `SPC` and server capture contains the overlay, proving the input/timer/state/overlay data are correct and the normal frontend paint is missing.
8. Run the existing tests:
   ```bash
   bun test test/unit/which-key-popup.test.ts test/unit/which-key-overlay.test.ts
   bin/tmax-use test tmax-use/playbooks/which-key.yaml
   bin/tmax-use test tmax-use/playbooks/which-key.yaml --headed=strict
   ```
9. Observe that they pass without launching the normal `bin/tmax` frontend, demonstrating the coverage gap.

## Root Cause Analysis

There are three related root causes:

1. **The developer command is linked to a build artifact, not the source launcher.** `scripts/link.sh` maps `/usr/local/bin/tmax` to `dist/tmax`. It builds only when `dist/tmax` or `dist/tlisp` is missing, and it leaves an existing symlink unchanged. A valid symlink can therefore keep executing an old compiled snapshot after repository refactoring. README setup also appends the repository `bin` directory to `PATH`, allowing an earlier global installation to win.

2. **The normal frontend never draws which-key.** `src/main.ts` uses `SteepFrontend` for normal `tmax`. `src/steep/assam.ts` renders the tab bar, buffer, minibuffer/command input, status line, and cursor, but it neither imports nor calls `renderWhichKeyOverlay`. The editor's delayed callback is not the failing layer: it commits `SetWhichKeyActive` and `SetWhichKeyPopup` through `applyUpdate`, and `applyUpdate` notifies the frontend subscription installed in `src/main.ts`. The repaint occurs with fresh state, but the Steep renderer omits the overlay. The daemon TUI and `captureFrame` already contain the required overlay rendering logic.

3. **The e2e playbook does not test what its comments claim.** The current tmax-use lifecycle always launches `src/server/server.ts`, and headed sessions launch `bin/tmaxclient --tui`, not normal `bin/tmax`. A `screen_contains` assertion does not itself create a headed session. Without `--headed` plus a step marked `headed: true` (or `--session`, which force-promotes steps), key dispatch and capture remain protocol/headless. Consequently, the which-key playbook proves daemon editor state and capture rendering, but cannot detect a missing layer in `SteepFrontend` or a stale `tmax` command.

Git history shows the Steep overlay omission predates the current uncommitted CHORE-44 patch, while CHORE-44 changed the normal bootstrap and made the unsupported path more visible. The implementation should fix the present architectural gap and lock down behavior without claiming an unproven single causal commit.

## Relevant Files

Use these files to fix the bug:

- `README.md` — documents developer PATH setup; it must make the repository launcher take precedence and explain the source-current developer link.
- `bin/tmax` — authoritative repository-local normal launcher. Preserve its source-relative `PROJECT_DIR` resolution and default `src/main.ts` execution.
- `scripts/link.sh` — currently links `tmax` to stale-prone `dist/tmax`; update the developer-link contract and make it testable without writing to `/usr/local/bin`.
- `src/main.ts` — wires `Editor.onStateChange` to `SteepFrontend.requestRender` and is the normal launch entrypoint the regression playbook must exercise.
- `src/steep/assam.ts` — normal frontend renderer missing the which-key overlay layer.
- `src/frontend/render/which-key-overlay.ts` — shared popup computation/rendering implementation; reuse it rather than introducing another renderer.
- `src/client/tui-client.ts` — reference for overlay placement and cursor/render ordering; avoid changing its behavior unless a shared helper is extracted.
- `src/render/capture-frame.ts` — second reference renderer and existing headless capture surface; preserve parity.
- `src/editor/handlers/normal-handler.ts` — schedules prefix activation and constructs popup state; behavior should remain unchanged unless a regression test proves a minimal adjustment is required.
- `src/editor/utils/which-key-state.ts` — owns the per-editor timeout and cancellation semantics; do not introduce global state or a frontend-owned timer.
- `test/unit/which-key-popup.test.ts` — existing state tests include a weak conditional SPC assertion that currently permits missing bindings/popup behavior.
- `test/unit/which-key-overlay.test.ts` — existing pure renderer tests; extend only for any shared placement helper introduced by the fix.
- `test/unit/tmax-launcher.test.ts` — new launcher/link regression coverage described below.
- `tmax-use/test/playbook.ts` — playbook schema and validation; add the explicit normal-launch surface.
- `tmax-use/test/runner.ts` — lifecycle orchestration; add the normal-launch branch without changing default daemon behavior.
- `tmax-use/test/headed.ts` — tmux process startup/capture/cleanup helpers; add a repository-local `bin/tmax` launch helper or parameterize the existing helper safely.
- `tmax-use/src/instance.ts` — supports connecting to an already-running embedded server; use its existing connect lifecycle or make the smallest cleanup extension required.
- `test/unit/tmax-use/playbook.test.ts` and `test/unit/tmax-use/runner.test.ts` — add deterministic tests for schema validation, command construction, no-fallback behavior, lifecycle ordering, and cleanup.
- `tmax-use/playbooks/README.md` — document normal-launch semantics and the difference between daemon capture, TUI headed mode, and the normal Steep frontend.
- `tmax-use/playbooks/which-key.yaml` — correct misleading comments so this file is explicitly daemon/capture coverage, or add explicit headed markers if retaining TUI coverage.

### New Files

- `test/unit/tmax-launcher.test.ts` — verifies the developer link points to the repository `bin/tmax` launcher and can be tested in a temporary install directory.
- `tmax-use/playbooks/which-key-normal-launch.yaml` — launches normal repository-local `tmax`, presses `SPC` through a real terminal, and asserts the visible popup lifecycle.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Establish the Repository-Local Developer Launcher Contract

**Objective**: Ensure the `tmax` developer command executes the current checkout source instead of a stale compiled artifact or an earlier global installation.

**User Story**: As a tmax developer, I want `tmax` from my checkout setup to resolve to the repository launcher so that source edits and refactors are exercised immediately.

- Update `scripts/link.sh` so the `tmax` developer link targets `$ROOT/bin/tmax`, not `$ROOT/dist/tmax`.
- Always replace/update the `tmax` symlink when the script runs; do not treat an existing symlink with the wrong target as success.
- Add an `INSTALL_DIR` environment override defaulting to `/usr/local/bin` so tests can run the script against a temporary directory without privileges or host mutation.
- Do not require `dist/tmax` to exist when creating the source-current `tmax` developer link. Keep `tlisp` behavior unchanged unless separating its build check is necessary to prevent it from forcing an unrelated tmax build.
- Preserve symlink-safe `PROJECT_DIR` resolution in `bin/tmax`; a link from an arbitrary install directory must still resolve the checkout root.
- Update README setup commands to prepend the absolute checkout `bin` directory to `PATH` instead of appending it. Avoid a single-quoted literal `$(pwd)` in the persisted command.
- Document how to clear a shell's cached command resolution (`hash -r` for sh/zsh-compatible shells) after replacing an older global command.
- Do not alter the release installer: `scripts/install.sh` installs released binaries and is a separate production distribution contract.

**Acceptance Criteria**:
- [ ] Running `INSTALL_DIR="$LINK_TEST_DIR" scripts/link.sh` creates `$LINK_TEST_DIR/tmax` as a symlink whose fully resolved target is the current checkout's `bin/tmax`.
- [ ] Re-running the script after `$LINK_TEST_DIR/tmax` is changed to a wrong symlink replaces it with the correct repository launcher.
- [ ] The developer link succeeds when `dist/tmax` is absent; no stale build is required for source development.
- [ ] Executing `$LINK_TEST_DIR/tmax --version` runs successfully from a working directory outside the repository and reports the version from the current checkout's `package.json`.
- [ ] README setup prepends the repository `bin` path and includes the command-cache refresh note.
- [ ] Release installation behavior in `scripts/install.sh` is unchanged.

### Add Deterministic Launcher Regression Tests

**Objective**: Prevent the developer link from silently returning to a stale compiled or foreign tmax executable.

**User Story**: As a maintainer, I want automated launcher tests so that a refactor cannot make the normal development command execute old code unnoticed.

- Create `test/unit/tmax-launcher.test.ts` using temporary directories and subprocesses only; never modify `/usr/local/bin`, `$HOME/.bun/bin`, or the user's real PATH.
- Run `scripts/link.sh` with `INSTALL_DIR` pointing at the fixture directory.
- Assert the realpath of the created `tmax` link equals the checkout's `bin/tmax`.
- Seed an incorrect existing symlink, rerun the script, and assert correction.
- Execute the linked command with `--version` from a non-repository cwd and compare its version text to `package.json`.
- Add a source-level guard that the developer `tmax` link does not target `dist/tmax`; do not use a brittle full-file snapshot.
- Clean all fixture directories in `afterEach`/`afterAll`, even when assertions fail.

**Acceptance Criteria**:
- [ ] Each new test fails against the current `scripts/link.sh` behavior and passes after the launcher fix.
- [ ] Tests require no elevated permissions and make no changes outside their temporary directory.
- [ ] Tests prove both first-time linking and correction of an existing wrong symlink.
- [ ] Tests prove the linked launcher is cwd-independent and reads the checkout's current version.

### Render Which-Key in the Normal Steep Frontend

**Objective**: Paint the delayed which-key popup in the frontend used by normal `tmax` launches.

**User Story**: As an editor user, I want pressing `SPC` and pausing to display available leader bindings so that I can discover commands during normal use.

- Import and call the existing `renderWhichKeyOverlay` implementation from `src/steep/assam.ts`.
- Use the same condition as the TUI renderer: render only when `state.whichKeyActive` is true and `state.whichKeyPopup` is non-null.
- Use the same placement formula as `src/client/tui-client.ts`: overlay the bottom of the buffer area, above the status line and respecting an optional tab bar and minibuffer/command height.
- Render the overlay after the underlying buffer/status layers so it is not overwritten by normal frame composition.
- Preserve the existing cursor placement behavior and clamp rules. If the cursor would be positioned over popup content, match the established TUI behavior rather than inventing a frontend-specific policy.
- Rely on `applyUpdate` and the existing `Editor.onStateChange` subscription for timeout-triggered repaint. Do not add polling, sleeps, duplicate timers, or frontend-owned which-key state.
- Keep popup styling and binding labels sourced from `which-key-overlay.ts`; do not duplicate color codes or command formatting in Steep.

**Acceptance Criteria**:
- [ ] In a repository-local normal `bin/tmax` session, `SPC` followed by a wait greater than `whichKeyTimeout` visibly displays `SPC — leader`.
- [ ] The popup visibly includes `; : execute-extended-command` and `x : ..prefix..` (spacing may be renderer-controlled, but labels and commands must be present).
- [ ] `Escape` removes the overlay on the next render.
- [ ] `SPC ;` typed before the timeout enters M-x mode without a delayed popup appearing afterward.
- [ ] The TUI client and server capture continue rendering the same which-key labels and bindings.
- [ ] No new timer, global singleton, or polling loop is added.

### Strengthen Which-Key Unit Coverage at the Timer and Render Boundary

**Objective**: Replace permissive internal assertions with deterministic tests for SPC activation, popup data, cancellation, and repaint notification.

**User Story**: As a maintainer, I want unit tests to fail when delayed SPC state or repaint signaling breaks so that the e2e test is not the only diagnostic.

- In `test/unit/which-key-popup.test.ts`, replace the conditional SPC binding assertion with strict assertions after waiting for activation:
  - `whichKeyActive === true`;
  - `whichKeyPrefix === "SPC"`;
  - bindings contain `SPC ;` and the `SPC x` nested prefix;
  - `whichKeyPopup` is non-null and its flattened rows contain the `;` and `x` entries.
- Add a listener regression test that subscribes with `editor.onStateChange`, presses `SPC`, clears the synchronous notification count, waits past the short test timeout, and proves the timer-driven `SetWhichKeyActive`/`SetWhichKeyPopup` updates notify subscribers. Assert final state rather than relying only on call count because the callback commits more than one message.
- Add or extend a pure overlay placement test only if a small shared placement helper is extracted. Do not refactor all three renderers merely to increase unit-test reach.
- Preserve fixture disposal and timer reset so the full test file does not leak handles or state into later tests.

**Acceptance Criteria**:
- [ ] The previous weak `if (bindings.length > 0)` SPC assertion is removed.
- [ ] A test fails if SPC never activates, loses either default binding, or produces a null popup.
- [ ] A test fails if timeout-driven popup state no longer notifies the normal frontend subscription.
- [ ] Quick `SPC ;` and Escape cancellation tests prove no timer activates after cancellation/completion.
- [ ] The full `test/unit/which-key-popup.test.ts` file passes without leaked timers or order-dependent failures.

### Add an Explicit Normal-Launch Surface to tmax-use

**Objective**: Allow a playbook to test the exact repository-local `bin/tmax` + Steep frontend path used during normal editing.

**User Story**: As a developer, I want tmax-use to launch normal tmax in a real terminal so that user-visible regressions cannot pass through daemon state or capture substitutes.

- Add an optional top-level playbook field `launch` with allowed values `daemon` (default, existing behavior) and `normal` (new behavior). Reject every other value with a path-specific validation error.
- Document that `launch: normal` is terminal-dependent and cannot fall back to headless capture.
- For `launch: normal`, allocate a unique run id for every playbook execution and include it in the tmux session/window name, `TMAX_SOCKET`, lock path, and fixture directory. Allow tests to provide the run id through an environment override so validation can audit only resources created by that run. Do not pre-spawn `src/server/server.ts`.
- Write setup files before starting the normal process so the first fixture path can be passed to `PROJECT_ROOT/bin/tmax` if desired. If restructuring this order is disproportionate, start on scratch and open the fixture through the embedded server immediately after connection; whichever approach is chosen must be deterministic and documented.
- Start `PROJECT_ROOT/bin/tmax` (not `command -v tmax`, `dist/tmax`, `src/main.ts`, or `bin/tmaxclient --tui`) inside a detached tmux session/window with the isolated `TMAX_SOCKET`, requested width/height, and repository cwd.
- Wait for the embedded server socket to respond, then attach the harness through `TmaxInstance.connect`/`TmaxClient` for eval and state assertions. Do not spawn a second daemon on the same socket.
- Force every `keys` action in a normal-launch playbook through tmux key dispatch. Use the real tmux pane for `screen_contains` and `screen_not_contains` assertions.
- Treat missing tmux, failure to start `bin/tmax`, missing socket, empty pane capture, or inability to attach as a failed playbook. Never warn-and-fallback for `launch: normal`.
- Record the exact launched command in failure diagnostics so a future stale-path problem is obvious.
- On cleanup, terminate only the tmux process/window whose name contains the unique run id, close the connected harness without killing unrelated processes, remove only the socket/lock/fixture paths containing that run id, and delete fixture files. Cleanup must run on pass, assertion failure, startup timeout, and thrown error.
- Preserve current daemon/headless behavior for playbooks that omit `launch` or specify `launch: daemon`.

**Acceptance Criteria**:
- [ ] Parser tests accept `launch: normal`, default missing `launch` to daemon semantics, and reject unknown values.
- [ ] Runner tests prove normal mode constructs a command containing the absolute repository `bin/tmax` path and never `dist/tmax` or `bin/tmaxclient --tui`.
- [ ] Runner tests prove no standalone daemon is spawned before the normal process.
- [ ] Runner tests prove normal-mode keys use tmux dispatch and screen assertions use pane capture.
- [ ] Normal mode fails explicitly when tmux/startup/capture is unavailable; it cannot be reported as a headless pass.
- [ ] Existing daemon-mode runner and headed-TUI tests pass unchanged.
- [ ] Cleanup tests prove the tmux process, isolated socket, lock, and fixtures created for the unique run id are removed on both success and failure without failing because of unrelated stale resources.

### Add the Normal-Launch Which-Key Regression Playbook

**Objective**: Reproduce and prevent the exact user-visible SPC failure through the normal repository command.

**User Story**: As a tmax user, I want an e2e test to press SPC in the same editor I launch normally so that a green playbook guarantees the popup is actually visible.

- Create `tmax-use/playbooks/which-key-normal-launch.yaml` with `launch: normal`, a small setup file, fixed terminal dimensions, and `cleanup: true`.
- Use a unique visible text fixture so the runner can prove the normal process opened the intended file before testing which-key.
- Set a short deterministic timeout (for example 150 ms) through eval after the embedded server is connected; use real keys for every user interaction.
- Send `Escape` to establish normal mode, then send a space using tmax-use named-key syntax (`keys: "<SPC>"`) or an explicit literal leading space (`keys: " "`). Do not write `keys: "SPC"`, because tmax-use would send the letters `S`, `P`, and `C`. Wait at least twice the configured timeout plus the renderer settle interval, and assert the real pane contains `SPC — leader`.
- Use separate assertion steps for `execute-extended-command` and `..prefix..` because the schema supports one `screen_contains` value per step.
- Send `Escape` and assert the popup text is absent.
- Set a longer timeout, send the quick leader command without pausing between keys using exact YAML such as `keys: "<SPC>;"` or a literal leading space such as `keys: " ;"`, assert mode `mx`, and assert the popup header remains absent after the timeout would have elapsed. Do not use `keys: "SPC ;"`.
- Restore the default timeout before cleanup if the process remains alive long enough for subsequent shared checks.
- Update `tmax-use/playbooks/which-key.yaml` comments to state accurately that it covers daemon state/capture unless explicitly run through the daemon TUI; do not let it claim normal-launch coverage.

**Acceptance Criteria**:
- [ ] The new playbook fails against the current Steep renderer because `SPC — leader` is absent.
- [ ] After the fix, `bin/tmax-use test tmax-use/playbooks/which-key-normal-launch.yaml` passes without extra `--headed`, `--session`, or manual tmux preparation.
- [ ] Test artifacts identify the launch command as the absolute repository `bin/tmax` path.
- [ ] The positive popup assertions are pane captures, not capture RPC output or `(which-key-active)` state queries.
- [ ] Escape dismissal and quick `SPC ;` completion are both verified visually/behaviorally.
- [ ] The playbook cannot pass when tmux is unavailable or when the normal process fails to start.

### Update Harness Documentation and Remove False-Green Claims

**Objective**: Make test-surface guarantees explicit so future playbooks do not confuse state capture, daemon TUI, and normal tmax rendering.

**User Story**: As a playbook author, I want clear launch and capture semantics so that I choose the surface that can detect my bug.

- Update `tmax-use/playbooks/README.md` schema with `launch: daemon|normal`.
- Add a compact comparison of:
  - daemon/headless RPC capture;
  - daemon TUI headed capture (`bin/tmaxclient --tui`);
  - normal headed capture (`bin/tmax` + Steep + embedded server).
- State that `screen_contains` alone does not prove normal frontend coverage.
- State that `launch: normal` always requires a real terminal and fails instead of falling back.
- Correct the existing which-key playbook's inaccurate assertion that its default invocation proves a fresh normal tmax popup.
- Update README which-key usage only if necessary to mention the delay; do not expand this bug into a general keybinding documentation rewrite.

**Acceptance Criteria**:
- [ ] A playbook author can determine which launch value tests `SteepFrontend` without reading runner source.
- [ ] Documentation no longer says the default `which-key.yaml` invocation proves normal tmax rendering.
- [ ] The required command for the new normal-launch playbook is documented and matches the validation command below.

### Run Complete Validation

**Objective**: Prove the launcher, unit behavior, normal terminal rendering, daemon/TUI parity, and full project remain correct.

**User Story**: As a maintainer, I want all targeted and regression gates to pass so that the which-key repair does not damage other editor surfaces.

- Run every command in `Validation Commands` in order.
- Stop and report the first failure with its exact command and relevant output; do not weaken assertions, skip the normal-launch playbook, or substitute server capture.
- Confirm no test-created tmux sessions, sockets, locks, or fixture files remain after the commands finish.

**Acceptance Criteria**:
- [ ] Every targeted launcher, which-key, harness, and normal-launch playbook command exits 0.
- [ ] All source/test/full typecheck gates exit 0.
- [ ] `bun run test:unit`, `bun run build`, and `bun run test:tmax-use` exit 0.
- [ ] The final process/socket audit finds no resources created by the regression playbook.

## Tests & E2E Playbooks

This bug must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

### Unit tests

- Update `test/unit/which-key-popup.test.ts` with strict SPC binding/popup assertions, timer-driven state-listener coverage, Escape cancellation, and quick `SPC ;` non-activation.
- Update `test/unit/which-key-overlay.test.ts` only if a pure shared placement helper is introduced; otherwise keep its existing styling/layout assertions unchanged.
- Create `test/unit/tmax-launcher.test.ts` for temporary-install-dir developer link resolution, wrong-link replacement, cwd independence, and current package version.
- Update `test/unit/tmax-use/playbook.test.ts` for `launch` parsing/defaulting/validation.
- Update `test/unit/tmax-use/runner.test.ts` for repository-local normal command construction, hard failure semantics, normal lifecycle ordering, tmux-only key dispatch/capture, no standalone daemon spawn, and cleanup.
- Each new behavior must have at least one test that fails without the implementation.
- Targeted tests must pass before broad validation:
  ```bash
  bun test test/unit/tmax-launcher.test.ts test/unit/which-key-popup.test.ts test/unit/which-key-overlay.test.ts
  bun test test/unit/tmax-use/playbook.test.ts test/unit/tmax-use/runner.test.ts
  ```

### tmax-use e2e playbook

- The required new file is `tmax-use/playbooks/which-key-normal-launch.yaml`.
- It must use `launch: normal`, a repository-local `bin/tmax` process, real tmux key dispatch, and real pane capture.
- It must assert popup appearance, the default `;` and `x` entries, Escape dismissal, and quick `SPC ;` completion without a delayed popup.
- Run it locally with no extra headed flags:
  ```bash
  bin/tmax-use test tmax-use/playbooks/which-key-normal-launch.yaml
  ```
- A headless fallback, direct `src/server/server.ts` launch, `bin/tmaxclient --tui` launch, or capture-RPC-only assertion does not satisfy this bug.

### New Files

- `test/unit/tmax-launcher.test.ts` — proves the developer `tmax` link always resolves to the current repository source launcher.
- `tmax-use/playbooks/which-key-normal-launch.yaml` — proves the SPC popup works through normal `bin/tmax` and the Steep terminal renderer.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

```bash
# Optional reproduction-only evidence for environments that already have a global tmax:
# command -v tmax
# readlink "$(command -v tmax)"
bun test test/unit/which-key-popup.test.ts test/unit/which-key-overlay.test.ts
bin/tmax-use test tmax-use/playbooks/which-key.yaml

# Developer-link contract without mutating /usr/local:
LINK_TEST_DIR="$(mktemp -d)"
INSTALL_DIR="$LINK_TEST_DIR" scripts/link.sh
test "$(realpath "$LINK_TEST_DIR/tmax")" = "$(realpath bin/tmax)"
(cd /tmp && "$LINK_TEST_DIR/tmax" --version)
rm -rf "$LINK_TEST_DIR"

# Targeted unit and harness regressions:
bun test test/unit/tmax-launcher.test.ts test/unit/which-key-popup.test.ts test/unit/which-key-overlay.test.ts
bun test test/unit/tmax-use/playbook.test.ts test/unit/tmax-use/runner.test.ts

# Exact user-visible regression through normal tmax:
BUG24_RUN_ID="bug24-$(date +%s)-$$"
TMAX_USE_RUN_ID="$BUG24_RUN_ID" bin/tmax-use test tmax-use/playbooks/which-key-normal-launch.yaml

# Preserve existing daemon/capture which-key coverage:
bin/tmax-use test tmax-use/playbooks/which-key.yaml

# Required project type and behavior gates:
bun run typecheck:src
bun run typecheck:test
bun run typecheck:tmax-use
bun run typecheck
bun run test:unit
bun run build
bun run test:tmax-use

# Resource cleanup audit; no resources created for this validation run id should remain:
test -z "$(tmux list-sessions 2>/dev/null | rg "$BUG24_RUN_ID" || true)"
test -z "$(find /tmp -maxdepth 1 -name "*$BUG24_RUN_ID*" -print)"
```

- `bun run test:unit` — Run unit tests with zero regressions.
- `bun run test:tmax-use` — Run all tmax-use e2e playbooks + tests, including the required normal-launch playbook.

## Notes

- No new library is required.
- The working tree already contains extensive CHORE-44 implementation changes. The implementer must preserve those edits, avoid broad formatting, and touch only files listed in this spec unless a directly required harness dependency is discovered.
- Do not “fix” this by rebuilding `dist/tmax` once. That would make the local symptom disappear temporarily while preserving the stale-artifact developer workflow.
- Do not “fix” this by changing `render-state` to mutate or synchronize frame state. The server's read-only render-state invariant is intentional and unrelated to the normal Steep omission.
- Do not “fix” the playbook by asserting `(which-key-active)` or capture RPC output. Those paths already pass while the visible normal editor is broken.
- The existing daemon TUI can render which-key when driven through real tmux input (`--headed --session ...`); this bug specifically requires normal `bin/tmax`/Steep coverage in addition to preserving daemon/TUI behavior.
- `scripts/install.sh` remains the release-binary installer. The source-current guarantee in this spec applies to the repository developer setup and `scripts/link.sh`.

## Audit findings (adw-patch-review 2026-07-18T22:17:45.471Z)

**Verdict:** gaps

The BUG-24 implementation is functionally complete and correct across all spec areas: the developer launcher now links to the source `bin/tmax` (scripts/link.sh: INSTALL_DIR override, `-sfn` always-relink, no dist requirement), the Steep frontend renders the which-key overlay (assam.ts imports + calls renderWhichKeyOverlay with the same condition/placement as the TUI/capture renderers, no new timer/polling), the tmax-use schema gained a `launch: daemon|normal` field, the runner has a full normal-launch branch (isolated run id, TMAX_SOCKET, HOME, real tmux key dispatch + pane capture, no headless fallback, recorded launch command, scoped cleanup), docs corrected the false-green claim, and unit coverage was strengthened (strict SPC assertions, timer-listener test, Escape + quick-completion cancellation) plus a new tmax-launcher.test.ts. Critically, the BUG-24 regression e2e `which-key-normal-launch.yaml` PASSES all 11 steps (junit: tests=11, failures=0) — the exact user-visible SPC→leader-popup fix is proven through normal `bin/tmax`+Steep+real pane capture, including ; / x entries, Escape dismissal, and quick `SPC ;`→M-x with no stale popup. The verdict is 'gaps' solely because the required validation gate `bun run test:tmax-use` does NOT exit 0: it has 35 failures, every one of which is a pre-existing daemon-mode playbook (`_smoke`, `browse-url*`, `eval-01..16`, `which-key.yaml`, `which-key-deep-dive.yaml`) timing out with `daemon not responsive ... socket not yet present` — the documented load-sensitivity issue (learnings.md gotcha #4: daemon path polls only 5s; this box is saturated by 3+ concurrent adw pipelines). These failures are environmental and unrelated to BUG-24, but the spec's acceptance criterion 'test:tmax-use exits 0' is unmet. Minor: three runner-test sub-criteria (no-daemon-spawn ordering, tmux-only dispatch/capture, hard-fail on missing tmux) are covered by the implementation and the passing e2e rather than explicit unit assertions. The build was also still being actively mutated by a live adw patch-review pipeline during this audit (uncommitted; tmax-launcher.test.ts appeared mid-audit), so it is not in a verified-final committed state.

### Criteria
- **link.sh targets $ROOT/bin/tmax (not dist/tmax) and always (re)links via INSTALL_DIR override; works with dist/tmax absent; bin/tmax --version is cwd-independent and reports package.json version** — implemented: scripts/link.sh: INSTALL_DIR default /usr/local/bin; TMAX_SOURCE=$ROOT/bin/tmax; ln -sfn always replaces; tlisp built separately via build:tlisp. Verified: `cd /tmp && bin/tmax --version` → 'tmax v0.2.0' (matches package.json). tmax-launcher.test.ts:52-100 covers realpath==bin/tmax, wrong-symlink replacement, no-dist, cwd-independent version.
- **README prepends repo bin/ to PATH (not append), avoids single-quoted literal $(pwd), and documents hash -r cache refresh; scripts/install.sh unchanged** — implemented: README.md diff: `echo "export PATH=\"$(pwd)/bin:\$PATH\"" >> ~/.bashrc`; `hash -r` note added. scripts/install.sh absent from diff (unchanged).
- **New tmax-launcher.test.ts: temporary INSTALL_DIR only, asserts realpath==bin/tmax, wrong-symlink correction, cwd-independent version, source-level guard against dist/tmax, fixture cleanup** — implemented: test/unit/tmax-launcher.test.ts:21-49 (REPO_ROOT realpath, mkdtemp fixtures, afterEach rmSync); tests at :52-109 cover all four behaviors + source guard (contains 'bin/tmax', not 'dist/tmax').
- **Steep frontend renders which-key overlay: condition whichKeyActive && whichKeyPopup, bottom-of-buffer placement above status line, drawn after buffer/status, reusing renderWhichKeyOverlay; no new timer/singleton/polling** — implemented: src/steep/assam.ts:11 import; :78-92 `if (state.whichKeyActive && state.whichKeyPopup) { renderWhichKeyOverlay(...); overlayStart = tabBarHeight + bufferHeight - overlayLines.length; ... }` placed after renderStatusLine (line 75). Relies on existing requestRender/onStateChange subscription; no new timer added.
- **which-key-popup.test.ts: weak if(bindings.length>0) removed; strict SPC assertions (active, prefix 'SPC', bindings SPC ; / SPC x, popup non-null with ; and x); timer-driven onStateChange listener test; Escape + quick-completion cancellation; no leaked timers** — implemented: test/unit/which-key-popup.test.ts diff: old conditional block replaced (:133-158) with strict assertions; new describe 'Which-key SPC leader regression (BUG-24)' adds listener test (resets count after sync burst, asserts calls>0 + final state), Escape dismissal, and quick-completion cancellation. test:unit gate PASS.
- **playbook schema: optional launch field daemon|normal, default daemon, reject unknown with path-specific error** — implemented: tmax-use/test/playbook.ts: launch added to allowedTop + type + validation `launch must be 'daemon' or 'normal'`. test/unit/tmax-use/playbook.test.ts:232-263 covers accept normal/daemon, default undefined, reject unknown.
- **runner: normal mode builds command with absolute bin/tmax (never dist/src/main/server/tmaxclient), unique run id with TMAX_USE_RUN_ID override, no standalone daemon spawn, tmux-only key dispatch + pane capture, hard-fail when tmux unavailable, scoped cleanup of tmux/socket/lock/fixtures** — partial: tmax-use/test/runner.ts: buildNormalLaunchCommand (:501), normalRunId (:510 TMAX_USE_RUN_ID), waitForNormalSocket, cleanupNormalResources (:530), normal branch (:575-700) with tmuxAvailable() hard-fail (:595), startNormalLaunchSession, TmaxInstance.connect (no second daemon), forceHeaded+normalLaunch routing keys/capture through tmux. IMPLEMENTATION complete. Unit tests (runner.test.ts) cover command construction, run id, and cleanup only; 'no-daemon-spawn ordering / tmux-only dispatch / hard-fail' are exercised by the passing e2e rather than explicit unit assertions.
- **which-key-normal-launch.yaml: launch:normal, setup file, fixed dims, cleanup:true; SPC paints 'SPC — leader' on real pane; separate steps for execute-extended-command and ..prefix..; Escape dismisses; quick SPC; → mx with no stale popup; restore timeout** — implemented: tmax-use/playbooks/which-key-normal-launch.yaml (launch: normal, keys '<SPC>', screen_contains 'SPC — leader', 'execute-extended-command', '..prefix..', '<Escape>' dismissal, '<SPC>;' → mode mx, restore timeout). junit: testsuite 'which-key normal launch' tests=11 failures=0 time=147.5s — all steps PASS including 'press SPC, leader popup paints on screen', 'quick SPC ; enters M-x'.
- **which-key.yaml comments corrected to state daemon/capture coverage (not normal tmax); playbooks/README documents launch:daemon|normal, comparison table, screen_contains-doesn't-prove-normal, normal never falls back** — implemented: tmax-use/playbooks/which-key.yaml diff: 'does NOT launch repository's normal bin/tmax Steep frontend... see which-key-normal-launch.yaml'. tmax-use/playbooks/README.md diff: launch field, daemon-vs-normal comparison table, 'screen_contains assertion alone does not prove the normal bin/tmax Steep frontend renders', 'never reports a headless pass'.
- **Validation: all typecheck gates exit 0; test:unit, build, test:tmax-use exit 0; no resources remain after the run** — partial: typecheck:src PASS, test:unit PASS (provided gates). test:tmax-use FAIL (exit -1): junit tests=46 failures=35, ALL daemon-mode playbooks failing 'daemon not responsive ... socket not yet present' (environmental load timeout, learnings.md gotcha #4). build not reported in provided gates. Resource audit clean: no stray .txt fixtures, no leftover normal-launch tmux sessions observed.

### Tests
- **Developer link resolves to checkout bin/tmax (realpath), corrects a wrong symlink, works with dist absent, --version is cwd-independent** — covered: test/unit/tmax-launcher.test.ts:52-100 (5 tests, isolated INSTALL_DIR, afterEach cleanup). Manual check: `cd /tmp && bin/tmax --version` → 'tmax v0.2.0'.
- **SPC activates which-key: active==true, prefix=='SPC', bindings contain 'SPC ;' and 'SPC x', popup non-null with ; and x entries** — covered: test/unit/which-key-popup.test.ts:133-158 (strict assertions replacing the old conditional block).
- **Timer-driven SetWhichKeyActive/SetWhichKeyPopup notifies onStateChange subscribers (the normal frontend repaint path)** — covered: test/unit/which-key-popup.test.ts 'timer-driven SPC activation notifies onStateChange subscribers' (resets count after sync burst, waits past timeout, asserts calls>0 + final active/popup state).
- **Escape dismisses SPC which-key popup; quick SPC completion cancels timer before activation (no delayed popup)** — covered: test/unit/which-key-popup.test.ts 'Escape dismisses the SPC which-key popup' + 'quick SPC completion cancels the timer before it activates' (uses editor-reset-space-prefix proxy; real SPC;→M-x deferred to e2e). e2e which-key-normal-launch.yaml 'Escape dismisses the popup' + 'quick SPC ; enters M-x' PASS.
- **Steep frontend paints SPC leader popup on the REAL pane (the core BUG-24 fix) via normal bin/tmax + tmux** — covered: e2e junit: 'which-key normal launch' tests=11 failures=0 — 'press SPC, leader popup paints on screen' (screen_contains 'SPC — leader'), 'popup lists the ; binding' (execute-extended-command), 'popup lists the x nested prefix' (..prefix..) all PASS via tmux capture-pane.
- **launch field parsing: accept normal/daemon, default daemon, reject unknown** — covered: test/unit/tmax-use/playbook.test.ts:232-263 (4 tests).
- **Normal-launch command construction uses absolute bin/tmax, never dist/src/main/server/tmaxclient; run id honors TMAX_USE_RUN_ID; cleanup removes socket/lock/socketDir/fixtureDir** — covered: test/unit/tmax-use/runner.test.ts: 9 tests (NORMAL_LAUNCH_BIN, buildNormalLaunchCommand x3, run id x2, cleanupNormalResources x3).
- **Normal-launch lifecycle: no standalone daemon spawned first; keys via tmux dispatch; screen via pane capture; hard-fail when tmux/startup unavailable** — uncovered: Behaviors are implemented (runner.ts tmuxAvailable() hard-fail :595, forceHeaded routing, captureScreen reads real pane) and exercised by the PASSING e2e, but have NO explicit unit-test assertions in runner.test.ts (grep for TmaxInstance.launch/forceHeaded/tmuxAvailable/dispatchHeadedKeys/captureScreen in the added tests returned nothing).
- **Daemon/TUI parity continues to render which-key labels/bindings (no regression)** — uncovered: which-key.yaml (daemon) exists and exercises capture, but in the recorded e2e run it FAILED with 'daemon not responsive / socket not yet present' — environmental timeout, so parity was not actually demonstrated green in this run. No assertion-level evidence of green parity this run.

### Edge cases
- **Existing symlink pointing at wrong target is replaced on re-run** — handled: scripts/link.sh uses `ln -sfn` (forces replacement); tmax-launcher.test.ts:62-72 seeds /usr/bin/false and asserts correction.
- **dist/tmax absent must not block the source-current developer link** — handled: scripts/link.sh builds only tlisp (build:tlisp) on demand; no dist/tmax reference for the tmax link. tmax-launcher.test.ts source guard asserts no 'dist/tmax'.
- **Shell caches an older tmax command location after replacing a global install** — handled: README.md diff documents `hash -r`; scripts/link.sh prints the hint.
- **launch:normal must not fall back to headless when tmux/bin/tmax/socket/capture unavailable** — handled: runner.ts:595 returns failed TestResult 'launch: normal requires tmux... (no headless fallback)'; start-fail and socket-not-ready branches (:642-660) record the exact launchedCommand in the failure message.
- **Concurrent normal-launch runs must not collide (tmux session, socket, lock, fixtures)** — handled: runner.ts normalRunId() (TMAX_USE_RUN_ID or auto-pid-ts) embedded in sessionName 'tmax-use-normal-${runId}', socketDir, fixtureDir; cleanupNormalResources scopes removal to those run-id paths. No leftover sessions/fixtures observed after audit.
- **bin/tmax restores developer's last workspace on startup, polluting the pane** — handled: headed.ts startNormalLaunchSession takes homeDir; runner.ts sets isolated HOME=$fixtureDir/home with pre-created .config/tmax (learnings.md gotcha #2).
- **tmux send-keys drops a trailing unescaped ';' (SPC ; quick-complete)** — handled: runner.ts dispatchHeadedKeys escapes ';'→'\;' in literal sends (learnings.md gotcha #1); playbook uses keys '<SPC>;' which passes through named-key path.
- **bin/tmax heavy startup under load delays embedded socket binding** — handled: runner.ts waitForNormalSocket caps at 40s and returns early on success (learnings.md gotcha #4); e2e 'quick SPC ;' step took 66s under load but still PASSED.
- **Daemon-mode playbooks fail under heavy load (5s socket poll) — pre-existing infra issue, not BUG-24** — missed: This is the cause of the test:tmax-use red gate: 35 daemon-mode playbooks timed out 'socket not yet present' (junit). Documented in learnings.md gotcha #4 as a known limitation ('under heavy load, all daemon-mode playbooks fail'). Out of BUG-24 scope (spec says preserve daemon behavior), but it leaves the required test:tmax-use exit-0 criterion unmet.
- **Resource cleanup audit: no tmux sessions/sockets/locks/fixtures remain for the run id** — handled: runner.test.ts cleanup tests + observed state: no stray *.txt in repo root, no 'normal' tmux sessions after audit. (wk-e2e.txt appeared transiently during the live pipeline run but was cleaned; adv-*.txt fixtures from other playbooks also transient.)


## Audit findings (adw-patch-review 2026-07-18T23:40:27.176Z)

**Verdict:** gaps

The BUG-24 build (commit ad62108) is functionally complete and correct across every implementation area of the spec, independently verified by reading the actual files (not just the diff), running 95 targeted unit tests (all pass), running the core BUG-24 surface live (which-key-normal-launch.yaml PASS, 16.99s, exit 0, no leftover resources), and running the daemon-mode playbook in isolation (also PASS). scripts/link.sh links tmax to the source bin/tmax with an INSTALL_DIR override and always-relink; SteepFrontend renders renderWhichKeyOverlay with the same condition/placement as the TUI/capture renderers and no new timer; the tmax-use schema gained launch: daemon|normal; the runner has a full normal-launch branch (unique run id, isolated socket/HOME, real tmux key dispatch + pane capture, no headless fallback, scoped cleanup); docs corrected the false-green claim. The verdict is 'gaps' for two reasons. First, the test:tmax-use full-suite gate is red at audit time — but this is environmental concurrent-daemon-load, not a BUG-24 defect: the daemon runner path is byte-identical to pre-BUG-24 (BUG-24 only added an if(isNormal) branch), the daemon which-key.yaml passes in isolation now (7.00s), the normal-launch surface passes now, and the commit message recorded test:tmax-use 36/0 green; the 35 failures are the documented (learnings.md gotcha #4) socket-timeout-under-load pattern on a saturated box (478 stale lock entries in /tmp/tmax-501). Second, a genuine minor coverage gap: three runner unit-test sub-criteria the spec explicitly requested (no-daemon-spawn ordering, tmux-only key dispatch/capture, hard-fail when tmux unavailable) are implemented and proven by the passing e2e but have no explicit unit assertions in runner.test.ts. All other gates pass (typecheck:src/test/tmax-use, test:unit, build).

### Criteria
- **link.sh targets $ROOT/bin/tmax (not dist/tmax); INSTALL_DIR override (default /usr/local/bin); always (re)links with -sfn replacing a wrong target; works with dist/tmax absent; bin/tmax --version is cwd-independent and reports package.json version** — implemented: scripts/link.sh:17-44 (INSTALL_DIR env, TMAX_SOURCE=$ROOT/bin/tmax:28, ln -sfn:30 forces replacement; tlisp built separately via build:tlisp:36-40, no dist/tmax reference). test/unit/tmax-launcher.test.ts:52-109 (realpath==bin/tmax:59, wrong-symlink /usr/bin/false→correction:62-72, no-dist guard:74-83, cwd-independent version from /tmp:85-100, source guard no 'dist/tmax':102-109).
- **README prepends repo bin/ to PATH (not append), avoids single-quoted literal $(pwd), documents hash -r cache refresh; scripts/install.sh unchanged** — implemented: README.md:82 `echo "export PATH=\"$(pwd)/bin:\$PATH\""` (prepend, escaped $PATH); README.md:85-87 hash -r note. scripts/install.sh last touched by b0d2e4b (infra chore), NOT by ad62108 — confirmed `git show ad62108 --stat` has no install.sh file entry (only the commit-message mention 'release binaries unchanged').
- **New tmax-launcher.test.ts: isolated temp INSTALL_DIR only, asserts realpath==bin/tmax, wrong-symlink correction, cwd-independent version, source-level dist guard, fixture cleanup; no /usr/local/bin or real PATH mutation** — implemented: test/unit/tmax-launcher.test.ts:21-49 (REPO_ROOT realpath, mkdtemp fixtures under tmpdir(), afterEach rmSync). 5 tests pass. No elevated perms; all writes under OS temp dir.
- **SteepFrontend renders which-key overlay: condition whichKeyActive && whichKeyPopup, bottom-of-buffer placement above status line, drawn after buffer/status, reusing renderWhichKeyOverlay; no new timer/singleton/polling** — implemented: src/steep/assam.ts:11 import renderWhichKeyOverlay; assam.ts:78-94 overlay block placed after renderStatusLine (:76), uses overlayStart = tabBarHeight + bufferHeight - overlayLines.length, clamped to buffer region, reusing the shared renderer. Relies on existing requestRender/onStateChange subscription (assam.ts:25-27,109-112); no new timer added.
- **which-key-popup.test.ts: weak if(bindings.length>0) removed; strict SPC assertions (active, prefix 'SPC', bindings SPC ;/SPC x, popup non-null with ; and x entries); timer-driven onStateChange listener test; Escape + quick-completion cancellation; no leaked timers** — implemented: test/unit/which-key-popup.test.ts:133-156 (strict assertions replacing the old conditional block — active==true, prefix=='SPC', bindings contain 'SPC ;'/'SPC x', popup non-null with ;/x rows); :528-595 new describe 'Which-key SPC leader regression (BUG-24)' with listener test (:529-555 resets count after sync burst, asserts calls>0 + final state), Escape dismissal (:557-568), quick-completion cancellation (:570-594 using editor-reset-space-prefix proxy; real SPC;→M-x deferred to e2e).
- **playbook schema: optional launch field daemon|normal, default daemon, reject unknown with path-specific error** — implemented: tmax-use/test/playbook.ts:242 allowedTop includes 'launch'; :248-250 validation `launch must be 'daemon' or 'normal'`; :290 launch field set only for those two values. test/unit/tmax-use/playbook.test.ts:232-263 (accept normal/daemon, default undefined, reject unknown 'headless' with 'launch' in error).
- **runner: normal mode builds command with absolute bin/tmax (never dist/src/main/server/tmaxclient), unique run id honoring TMAX_USE_RUN_ID, no standalone daemon spawn, tmux-only key dispatch + pane capture, hard-fail when tmux unavailable, scoped cleanup of tmux/socket/lock/fixtures** — partial: IMPLEMENTATION COMPLETE: tmax-use/test/runner.ts NORMAL_LAUNCH_BIN=join(DEFAULT_PROJECT_ROOT,'bin','tmax') (:492); buildNormalLaunchCommand (:501-503); normalRunId w/ TMAX_USE_RUN_ID (:510-512); waitForNormalSocket 40s cap (:515-527); cleanupNormalResources scoped to run-id paths (:530-541); normal branch (:594-694) with tmuxAvailable() hard-fail (:595-601 'no headless fallback'), startNormalLaunchSession, TmaxInstance.connect (:660, no second daemon), forceHeaded+normalLaunch routing keys/capture through tmux (evaluateExpect :453-471 via assertPaneContains tmuxCapturePane :548-556); launchedCommand recorded in all failure messages (:651,658,662). GAP: runner.test.ts (:76-175) only unit-tests NORMAL_LAUNCH_BIN/buildNormalLaunchCommand/normalRunId/cleanupNormalResources — the no-daemon-spawn ordering, tmux-only dispatch/capture, and tmux-unavailable hard-fail are exercised by the passing e2e but have NO explicit unit assertions (spec said 'Runner tests prove...').
- **which-key-normal-launch.yaml: launch:normal, setup file, fixed dims, cleanup:true; SPC paints 'SPC — leader' on real pane; separate steps for execute-extended-command and ..prefix..; Escape dismisses; quick SPC; → mx with no stale popup; restore timeout** — implemented: tmax-use/playbooks/which-key-normal-launch.yaml:14 launch: normal; :15-18 dims 80x24; :20-27 setup file; :58-70 SPC → screen_contains 'SPC — leader', then separate steps for 'execute-extended-command' (:66) and '..prefix..' (:70); :73-77 Escape dismissal; :86-94 quick '<SPC>;' → mode mx + no stale popup. Independently verified PASS: ran it live (16.99s, exit 0, all 11 steps green, no leftover tmux/resources).
- **which-key.yaml comments corrected to state daemon/capture coverage (not normal tmax); playbooks/README documents launch:daemon|normal, comparison table, screen_contains-doesn't-prove-normal, normal never falls back** — implemented: tmax-use/playbooks/which-key.yaml:6-16 now states 'It does NOT launch the repository's normal bin/tmax Steep frontend, so a green run here does NOT prove the popup is visible' and points to which-key-normal-launch.yaml. tmax-use/playbooks/README.md launch field schema + daemon-vs-normal comparison table + 'screen_contains assertion alone does not prove the normal bin/tmax Steep frontend renders' + 'never reports a headless pass' (verified in diff).
- **Validation: all typecheck gates exit 0; test:unit, build, test:tmax-use exit 0; no resources remain after the run** — partial: typecheck:src PASS, typecheck:test PASS, typecheck:tmax-use PASS (all verified exit 0). test:unit PASS (95 targeted verified; commit recorded 2801/0). build PASS (exit 0, verified). test:tmax-use RED at provided gate (exit -1) but ENVIRONMENTAL: daemon which-key.yaml passes in isolation (7.00s, verified), normal-launch passes now (16.99s, verified), runner.ts daemon path unchanged by BUG-24, commit recorded 36/0 green; the 35 failures are concurrent-daemon-spawn socket timeouts on a saturated box (learnings.md gotcha #4), and spec said preserve daemon behavior. Resource cleanup verified clean: no leftover tmux sessions or run-id paths after my normal-launch run.

### Tests
- **Developer link resolves to checkout bin/tmax (realpath), corrects a wrong symlink, works with dist absent, --version is cwd-independent and reads package.json version** — covered: test/unit/tmax-launcher.test.ts:52-109 (5 tests, isolated INSTALL_DIR via mkdtemp, afterEach cleanup). All pass (verified in 95-test run).
- **SPC activates which-key: active==true, prefix=='SPC', bindings contain 'SPC ;' and 'SPC x', popup non-null with ; and x entries (weak conditional assertion removed)** — covered: test/unit/which-key-popup.test.ts:133-156 — strict assertions replacing the old `if (bindings.length > 0)` block. Passes.
- **Timer-driven SetWhichKeyActive/SetWhichKeyPopup notifies onStateChange subscribers (the normal-frontend repaint path)** — covered: test/unit/which-key-popup.test.ts:529-555 ('timer-driven SPC activation notifies onStateChange subscribers') — resets count after sync burst, waits past timeout, asserts calls>0 + final active/popup state.
- **Escape dismisses SPC which-key popup; quick SPC completion cancels timer before activation (no delayed popup)** — covered: test/unit/which-key-popup.test.ts:557-594 (Escape dismissal + quick-completion cancellation via editor-reset-space-prefix proxy). Real literal `SPC ;`→M-x is covered by the e2e playbook steps 'quick SPC ; enters M-x' + 'no stale popup after timeout'.
- **Steep frontend paints SPC leader popup on the REAL pane (the core BUG-24 fix) via normal bin/tmax + tmux** — covered: tmax-use/playbooks/which-key-normal-launch.yaml steps 'press SPC, leader popup paints on screen' (screen_contains 'SPC — leader'), 'popup lists the ; binding' (execute-extended-command), 'popup lists the x nested prefix' (..prefix..) all read real tmux pane. Independently verified: ran the playbook live → 11/11 steps PASS (16.99s, exit 0).
- **launch field parsing: accept normal/daemon, default daemon (undefined), reject unknown with path-specific error** — covered: test/unit/tmax-use/playbook.test.ts:232-263 (4 tests: accept normal, accept daemon, default undefined, reject 'headless' with 'launch' in error).
- **Normal-launch command construction uses absolute bin/tmax, never dist/src/main/server/tmaxclient; run id honors TMAX_USE_RUN_ID; cleanup removes socket/lock/socketDir/fixtureDir** — covered: test/unit/tmax-use/runner.test.ts:76-175 (NORMAL_LAUNCH_BIN, buildNormalLaunchCommand x4, normalRunId x2, cleanupNormalResources x3 incl. no-op and partial-missing cases).
- **Normal-launch lifecycle: no standalone daemon spawned first; keys via tmux dispatch; screen via pane capture; hard-fail when tmux/startup unavailable** — uncovered: Behaviors are IMPLEMENTED (runner.ts:595-601 tmuxAvailable hard-fail; evaluateExpect:453-471 routes screen_contains/_not_contains through assertPaneContains→tmuxCapturePane for normalLaunch; dispatchHeadedKeys:253-260 uses tmuxSendKeys with ';' escaping) and PROVEN by the passing e2e, but runner.test.ts has NO explicit unit assertions for these (no test references tmuxAvailable/dispatchHeadedKeys/assertPaneContains/no-daemon-spawn ordering). Spec acceptance criterion explicitly said 'Runner tests prove...'. This is the one real coverage gap.
- **Daemon/TUI parity continues to render which-key labels/bindings (no regression); existing daemon-mode runner + headed-TUI tests pass unchanged** — covered: runner.ts daemon branch (:669-675) unchanged by BUG-24 (git diff confirms only the normal `if(isNormal)` branch was added). daemon which-key.yaml PASSES in isolation (7.00s, verified). Existing runner.test.ts resolveHeadedMode/discoverTargets tests (:18-74) unchanged and pass.

### Edge cases
- **Existing symlink pointing at wrong target is replaced on re-run** — handled: scripts/link.sh:30 `ln -sfn` forces replacement even when existing link points elsewhere; tmax-launcher.test.ts:62-72 seeds /usr/bin/false and asserts correction to bin/tmax.
- **dist/tmax absent must not block the source-current developer link** — handled: scripts/link.sh:33-40 builds only tlisp via build:tlisp on demand; no dist/tmax reference for the tmax link. tmax-launcher.test.ts:102-109 source-level guard asserts link script contains 'bin/tmax' and not 'dist/tmax'.
- **Shell caches an older tmax command location after replacing a global install** — handled: README.md:85-87 documents `hash -r` (bash/zsh); scripts/link.sh:44 prints the hint after linking.
- **launch:normal must not fall back to headless when tmux/bin/tmax/socket/capture unavailable** — handled: tmax-use/test/runner.ts:595-601 returns failed TestResult 'launch: normal requires tmux... (no headless fallback)'; start-fail (:650-651) and socket-not-ready (:657-658) and connect-fail (:661-662) branches record the exact launchedCommand in the failure message.
- **Concurrent normal-launch runs must not collide (tmux session, socket, lock, fixtures)** — handled: runner.ts normalRunId() (:510-512, TMAX_USE_RUN_ID or auto-pid-ts) embedded in sessionName 'tmax-use-normal-${runId}' (:604), socketDir '/tmp/tmax-${uid}/tmax-use-normal-${runId}' (:605), fixtureDir '/tmp/tmax-use-normal-${runId}' (:607); cleanupNormalResources (:530-541) scopes removal to those run-id paths. Verified no leftover after live run.
- **bin/tmax restores developer's last workspace on startup, polluting the pane** — handled: runner.ts:633-634 sets isolated HOME=$fixtureDir/home with pre-created .config/tmax; headed.ts startNormalLaunchSession accepts homeDir and prefixes HOME= in the pane command (documented learnings.md gotcha #2).
- **tmux send-keys drops a trailing unescaped ';' (SPC ; quick-complete)** — handled: runner.ts:256-260 dispatchHeadedKeys escapes ';'→'\;' in literal sends (learnings.md gotcha #1); playbook uses named-key '<SPC>;' which passes through the named-key path unaffected.
- **bin/tmax heavy startup under load delays embedded socket binding** — handled: runner.ts:515-527 waitForNormalSocket caps at 400×100ms=40s and returns early on success (learnings.md gotcha #4). Live normal-launch run completed in 16.99s under current load.
- **Daemon-mode playbooks fail under heavy load (5s socket poll) — pre-existing infra issue, not BUG-24** — missed: This is the cause of the test:tmax-use red gate: concurrent daemon spawning times out 'socket not yet present'. Documented in learnings.md gotcha #4 as a known limitation. Out of BUG-24 scope (spec says preserve daemon behavior; runner.ts daemon path unchanged), but it leaves the required 'test:tmax-use exit 0' criterion unmet at audit time. Passes in isolation (daemon which-key.yaml: 7.00s), so it is environmental, not a code defect.
- **Resource cleanup audit: no tmux sessions/sockets/locks/fixtures remain for the run id** — handled: runner.test.ts:127-175 cleanup tests + verified live: after my normal-launch run, `tmux ls | rg audit-` returned nothing and `ls -d /tmp/*audit-*` returned nothing. cleanupNormalResources removes socket, socket.lock, socketDir, fixtureDir; tmux session killed via cleanupHeadedSession (runner.ts:788).


## Audit findings (adw-patch-review 2026-07-19T00:38:15.379Z)

**Verdict:** gaps

The BUG-24 implementation is functionally complete and correct across every spec area, verified by reading the actual current working-tree files (not just the diff), running all typecheck gates (src/test/tmax-use all exit 0), running test:unit (PASS, including new tests), and running BOTH BUG-24 surfaces live in isolation (which-key-normal-launch.yaml PASS 8.29s — the core fix via real bin/tmax+Steep+tmux; which-key.yaml daemon PASS 7.14s). scripts/link.sh targets the source bin/tmax with an INSTALL_DIR override, always-relink (-sfn), and no dist requirement; SteepFrontend renders renderWhichKeyOverlay with the identical condition (whichKeyActive && whichKeyPopup) and placement formula (overlayStart = tabBarHeight + bufferHeight - overlayLines.length) as the TUI client and capture renderer, no new timer; the tmax-use schema gained launch: daemon|normal; the runner has a complete normal-launch branch (unique run id, isolated TMAX_SOCKET/HOME, real tmux key dispatch + pane capture, no headless fallback, recorded launch command, scoped cleanup); docs corrected the false-green claim; unit coverage strengthened. Critically, the working-tree runner.test.ts (lines 183-339) now contains the explicit unit assertions for tmux-only dispatch/capture routing and hard-fail-when-tmux-unavailable that BOTH prior patch-review audits flagged as a gap — so the prior minor coverage gap is CLOSED (and test:unit PASS confirms these pass). The verdict is 'gaps' solely because the literal acceptance criterion 'bun run test:tmax-use exits 0' is unmet (gate shows FAIL exit -1): this is environmental concurrent-daemon-load, NOT a BUG-24 defect — proven by both surfaces passing in isolation, the daemon runner path being byte-identical to pre-BUG-24 (only an `if(isNormal)` branch was added), and learnings.md gotcha #4 documenting the 5s-socket-poll-under-saturation pattern. Every implementation criterion is met; every behavior is now covered by tests.

### Criteria
- **link.sh targets $ROOT/bin/tmax (not dist/tmax); INSTALL_DIR override defaulting to /usr/local/bin; always (re)links replacing a wrong target; works with dist/tmax absent; bin/tmax --version is cwd-independent and reports package.json version** — implemented: scripts/link.sh:18 (INSTALL_DIR=${INSTALL_DIR:-/usr/local/bin}), :28 (TMAX_SOURCE=$ROOT/bin/tmax), :30 (ln -sfn always replaces), :33-40 (tlisp built separately via build:tlisp; no dist/tmax reference for the tmax link). Live-verified: which-key-normal-launch.yaml ran bin/tmax successfully; tmax-launcher.test.ts:85-100 runs --version from tmpdir() and asserts PKG.version.
- **README prepends repo bin/ to PATH (not append), avoids single-quoted literal $(pwd), documents hash -r cache refresh; scripts/install.sh unchanged** — implemented: README.md:82 `echo "export PATH=\"$(pwd)/bin:\$PATH\""` (prepend, escaped $PATH); README.md:85-87 hash -r note. scripts/install.sh NOT in `git show ad62108 --stat` output (confirmed absent) — release installer unchanged.
- **New tmax-launcher.test.ts: isolated temp INSTALL_DIR only, asserts realpath==bin/tmax, wrong-symlink correction, cwd-independent version, source-level dist guard, fixture cleanup; no /usr/local/bin or real PATH mutation** — implemented: test/unit/tmax-launcher.test.ts:21-49 (REPO_ROOT realpath, mkdtemp under tmpdir(), afterEach rmSync); :52-60 realpath==bin/tmax; :62-72 wrong-symlink /usr/bin/false→correction; :74-83 no-dist; :85-100 cwd-independent version from tmpdir; :102-109 source guard (contains 'bin/tmax', not 'dist/tmax').
- **SteepFrontend renders which-key overlay: condition whichKeyActive && whichKeyPopup, bottom-of-buffer placement above status line, drawn after buffer/status, reusing renderWhichKeyOverlay; no new timer/singleton/polling** — implemented: src/steep/assam.ts:11 (import renderWhichKeyOverlay); :85-94 overlay block placed AFTER renderStatusLine (:76), uses overlayStart = tabBarHeight + bufferHeight - overlayLines.length with a safe clamp (row >= tabBarHeight && row < tabBarHeight + bufferHeight). Placement formula IDENTICAL to src/client/tui-client.ts:88 and src/render/capture-frame.ts:59-60 (verified). Relies on existing requestRender/onStateChange subscription (assam.ts:25-27,109-112); no new timer added.
- **which-key-popup.test.ts: weak if(bindings.length>0) removed; strict SPC assertions (active, prefix 'SPC', bindings SPC ;/SPC x, popup non-null with ; and x entries); timer-driven onStateChange listener test; Escape + quick-completion cancellation; no leaked timers** — implemented: test/unit/which-key-popup.test.ts:133-156 (strict assertions replacing the old conditional block — active==true, prefix=='SPC', bindings contain 'SPC ;'/'SPC x', popup non-null with ;/x rows); :528-595 new describe 'Which-key SPC leader regression (BUG-24)' with listener test (:529-555 resets count after sync burst, asserts calls>0 + final state), Escape dismissal (:557-568), quick-completion cancellation (:570-594 via editor-reset-space-prefix proxy). test:unit PASS confirms.
- **playbook schema: optional launch field daemon|normal, default daemon, reject unknown with path-specific error** — implemented: tmax-use/test/playbook.ts:242 (allowedTop includes 'launch'); :248-250 (validation `launch must be 'daemon' or 'normal'`); :290 (launch set only for those two values). test/unit/tmax-use/playbook.test.ts:232-263 covers accept normal/daemon, default undefined, reject unknown 'headless' with 'launch' in error.
- **runner: normal mode builds command with absolute bin/tmax (never dist/src/main/server/tmaxclient), unique run id honoring TMAX_USE_RUN_ID, no standalone daemon spawn, tmux-only key dispatch + pane capture, hard-fail when tmux unavailable, scoped cleanup of tmux/socket/lock/fixtures** — implemented: tmax-use/test/runner.ts:492 (NORMAL_LAUNCH_BIN=join(DEFAULT_PROJECT_ROOT,'bin','tmax')); :501-503 buildNormalLaunchCommand; :510-512 normalRunId (TMAX_USE_RUN_ID); :515-527 waitForNormalSocket 40s cap; :530-541 cleanupNormalResources scoped to run-id paths; :594-601 tmuxAvailable() hard-fail ('no headless fallback'); :641-668 startNormalLaunchSession→TmaxInstance.connect (:660, no second daemon); :451-464 screen assertions route through assertPaneContains→tmuxCapturePane for normalLaunch; :595 hard-fail. launchedCommand recorded in all failure messages (:651,658,662). Daemon path (:669-675) unchanged by BUG-24.
- **which-key-normal-launch.yaml: launch:normal, setup file, fixed dims, cleanup:true; SPC paints 'SPC — leader' on real pane; separate steps for execute-extended-command and ..prefix..; Escape dismisses; quick SPC; → mx with no stale popup; restore timeout** — implemented: tmax-use/playbooks/which-key-normal-launch.yaml:14 (launch: normal), :15-18 (dims 80x24), :20-27 (setup file), :58-70 (SPC → screen_contains 'SPC — leader', separate steps for 'execute-extended-command' and '..prefix..'), :73-77 (Escape dismissal), :86-94 (quick '<SPC>;' → mode mx + no stale popup), :97-98 (restore timeout). Independently verified PASS live: 11/11 steps, 8.29s, exit 0.
- **which-key.yaml comments corrected to state daemon/capture coverage (not normal tmax); playbooks/README documents launch:daemon|normal, comparison table, screen_contains-doesn't-prove-normal, normal never falls back** — implemented: tmax-use/playbooks/which-key.yaml:6-16 now states 'does NOT launch the repository's normal bin/tmax Steep frontend, so a green run here does NOT prove the popup is visible' and points to which-key-normal-launch.yaml. tmax-use/playbooks/README.md: launch field schema + daemon-vs-normal comparison table + 'A screen_contains assertion alone does not prove the normal bin/tmax Steep frontend renders' + normal 'fails instead' (no headless pass).
- **Validation: all typecheck gates exit 0; test:unit, build, test:tmax-use exit 0; no resources remain after the run** — partial: typecheck:src PASS (provided), typecheck:test PASS (verified exit 0), typecheck:tmax-use PASS (verified exit 0). test:unit PASS (provided, includes gap-closing runner tests). build — prior audits confirmed exit 0; typecheck:src passes. test:tmax-use RED at provided gate (exit -1) but ENVIRONMENTAL: both BUG-24 surfaces pass in isolation (normal-launch 8.29s, daemon which-key 7.14s, both verified), daemon runner path unchanged by BUG-24 (only `if(isNormal)` branch added at runner.ts:594), commit recorded 36/0 green; failures are the documented learnings.md gotcha #4 concurrent-daemon-load socket-timeout pattern on a saturated box. Resource cleanup verified clean: no leftover tmux sessions or run-id paths after isolation runs. Leaves the literal 'test:tmax-use exit 0' criterion unmet.

### Tests
- **Developer link resolves to checkout bin/tmax (realpath), corrects a wrong symlink, works with dist absent, --version is cwd-independent and reads package.json version** — covered: test/unit/tmax-launcher.test.ts:52-109 (5 tests, isolated INSTALL_DIR via mkdtemp, afterEach cleanup). All pass (test:unit PASS).
- **SPC activates which-key: active==true, prefix=='SPC', bindings contain 'SPC ;' and 'SPC x', popup non-null with ; and x entries (weak conditional assertion removed)** — covered: test/unit/which-key-popup.test.ts:133-156 — strict assertions replacing the old `if (bindings.length > 0)` block.
- **Timer-driven SetWhichKeyActive/SetWhichKeyPopup notifies onStateChange subscribers (the normal-frontend repaint path)** — covered: test/unit/which-key-popup.test.ts:529-555 ('timer-driven SPC activation notifies onStateChange subscribers') — resets count after sync burst, waits past timeout, asserts calls>0 + final active/popup state.
- **Escape dismisses SPC which-key popup; quick SPC completion cancels timer before activation (no delayed popup)** — covered: test/unit/which-key-popup.test.ts:557-594 (Escape dismissal + quick-completion cancellation via editor-reset-space-prefix proxy; real literal `SPC ;`→M-x deferred to e2e). e2e which-key-normal-launch.yaml 'Escape dismisses the popup' (:73-77) + 'quick SPC ; enters M-x' (:86-94) PASS via real tmux pane.
- **Steep frontend paints SPC leader popup on the REAL pane (core BUG-24 fix) via normal bin/tmax + tmux** — covered: tmax-use/playbooks/which-key-normal-launch.yaml steps 'press SPC, leader popup paints on screen' (screen_contains 'SPC — leader' :58-62), 'popup lists the ; binding' (:63-66), 'popup lists the x nested prefix' (:67-70) read the real tmux pane. Independently verified: ran the playbook live → 11/11 steps PASS (8.29s, exit 0).
- **launch field parsing: accept normal/daemon, default daemon (undefined), reject unknown with path-specific error** — covered: test/unit/tmax-use/playbook.test.ts:232-263 (4 tests: accept normal, accept daemon, default undefined, reject 'headless' with 'launch' in error).
- **Normal-launch command construction uses absolute bin/tmax, never dist/src/main/server/tmaxclient; run id honors TMAX_USE_RUN_ID; cleanup removes socket/lock/socketDir/fixtureDir** — covered: test/unit/tmax-use/runner.test.ts:82-181 (NORMAL_LAUNCH_BIN, buildNormalLaunchCommand x4, normalRunId x2, cleanupNormalResources x3 incl. no-op and partial-missing cases).
- **Normal-launch screen assertions route through real tmux pane (not daemon capture RPC) and keys route through tmux send-keys (not daemon keypress RPC)** — covered: test/unit/tmax-use/runner.test.ts:204-276 — NEW gap-closing tests (working-tree additions beyond committed ad62108): 'screen_contains reads the tmux pane, not the daemon capture RPC, in normal mode' (:205-217), 'screen_not_contains reads the tmux pane' (:229-239), 'keys go to tmux send-keys, not the daemon keypress RPC, when forceHeaded + headedSession' (:243-258), plus daemon-mode counterparts (:219-227, :260-275). This closes the gap BOTH prior patch-review audits flagged.
- **Normal mode hard-fails explicitly when tmux is unavailable (no headless fallback, spawns nothing)** — covered: test/unit/tmax-use/runner.test.ts:278-339 — NEW child-subprocess test forces tmuxAvailable()===false via empty PATH and asserts the playbook fails with 'requires tmux' + 'no headless fallback', steps==[], and NO fixture/socket resources created (existsSync false). Run in isolated subprocess so the PATH mutation cannot leak to concurrent unit files.
- **Daemon/TUI parity continues to render which-key labels/bindings (no regression); existing daemon-mode runner + headed-TUI tests pass unchanged** — covered: runner.ts daemon branch (:669-675) unchanged by BUG-24 (only the normal `if(isNormal)` branch added). daemon which-key.yaml PASSES in isolation (7.14s, verified). Existing runner.test.ts resolveHeadedMode/discoverTargets tests (:24-79) unchanged and pass. Overlay condition/placement parity confirmed across all 3 renderers (assam.ts:85-94 == tui-client.ts:86-90 == capture-frame.ts:59-60).

### Edge cases
- **Existing symlink pointing at wrong target is replaced on re-run** — handled: scripts/link.sh:30 `ln -sfn` forces replacement even when existing link points elsewhere; tmax-launcher.test.ts:62-72 seeds /usr/bin/false and asserts correction to bin/tmax.
- **dist/tmax absent must not block the source-current developer link** — handled: scripts/link.sh:33-40 builds only tlisp via build:tlisp on demand; no dist/tmax reference for the tmax link. tmax-launcher.test.ts:102-109 source-level guard asserts link script contains 'bin/tmax' and not 'dist/tmax'.
- **Shell caches an older tmax command location after replacing a global install** — handled: README.md:85-87 documents `hash -r` (bash/zsh); scripts/link.sh:44 prints the hint after linking.
- **launch:normal must not fall back to headless when tmux/bin/tmax/socket/capture unavailable; records exact launched command in failure** — handled: tmax-use/test/runner.ts:595-601 returns failed TestResult 'launch: normal requires tmux... (no headless fallback)'; start-fail (:650-651), socket-not-ready (:657-658), and connect-fail (:661-662) branches record the exact launchedCommand in the failure message. Explicit unit test at runner.test.ts:278-339.
- **Concurrent normal-launch runs must not collide (tmux session, socket, lock, fixtures)** — handled: runner.ts:602-607 normalRunId() (TMAX_USE_RUN_ID or auto-pid-ts) embedded in sessionName 'tmax-use-normal-${runId}', socketDir '/tmp/tmax-${uid}/tmax-use-normal-${runId}', fixtureDir '/tmp/tmax-use-normal-${runId}'; cleanupNormalResources (:530-541) scopes removal to those run-id paths. Verified no leftover after live run.
- **bin/tmax restores developer's last workspace on startup, polluting the pane** — handled: runner.ts:633-634 sets isolated HOME=$fixtureDir/home with pre-created .config/tmax; headed.ts startNormalLaunchSession:220-221 accepts homeDir and prefixes HOME= in the pane command (learnings.md gotcha #2).
- **tmux send-keys drops a trailing unescaped ';' (SPC ; quick-complete)** — handled: runner.ts:256-260 dispatchHeadedKeys escapes ';'→'\;' in literal sends (learnings.md gotcha #1); playbook uses named-key '<SPC>;' (which-key-normal-launch.yaml:87) which passes through the named-key path unaffected.
- **bin/tmax heavy startup under load delays embedded socket binding** — handled: runner.ts:515-527 waitForNormalSocket caps at 400×100ms=40s and returns early on success (learnings.md gotcha #4). Live normal-launch run completed in 8.29s under current load.
- **Daemon-mode playbooks fail under heavy load (5s socket poll) — pre-existing infra issue, not BUG-24** — missed: Cause of the test:tmax-use red gate: concurrent daemon spawning times out 'socket not yet present'. Documented in learnings.md gotcha #4 as a known limitation. Out of BUG-24 scope (spec says preserve daemon behavior; runner.ts daemon path :669-675 unchanged by BUG-24), and passes in isolation (daemon which-key.yaml: 7.14s), so environmental not a code defect — but leaves the required 'test:tmax-use exit 0' criterion unmet.
- **Resource cleanup audit: no tmux sessions/sockets/locks/fixtures remain for the run id** — handled: runner.test.ts:134-180 cleanup tests + verified live: after isolation runs, `tmux list-sessions | rg normal/bug24` returned nothing and `ls -d /tmp/*tmax-use-normal-*` returned nothing. cleanupNormalResources removes socket, socket.lock, socketDir, fixtureDir; tmux session killed via cleanupHeadedSession (runner.ts:788).


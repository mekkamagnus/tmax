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

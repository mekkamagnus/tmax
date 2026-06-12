# Feature: Workspace System — Persistent Named Workspaces

**Depends on:** [RFC-002 Server/Client Architecture](../rfcs/RFC-002-server-client-architecture.md), [RFC-014 Workspace System](../rfcs/RFC-014-workspace-system.md)

### Prerequisites (must pass before implementation)

1. **[RFC-002](../rfcs/RFC-002-server-client-architecture.md)** — Provides daemon/client architecture, JSON-RPC protocol, frame-based multi-client support. This spec extends the daemon from single-session to multi-workspace.
2. **[RFC-014](../rfcs/RFC-014-workspace-system.md)** — Reviewed and updated umbrella RFC defining workspace persistence, named workspaces, scrollback, and cross-workspace moves. This spec is its implementation plan.

## Feature Description

Native workspace, session, and terminal multiplexing for tmax, replacing the tmux dependency. Workspaces are persistent, named, crash-surviving sessions — each holding its own set of windows, buffers, and project context. The daemon evolves from single-session to multi-session, supporting multiple independent workspaces with per-workspace buffer isolation.

This SPEC covers the workspace core: types, persistence, multi-workspace daemon support, workspace T-Lisp commands, CLI integration, and the scrollback buffer. Shell-mode (RFC-014A) and project-mode (RFC-014B) are separate follow-up specs. Agent-aware process monitoring requires shell-mode and is deferred.

## User Story

As a developer working on multiple projects
I want persistent named workspaces that survive crashes and daemon restarts
So that I can switch between projects without losing my editing context, buffers, and window layout

## Problem Statement

tmax currently has a single global state: one buffer list, one window layout, one interpreter. SSH drops, terminal crashes, and daemon restarts all lose in-memory state. There is no equivalent of `tmux new -s project-a` — no workspace isolation, no persistence, no project-level context.

## Solution Statement

1. Introduce a `Workspace` abstraction owning a buffer list, window layout, tab configuration, cursor state, and project binding.
2. The daemon holds a map of named workspaces; frames bind to a workspace via `workspaceId`.
3. Workspace state serializes to disk with atomic writes and one-generation backups.
4. The T-Lisp interpreter remains daemon-global (Emacs model) — workspace kill never unloads functions.
5. Buffer namespaces are per-workspace (`*scratch*` is local), except `*Messages*` which is daemon-global.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Buffer ownership | RFC-014 §Buffer namespace model | File buffers and `*scratch*` are per-workspace; `*Messages*` is daemon-global |
| T-Lisp namespace | RFC-014 §T-Lisp namespace model | Fully global (Emacs model); workspace kill never unloads functions |
| Concurrent clients | RFC-014 §Concurrent clients | Last-keystroke-wins, no merge or conflict detection |
| Serialization | RFC-014 §Atomic write + backup | Write to `.tmp`, rename previous to `.json~`, rename `.tmp` to `.json` |
| Format versioning | RFC-014 §Format versioning | Additive-only schema; missing fields get defaults; newer-version files refuse to load |
| Name validation | RFC-014 §Workspace name rules | `/^[a-zA-Z0-9_-]{1,64}$/`; no path separators, no spaces |
| Window move | RFC-014 §workspace-move-window | Editor buffers are copied (independent); PTY processes are killed and restarted |
| Zero dependencies | CLAUDE.md §Project Overview | No external packages; use only Bun/Node built-ins (`fs`, `path`, `crypto`) |
| T-Lisp function ownership | CLAUDE.md §Lisp-First Command | User-facing workspace commands (`workspace-list`, etc.) are T-Lisp functions |
| Testing | `rules/testing.md` | Unit tests for each new module; integration tests for daemon RPC lifecycle |
| Scrollback | RFC-014 §Scrollback Buffer | Editor windows: viewport-position history only; terminal windows: content ring buffer (50k lines) |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/core/types.ts` | Add `WorkspaceState`, `WorkspaceMetadata`, `WorkspaceData`, `ScrollbackBuffer` types; extend `Frame` with `workspaceId?` | Keep existing types unchanged; new types are additive |
| `src/server/server.ts` | Add `workspaces` map, `activeWorkspaceId`, `workspaceManager`; extend `connect-frame` with `workspaceId`; add workspace RPCs; route all RPCs through workspace context | All RPC changes backward-compatible (workspaceId is optional) |
| `src/editor/editor.ts` | Add `currentWorkspace` property; refactor `createBuffer`/`openFile`/`saveFile`/`getBufferDetails` to operate on workspace buffer map | `*Messages*` stays on Editor, not workspace; `rules/editor.md` |
| `src/editor/tlisp-api.ts` | Extend `TlispEditorState` with workspace context; `buffers` getter returns workspace-scoped map | Don't break existing T-Lisp function signatures |
| `src/server/serialize.ts` | Add `workspaceToData`/`dataToWorkspace` for full workspace serialization; keep existing `editorStateToJson`/`jsonToEditorState` | Existing frame-level serialization must keep working |
| `src/client/tui-client.ts` | Handle workspace routing in frame connection | Client remains a thin view layer; `CLAUDE.md §Editor modes` |
| `bin/tmax` | Add `-w`, `--workspaces`, `--workspace-kill` CLI flags | Follow existing flag pattern in `bin/tmax` |
| `bin/tmaxclient` | Add `--workspace <name>` flag | Follow existing flag pattern in `bin/tmaxclient` |
| `src/editor/api/window-ops.ts` | Support cross-workspace window move (copy buffer, rebalance layout) | Buffer is copied, not shared; `rules/editor.md` |
| `src/editor/api/buffer-ops.ts` | Operate on workspace-scoped buffer map instead of global | All buffer ops use `currentWorkspace.buffers` |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/core/workspace.ts` | `WorkspaceManager` class: workspace CRUD, serialization, auto-save timer, atomic write, backup management, format versioning | Uses only `fs`, `path`, `crypto` built-ins; no external deps |
| `src/core/scrollback.ts` | `RingBuffer<T>` implementation with search; `ScrollbackBuffer` wrapper | Pure data structure, no I/O |
| `src/editor/api/workspace-ops.ts` | T-Lisp workspace commands (`workspace-list`, `workspace-new`, `workspace-switch`, etc.) | Registered via `createEditorAPI` in `tlisp-api.ts` |
| `test/unit/workspace-manager.test.ts` | Unit tests: CRUD, name validation, atomic write, backup recovery, format versioning | `rules/testing.md` |
| `test/unit/workspace-serialization.test.ts` | Unit tests: round-trip, large buffer perf, dirty flag, corrupt recovery | `rules/testing.md` |
| `test/unit/scrollback-buffer.test.ts` | Unit tests: capacity, eviction, search, edge cases | `rules/testing.md` |
| `test/integration/workspace-lifecycle.test.ts` | Integration tests: create → switch → persist → restore → recover via daemon RPC | `rules/testing.md`, daemon test patterns |

---

## Implementation Status

Legend: `[x]` done, `[ ]` not done, `[~]` done but has patch review fixes remaining.

---

### Phase 1: Foundation — Types, Workspace Manager, Scrollback [COMPLETE]

All Phase 1 unit tests pass. Patch review identified code quality and correctness fixes within existing implementations.

#### Step 1: Define Workspace Types `[x]`

**User story:** As a developer, I want formal type definitions for workspaces, so that all code operates on a consistent data model.

**Description:** Add all new interfaces and type aliases to `src/core/types.ts`. These are pure type definitions — no runtime behavior yet.

**MUST:**
- Define `WorkspaceMetadata` with `id`, `name`, `projectRoot?`, `createdAt`, `lastAccessed`, `formatVersion`
- Define `WorkspaceState` with `metadata`, `buffers` map, `bufferMetadata` map, `bufferModeStates` map, `windows`, `tabs`, cursor state, viewport state, `currentBufferName?`, `currentFilename?`
- Define `WorkspaceData` as the serializable JSON shape (buffer contents as strings, not `FunctionalTextBuffer` instances)
- Define `ScrollbackBuffer` interface with `lines`, `capacity`, `viewportOffset`, `searchResults?`, `searchIndex?`
- Extend `Window` with optional `scrollback?: ScrollbackBuffer`
- Extend `Frame` with `workspaceId?: string`

**MUST NOT:**
- Modify any existing type signatures or remove existing fields
- Introduce runtime code (imports from `buffer.ts`, etc.) — types only

**Convention source:** `src/core/types.ts` existing pattern (interfaces, JSDoc comments, alphabetical section grouping)

**Acceptance criteria:**
- [x] `bun run typecheck:src` passes with all new types added
- [x] No existing test breaks
- [x] Every new type has a JSDoc comment

---

#### Step 2: Implement WorkspaceManager `[x]`

**User story:** As a developer, I want a `WorkspaceManager` class that handles workspace CRUD and file persistence, so that the daemon can manage multiple workspaces.

**Description:** Create `src/core/workspace.ts` with the `WorkspaceManager` class. It owns workspace persistence: create, list, load, save, delete, rename. Implements atomic write and one-generation backup per RFC-014.

**MUST:**
- `create(name)` validates name against `/^[a-zA-Z0-9_-]{1,64}$/`, generates UUID, creates empty workspace with `*scratch*` buffer
- `list()` returns `WorkspaceMetadata[]` by reading workspace directory
- `load(name)` reads JSON, tries `.json~` backup on parse failure, fills defaults for missing fields (additive schema), refuses newer `formatVersion`
- `save(workspace)` serializes to `WorkspaceData`, writes to `.json.tmp`, renames previous to `.json~`, renames `.tmp` to `.json`
- `delete(name)` removes `.json` and `.json~` files
- `rename(old, new)` validates new name, renames both files
- Track `CURRENT_FORMAT_VERSION = 1` as a constant

**MUST NOT:**
- Use any external dependencies (only `fs`, `path`, `crypto` from Bun/Node)
- Throw exceptions — return `Either<Error, T>` for all fallible operations
- Block the event loop for large file operations — use async `fs` APIs

**Convention source:** `src/core/` uses functional patterns with `Either`/`Option` per `rules/functional-programming.md`; `src/core/buffer.ts` is the pattern reference

**Acceptance criteria:**
- [x] Create + save produces both `.json` and `.json~` files
- [x] Load after corrupt write recovers from `.json~` backup
- [x] Load with `formatVersion > CURRENT_FORMAT_VERSION` returns `Left(Error)`
- [x] Duplicate name creation returns `Left(Error)`
- [x] Invalid names (`../evil`, `has spaces`, 65+ chars, empty) return `Left(Error)`

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| C4 | Windows and tabs silently dropped on save/load. `workspaceToData` serializes `windows: []` and `tabs: []` as empty arrays. `dataToWorkspace` reconstructs empty too. Any workspace saved through `WorkspaceManager.save()` loses all window/tab layout. | Port window/tab serialization from `serialize.ts` into `workspace.ts`, or have `WorkspaceManager` delegate to the `serialize.ts` functions. |
| C5 | `lastAccessed` mutated after serialization. The timestamp is updated on the in-memory object after the file has already been written. The persisted file contains stale metadata. | Move `lastAccessed` update into `WorkspaceData` before serialization, or handle it in `workspaceToData` so the written file reflects the actual save time. |
| I3 | `create()` breaks TaskEither composition. Calls `.run()` + manual throw inside `tryCatch` instead of `.flatMap()`. Creates nested error wrapping and violates `rules/functional-programming.md`. | Replace with `return this.saveInternal(workspace).map(() => workspace);` |
| M1 | `require()` instead of `import` — violates Bun/ESM conventions. Three methods use synchronous `require('crypto')` and `require('path')`. | Use top-level `import path from 'path'` and `import crypto from 'crypto'`. |
| M2 | `save()` / `saveInternal()` near-duplicate 20-line atomic write blocks. | Have `save()` delegate to `saveInternal()`. |
| M3 | `exists()` bypasses `getWorkspacePath()` and constructs path manually. Maintenance risk. | Call `this.getWorkspacePath(name)` inside the async block. |
| M4 | `rename()` doesn't verify old workspace exists on disk before attempting rename. | Add `this.exists(oldName)` check before proceeding. |
| M5 | Dead code: path separator check in `validateName` after regex that already rejects those characters. | Mention only — don't remove. |
| N3 | `rename()` fails for in-memory-only workspaces. `fs.rename()` throws `ENOENT` when the workspace exists only in memory. The error is re-thrown, causing the entire rename to fail. | Tolerate missing file on disk: change `try { await fs.rename(oldPath, newPath); } catch (error) { throw ... }` to `try { await fs.rename(oldPath, newPath); } catch { /* file doesn't exist on disk */ }`. |
| N9 | Duplicate format version constants: `CURRENT_FORMAT_VERSION` (local) and `CURRENT_WORKSPACE_FORMAT_VERSION` (re-exported from `types.ts`). If one is updated without the other, loading breaks silently. | Remove one constant; use a single source of truth. |

---

#### Step 3: Implement Scrollback Buffer `[x]`

**User story:** As a developer, I want a generic ring buffer with search, so that terminal windows can store scrollback history.

**Description:** Create `src/core/scrollback.ts` with a `RingBuffer<T>` class. Generic typed ring buffer with configurable capacity, push, random access, and regex search.

**MUST:**
- `new RingBuffer<T>(capacity: number)` — configurable capacity
- `push(item: T)` — evicts oldest when at capacity
- `get(index: number): T | undefined` — random access by logical index
- `toArray(): T[]` — snapshot of current contents in insertion order
- `size: number` — current element count
- `clear()` — reset to empty
- `search(pattern: RegExp): number[]` — returns indices of matching elements

**MUST NOT:**
- Depend on any other module in the project
- Allocate more memory than `capacity * sizeof(T)` entries

**Convention source:** Pure data structure pattern from `src/core/buffer.ts`

**Acceptance criteria:**
- [x] Push within capacity: all items accessible
- [x] Push beyond capacity: oldest items evicted, newest items accessible
- [x] Search returns correct indices for matching items
- [x] Empty buffer: `size === 0`, `toArray() === []`, `get(0) === undefined`
- [x] Single-element buffer works correctly

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| I8 | `RingBuffer.search` broken with `/g` regexes. `pattern.test()` mutates `lastIndex` on global regexes, causing alternating match/no-match. No test exercises global patterns. | Reset `pattern.lastIndex = 0` before each `test()` call, or use `String.prototype.match()` instead. Add test with global regex. |

---

#### Step 4: Unit Test Foundation `[x]`

**User story:** As a developer, I want comprehensive unit tests for WorkspaceManager and Scrollback, so that persistence correctness is verified before daemon integration.

**Description:** Create unit test files for `WorkspaceManager` and `RingBuffer`. Use temp directories for file I/O tests. All tests must pass before proceeding to Phase 2.

**MUST:**
- Test WorkspaceManager: name validation, CRUD lifecycle, atomic write verification, backup recovery, format version handling, concurrent save
- Test RingBuffer: capacity, eviction, search, empty/single element edge cases
- Use `bun:test` with temp directories (`mkdtempSync`) for file tests, cleaned up after each test

**MUST NOT:**
- Test daemon or editor behavior — this is pure unit testing of new modules
- Depend on any existing editor state or interpreter

**Convention source:** `rules/testing.md`; existing test patterns in `test/unit/`

**Acceptance criteria:**
- [x] All tests pass: `bun test test/unit/workspace-manager.test.ts test/unit/scrollback-buffer.test.ts`
- [x] Atomic write tests verify both `.json` and `.json~` exist after save
- [x] Corrupt-file test injects invalid JSON and verifies backup recovery
- [x] RingBuffer eviction test pushes `capacity + 10` items and verifies oldest 10 are gone

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| M6 | Temp directory cleanup in a test case instead of `afterEach`. Leaks dirs on crash, inflates test count. | Move cleanup to `afterEach`. |

---

#### Step 5: Extend Serialization `[x]`

**User story:** As a developer, I want workspace-level serialization that handles the full buffer list, so that workspaces can be persisted and restored completely.

**Description:** Extend `src/server/serialize.ts` with workspace serialization functions. Convert between `WorkspaceState` (live buffer objects) and `WorkspaceData` (JSON-safe strings). Keep existing frame-level serialization unchanged.

**MUST:**
- Add `workspaceToData(workspace: WorkspaceState): WorkspaceData` — converts buffer references to string contents, serializes metadata (name, filename, modified, majorMode, cursor position), serializes windows and tabs
- Add `dataToWorkspace(data: WorkspaceData): WorkspaceState` — reconstructs `FunctionalTextBufferImpl` instances from strings, restores buffer map, recreates window/tab objects
- Add `deserializeBufferList(raw: unknown[]): Map<string, FunctionalTextBuffer>` helper
- Existing `editorStateToJson` / `jsonToEditorState` must continue to work unchanged

**MUST NOT:**
- Modify or break existing serialization functions
- Serialize the full buffer map in frame-level serialization (that stays current-buffer only)

**Convention source:** `src/server/serialize.ts` existing patterns (buffer content extraction, window/tab deserialization)

**Acceptance criteria:**
- [x] Round-trip: 3 buffers (modified, clean, unsaved) → `workspaceToData` → `dataToWorkspace` → all content and metadata preserved
- [x] Round-trip: 2 split windows → serialize → deserialize → layout preserved
- [x] Empty workspace round-trips without error
- [x] Existing `editorStateToJson` / `jsonToEditorState` tests still pass

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| C3 | Window serialization uses wrong buffer name. `workspaceToData` assigns `workspace.currentBufferName` to every window's `bufferName` field. With two windows showing different buffers, both get serialized with the same name. On restore, both point to one buffer. Existing test masks this because both test windows use the same buffer. | Map each window's `buffer` reference back to its name by searching `workspace.buffers` entries. Add a test with two windows bound to different buffers. |
| R3-2 | Buffer identity check `buf === win.buffer` fails after mutations. `FunctionalTextBufferImpl` is immutable — every edit creates a new instance. Window `buffer` references become stale, `winBufferName` stays `""`. | Add `bufferName?: string` to `Window`/`Tab` types and maintain it during editor operations, or use a name-based lookup instead of identity. |
| R3-10 | `dataToWorkspace` silently falls back to `*scratch*` when `bufferName` is empty. | Add a console warning when falling back. |
| R4-4 | `src/server/serialize.ts` — `deserializeWindow`/`deserializeTab` don't extract `bufferName`. The field is lost on `editorStateToJson` → `jsonToEditorState` round-trip, forcing the workspace path to fall back to identity checks. | Add `bufferName: typeof record.bufferName === "string" ? record.bufferName : undefined` to both deserialization functions. |

---

#### Step 6: Serialization Unit Tests `[x]`

**User story:** As a developer, I want serialization tests covering round-trip, performance, and edge cases, so that persistence correctness is verified independently.

**Description:** Create `test/unit/workspace-serialization.test.ts` covering all serialization scenarios.

**MUST:**
- Round-trip test with 3 buffers (modified, clean, unsaved) verifying content, metadata, cursor positions
- Window layout preservation test
- Empty workspace round-trip
- Large buffer (100k lines) performance: serialization completes in <500ms
- Modified flag preserved correctly
- Unmodified buffers: only metadata stored (no content duplication)

**MUST NOT:**
- Test daemon behavior — this is serialization-only

**Convention source:** `rules/testing.md`

**Acceptance criteria:**
- [x] All tests pass: `bun test test/unit/workspace-serialization.test.ts`
- [x] Large buffer test asserts <500ms for serialization
- [x] Modified flag test verifies `true`/`false` preservation

---

### Phase 2: Core — Multi-Workspace Daemon and Buffer Scoping `[x]`

Core workspace routing and buffer scoping are structurally complete and pass focused typecheck/tests. Round-5 frame buffer remapping and inactive-workspace render/query isolation fixes are integrated.

#### Step 7: Evolve TmaxServer for Multi-Workspace `[x]`

**User story:** As a developer, I want the daemon to support multiple workspaces, so that clients can connect to independent workspace sessions.

**Description:** Modify `TmaxServer` to hold a `Map<string, WorkspaceState>` instead of relying on the single `Editor`. Each workspace has its own buffer map. Frames bind to a workspace via `workspaceId`. All RPCs route through the frame's workspace.

**MUST:**
- Add `workspaces: Map<string, WorkspaceState>`, `activeWorkspaceId`, `workspaceManager: WorkspaceManager` to `TmaxServer`
- On startup: load workspace list from disk; lazy-load individual workspaces on demand
- Modify `connect-frame` RPC: accept optional `workspaceId`; if omitted, use `activeWorkspaceId` or create default workspace
- Modify all existing RPCs (`open`, `eval`, `keypress`, `command`, `query`, `insert`, `render-state`) to resolve the frame's workspace and operate on that workspace's buffer map
- On `connect-frame` with a workspace that isn't loaded: lazy-load via `workspaceManager.load()`

**MUST NOT:**
- Break backward compatibility — `connect-frame` without `workspaceId` creates/uses a default workspace
- Remove the `Editor` class — it continues to manage the interpreter, key mappings, and T-Lisp API surface
- Change the JSON-RPC protocol version

**Convention source:** `src/server/server.ts` existing patterns (RPC dispatch, frame sync, lock management); `rules/daemon-client.md`

**Acceptance criteria:**
- [x] `connect-frame` without `workspaceId` works identically to current behavior (backward compat)
- [x] `connect-frame` with `workspaceId` binds frame to that workspace's buffer map
- [x] Explicit `workspaceId` on frame-aware RPCs overrides the active frame's bound workspace when intentionally provided
- [x] `open` in workspace A creates a buffer in workspace A only; workspace B is unaffected
- [x] `list-buffers` returns only buffers for the frame's workspace
- [x] Existing daemon tests pass without modification

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| C2 | `handleRenderState` mutates editor state on a read operation. `activateFrameWorkspace` is called inside `render-state`, which triggers `applyWorkspace()` — replacing buffers, cursor, viewport. If client B requests render-state for workspace Y while client A is editing workspace X, the editor silently switches to Y's buffers, corrupting A's subsequent operations. `rules/daemon-client.md` states: "Never mutate editor state during render-state." | Remove `activateFrameWorkspace` from `handleRenderState`. Return the frame's local snapshot directly without touching the editor. |
| I2 | Orphaned frames after workspace kill. Frames bound to a killed workspace get `workspaceId` reassigned to `activeWorkspaceId`, but their buffer references, cursor, and mode still point to the deleted workspace's data. | After reassigning `frame.workspaceId`, call `syncEditorToFrame(frame)` to reset frame state from the active workspace. |
| N2 | `readLastWorkspace` is dead code — C6 is write-only. Daemon always falls back to `this.activeWorkspaceId` instead of persisted value. On restart, last workspace is never restored. | Use `readLastWorkspace` in `connect-frame` as fallback before `this.activeWorkspaceId`. Use in `initializeWorkspaces` to choose initial active workspace. |
| N4 | `handleQuery` still calls `activateFrameWorkspace` despite being read-only. Same bug as C2. Queries can silently switch the active workspace, disrupting concurrent clients. | Read frame workspace state directly without activating, or restrict query to already-active workspace. |
| N5 | Auto-save timer `setInterval` without `.unref()` prevents clean process exit. If `shutdown()` isn't called cleanly, process lingers. | Call `this.autoSaveTimer.unref()` after creating the interval. |
| N6 | `saveAllDirtyWorkspaces` never clears `modified` flag after auto-save. Once edited, workspace re-saves every 30s indefinitely. | After successful auto-save, clear `modified` on workspace `bufferMetadata` entries. |
| R3-3 | N6 fix desyncs with editor. Clearing workspace flags doesn't clear `editor.bufferMetadata`. Next capture re-reads stale `true`. | Also clear `editor.bufferMetadata` modified flags for active workspace buffers. |
| R3-5 | `handleQuery` returns stale data for non-active workspaces. Map data may not reflect editor state. | Document limitation; return Map data for non-active, editor data for active. |
| R3-6 | `handleWorkspaceNew` missing `updateLastWorkspace` call. New workspace isn't persisted as last-active. | Call `this.updateLastWorkspace(name)` after creation. |
| R4-6 | R3-6 fix creates a logical inconsistency: `workspace-new` creates but doesn't activate the workspace, yet calls `updateLastWorkspace`. On daemon restart, `readLastWorkspace` returns an unactivated workspace name. | Remove `updateLastWorkspace` from `handleWorkspaceNew` — the spec defines it as "create only, does not switch." |
| R4-9 | `handleWorkspaceSwitch` calls `captureActiveWorkspace` twice and redundantly assigns `activeWorkspaceId`. | Inline the activate logic to avoid double capture: capture, save, load, set activeWorkspaceId, apply, updateLastWorkspace. |
| R5-1 | Frame-local buffer references become stale after workspace reactivation. `applyWorkspace()` deep-copies buffers, but `syncFrameToEditor()` later writes `frame.currentBuffer` back into the editor. That frame buffer can be an old object no longer present in `editor.buffers`, causing edits to target detached buffers and breaking `currentBufferName` resolution. | **Done:** `Frame.currentBufferName` is stored and `syncFrameToEditor()` remaps by name before falling back. Regression test covers A → B → A frame edits. |
| R5-2 | Read-only frame rendering still mixes workspace state. `frameToEditorState()` combines frame-local current buffer/cursor/mode with shared `editor.getState().buffers/windows/tabs`, which belong to whichever workspace is currently active. `render-state`/`capture` for an inactive workspace frame can render the wrong workspace metadata. | **Done:** inactive frame render/query state is built from the frame workspace snapshot without activating it. Regression test covers independent inactive workspace rendering. |
| R6-1 | Explicit `workspaceId` is ignored when a frame is resolved. `activateFrameWorkspace(frame, requestedWorkspaceId)` previously preferred `frame.workspaceId` over `requestedWorkspaceId`, so `eval`/`insert`/`keypress`/`command` could mutate the frame-bound workspace even when the caller explicitly targeted another workspace. | **Done:** explicit `requestedWorkspaceId` now takes precedence, one-shot overrides avoid rebinding/corrupting the frame, and regression coverage verifies explicit workspace override behavior. |
| R7-2 | Explicit `workspaceId` overrides still have daemon-global side effects. The operation no longer rebinds the frame, but `activateFrameWorkspace()` still leaves `activeWorkspaceId` set to the override workspace after frame-aware `eval`/`insert`/`keypress`/`command`/`open`. Later no-frame/default operations can observe or mutate the override workspace unexpectedly. | **Done:** frame-aware override handlers restore the previous active workspace/frame context in `finally` unless the request is an intentional workspace switch. Regression coverage verifies a one-shot override does not change subsequent default/no-frame behavior. |

---

#### Step 8: Extract Workspace-Scoped Buffer Management `[x]`

**User story:** As a developer, I want buffer operations to be workspace-scoped, so that each workspace has its own independent buffer list.

**Description:** Refactor `Editor` to operate on a `currentWorkspace: WorkspaceState` property. Buffer, window, and tab operations delegate to the current workspace instead of using global state. `TlispEditorState.buffers` returns the workspace-scoped map.

**MUST:**
- Add `currentWorkspace: WorkspaceState` property to `Editor`
- Refactor `createBuffer`, `openFile`, `saveFile`, `getBufferDetails` to use `currentWorkspace.buffers`
- `TlispEditorState.buffers` getter returns `currentWorkspace.buffers`
- `*Messages*` buffer stays on the Editor (daemon-global), not on the workspace
- `workspace-switch` swaps `currentWorkspace` to the target, triggering mode re-detection for the active buffer

**MUST NOT:**
- Change T-Lisp function signatures — they continue to access buffers through `state.buffers`
- Move the interpreter or key mappings into workspaces (those stay daemon-global)
- Break direct-editor mode (non-daemon) — single-workspace behavior preserved

**Convention source:** `src/editor/editor.ts` existing patterns; `rules/editor.md`

**Acceptance criteria:**
- [x] `buffer-list` returns only buffers in the current workspace
- [x] Switching workspaces swaps the visible buffer list
- [x] `*Messages*` accumulates entries from all workspaces
- [x] `*scratch*` content differs between workspaces
- [x] All existing T-Lisp buffer operations work unchanged
- [x] Workspace buffer state is fully isolated
- [x] Mode re-detection fires on workspace switch
- [x] Cursor positions are saved per-buffer, not global

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| C1 | Shared buffer references between workspaces. `exportWorkspace()` places live `FunctionalTextBufferImpl` references into the workspace map. `applyWorkspace()` puts them back by reference with no deep copy. If workspace A is captured, workspace B applied and edited, then A re-applied, the stored A state may contain mutations from B's session. | Deep-copy buffers in `applyWorkspace()`: reconstruct each buffer from `getContent()` rather than inserting the same instance. Consider lazy copy-on-write for performance — only copy the active buffer, restore others from serialized snapshot on demand. |
| I4 | Missing mode re-detection on workspace switch. `applyWorkspace()` restores `bufferModeStates` but never calls `activateMajorModeForFile()`. After switch, the editor may show the wrong major mode. | Add `this.activateMajorModeForFile(this.state.currentFilename)` at the end of `applyWorkspace()`. |
| I5 | Cursor position saved as global, not per-buffer. `exportWorkspace` writes `this.state.cursorPosition` for all buffers. When workspace has buffers at different cursor positions, all get the same position on export. | Track per-buffer cursor positions. For the active buffer use live cursor state; for inactive buffers preserve the incoming workspace's saved cursor. |
| I10 | Mode not reset on workspace switch. `applyWorkspace()` never sets `this.state.mode`. User could land in insert/visual mode on a newly loaded workspace buffer. | Set `this.state.mode = "normal"` at the end of `applyWorkspace()`. |
| N1 | `exportWorkspace()` crashes when `activeMinorModes` is undefined. `modeState?.activeMinorModes.map(...)` throws `TypeError` for any buffer that never had a mode explicitly set. | Add `?? []` before `.map()`: `(modeState?.activeMinorModes ?? []).map(...)`. |
| N7 | Window/tab objects carry stale buffer references after deep copy. After deep-copying buffers, `this.state.windows[].buffer` still points to the original workspace buffer objects, not the fresh copies in `this.buffers`. | Remap window/tab `buffer` refs to the new deep-copied instances from `this.buffers`. |
| N8 | `exportWorkspace()` passes live buffer references into the returned workspace. While `applyWorkspace` deep-copies on the receiving end, the exported object itself is unsafe to hand off to other consumers. | Consider deep-copying in `exportWorkspace` too, or document the contract that consumers must deep-copy. |
| R3-1 | N7 remap broken: `findBufferName(w.buffer)` uses `===` on `this.buffers`, but after deep-copy those are new instances — always returns `undefined`. All windows get `*scratch*`. | Build a reverse index `Map<FunctionalTextBuffer, string>` from the OLD workspace buffers during deep-copy loop, then use it to resolve window/tab buffer names before looking up in the NEW `this.buffers`. |
| R3-9 | `exportWorkspace()` calls `getEditorState()` twice (lines 2457-2458). | Cache in a local variable. |
| R4-3 | T-Lisp `currentBuffer` setter does not update `window.buffer` or `window.bufferName` on buffer switch. After T-Lisp `buffer-switch`, the window has stale references. Serialization then writes wrong buffer name. | Add window update in the setter, same as `createBuffer()` does. |
| R4-5 | `currentBuffer` setter tab spread `{ ...tab, buffer: v }` keeps the old `bufferName` even though the buffer changed. | Add `bufferName: bufferName` to the spread. |
| R4-8 | `exportWorkspace` IIFE calls `getEditorState()` which clones entire state just to extract two fields (`activeMinorModes`, `activeMinorModeLighters`). Overkill. | Extract the two fields directly from the mode state instead of cloning the full state. |

---

#### Step 9: Register Workspace T-Lisp Commands `[x]`

**User story:** As a power user, I want T-Lisp commands for workspace management, so that I can create, switch, and manage workspaces from the editor.

**Description:** Create `src/editor/api/workspace-ops.ts` with T-Lisp workspace commands. Register them in the editor's API surface. Add `SPC w` prefix keymap.

**MUST:**
- `workspace-list` → returns `{ name, active, lastAccessed, projectRoot, windowCount }[]`
- `workspace-new <name>` → creates workspace, does not switch
- `workspace-switch <name>` → saves current, loads target, swaps `currentWorkspace`
- `workspace-kill <name>` → prompts for unsaved buffers, deletes workspace
- `workspace-rename <old> <new>` → validates new name, renames files
- `workspace-save` → explicit save of current workspace
- `workspace-load <name>` → pre-loads workspace from disk (for faster switch)
- `workspace-move-window <target>` → copies buffer to target, removes from current, rebalances
- Add `SPC w` prefix keymap with entries for all workspace commands

**MUST NOT:**
- Hard-code agent detection or process monitoring (that's RFC-014A scope)
- Allow `workspace-kill` without prompting if unsaved buffers exist

**Convention source:** `src/editor/api/` pattern (T-Lisp function registration via `createEditorAPI`); `rules/editor.md`; `rules/tlisp.md`

**Acceptance criteria:**
- [x] `workspace-new "test"` creates a workspace file on disk
- [x] `workspace-switch "test"` saves current workspace and activates "test"
- [x] `workspace-list` includes the new workspace with correct metadata
- [x] `workspace-kill "test"` requires confirmation for dirty workspaces and removes workspace files when confirmed
- [x] `SPC w` shows workspace command keybindings in which-key

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| R4-1 | `split-window` in `src/editor/api/window-ops.ts` constructs Window without `bufferName`. After buffer mutations, serialization falls back to identity check which fails. | Set `bufferName: currentWindow.bufferName` on the new window. |
| R4-2 | `tab-new` in `src/editor/api/tab-ops.ts` constructs Tab without `bufferName`. Same staleness risk. | Set `bufferName: name` on the new tab. |
| R5-5 | `workspace-kill` deletes inactive workspaces directly without checking unsaved buffers or prompting, despite the command contract and MUST NOT rule. | **Done:** dirty workspace kill returns `confirmationRequired` with dirty buffer names unless `confirm: true` is supplied. Integration coverage verifies prompt-required behavior. |

---

### Phase 3: Integration — Persistence Triggers, CLI, Cross-Workspace Moves, Tests `[~]`

Implementation items are complete through round 8. Validation remains open only because the full `bun test` gate failed in the suite-wide run with timeout/performance noise; the affected files pass when rerun in isolation.

#### Step 10: Wire Auto-Save and Serialization Triggers `[x]`

**User story:** As a user, I want my workspace auto-saved so that I don't lose work if the daemon crashes.

**Description:** Wire serialization triggers in `TmaxServer`: periodic auto-save, switch-triggered save, shutdown save, and debounced dirty-save.

**MUST:**
- Auto-save timer: every 30s (configurable), check dirty state via content hash, save if changed
- Maximum dirty interval: 120s — force save even if hash hasn't changed
- On `workspace-switch`: save current workspace before activating the new one
- On `shutdown` RPC / `SIGTERM`: save all loaded workspaces sequentially
- On buffer modification: debounce 5s, then check dirty and save
- Track `lastSaveHash` per workspace, compare against computed hash of all buffer contents
- Avoid duplicate full-buffer content traversal in the successful save path when practical; hashing and serialization should share traversal work or use per-buffer dirty/content versions for large workspaces

**MUST NOT:**
- Auto-save more frequently than the configured interval
- Block the event loop during save — use async file I/O

**Convention source:** `src/server/server.ts` existing shutdown handler pattern; `rules/daemon-client.md`

**Acceptance criteria:**
- [x] Make edits, wait for configured debounce/auto-save, kill daemon, restart → edits present
- [x] Make edits, immediately kill daemon (`kill -9`), restart → edits present from last auto-save
- [x] `workspace-switch` triggers save of current workspace (verified by file timestamp)
- [x] Auto-save failure preserves dirty flags in both workspace metadata and active editor metadata
- [x] `shutdown` saves all loaded workspaces
- [x] Successful dirty save avoids redundant full-content traversal, verified with an instrumented large-workspace test or equivalent serializer/hash coupling test
- [x] Layout-only changes (split/close/resize/switch window or tab metadata) are persisted by debounced/periodic save even when no buffer content is marked modified

**Current status:** Switch-triggered save, shutdown save, content-hash tracking, configurable debounce, max dirty interval, focused debounced auto-save validation, failed-save dirty-flag recovery, crash-style reload validation, file timestamp verification, redundant traversal optimization, and layout-only autosave persistence are implemented and tested.

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| I1 | Missing debounced dirty-save and hash/max-interval logic. A 30s dirty timer exists, but the spec requires content hash comparison, 5s debounced save on buffer modification, and a 120s maximum dirty interval. | **Done:** server tracks `lastSaveHash`/`lastSavedAt`, schedules configurable dirty debounced saves, and avoids repeat writes when content hash is unchanged. |
| R5-4 | Auto-save acceptance criteria are still unverified. Focused workspace tests do not exercise timer-based save, kill/restart recovery from auto-save, or file timestamp changes on switch. | **Done:** focused integration coverage proves configurable debounced save, crash-style reload from last auto-save, and workspace-switch persistence timestamp/content updates. |
| R6-3 | Auto-save failure clears active editor dirty flags. `saveDirtyWorkspace()` clears workspace/editor modified flags before persistence succeeds and restores only workspace metadata on failure. A later active workspace capture can erase the restored dirty state. | **Done:** save failure restores workspace metadata and active editor dirty flags. Regression coverage verifies dirty state remains visible after failed auto-save. |
| R7-4 | Dirty-save performance does redundant full-content traversal. `workspaceContentHash()` reads every buffer's content, then successful persistence serializes the same workspace content again. This is acceptable for small workspaces but avoidable for large projects. | **Done:** `WorkspaceManager.saveWithContentHash()` computes the content hash from the serialized data used for the write, and `TmaxServer.saveDirtyWorkspace()` uses that single-serialization result. Unit coverage verifies one `getContent()` call for a successful save. |
| R8-3 | Layout-only workspace changes are not crash-autosaved. `saveDirtyWorkspace()` exits early unless some buffer metadata is `modified`, so split/close/resize/window/tab metadata changes can be lost on crash before switch or shutdown. | **Done:** dirty-save now compares the serialized workspace hash across buffer and layout state instead of exiting early on clean buffer metadata. Regression coverage verifies split-window layout persists via debounce/auto-save without modified buffer content. |

---

#### Step 11: CLI Integration `[x]`

**User story:** As a user, I want CLI flags for workspace management, so that I can open and manage workspaces from the command line.

**Description:** Add workspace flags to `bin/tmax` and `bin/tmaxclient`. Persist last-active workspace for default reconnection.

**MUST:**
- `tmax -w project-a` → start daemon (if needed) + connect to workspace "project-a"
- `tmax -w new:project-b` → create workspace + connect
- `tmax --workspaces` → list workspace names via `workspace-list` RPC
- `tmax --workspace-kill name` → kill workspace via `workspace-kill` RPC
- `tmax` (no flags) → connect to last active workspace (stored in `~/.config/tmax/last-workspace`)
- `tmaxclient --workspace <name>` → include `workspaceId` in `connect-frame` RPC
- Update `~/.config/tmax/last-workspace` on every workspace switch

**MUST NOT:**
- Break existing `tmax` invocations without workspace flags
- Require daemon restart for new workspace creation

**Convention source:** `bin/tmax` existing flag pattern (`-e`, `--daemon`, `--stop`); `rules/daemon-client.md`

**Acceptance criteria:**
- [x] `tmax -w new:test-ws` creates workspace and opens TUI connected to it
- [x] `tmax --workspaces` lists workspace names
- [x] `tmax` (no flags) reopens last active workspace after prior `tmax -w NAME` use
- [x] `tmax --workspace-kill test-ws` removes workspace and its files
- [x] `-w` with no argument produces an error instead of silent fallthrough
- [x] Invalid workspace name in `-w new:...` produces an error

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| C6 | Missing `last-workspace` persistence. `tmax` (no flags) should reconnect to the last active workspace via `~/.config/tmax/last-workspace`. Neither reading nor writing this file is implemented. | In `bin/tmax`, when no workspace flag is provided but a daemon is running, read `~/.config/tmax/last-workspace` and use its value as the workspace ID. In `server.ts`, write to this file in `handleWorkspaceSwitch` and `createFrameForWorkspace`. |
| I6 | `-w` with no argument silently ignored. If `-w` is the last argument, `shift_mode` is set but never consumed. Script falls through to single-process editor with no workspace, no error. | After the argument parsing loop, check if any `shift_mode` is still set and error with usage message. |
| I7 | Workspace creation errors suppressed. `|| true` after workspace creation means invalid names or duplicate names proceed silently to a connect that will fail. | Remove `|| true`. Check exit code and report the error: `if ! "$CLIENT" ...; then echo "Error: ..." >&2; exit 1; fi` |
| M7 | `--workspace` alias exists but help text omits it. | Add to usage or remove alias. |
| R3-4 | `bin/tmaxclient` missing argument validation for 14 flags. If a value-taking flag is the last argument, `undefined` is used. | Add argument presence checks for all value-taking flags. |
| R3-8 | `bin/tmaxclient` uses `require()` instead of `import`. | Convert to `import` statements. |
| R4-7 | `bin/tmaxclient` — `--eval`, `--insert`, `--key`, `--keys` missing `startsWith('-')` check. Running `--eval --status` would set `evalCode` to `"--status"`. | Add `|| arg.startsWith('-')` guard to those four flags. |
| R5-3 | `tmax -w NAME` connects through `connect-frame`, which activates the workspace but does not persist it as last active. Only explicit `workspace-switch` writes `~/.config/tmax/last-workspace`. | **Done:** successful requested `connect-frame` activation persists `last-workspace`; integration coverage verifies explicit workspace connect writes the file. |

---

#### Step 12: Cross-Workspace Window Move `[x]`

**User story:** As a power user, I want to move a window from one workspace to another, so that I can reorganize my work without copy-pasting.

**Description:** Implement `workspace-move-window` that copies the buffer to the target workspace, removes the window from the source, and rebalances both layouts.

**MUST:**
- Copy editor buffer content to target workspace (independent copy, not shared reference)
- Remove window from source workspace's window list
- Rebalance source workspace layout (redistribute remaining windows)
- Append window to target workspace's window list
- Preserve source buffer data when another source window or tab still references the moved buffer
- Handle target buffer name collisions without silently overwriting existing target content
- Save both workspaces
- Persist the target workspace before removing/persisting the source, or use rollback/two-phase persistence, so target save failure cannot persist source removal without target addition
- Terminal windows: kill PTY and restart in target (placeholder, full impl in RFC-014A)

**MUST NOT:**
- Share buffer references between workspaces
- Delete a source buffer that is still referenced by another source window or tab
- Silently overwrite an existing target buffer with the same name
- Persist a source-side removal before the target-side addition is durable
- Attempt PTY process migration

**Convention source:** `src/editor/api/window-ops.ts` existing split/window patterns

**Acceptance criteria:**
- [x] Window with buffer "file.ts" moves from workspace A to workspace B
- [x] Workspace A no longer lists "file.ts" in its buffer list
- [x] Workspace B lists "file.ts" with identical content
- [x] Editing "file.ts" in workspace B does not affect workspace A through shared references
- [x] Moving one of two source windows that share a buffer does not delete or dangle the remaining source window's buffer
- [x] Moving into a target workspace with an existing same-name buffer prompts, renames, or errors instead of overwriting content silently
- [x] If target workspace persistence fails during move, the source workspace file and in-memory source workspace both retain the moved buffer/window after restart or later shutdown

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| R6-2 | `workspace-move-window` deletes the source buffer unconditionally and overwrites an existing target buffer with the same name. This loses data when multiple source windows/tabs reference the same buffer or when the target already contains a buffer named like the moved buffer. | **Done:** target buffer name collisions now error before mutation, and source buffer metadata is preserved while another source window/tab references it. Regression tests cover both cases. |
| R7-1 | `workspace-move-window` saves the source workspace before the target. If source persistence succeeds and target persistence fails, restart can lose the moved buffer/window because the source removal was durable but the target addition was not. | **Done:** target workspace is saved before source workspace, and regression coverage injects target save failure to prove the source workspace file still retains the moved buffer/window. |
| R8-1 | `workspace-move-window` still mutates the in-memory source and target workspaces before target persistence succeeds. The existing failure test checks the source file immediately after injected target-save failure, but a later shutdown or save can persist the already-mutated in-memory source and remove the moved buffer/window. | **Done:** source/target workspaces are staged as cloned snapshots and committed to `this.workspaces`/editor only after target and source persistence both succeed. Regression coverage injects target-save failure, then explicitly saves/restarts the source and verifies the moved buffer/window remain. |
| R8-2 | `workspace-move-window` accepts `sourceWorkspaceId` but does not restore one-shot source overrides. Unlike `open`, `eval`, `insert`, `keypress`, and `command`, it calls `activateFrameWorkspace(frame, params?.sourceWorkspaceId)` without `restoreWorkspaceAfterOverride()` in `finally`. | **Done:** `workspace-move-window` uses the same one-shot override restoration pattern as other frame-aware handlers, including success and failure paths. Regression coverage verifies default/no-frame behavior still sees the previous active workspace. |

---

#### Step 13: Restore Behavior and Recovery `[x]`

**User story:** As a user, I want crashed workspaces to restore cleanly, with prompts for file conflicts, so that I don't silently lose work.

**Description:** Implement restore logic for workspace load: reopen buffers, recreate layout, handle file-on-disk conflicts, handle missing project roots.

**MUST:**
- Reopen all buffers with saved content; unmodified buffers re-read from disk
- Recreate window layout with correct dimensions
- Place cursors at saved positions
- Re-activate saved major/minor modes
- On file-changed-on-disk conflict: offer choices (a) keep disk version, (b) restore workspace version, (c) diff view
- On multiple conflicts: present batch prompt listing all affected buffers
- On missing project root: warn in `*Messages*`, open without project binding

**MUST NOT:**
- Silently overwrite disk changes
- Fail the entire workspace restore because one buffer's file changed

**Convention source:** `src/editor/editor.ts` existing `openFile` pattern; Emacs `recover-file` model

**Acceptance criteria:**
- [x] Workspace with 3 buffers restores all buffers, cursors, and layout
- [x] File changed on disk since last save → user gets conflict prompt
- [x] Missing project root → workspace opens with warning in `*Messages*`
- [x] Unmodified buffer re-reads from disk (not from serialized content)

**Current status:** Restore layout, conflict prompt messaging, missing-root warning, and unmodified-buffer disk reread behavior are implemented and covered by integration tests.

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| R7-3 | SPEC completion is overstated if Step 13 remains open. Current validation proves many workspace lifecycle paths, but restore conflict/recovery acceptance criteria are still unchecked. | **Done:** Step 13 acceptance criteria are implemented and checked, and the SPEC now tracks round-7 completion explicitly. |

---

#### Step 14: Integration Tests `[x]`

**User story:** As a developer, I want end-to-end integration tests, so that the full workspace lifecycle is verified through daemon RPC.

**Description:** Create `test/integration/workspace-lifecycle.test.ts` testing the complete create → switch → persist → restore → recover cycle via daemon RPC.

**MUST:**
- Start daemon, create workspace, open file, verify buffer in workspace
- Create second workspace, switch to it, verify buffer list is independent
- Switch back to first workspace, verify buffer still present with correct content
- Kill daemon, restart, load workspace, verify full restoration
- Corrupt workspace file, restart, verify backup recovery
- Test `workspace-kill` with unsaved buffer (should prompt)
- Test cross-workspace window move (editor buffer copies correctly)

**MUST NOT:**
- Use tmux — test directly via daemon RPC (JSON-RPC over Unix socket)
- Depend on TUI rendering — test state, not display

**Convention source:** `rules/testing.md`; existing integration test patterns in `test/integration/`

**Acceptance criteria:**
- [x] All integration tests pass: `bun test test/integration/workspace-lifecycle.test.ts`
- [x] Persistence test: kill + restart + load = full state recovery
- [x] Recovery test: corrupt file + load = backup restored with warning
- [x] RPC helper accumulates data chunks before parsing
- [x] Failure-injection test proves target-save failure during `workspace-move-window` cannot later persist source removal through shutdown or explicit save
- [x] One-shot `sourceWorkspaceId` override on `workspace-move-window` restores previous active workspace/frame on success and failure
- [x] Layout-only workspace changes are persisted by debounce/auto-save without modified buffer content

**Patch review fixes required:**

| ID | Issue | Fix |
|----|-------|-----|
| I9 | RPC helper assumes single `data` event. Doesn't accumulate chunks. TCP/Unix socket can fragment responses. | Accumulate data chunks and parse on newline delimiter. |
| R3-7 | No test coverage for N2, N3, N7, or workspace-rename RPC fixes. | Add integration tests for: last-workspace persistence, rename of in-memory workspace, window buffer remap after workspace switch, workspace-rename RPC. |
| R4-10 | No test coverage for R3-1 (applyWorkspace window remap), R3-3 (auto-save modified flag clearing), R3-6/N2 (last-workspace persistence on reconnect). N7 serialization side only partially covered. | Add tests: editor applyWorkspace round-trip verifying window buffer references, saveAllDirtyWorkspaces + clearModifiedFlags, connect-frame without workspaceId reconnecting via readLastWorkspace. |
| R5-6 | No test coverage for R5 frame isolation and CLI persistence fixes. | **Done:** regression tests cover stale frame buffer remap, inactive workspace render state, explicit workspace connect last-workspace persistence, debounced auto-save, dirty workspace kill prompt, and cross-workspace move. |
| R6-4 | No test coverage for explicit workspace override, move-window same-name/multi-window edge cases, or auto-save failure dirty-flag restoration. | **Done:** focused integration tests cover R6-1, R6-2, and R6-3. |
| R7-5 | No coverage for round-7 durability/performance/one-shot semantics. | **Done:** focused tests cover target-save failure during `workspace-move-window`, one-shot workspace override restoring default active behavior, redundant dirty-save content traversal, and Step 13 restore/recovery acceptance criteria. |
| R8-4 | Round-8 failure paths are not covered. Current coverage misses post-failure in-memory source mutation, `workspace-move-window` source override restoration, and layout-only autosave. | **Done:** focused integration tests cover R8-1, R8-2, and R8-3. Full validation remains tracked in Step 15. |

---

#### Step 15: Validation `[~]`

**User story:** As a developer, I want all tests and type checks passing, so that I can be confident the feature is complete with zero regressions.

**Description:** Run the full validation suite. Every command must pass.

**MUST:**
- Run typecheck, unit tests, integration tests, full test suite, daemon tests

**MUST NOT:**
- Skip any failing test — all must pass

**Convention source:** `CLAUDE.md §8. Verify Before Reporting Complete`

**Acceptance criteria:**
- [x] `bun run typecheck:src` passes
- [x] `bun run typecheck:test` passes
- [x] `bun run typecheck` passes
- [x] `bun test test/unit/workspace-manager.test.ts` passes
- [x] `bun test test/unit/workspace-serialization.test.ts` passes
- [x] `bun test test/unit/scrollback-buffer.test.ts` passes
- [x] `bun test test/integration/workspace-lifecycle.test.ts` passes
- [ ] `bun test` — full suite passes with zero regressions
- [ ] `bun run test:daemon` passes

---

## Feature Acceptance Criteria

1. **Multiple workspaces.** `workspace-new project-a` and `workspace-new project-b` create independent workspaces. Switching between them swaps the buffer list, window layout, and cursor state.
2. **Persistence survives crashes.** Create workspace, open 3 files, kill daemon (`kill -9`), restart, `workspace-load project-a` restores all 3 files with correct cursor positions and window layout.
3. **Atomic writes.** After any save, both `project-a.json` and `project-a.json~` exist. Killing the daemon mid-write never produces a corrupt `project-a.json`.
4. **Recovery from corrupt files.** If `project-a.json` is corrupt, the system recovers from `project-a.json~` and logs a warning.
5. **Name validation.** `workspace-new "../evil"` and `workspace-new "has spaces"` return errors. `workspace-new "project-a"` succeeds.
6. **`*Messages*` is global, `*scratch*` is per-workspace.** Messages from all workspaces appear in `*Messages*`. Each workspace has its own `*scratch*` content.
7. **Last-keystroke-wins for concurrent clients.** Two clients on the same workspace; both can type; last input wins.
8. **Auto-save works.** Make edits, wait 30s, kill daemon, restart → edits are present.
9. **Format versioning.** Workspace files with `version: 1` load correctly when tmax is at version 2 (defaults filled). Workspace files with `version: 3` refuse to load on tmax version 2.
10. **Scrollback buffer.** Terminal window scrollback stores up to 50,000 lines, supports regex search, evicts oldest when full.

## Validation Commands

- `bun run typecheck:src` — TypeScript compilation passes with all new types
- `bun run typecheck:test` — Test files type-check
- `bun run typecheck` — Full project type-check
- `bun test test/unit/workspace-manager.test.ts` — Workspace manager unit tests pass
- `bun test test/unit/workspace-serialization.test.ts` — Serialization round-trip tests pass
- `bun test test/unit/scrollback-buffer.test.ts` — Scrollback buffer tests pass
- `bun test test/integration/workspace-lifecycle.test.ts` — Integration lifecycle tests pass
- `bun test` — Full test suite passes with zero regressions
- `bun run test:daemon` — Daemon tests pass

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Fully global T-Lisp namespace (Emacs model) | Matches Emacs behavior; well-understood; simplest to implement | Per-workspace namespaces (massive interpreter complexity); workspace-local overrides (medium complexity, unclear benefit) |
| Copy buffers on cross-workspace move | Simplest correct semantics; no sync needed | Shared buffer references (complex synchronization, conflict resolution); file-backed re-open (loses unsaved changes) |
| Restart PTY on cross-workspace move | Process migration is infeasible in practice (fixed parent PID, working directory, file descriptors) | Best-effort migration (`prctl` on Linux, fragile; impossible on macOS) |
| Last-keystroke-wins for concurrent clients | Matches tmux behavior; simplest model; no merge logic needed | Collaborative locking (limits multi-client use); OT/CRDT (extremely complex) |
| Additive-only format versioning | Simplest migration strategy; no migration functions needed | Version-check + migrate (extra code for each version bump); WAL (overkill for editor state) |
| Per-workspace buffer isolation, global `*Messages*` | `*scratch*` isolation prevents cross-project confusion; `*Messages*` aggregation gives daemon-wide observability | Fully isolated (lose daemon-wide logs); fully shared (can't have project-specific buffers) |
| Atomic write + one-generation backup | Prevents corrupt files on crash; one backup is sufficient recovery depth | WAL (complex); no backup (no recovery) |
| TypeScript-only test backend interface | Test infrastructure is TypeScript; no benefit to T-Lisp extensibility for test harness | T-Lisp backend protocol (adds complexity, no real use case) |

**Deferred to follow-up:**
- Shell-mode (RFC-014A) — PTY-backed terminal windows, agent-aware process monitoring
- Project-mode (RFC-014B) — Project root detection, file discovery, project-wide search
- Tabs — Included in data model for forward compatibility but not implemented
- Shared buffer references between workspaces — Future enhancement after copy semantics are stable
- Agent-aware process monitoring — Requires shell-mode; no Loom/Fikra dependency for core hooks

## Edge Cases

- Workspace name with invalid characters → `Left(Error)` with validation message
- Duplicate workspace name → `Left(Error)` without modifying existing workspace
- Switch to nonexistent workspace → `Left(Error)` without changing current workspace
- Kill workspace that is active in another client → prompt the user before proceeding
- Save workspace with 0 buffers → valid (empty workspace persists correctly)
- Load workspace from newer tmax version → refuse with "please upgrade" message
- Auto-save while buffer is being edited → no data loss (atomic write; in-memory state is source of truth)
- Concurrent clients on same workspace → last-keystroke-wins (by design)
- `*Messages*` accumulates entries from all workspaces (daemon-global)
- `*scratch*` is per-workspace (different content in each)
- Scrollback buffer at capacity → oldest entries evicted, search still works on remaining content
- File changed on disk since serialization → recovery prompt with three choices
- Multiple file-on-disk conflicts → batch prompt listing all affected buffers
- Project root directory deleted since serialization → warn in `*Messages*`, open without project binding
- Workspace file corrupt AND backup corrupt → log error, create empty workspace

## Verified Correct (patch review)

- Path traversal security: regex `^[a-zA-Z0-9_-]{1,64}$` is sufficient
- Atomic write pattern: tmp → backup → rename
- Backup recovery on corrupt primary file
- Format versioning: refuses newer, defaults for missing fields
- `Either`/`TaskEither` return types used consistently in `WorkspaceManager`
- `*Messages*` stays daemon-global, `*scratch*` is per-workspace
- T-Lisp interpreter stays daemon-global (not per-workspace)
- Backward-compatible `connect-frame` without `workspaceId`
- Shutdown saves all loaded workspaces
- Buffer `getContent()` optimization via `this.lines.join("\n")` is sound
- Shell injection: all variable expansions properly quoted in `bin/tmax`
- Test coverage for CRUD, name validation, serialization round-trip

## Patch Review Round 2

Issues found after applying round-1 fixes. All items below are required fixes.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| N1 | `src/editor/editor.ts` — `exportWorkspace` | **Crash when `activeMinorModes` is undefined.** `modeState?.activeMinorModes.map(...)` throws `TypeError` for any buffer that never had a mode explicitly set. `modeState?.activeMinorModes` evaluates to `undefined`, then `.map()` is called on it. | Add `?? []` before `.map()`: `(modeState?.activeMinorModes ?? []).map(...)`. |
| N2 | `src/server/server.ts` — `readLastWorkspace` | **C6 is write-only.** `updateLastWorkspace` persists the name on switch, but `readLastWorkspace` is never called. The daemon always falls back to `this.activeWorkspaceId` instead of the persisted value. On daemon restart, the last workspace is never restored. | Use `readLastWorkspace` in `connect-frame` as fallback before `this.activeWorkspaceId`. Use it in `initializeWorkspaces` to choose initial active workspace. |
| N3 | `src/core/workspace.ts` — `rename()` | **Fails for in-memory-only workspaces.** `fs.rename()` throws `ENOENT` when the workspace exists only in memory (never persisted). The error is re-thrown, causing the entire rename to fail. | Tolerate missing file on disk: change `try { await fs.rename(oldPath, newPath); } catch (error) { throw new Error(...) }` to `try { await fs.rename(oldPath, newPath); } catch { /* file doesn't exist on disk, that's fine */ }`. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| N4 | `src/server/server.ts` — `handleQuery` | **Read-only handler calls `activateFrameWorkspace`, mutating editor state.** Same bug as C2 (fixed for `handleRenderState`). Queries can silently switch the active workspace, disrupting concurrent clients. | Read frame workspace state directly without activating, or restrict query to the already-active workspace. |
| N5 | `src/server/server.ts` — auto-save timer | **`setInterval` without `.unref()` prevents clean process exit.** If `shutdown()` isn't called cleanly (e.g., fatal error outside signal handlers), the process lingers. | Call `this.autoSaveTimer.unref()` after creating the interval. |
| N6 | `src/server/server.ts` — `saveAllDirtyWorkspaces` | **Never clears `modified` flag after auto-save.** Once a buffer is edited, its workspace re-saves every 30s indefinitely even with no further edits. Unnecessary I/O. | After successful auto-save, clear `modified` on workspace `bufferMetadata` entries. |
| N7 | `src/editor/editor.ts` — `applyWorkspace` | **Window/tab objects carry stale buffer references after deep copy.** After deep-copying buffers, `this.state.windows[].buffer` still points to the original workspace buffer objects, not the fresh copies in `this.buffers`. | Remap window/tab `buffer` refs to the new deep-copied instances from `this.buffers`. |

### Minor

| ID | Area | Issue |
|----|------|-------|
| N8 | `src/editor/editor.ts` — `exportWorkspace` | Passes live buffer references into the returned workspace. While `applyWorkspace` deep-copies on the receiving end, the exported object itself is unsafe to hand off to other consumers. |
| N9 | `src/core/workspace.ts` | Duplicate format version constants: `CURRENT_FORMAT_VERSION` (local) and `CURRENT_WORKSPACE_FORMAT_VERSION` (re-exported from `types.ts`). If one is updated without the other, loading breaks silently. |

### Verified Correct (round 2)

- C1: Deep copy of buffer content in `applyWorkspace()` is correct
- C2: `handleRenderState` no longer mutates editor state
- I4: Mode re-detection called after all state is restored (correct ordering)
- I8: RingBuffer search reset works for global and sticky regexes
- M1: `import path from 'path'` works correctly in Bun
- M2: `save()` → `saveInternal()` delegation is clean
- M3: `exists()` uses `getWorkspacePath()` correctly
- I6: CLI shift_mode check covers all three modes
- I9: RPC helpers correctly accumulate and newline-delimit
- I2: Orphaned frame sync after workspace kill works correctly
- C4: Window/tab serialization resolves buffer references by name
- C5: `lastAccessed` is in the serialized data before write

## Patch Review Round 3

Issues found after applying round-2 fixes. All items below are required fixes.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R3-1 | `src/editor/editor.ts` — `applyWorkspace` N7 remap | **`findBufferName()` uses `===` identity check against `this.buffers`, but after deep-copy `this.buffers` has new instances.** The incoming workspace's windows/tabs still hold references to the old buffer objects. `findBufferName(w.buffer)` searches `this.buffers` by `===` and always returns `undefined`, so all windows get `*scratch*`. | Track buffer names in the workspace data instead of relying on identity. Add a `Map<FunctionalTextBuffer, string>` reverse index during the deep-copy loop, then use it to remap window/tab buffer references by name lookup. |
| R3-2 | `src/server/serialize.ts` — `workspaceToData` | **Buffer identity check `buf === win.buffer` fails after mutations.** `FunctionalTextBufferImpl` is immutable — every edit creates a new instance. The window's `buffer` reference becomes stale after any buffer mutation, so the identity check silently fails and `winBufferName` stays `""`. | Store the buffer name directly on each window/tab during editor operations (add `bufferName?: string` to `Window`/`Tab`), or resolve names via `findBufferName` on the editor's `buffers` map (which is kept in sync). |
| R3-3 | `src/server/server.ts` — `saveAllDirtyWorkspaces` | **N6 modified flag desync.** Clearing `workspace.bufferMetadata.modified` doesn't clear `editor.bufferMetadata.modified`. Next `captureActiveWorkspace()` calls `exportWorkspace()` which reads `this.bufferMetadata.get(name).modified` — still `true`. The flag gets re-set into the workspace on every capture, defeating the clear. | After clearing workspace flags, also clear `editor.bufferMetadata` modified flags for the active workspace's buffers. |
| R3-4 | `bin/tmaxclient` — argument validation | **14 flags lack argument validation.** If `--workspace`, `--socket`, `-e`, or any other value-taking flag is the last argument on the command line, the script silently proceeds with `undefined`. | Add argument presence checks for all value-taking flags after the parsing loop. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R3-5 | `src/server/server.ts` — `handleQuery` | **Returns stale data for non-active workspace frames.** `handleQuery` was fixed to not call `activateFrameWorkspace`, but it now reads from the workspace Map directly. If the queried workspace isn't the active one, the Map data may be stale (not captured from editor since last activation). | For non-active workspaces, return data directly from the workspace Map. For the active workspace, read from editor state. Document this limitation. |
| R3-6 | `src/server/server.ts` — `handleWorkspaceNew` | **Missing `updateLastWorkspace` call.** Creating a new workspace should update the last-workspace file so `tmax` (no flags) reconnects to it. | Call `this.updateLastWorkspace(name)` after successful workspace creation in `handleWorkspaceNew`. |
| R3-7 | `test/` — missing coverage | **No test coverage for N2, N3, N7, or workspace-rename RPC.** Round-2 fixes have no tests verifying they work correctly. | Add integration tests for: last-workspace persistence (N2), rename of in-memory workspace (N3), window buffer remap after workspace switch (N7), workspace-rename RPC. |
| R3-8 | `bin/tmaxclient` — `require()` | **Uses `require()` instead of `import`.** The file is TypeScript but uses CommonJS `require()` for net module. | Convert to `import` statements. |

### Minor

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R3-9 | `src/editor/editor.ts` — `exportWorkspace` | **Calls `getEditorState()` twice.** Lines 2457-2458 call it once for `activeMinorModes` and once for `activeMinorModeLighters`. | Cache in a local variable. |
| R3-10 | `src/server/serialize.ts` — `dataToWorkspace` | **Silently falls back to `*scratch*` when `bufferName` is empty.** No warning or log when a window/tab reference can't be resolved. | Add a console warning when falling back, so serialization issues are diagnosable. |

## Patch Review Round 4

Issues found after applying round-3 fixes. Focus: `bufferName` consistency across all Window/Tab construction sites, `currentBuffer` setter maintenance, and remaining test gaps.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R4-1 | `src/editor/api/window-ops.ts` — `split-window` | **Missing `bufferName` on new window.** Split-window constructs a Window without the `bufferName` field added by R3-2. After buffer mutations, serialization falls back to identity check which fails. The new window serializes with `bufferName: ""`, losing its buffer reference. | Set `bufferName: currentWindow.bufferName` on the new window object. |
| R4-2 | `src/editor/api/tab-ops.ts` — `tab-new` | **Missing `bufferName` on new tab.** Same pattern as R4-1. Tab constructed without `bufferName`, creating a serialization gap. | Set `bufferName: name` on the new tab object. |
| R4-3 | `src/editor/editor.ts` — T-Lisp `currentBuffer` setter | **Window buffer/bufferName not updated on T-Lisp buffer switch.** The `set currentBuffer(v)` setter (used by `buffer-switch`) updates `state.currentBuffer` and tabs but NOT `window.buffer` or `window.bufferName`. After any T-Lisp buffer switch, the window has stale references. `workspaceToData()` then serializes the wrong buffer name. | Add window `buffer` and `bufferName` updates in the setter, mirroring what `createBuffer()` does. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R4-4 | `src/server/serialize.ts` — `deserializeWindow`/`deserializeTab` | **Missing `bufferName` extraction.** These functions don't extract `record.bufferName`, so the field is lost on `editorStateToJson` → `jsonToEditorState` round-trip. After deserialization, every Window/Tab has `bufferName === undefined`, forcing the workspace path to fall back to the identity check that R3-2 was designed to eliminate. | Add `bufferName: typeof record.bufferName === "string" ? record.bufferName : undefined` to both deserialization functions. |
| R4-5 | `src/editor/editor.ts` — `currentBuffer` setter tab spread | **Tab spread drops `bufferName`.** `{ ...tab, buffer: v }` copies the old `bufferName` from the existing tab, but if the buffer identity has changed, the old name will be incorrect for the new buffer. | Add `bufferName: bufferName` to the spread. |
| R4-6 | `src/server/server.ts` — `handleWorkspaceNew` + `updateLastWorkspace` | **Logical inconsistency from R3-6.** `workspace-new` creates but doesn't activate the workspace (by design: "create only, does not switch"), yet R3-6 added `updateLastWorkspace(name)`. On daemon restart, `readLastWorkspace` returns an unactivated workspace name that was never actually used. | Remove `updateLastWorkspace` from `handleWorkspaceNew`. The spec defines it as "create only." `updateLastWorkspace` belongs in `handleWorkspaceSwitch` only. |
| R4-7 | `bin/tmaxclient` — 4 flags missing `startsWith('-')` guard | `--eval`, `--insert`, `--key`, `--keys` validate existence of the next argument but don't check if it looks like a flag (e.g., `tmaxclient --eval --status` sets `evalCode` to `"--status"`). | Add `|| arg.startsWith('-')` guard to those four flag validations. |

### Minor

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R4-8 | `src/editor/editor.ts` — `exportWorkspace` IIFE | `getEditorState()` clones the entire state object just to extract two fields (`activeMinorModes`, `activeMinorModeLighters`). The R3-9 IIFE fix is correct but overkill. | Extract the two fields directly from the mode state (`getCurrentModeState()`) instead of cloning the full state via `getEditorState()`. |
| R4-9 | `src/server/server.ts` — `handleWorkspaceSwitch` | Double `captureActiveWorkspace()` call (once explicit, once inside `activateWorkspace`) and redundant `activeWorkspaceId` assignment. Not a bug but wastes an export cycle. | Inline the activate logic: capture, save, load, set activeWorkspaceId, apply, updateLastWorkspace. |

### Test coverage gaps

| ID | Fix | Coverage |
|----|-----|----------|
| R4-10 | R3-1 (applyWorkspace window remap via oldBufferNames) | **Missing** — no test verifies `Editor.applyWorkspace()` correctly resolves window buffer references |
| R4-10 | R3-3 (auto-save modified flag clearing) | **Missing** — no test exercises `saveAllDirtyWorkspaces` + `clearModifiedFlags` |
| R4-10 | R3-6/N2 (last-workspace persistence on reconnect) | **Missing** — no test verifies `connect-frame` without workspaceId reconnects via `readLastWorkspace` |
| R4-10 | N3 (rename in-memory workspace) | **Covered** — `workspace-manager.test.ts` |
| R4-10 | N7 (serialization round-trip) | **Done** — serialization and editor apply paths are covered by focused workspace lifecycle tests |
| R5-6 | Frame stale-buffer remap (R5-1) | **Done** — integration coverage verifies a frame remains bound to the current deep-copied workspace buffer after reactivation |
| R5-6 | Inactive workspace render/capture state (R5-2) | **Done** — integration coverage verifies frames in different workspaces render their own buffers/windows without mutating active editor state |
| R5-6 | Explicit workspace last-workspace persistence (R5-3) | **Done** — integration coverage verifies explicit workspace frame connection updates the last-workspace file |

### Verified Correct (round 4)

- R3-1 reverse index in `applyWorkspace()` correctly maps old buffer instances to names
- R3-2 `bufferName` field properly set in `applyWorkspace`, `createBuffer`, initial window creation, and both `workspaceToData`/`dataToWorkspace` implementations
- R3-3 dual modified-flag clearing (workspace + editor `clearModifiedFlags()`) is correct — next `captureActiveWorkspace()` reads `false` from editor's map
- R3-4 argument validation covers all 14 value-taking flags (minus the 4 `startsWith('-')` gaps in R4-7)
- R3-8 `bin/tmaxclient` fully converted to top-level `import` statements, no `require()` remaining
- Auto-save timer `.unref()` is called
- `handleQuery` and `handleRenderState` do not call `activateFrameWorkspace`
- `readLastWorkspace` is used by startup/reconnect paths; explicit `workspace-switch` persists last-active workspace correctly
- Frame-held stale buffer references are resolved through `currentBufferName`, so reactivated frames edit the current workspace buffer instance rather than an obsolete deep-copy reference.

## Patch Review Round 5

Issues found after applying round-4 fixes. Focus: frame/workspace isolation under deep-copy semantics, read-only render correctness, remaining CLI persistence, and incomplete feature acceptance criteria.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R5-1 | `src/server/server.ts` — `syncFrameToEditor` after `activateFrameWorkspace` | **Done:** frame edits now remap to the current workspace/editor buffer instance by `currentBufferName`; stale frame-held buffer references are not trusted after workspace activation. | Verified by integration regression test. |
| R5-2 | `src/server/server.ts` — `frameToEditorState`, `handleRenderState`, `handleCapture` | **Done:** inactive frame render/query state now uses the frame workspace snapshot and keeps `render-state` read-only. | Verified by integration regression test. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R5-3 | `bin/tmax` / `src/server/server.ts` — last-workspace persistence | **Done:** requested `connect-frame` activation persists last-workspace. | Verified by integration regression test. |
| R5-4 | `src/server/server.ts` — auto-save implementation | **Done:** content hash tracking, configurable debounced saves, and max dirty interval are implemented. | Verified by short-interval debounced auto-save integration test. |
| R5-5 | `src/server/server.ts` — `workspace-kill` | **Done:** dirty workspace kill returns a confirmation-required result with dirty buffer names unless confirmed. | Verified by integration regression test. |

### Completed Scope

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R5-6 | `test/` — coverage | **Done:** focused regression tests cover stale frame remap, inactive render state, last-workspace persistence, debounced auto-save, dirty kill prompt, and workspace move-window. | Keep full suite validation tracked in Step 15. |
| R5-7 | `workspace-move-window` / restore conflicts | **Done:** cross-workspace editor-buffer move happy path, same-name target, shared-source-buffer edge cases, restore conflict prompts, and missing-root behavior are implemented and tested. | Covered by focused workspace lifecycle integration tests. |

### Verified Correct (round 5)

- `bun run typecheck:src` passed
- `bun run typecheck:test` passed
- `bun run typecheck` passed
- `bun run test:daemon` passed
- `bun test` passed: 2243 pass, 1 skipped, 0 fail
- Focused workspace tests passed: `bun test test/unit/workspace-manager.test.ts test/unit/workspace-serialization.test.ts test/unit/scrollback-buffer.test.ts test/integration/workspace-lifecycle.test.ts`
- `bun run typecheck:test` passed
- Focused workspace validation passed: `bun test test/unit/workspace-manager.test.ts test/unit/workspace-serialization.test.ts test/unit/scrollback-buffer.test.ts test/integration/workspace-lifecycle.test.ts`
- Result: 103 tests passed, 0 failed

## Patch Review Round 6

Issues found after applying round-5 fixes. Focus: explicit workspace routing, data-loss edge cases in `workspace-move-window`, and dirty-state correctness on failed auto-save.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R6-1 | `src/server/server.ts` — `activateFrameWorkspace` | **Done:** explicit `workspaceId` on frame-aware RPCs now overrides the frame-bound workspace for the operation without rebinding the frame. | Verified by integration regression test. |
| R6-2 | `src/server/server.ts` — `handleWorkspaceMoveWindow` | **Done:** same-name target buffer collisions are rejected before mutation, and source buffer metadata is preserved while remaining source windows/tabs reference it. | Verified by integration regression tests. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R6-3 | `src/server/server.ts` — `saveDirtyWorkspace` | **Done:** auto-save failure restores active editor dirty flags as well as workspace metadata. | Verified by failed auto-save regression test. |
| R6-4 | `test/` — coverage | **Done:** focused integration coverage now exercises R6-1, R6-2, and R6-3. | Keep full validation tracked in Step 15. |

### Verified Correct (round 6)

- `bun run typecheck:src` passed
- `bun run typecheck:test` passed
- `bun run typecheck` passed
- `bun test test/integration/workspace-lifecycle.test.ts` passed: 12 pass, 0 fail
- `bun test` passed: 2247 pass, 1 skipped, 0 fail
- `bun run test:daemon` passed: 19 pass, 0 fail

## Patch Review Round 7

Issues found after applying round-6 fixes. Focus: persistence failure ordering, one-shot workspace override side effects, remaining SPEC completion gaps, and large-workspace save performance.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R7-1 | `src/server/server.ts` — `handleWorkspaceMoveWindow` | **Done:** target workspace is saved before source workspace, preventing durable source removal before target addition. | Verified by failure-injection integration coverage. |
| R7-3 | `docs/specs/SPEC-040-workspace-system.md` — completion state | **Done:** Step 10 crash-style reload/timestamp/performance coverage and Step 13 restore/recovery criteria are complete. | SPEC checkboxes updated after implementation and focused validation. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R7-2 | `src/server/server.ts` — frame-aware explicit `workspaceId` overrides | **Done:** one-shot override handlers restore previous active workspace/frame context in `finally`. | Verified by default/no-frame query regression coverage after an explicit override. |
| R7-4 | `src/server/server.ts` — dirty-save performance | **Done:** successful dirty saves use `saveWithContentHash()` so serialization and persisted hash share the same content traversal. | Verified by unit instrumentation that observes one `getContent()` call during successful save. |
| R7-5 | `test/` — coverage | **Done:** round-7 durability, override, performance, and restore/recovery behaviors are covered. | Verified by focused workspace unit/integration tests. |

### Verified Correct (round 7)

- `bun run typecheck:src` passed
- `bun run typecheck:test` passed
- `bun run typecheck` passed
- `bun test test/integration/workspace-lifecycle.test.ts` passed: 15 pass, 0 fail
- `bun test test/unit/workspace-manager.test.ts test/unit/workspace-serialization.test.ts test/unit/scrollback-buffer.test.ts test/integration/workspace-lifecycle.test.ts` passed: 117 pass, 0 fail
- `bun run test:daemon` passed: 19 pass, 0 fail
- `bun test` passed: 2251 pass, 1 skip, 0 fail

## Patch Review Round 8

Issues found after applying round-7 fixes. Focus: `workspace-move-window` failure rollback, one-shot source override restoration, and layout-only autosave.

### Critical

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R8-1 | `src/server/server.ts` — `handleWorkspaceMoveWindow` | **Done:** target-save failure no longer corrupts in-memory source state. | Source and target workspaces are cloned, mutated as staged snapshots, persisted target-first/source-second, and committed to daemon/editor state only after both saves succeed. Regression coverage injects target-save failure, then explicitly saves/restarts the source and verifies the moved buffer/window remain. |

### Important

| ID | Area | Issue | Fix |
|----|------|-------|-----|
| R8-2 | `src/server/server.ts` — `handleWorkspaceMoveWindow` | **Done:** `sourceWorkspaceId` one-shot override is restored. | The handler captures previous workspace/frame context and restores it in `finally` on success and failure when the source workspace is an override. |
| R8-3 | `src/server/server.ts` — `saveDirtyWorkspace` / workspace dirty tracking | **Done:** layout-only changes are crash-autosaved. | Dirty-save now compares the serialized workspace hash across layout and buffer state and writes when the hash changes, even if no buffer metadata is marked modified. |

### Test Coverage

| ID | Gap | Coverage Required |
|----|-----|-------------------|
| R8-4 | Existing failure-injection coverage checks the source workspace file immediately after target-save failure, but not later in-memory leakage through shutdown or explicit save. | **Done:** regression test injects target save failure, then explicitly saves/restarts the source and verifies the source file still contains the moved buffer/window. |
| R8-5 | No coverage for `workspace-move-window` source override restoration. | **Done:** regression test covers success and failure, proving `sourceWorkspaceId` does not change subsequent default/no-frame behavior after `workspace-move-window`. |
| R8-6 | No coverage for layout-only autosave. | **Done:** short-debounce test changes layout without modifying buffer content, waits for persistence, restarts without relying on graceful shutdown, and verifies layout restoration. |

### Verified Correct (round 8)

- `bun run typecheck:src` passed
- `bun run typecheck:test` passed
- `bun run typecheck` passed
- `bun test test/integration/workspace-lifecycle.test.ts` passed: 17 pass, 0 fail
- `bun test test/unit/workspace-manager.test.ts test/unit/workspace-serialization.test.ts test/unit/scrollback-buffer.test.ts test/integration/workspace-lifecycle.test.ts` passed: 119 pass, 0 fail
- Isolated rerun of full-suite failures passed: `bun test test/unit/error-handling.test.ts test/unit/vim-dispatch.test.ts test/integration/core-bindings.test.ts` passed: 42 pass, 0 fail
- `bun test` full suite failed in the suite-wide run: 2248 pass, 1 skip, 7 fail, 1 inter-test error. The failures were timeout/performance/shared-environment symptoms in unrelated files and passed in isolation, but the full-suite gate remains open until a clean rerun passes.
- `bun run test:daemon` is still running at the time of this spec update and remains open in Step 15 until it exits.

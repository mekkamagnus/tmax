# Workspace System (SPEC-040)

## Status

Accepted

## Context

The daemon supported only a single editor state — one set of buffers, windows, tabs, and cursor positions shared by all frames. This prevented isolated work contexts: switching buffers for one client affected every other client. There was no persistence of editor layout across daemon restarts, so users lost their window splits, tab configuration, and cursor positions every time the daemon restarted.

The Emacs session/desktop model demonstrates the value of named, persistent workspaces that can be switched independently of the files being edited.

## Decision

Implement a multi-workspace system where each workspace owns an isolated buffer map, window layout, tab configuration, cursor state, and mode state.

**WorkspaceManager** (`src/core/workspace.ts`) owns serialization, persistence, and loading:
- Each workspace serialized to `~/.config/tmax/workspaces/<name>.json` using atomic writes (`.json.tmp` → rename)
- Backup files (`.json~`) enable recovery from corrupted primary files
- Per-workspace write queue prevents concurrent save conflicts
- Serialized-content hashing (SHA-256 of layout + buffers) determines auto-save eligibility — avoids redundant writes when only `lastAccessed` changed

**Daemon routing** (`src/server/server.ts`):
- Frames bind to workspaces via `workspaceId`; RPCs route through the correct workspace
- One-shot workspace override: explicit `workspaceId` in RPC params activates workspace temporarily, restores previous active workspace in `finally`
- `workspace-move-window` uses staged commits (clone source/target, save target first, rollback on failure)
- Auto-save timer debounces per-workspace dirty saves, with max-dirty-interval forcing periodic saves

**Deep-copy isolation** (`editor.ts`):
- `applyWorkspace()` reconstructs buffers from `getContent()` to prevent shared references between workspaces
- Reverse index (`Map<FunctionalTextBuffer, string>`) built from OLD workspace buffers before deep-copy resolves window/tab buffer names
- `bufferName?: string` added to Window and Tab types and maintained across all 12 construction sites, avoiding identity checks that break after deep-copy

**Restore behavior**:
- Clean file-backed buffers reread from disk on restore
- Dirty buffers with conflicting disk content emit warnings to `*Messages*`
- Missing project roots emit warnings but don't fail the load

**RPCs added**: `workspace-new`, `workspace-switch`, `workspace-save`, `workspace-load`, `workspace-kill`, `workspace-list`, `workspace-move-window`

**CLI improvements** (`bin/tmaxclient`):
- All 14 value-taking flags validate against missing/flag-like arguments
- Symbolic key parsing for `--key` (Space, Enter, etc.)
- Converted from `require()` to top-level `import` statements

## Consequences

- **Easier**: Multiple projects can be open simultaneously in isolated contexts. Layout persists across daemon restarts. Moving a buffer between workspaces preserves content and cursor state.
- **Harder**: Every RPC handler must correctly route through workspace state. Buffer identity requires `bufferName` caching instead of object reference equality. Test isolation requires per-test HOME and TMAX_WORKSPACE_DIR to prevent cross-contamination.
- **Performance**: Deep-copy on workspace switch copies all buffer contents — acceptable for typical workspace sizes but could be optimized with copy-on-write if needed. Hash-based auto-save eligibility avoids unnecessary serialization.

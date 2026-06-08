# Switch Main Entry Point to Deno-ink UI

## Status

**accepted**

## Context

The tmax editor was migrating from a manual ANSI escape sequence-based terminal UI to a declarative React-based UI using Deno-ink. During this migration (SPEC-009), we encountered critical bugs:

1. **Wrong Entry Point**: The `deno task start` command was still running `src/main.ts` (the old manual terminal version) instead of `src/main-ink.ts` (the new Deno-ink React version)

2. **Filesystem Reference Bug**: The `Editor` class in `src/editor/editor.ts` had 4 locations where it incorrectly accessed `this.state.filesystem` when the filesystem is stored as `this.filesystem` (a class property). This prevented core key bindings from loading during initialization.

3. **Missing Permissions**: The Deno-ink React version requires additional permissions (`--allow-env` for React's NODE_ENV access, `--allow-net` for network requests) that the old terminal version didn't need.

4. **JSR Security Restrictions**: The JSX configuration was pointing to `https://esm.sh/react@18.2.0` which violates JSR's security policy (JSR packages cannot import non-JSR remote modules).

These issues prevented the Deno-ink UI from starting and testing from proceeding.

## Decision

We made the following changes:

1. **Updated `deno.json` Task Configuration**:
   - Changed `start` task from `src/main.ts` → `src/main-ink.ts`
   - Changed `dev` task from `src/main.ts` → `src/main-ink.ts`
   - Added `start-old` task to preserve access to old terminal version
   - Added `--allow-env` and `--allow-net` permissions to all Deno-ink tasks
   - Updated all related tasks (`check`, `bundle`, `compile`)

2. **Fixed Filesystem References in `src/editor/editor.ts`** (4 locations):
   - Line 195: `this.state.filesystem.readFile()` → `this.filesystem.readFile()`
   - Line 256: `this.state.filesystem.readFile()` → `this.filesystem.readFile()`
   - Line 433: `this.state.filesystem.readFile()` → `this.filesystem.readFile()`
   - Line 474: `this.state.filesystem.writeFile()` → `this.filesystem.writeFile()`

3. **Fixed JSX Configuration in `deno.json`**:
   - Changed `jsxImportSource` from `https://esm.sh/react@18.2.0` → `npm:react@18.2.0`

## Consequences

### Positive

- **Application Now Starts**: The Deno-ink UI successfully initializes, enters alternate screen mode, and is ready for user interaction
- **Correct Entry Point**: `deno task start` now runs the intended Deno-ink React version
- **Core Bindings Load**: Key bindings load properly during initialization
- **JSR Compliance**: JSX imports now comply with JSR security requirements
- **Backward Compatibility**: Old terminal version remains accessible via `deno task start-old`
- **Testing Can Proceed**: UI testing via tmux and manual testing is now possible

### Negative

- **Additional Permissions Required**: Users now need `--allow-env` and `--allow-net` permissions (beyond existing `--allow-read`, `--allow-write`, `--allow-run`)
- **Breaking Change**: Default `deno task start` behavior changes (can be mitigated by documenting the change)
- **Network Dependency**: The `--allow-net` permission suggests Deno-ink or React may make network requests (need to investigate if this can be eliminated)

### Neutral

- **Configuration Complexity**: `deno.json` has more complex permission configuration
- **File Structure**: Both `src/main.ts` and `src/main-ink.ts` coexist during migration period

## Related Decisions

- This is part of the larger SPEC-009 migration from manual ANSI terminal UI to Deno-ink React UI
- Future ADRs will document subsequent migration steps (React components, state management, testing)

## Implementation Evidence

The application successfully starts with Deno-ink:
```
Starting tmax editor with Deno-ink...
[?1049h[2J[H[?25l
```

The alternate screen escape sequence (`[?1049h`) confirms Deno-ink renderer is active.

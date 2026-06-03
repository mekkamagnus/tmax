# Chore: Binary Compilation and Distribution System

## ⚠️ STATUS: PARTIALLY COMPLETE - KNOWN LIMITATION

**Current Issue:** Bun's `--compile` has a known limitation with Ink's `yoga-wasm-web` dependency. The WASM file is not being bundled correctly into the compiled binary, causing runtime errors when trying to run the compiled binary.

**Error:** `Cannot find module './yoga.wasm'` when running the compiled binary.

**Workaround:** Users must currently run tmax from source using `bun run src/main.tsx` or the `bin/tmax` launcher script.

**Path Forward:**
1. Wait for Bun to fix WASM bundling in `--compile` (tracked in Bun issues)
2. Or replace Ink with a non-WASM TUI library (major refactoring)
3. Or explore alternative bundling approaches

## Completed Tasks ✅
- Build scripts added to package.json
- .gitignore updated for dist/ directory
- Build orchestration script created (scripts/build-binaries.ts)
- Installation script created (scripts/install.sh)
- --version flag added to main.tsx

## Remaining Tasks 📋
- Fix yoga.wasm bundling issue (blocked on Bun)
- Create CI/CD workflows for automated builds
- Create release packaging script
- Create uninstallation script
- Create Windows installation script
- Create Homebrew formula
- Update README with binary installation instructions
- Create comprehensive installation documentation

---

## Original Chore Description
Implement binary compilation for tmax to create standalone, distributable executables. This will make tmax feel like a "proper" editor that users can install and run directly without needing Bun installed or cloning source code. The implementation includes multi-platform builds, installation scripts, and CI/CD automation for binary distribution.

## Relevant Files
Use these files to resolve the chore:

### Existing Files (Modified)
- `package.json` - Add binary build scripts and `bin` entry point
- `.gitignore` - Exclude compiled binaries from source control
- `README.md` - Add binary installation instructions
- `bin/tmax` - Update launcher script to detect and use compiled binary

### New Files

#### Build Configuration
- `scripts/build-binaries.ts` - Binary build orchestration script
- `scripts/create-release.ts` - Release packaging script

#### Distribution Scripts
- `scripts/install.sh` - Unix/Linux installation script
- `scripts/install.ps1` - Windows installation script
- `scripts/uninstall.sh` - Unix/Linux uninstallation script

#### CI/CD Workflows
- `.github/workflows/build-binaries.yml` - Multi-platform binary builds
- `.github/workflows/release.yml` - Automated release with binaries

#### Homebrew Formula
- `scripts/homebrew-tmax.rb` - Homebrew formula template

#### Documentation
- `docs/INSTALLATION.md` - Comprehensive installation guide
- `RELEASE.md` - Release process documentation

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Test Basic Binary Compilation
- Create `dist/` directory
- Run basic compilation command:
  ```bash
  bun build --compile ./src/main.tsx --outfile ./dist/tmax
  ```
- Test the binary runs: `./dist/tmax --version` or `./dist/tmax --help`
- Verify terminal UI works with compiled binary
- Check file size (expect ~70-100MB due to bundled Bun runtime)

### 2. Add Build Scripts to package.json
Add the following scripts to `package.json`:

```json
{
  "scripts": {
    "build:binary": "bun build --compile ./src/main.tsx --outfile ./dist/tmax",
    "build:binary:macos-arm64": "bun build --compile --target=bun-macos-aarch64 ./src/main.tsx --outfile ./dist/tmax-macos-arm64",
    "build:binary:macos-x64": "bun build --compile --target=bun-macos-x64 ./src/main.tsx --outfile ./dist/tmax-macos-x64",
    "build:binary:linux-x64": "bun build --compile --target=bun-linux-x64 ./src/main.tsx --outfile ./dist/tmax-linux-x64",
    "build:binary:linux-arm64": "bun build --compile --target=bun-linux-aarch64 ./src/main.tsx --outfile ./dist/tmax-linux-arm64",
    "build:binary:all": "bun run build:binary:macos-arm64 && bun run build:binary:macos-x64 && bun run build:binary:linux-x64 && bun run build:binary:linux-arm64",
    "build:binary:clean": "rm -rf dist/"
  }
}
```

### 3. Update .gitignore
Add the following patterns to `.gitignore`:
```
# Compiled binaries
dist/
release/
*.exe
tmax-*
tmax.exe
```

### 4. Create Binary Build Orchestration Script
Create `scripts/build-binaries.ts`:
- Check current platform
- Build appropriate binary for current platform
- Report file size and output location
- Support `--all` flag for cross-platform builds (where supported)
- Add checksum generation (SHA256) for verification

### 5. Create Installation Script (Unix/Linux/macOS)
Create `scripts/install.sh`:
- Detect user's platform and architecture
- Download appropriate binary from GitHub releases
- Verify checksum
- Install to `/usr/local/bin/tmax` or `~/.local/bin/tmax`
- Handle permission errors gracefully
- Support `--prefix` flag for custom install location
- Add uninstallation info

### 6. Create Installation Script (Windows)
Create `scripts/install.ps1`:
- Detect Windows architecture
- Download appropriate binary from GitHub releases
- Install to user's AppData/Local directory
- Add to PATH (with user permission)
- Create desktop shortcut (optional)

### 7. Create Uninstallation Script
Create `scripts/uninstall.sh`:
- Remove binary from installation location
- Clean up any configuration files (with user confirmation)
- Report successful uninstallation

### 8. Update bin/tmax Launcher
Update existing `bin/tmax` script to:
- Check if compiled binary exists and is executable
- Prefer binary over `bun run src/main.tsx`
- Fall back to source execution for development
- Pass through all arguments correctly

### 9. Create GitHub Actions Build Workflow
Create `.github/workflows/build-binaries.yml`:
- Trigger on push to main tag (e.g., `v*`)
- Use matrix strategy for platforms:
  - `ubuntu-latest` (Linux x64)
  - `macos-latest` (macOS arm64)
  - `macos-13` (macOS x64, if available)
- Build platform-specific binary
- Upload binary as workflow artifact
- Generate SHA256 checksums

### 10. Create Release Workflow
Create `.github/workflows/release.yml`:
- Trigger on version tag push
- Download binaries from build workflow
- Create GitHub release with:
  - All platform binaries attached
  - Checksums file
  - Auto-generated changelog
- Publish to npm (optional)

### 11. Create Homebrew Formula Template
Create `scripts/homebrew-tmax.rb`:
- Define installation URL from GitHub releases
- Specify SHA256 checksum (placeholder, filled in release)
- Add conflicts with other editors (if any)
- Include test block to verify installation

### 12. Update README.md Installation Section
Add comprehensive installation options:

```markdown
## Installation

### Option 1: Pre-compiled Binary (Recommended)
```bash
curl -sSL https://tmax.dev/install.sh | bash
```

### Option 2: Homebrew (macOS/Linux)
```bash
brew install tmax-editor/tmax/tmax
```

### Option 3: Manual Download
1. Download from https://github.com/mekkamagnus/tmax/releases
2. Place binary in PATH
3. Run: chmod +x tmax

### Option 4: From Source (Development)
```bash
git clone https://github.com/mekkamagnus/tmax.git
cd tmax
bun install
bun run src/main.tsx
```
```

### 13. Update package.json bin Entry
Ensure `package.json` has:
```json
{
  "bin": {
    "tmax": "./bin/tmax"
  }
}
```

### 14. Create Release Documentation
Create `RELEASE.md`:
- Document release process step-by-step
- Checklist for pre-release (tests, version bump, changelog)
- Instructions for triggering builds
- Post-release tasks (Homebrew tap update, announcements)

### 15. Create Installation Documentation
Create `docs/INSTALLATION.md`:
- Detailed installation guide for all methods
- Troubleshooting common issues
- Platform-specific notes (macOS quarantine, Linux permissions)
- Verification steps to confirm installation

### 16. Add Version Command to Editor
Implement `--version` flag in `src/main.tsx`:
- Read version from `package.json`
- Display: `tmax v0.2.0 (T-Lisp powered terminal editor)`
- Exit cleanly after displaying version

### 17. Test Multi-Platform Builds Locally
- Build for current platform: `bun run build:binary`
- Test binary executes correctly
- Test all basic editor functions through binary
- Verify file operations work
- Check T-Lisp REPL still functions

### 18. Set Up Automated Release Testing
- Add smoke tests to run against compiled binaries
- Test binary can:
  - Start without errors
  - Open a file
  - Save a file
  - Run T-Lisp commands
  - Exit cleanly

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

```bash
# 1. Verify build scripts exist and are executable
cat package.json | grep "build:binary" && echo "✅ Build scripts defined"

# 2. Test basic compilation
mkdir -p dist
bun run build:binary
test -f dist/tmax && echo "✅ Binary created"
file dist/tmax && echo "✅ Binary is executable file"

# 3. Check binary size (should be ~70-100MB)
ls -lh dist/tmax
SIZE=$(stat -f%z dist/tmax 2>/dev/null || stat -c%s dist/tmax 2>/dev/null)
if [ "$SIZE" -gt 50000000 ]; then echo "✅ Binary size reasonable (~$((SIZE/1024/1024))MB)"; fi

# 4. Test binary runs
./dist/tmax --version 2>&1 | head -1 && echo "✅ Binary executes"
./dist/tmax --help 2>&1 | head -1 && echo "✅ Help command works"

# 5. Verify editor still works from source
bun test && echo "✅ All tests pass"

# 6. Test binary can open a file (quick smoke test)
echo "test content" > /tmp/tmax-test.txt
timeout 2s ./dist/tmax /tmp/tmax-test.txt 2>&1 || true
rm -f /tmp/tmax-test.txt

# 7. Verify gitignore excludes binaries
grep "dist/" .gitignore && echo "✅ .gitignore updated"

# 8. Check installation script exists and is valid
test -f scripts/install.sh && echo "✅ Install script exists"
bash -n scripts/install.sh && echo "✅ Install script syntax valid"

# 9. Verify CI workflow files exist
test -f .github/workflows/build-binaries.yml && echo "✅ Build workflow exists"
test -f .github/workflows/release.yml && echo "✅ Release workflow exists"

# 10. Cross-platform build test (if supported)
bun run build:binary:macos-arm64 2>&1 | head -1 && echo "✅ macOS ARM64 build works"
```

## Notes

### Binary Size Considerations
- Compiled Bun binaries are typically 70-100MB
- This includes the full Bun runtime (V8 + TinyCC + Zig)
- Comparable to Deno (~90MB) and larger than Go/Rust binaries (~5-10MB)
- Trade-off: Larger download for zero-dependency installation

### Platform Support Matrix

| Platform | Architecture | Build Host | Status |
|----------|-------------|------------|--------|
| macOS | ARM64 (Apple Silicon) | macOS-latest | Primary |
| macOS | x64 (Intel) | macOS-13 | Primary |
| Linux | x64 | ubuntu-latest | Primary |
| Linux | ARM64 | ubuntu-latest | Secondary |
| Windows | x64 | windows-latest | Future |

### Current Limitations
- Cross-compilation from macOS to Linux works but may have runtime differences
- Windows builds require Windows host or VM for proper testing
- Code signing not implemented (macOS will show quarantine warning)
- No static linking (relies on system libc)

### Installation UX Flow

**User Experience:**
```bash
$ curl -sSL https://tmax.dev/install.sh | bash
Installing tmax v0.2.0...
Detected platform: macOS (arm64)
Downloaded tmax-macos-arm64 (78.2 MB)
Verified SHA256 checksum
Installed to /usr/local/bin/tmax

✓ tmax is now installed!
Run 'tmax' to start editing, or 'tmax --help' for options.
```

### Verification After Installation
Users can verify their installation:
```bash
$ tmax --version
tmax v0.2.0 (T-Lisp powered terminal editor)

$ tmax --help
Usage: tmax [options] [file]

Options:
  -v, --version    Show version and exit
  -h, --help       Show this help message
  --init FILE      Load custom init file
  --dev            Enable development mode (verbose logging)
```

### Future Enhancements
- **Code Signing**: Apple Developer certificate for macOS (removes quarantine warning)
- **Homebrew Tap**: Official formula in homebrew-core or custom tap
- **npm Package**: `bunx tmax` or `npm install -g tmax`
- **AUR Package**: Arch Linux User Repository
- **Snap Package**: Linux universal package format
- **Optimization**: Investigate bun build optimizations to reduce binary size

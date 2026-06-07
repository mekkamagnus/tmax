# tmax Distribution Strategy

**Date:** 2026-06-08
**Status:** Decision memo

## Decision

Ship compiled binaries via GitHub Releases as the primary distribution method. Do not use npm.

## Rationale

### Why not npm

- npm packages are raw JavaScript — anyone can `npm unpack tmax` and read the full source.
- No meaningful obfuscation possible for closed-source software.
- Requires users to already have Node.js or Bun installed, defeating the "zero prerequisites" goal.

### Why Bun `--compile` binary

- Compiles to single executable with embedded bytecode — not trivially readable.
- Zero prerequisites for end users — download and run.
- Bun handles cross-platform compilation: `bun build ./src/main.ts --compile --outfile tmax-macos-arm64`.
- Professional install experience matching the marketing website.
- Natural path to paid tiers later (license keys, gated downloads).

## Binary size comparison

| Editor | Size | Notes |
|--------|------|-------|
| tmax (Bun binary) | 63 MB | Measured on macOS arm64. Bun runtime + 128 modules |
| tmax tlisp (standalone REPL) | 62 MB | Bun runtime + 25 modules |
| Neovim | ~20-30 MB | Compiled binary |
| Emacs | ~100-200 MB | Full build |
| Helix | ~15-25 MB | Rust binary |
| Vim | ~5-15 MB | Minimal |

Actual measured sizes (2026-06-08, macOS arm64, Bun compile). Smaller than initial ~80MB estimate — Bun's binary footprint is better than expected. The bulk is Bun runtime, not editor code. Acceptable for v0.2.0 alpha; track Bun's binary size improvements.

## Local build commands

```json
{
  "build": "bun run build:tmax && bun run build:tlisp",
  "build:tmax": "bun build --compile ./src/main.tsx --outfile dist/tmax",
  "build:tlisp": "bun build --compile ./src/tlisp/cli.ts --outfile dist/tlisp"
}
```

```bash
# Build both
bun run build

# Build individually
bun run build:tmax    # → dist/tmax (63MB, 128 modules)
bun run build:tlisp   # → dist/tlisp (62MB, 25 modules)

# Run
./dist/tmax file.txt
./dist/tlisp          # standalone T-Lisp REPL
```

Multi-platform builds only happen in CI (matching runner OS/arch). Local builds produce a binary for the current platform only.

## Repository layout

```
tmax/
├── dist/           # Build output (gitignored)
├── bin/            # Dev/launcher scripts (committed)
├── src/            # Source code (committed)
├── .github/
│   └── workflows/
│       └── release.yml
└── .gitignore      # dist/ listed
```

- `dist/` is gitignored — binaries never enter git.
- `bin/` stays committed — small shell scripts for dev use.
- CI is the only thing that builds release binaries.

## Release workflow

1. Tag a version: `git tag v0.2.0 && git push origin v0.2.0`
2. GitHub Actions builds per platform (macOS arm64, macOS x64, Linux x64)
3. CI uploads binaries to GitHub Release via `softprops/action-gh-release`
4. Install script pulls the right binary for the user's platform

## Install script

```bash
#!/bin/bash
OS="$(uname -s)"
ARCH="$(uname -m)"
[ "$OS" = "Darwin" ] && OS="macos"
[ "$ARCH" = "arm64" ] && ARCH="arm64" || ARCH="x64"

curl -fsSL "https://github.com/mekkamagnus/tmax/releases/latest/download/tmax-${OS}-${ARCH}" \
  -o /usr/local/bin/tmax
chmod +x /usr/local/bin/tmax
```

Website install: `curl -fsSL tmux.mekaelturner.com/install.sh | bash`

## GitHub Releases limits

| Limit | Free | Pro ($4/mo) |
|-------|------|-------------|
| Per file | 2 GB | 2 GB |
| Total storage | 1 GB | 5 GB |
| Bandwidth/month | 100 GB | 1 TB |

At ~63MB × 3 platforms = ~189MB per release. Keep only latest per platform to stay within free tier for a long time.

## Future considerations

- Homebrew tap for macOS convenience (`brew install tmax`) — no source exposure.
- License server for paid tiers.
- Auto-update mechanism (check latest release tag on startup).
- Consider R2/S3 for hosting if GitHub Releases storage becomes limiting.

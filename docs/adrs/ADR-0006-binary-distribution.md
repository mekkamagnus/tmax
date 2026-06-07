# ADR 0006: Binary Distribution via GitHub Releases

**Date**: 2026-06-08
**Status**: Accepted

## Context

tmax needs a distribution strategy. Two options considered: npm package and compiled binaries. npm packages ship raw JavaScript — unacceptable for closed-source software. Bun's `--compile` produces self-contained executables with embedded bytecode.

## Decision

Ship compiled binaries via GitHub Releases as the primary (and only) distribution method. Do not publish to npm.

### Build

```bash
bun build --compile ./src/main.tsx --outfile dist/tmax
bun build --compile ./src/tlisp/cli.ts --outfile dist/tlisp
```

- `dist/tmax` — full editor (63 MB, 128 modules, macOS arm64)
- `dist/tlisp` — standalone T-Lisp REPL (62 MB, 25 modules, macOS arm64)
- `dist/` is gitignored — binaries never enter git

### Release flow

1. Tag: `git tag v0.2.0 && git push origin v0.2.0`
2. GitHub Actions builds per platform (macOS arm64, macOS x64, Linux x64)
3. CI attaches binaries to GitHub Release
4. Install script pulls the right binary for the user's platform

### Local workflow

```bash
bun run build                        # build both binaries
./scripts/link.sh                    # symlink to /usr/local/bin
```

## Rationale

- **Closed-source protection**: Bun `--compile` embeds bytecode, not trivially readable
- **Zero prerequisites**: Users download and run, no runtime needed
- **Professional UX**: `curl | bash` install matching the marketing website
- **Future-proof**: Natural path to license keys, paid tiers, auto-updates

## Consequences

- Must maintain GitHub Actions CI for cross-platform builds
- ~63 MB per binary (mostly Bun runtime, acceptable for alpha)
- No npm discoverability — marketing website is the only discovery path
- Per-release storage on GitHub Releases: ~189 MB (3 platforms × ~63 MB)

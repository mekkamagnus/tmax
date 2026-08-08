# ADR-0201 — Magic (content-based) major-mode detection (`#170` / SPEC-103)

## Status

Accepted

## Context

tmax detected modes only from the filename. Scripts without an extension
(`deploy`, `entrypoint`), generically-named config, and generated markup (XML/
HTML feeds) fell through to `fundamental-mode`. Emacs sniffs the buffer content
(`magic-mode-alist`, `magic-fallback-alist`, `interpreter-mode-alist`).

## Decision

Added a **content-sniffing** step to `major-mode-auto-detect`, slotted between
filename detection and the default. Full precedence: file-local (SPEC-102) >
filename (`auto-mode-alist`) > **magic (this)** > default (SPEC-104).

1. **Detectors** in new `src/editor/magic-mode.ts`:
   - `detectShebang(text, registeredModes)` — `#!/usr/bin/env bash` /
     `#!/bin/bash` → interpreter → mode via a built-in map (bash/sh → shell,
     python → python, node → typescript [tmax's JS mode]). Only mapped when the
     mode is registered.
   - `detectMagicMode(text, userRules, fallbackRules)` — runs regexps against
     the first 512 bytes; **user rules before fallback**; first match wins.
     Malformed regexps are skipped (try/caught), not fatal.

2. **API** — `(major-mode-magic MODE REGEXP)` lets a mode register a fallback
   signature; `(magic-mode-add REGEXP MODE)` lets a user add a rule (precedence
   over fallback); `(magic-mode-rules)` lists all.

3. **State** — `magicUserRules` + `magicFallbackRules` on `MajorModeDomainState`.

4. **Self-registration** — `html-mode` ships `^<!DOCTYPE` and `^<html`; `xml-mode`
   ships `^[<][?]xml` (`<?xml` prolog). Shebang handling is built-in (code).

### Filename still wins

`major-mode-auto-detect` returns the filename result **before** calling
`resolveMagic`, so `x.sh` with HTML content stays `shell-mode`.

### Escape caveat (T-Lisp reader)

The T-Lisp reader double-processes string escapes, so a `.tlisp` magic regexp
like `"^\s*<"` is mangled. The shipped signatures are **backslash-free**
(`^<!DOCTYPE`, `^<html`, `^[<][?]xml` — char classes avoid escaping `?`).
`(magic-mode-add ...)` users should likewise prefer backslash-free patterns, or
use the 4-backslash workaround (same constraint as indent rules, #151).

## Consequences

- Extension-less shebang scripts detect by interpreter.
- `<?xml` and `<!DOCTYPE html` detect (for the registered xml/html modes).
- Filename detection wins when it matches; no regression.
- User magic rules beat fallback rules; `(magic-mode-rules)` introspects.
- Anchored, bounded (512-byte head), try/caught regexps — no ReDoS / crash risk.

## Verification

`bun run typecheck` clean; `bun run build` succeeds;
`bun test test/unit/magic-mode-detect.test.ts` → 14/14 pass (scanner + shebang
variants + html/xml self-registration + filename-beats-magic + user API +
rules list + no-match→default); 20/20 regression across file-local/default/open.
Verify-gate (adversarial, 2-agent) verdict: **PASS**.

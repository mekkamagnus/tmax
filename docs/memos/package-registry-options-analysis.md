# Options Analysis: T-Lisp Package Registry

**Date:** 2026-06-05
**Depends on:** RFC-005 (module system), SPEC-007 (module system implementation)
**Purpose:** Evaluate registry architectures for T-Lisp packages and recommend one

---

## Requirements

A T-Lisp package registry must serve:

1. **Discovery** — Find packages by name, keyword, or capability
2. **Installation** — One command to add a dependency
3. **Publishing** — Authors can release versions with minimal friction
4. **Integrity** — Installed packages match what was published
5. **Namespace stability** — Published versions are immutable; dependents don't break
6. **Author identity** — Users know who published a package
7. **Dependency resolution** — Transitive deps resolve to compatible versions
8. **Small ecosystem fit** — Works well with tens to hundreds of packages, not just thousands

---

## Option A: JSR-Style (Scoped, Centralized, Strict)

**Model:** All packages are scoped `@author/package`. Centralized registry hosts packages and metadata. Publishing validates the manifest against the module's actual exports. Browser-based OAuth for authentication.

**Reference:** [jsr.io](https://jsr.io) (Deno/TypeScript registry, launched 2024)

### How it works

```
@mekael/git-blame
├── tpkg.json       { "name": "@mekael/git-blame", "exports": [...] }
├── plugin.tlisp
└── README.md
```

- **Naming:** `@scope/pkg` — scope is globally unique, tied to account. No unscoped packages.
- **Manifest:** `tpkg.json` with `name`, `version`, `exports`, `dependencies`. The `exports` field is validated against `defmodule`'s export list at publish time.
- **Publishing:** `tmax pkg publish` — registry validates manifest matches code, rejects if exports don't align. Browser OAuth flow (no stored tokens by default). OIDC for CI publishing.
- **Versioning:** Semver. Immutable once published.
- **Installation:** `tmax pkg install @mekael/git-blame` — resolves to `~/.config/tmax/packages/mekael/git-blame/`.
- **Security:** Scope-level roles (admin/member). CI-only publishing option. OIDC provenance links package to specific CI run.

### Strengths

- **No name squatting** — `@mekael/git-blame` and `@alice/git-blame` coexist. The problem that plagues crates.io (flat namespace) doesn't exist.
- **Exports validated at publish** — Registry confirms the manifest's `exports` matches the code's `(export ...)`. This catches stale manifests before users see them.
- **Modern auth** — Browser OAuth + OIDC means no long-lived tokens on developer machines. Reduces credential leak risk.
- **Aligns with RFC-005 design** — The `tpkg.json` manifest was already sketched with scoped names (`mekael/git-blame`). JSR's model maps directly.

### Weaknesses

- **Requires hosting infrastructure** — Centralized means we run a server, storage, CDN. Cost and operational burden for a small ecosystem.
- **All-or-nothing scoping** — No unscoped packages means even `tmax/vim-motions` needs the `tmax/` prefix. Slightly verbose for first-party packages.
- **New registry** — JSR launched 2024 and is still maturing. The model is less battle-tested than npm (2010) or crates.io (2014).

### T-Lisp fit

| Requirement | Assessment |
|---|---|
| Discovery | Strong — centralized search, scope browsing |
| Installation | Strong — single command, auto-resolves deps |
| Publishing | Strong — validated publish, OAuth |
| Integrity | Strong — immutable versions, provenance |
| Namespace stability | Strong — scoped names prevent collisions |
| Author identity | Strong — scope = account |
| Dependency resolution | Strong — semver resolution |
| Small ecosystem fit | Moderate — infrastructure overhead for few packages |

---

## Option B: crates.io-Style (Flat, Centralized, API Token)

**Model:** Flat, globally unique package names. First-come-first-served. Centralized registry with API token authentication. Manifest is `tpkg.json` (TOML alternative would be unusual for a Lisp ecosystem — stick with JSON).

**Reference:** [crates.io](https://crates.io) (Rust registry, launched 2014)

### How it works

```
git-blame/
├── tpkg.json       { "name": "git-blame", "version": "1.3.0", ... }
├── plugin.tlisp
└── README.md
```

- **Naming:** Flat — `git-blame`, `vim-motions`, `org-mode`. Globally unique, first-come.
- **Manifest:** `tpkg.json` with `name`, `version`, `description`, `license`, `dependencies`.
- **Publishing:** `tmax pkg publish` — API token stored in `~/.config/tmax/credentials.json`. Validates crate compiles (in T-Lisp: validates `defmodule` parses and exports are resolvable).
- **Versioning:** Semver. Immutable. Yank available (prevents new dependents, doesn't remove).
- **Installation:** `tmax pkg install git-blame` — resolves to `~/.config/tmax/packages/git-blame/`.
- **Security:** API token. No built-in 2FA. Yank for soft-removal.

### Strengths

- **Proven at scale** — crates.io hosts 180K+ crates. The model works.
- **Simple naming** — `git-blame` is shorter than `@mekael/git-blame`. Easier to type and remember.
- **Lower infrastructure** — Flat namespace is simpler to index and search than scoped.
- **Yank is the right primitive** — You can't delete a published version (preserving dependents), but you can prevent new projects from adopting it. npm's 72-hour unpublish window was a band-aid; yank is the mature solution.

### Weaknesses

- **Name squatting** — The defining problem of flat namespaces. crates.io struggles with this continuously. With a small ecosystem, early squatters grab generic names.
- **No author disambiguation** — `git-blame` by mekael vs `git-blame` by someone else? Only one can exist. Scope disputes require admin intervention.
- **Token-only auth** — No browser OAuth or OIDC. Tokens get committed to git, stolen from CI logs, etc.
- **Doesn't align with RFC-005** — The module system uses `editor/motions` naming (path-based). Flat `git-blame` doesn't compose with hierarchical module names.

### T-Lisp fit

| Requirement | Assessment |
|---|---|
| Discovery | Moderate — flat search, no scope browsing |
| Installation | Strong — single command |
| Publishing | Moderate — token auth, no export validation |
| Integrity | Strong — immutable + yank |
| Namespace stability | Weak — collisions, squatting |
| Author identity | Weak — name only, no account binding |
| Dependency resolution | Strong — semver |
| Small ecosystem fit | Strong — simple, low overhead |

---

## Option C: npm-Style (Scoped + Unscoped, Centralized)

**Model:** Supports both scoped (`@author/pkg`) and unscoped (`pkg`) names. Centralized registry with mature tooling. API tokens with optional 2FA. The most widely-used registry model.

**Reference:** [npmjs.com](https://npmjs.com) (Node.js registry, launched 2010)

### How it works

```
# Scoped
@mekael/git-blame/
├── tpkg.json       { "name": "@mekael/git-blame", ... }

# Unscoped
git-blame/
├── tpkg.json       { "name": "git-blame", ... }
```

- **Naming:** `@scope/pkg` or flat `pkg`. Scoped packages can be private (access-restricted).
- **Manifest:** `tpkg.json` with `name`, `version`, `exports`, `dependencies`, `files`.
- **Publishing:** `tmax pkg publish` — token + optional OTP. Supports `--tag` for release channels (latest, beta, next).
- **Versioning:** Semver with dist-tags. `latest` is default; custom tags for pre-release channels.
- **Security:** API tokens (granular, automation, legacy), OTP 2FA, provenance signing, integrity hashes.

### Strengths

- **Most battle-tested model** — 16 years, 2M+ packages. Every edge case has been hit and addressed.
- **Flexibility** — First-party packages use short names (`vim-motions`), third-party uses scopes (`@mekael/git-blame`). Best of both worlds.
- **Dist-tags** — `--tag next` for beta releases is genuinely useful. Users opt into pre-release channels.
- **Provenance and signing** — npm's supply chain security is the most mature of any registry.

### Weaknesses

- **Two naming systems** — Supporting both scoped and unscoped is confusing for users. "Should I scope my package?" is a constant question. JSR avoided this by requiring scopes.
- **The unscoped namespace has all of crates.io's problems** — Squatting, typosquatting, name disputes. npm's unscoped namespace is a mess.
- **Complex auth** — Token types, granular permissions, OTP — it's powerful but heavy for a small ecosystem. We'd be building complex auth infra for 50 packages.
- **Historical baggage** — npm's left-pad incident (2016) led to the 72-hour unpublish policy, which is a band-aid. The lesson is: don't support unscoped packages.

### T-Lisp fit

| Requirement | Assessment |
|---|---|
| Discovery | Strong — search, scope browsing, keywords |
| Installation | Strong — single command, dist-tags |
| Publishing | Strong — validated, 2FA, provenance |
| Integrity | Strong — immutable, signed, hashed |
| Namespace stability | Moderate — scoped is stable, unscoped is not |
| Author identity | Strong for scoped, weak for unscoped |
| Dependency resolution | Strong — semver + dist-tags |
| Small ecosystem fit | Weak — too much complexity for early stage |

---

## Option D: Racket-Style (Decentralized Index)

**Model:** The registry is an index that maps package names to external source URLs (GitHub repos, archives). Packages are not hosted by the registry. Installation fetches from the original source.

**Reference:** [pkg.racket-lang.org](https://pkg.racket-lang.org) (Racket catalog)

### How it works

```
# Registry entry (index only):
"git-blame" → { source: "https://github.com/mekael/tmax-git-blame", checksum: "..." }

# Package lives on GitHub:
mekael/tmax-git-blame/
├── tpkg.json
└── plugin.tlisp
```

- **Naming:** Flat, content-based. Names describe purpose, not author.
- **Manifest:** `tpkg.json` with metadata fields.
- **Publishing:** No explicit publish step. Register the source URL with the catalog. The catalog polls for updates within 24 hours.
- **Versioning:** Checksum-based, not semver. Updates detected by checksum change.
- **Security:** Minimal — catalog indexes sources but doesn't host or verify content.

### Strengths

- **Zero hosting cost** — We run an index, not a package host. GitHub/GitLab/whatever hosts the actual files.
- **Simplest infrastructure** — A static JSON file could serve as the catalog.
- **Source-available by default** — Packages point to repos, so source is always accessible.
- **No auth system needed** — Catalog just indexes public URLs.

### Weaknesses

- **No semver** — Checksum-based versioning means no `^1.2.0` dependency constraints. This is the single biggest problem. Every successful registry (npm, crates.io, JSR, clojars) uses semver. Without it, dependency resolution is guesswork.
- **24-hour update delay** — Racket's catalog polls daily. Publishing an update and having users see it immediately is not possible without adding polling infrastructure.
- **No integrity guarantee** — Author can change the content at the source URL without changing the catalog entry. The checksum changes, but nothing stops the author from serving different content to different users.
- **No offline installation** — Installing requires reaching the original source (GitHub), not just the registry. If the source goes down, installation fails.
- **No publish validation** — No way to verify exports match manifest, deps resolve, or code parses before users see it.

### T-Lisp fit

| Requirement | Assessment |
|---|---|
| Discovery | Weak — flat index, no search |
| Installation | Moderate — extra network hop to source |
| Publishing | Moderate — register URL, no validation |
| Integrity | Weak — no hosting, checksum-only |
| Namespace stability | Weak — flat naming, no immutability |
| Author identity | Weak — name only |
| Dependency resolution | Weak — no semver |
| Small ecosystem fit | Strong — zero infrastructure |

---

## Option E: Clojars-Style (Maven-Compatible, Group Verification)

**Model:** Maven-style `groupId/artifactId` naming. Centralized registry with deploy tokens. Groups can be verified via DNS or GitHub org membership.

**Reference:** [clojars.org](https://clojars.org) (Clojure registry)

### How it works

```
com.mekael/git-blame/
├── tpkg.json       { "name": "com.mekael/git-blame", ... }
├── plugin.tlisp
└── README.md
```

- **Naming:** `groupId/artifactId`. Groups verified via DNS TXT record or GitHub org proof. Auto-created groups: `org.tmax.username`.
- **Manifest:** `tpkg.json` or Maven POM.
- **Publishing:** `tmax pkg publish` — deploy token, scoped to group. POM validation, checksum verification.
- **Versioning:** Semver. Immutable (non-SNAPSHOT). SNAPSHOT versions are mutable development builds.
- **Security:** Deploy tokens scoped to groups. Group verification prevents impersonation.

### Strengths

- **Group verification** — DNS TXT or GitHub org proof prevents impersonation. `com.mekael` can only be registered by someone who controls `mekael.com` DNS or the `mekael` GitHub org. This is the right primitive for author identity.
- **Deploy tokens scoped to groups** — Token can only publish to the verified group. Even if leaked, blast radius is limited.
- **SNAPSHOT versions** — Mutable development versions for active development. Useful for testing before a formal release.
- **Maven compatibility** — If T-Lisp ever needs to interop with JVM tooling, the naming is compatible. (Unlikely for a terminal editor, but noted.)

### Weaknesses

- **Reverse DNS naming is confusing** — `com.mekael/git-blame` is less intuitive than `@mekael/git-blame`. Users need to understand DNS conventions.
- **DNS verification requires a domain** — Individual contributors without a personal domain can't verify a group. They fall back to `org.tmax.username` which is uncreative but works.
- **SNAPSHOT is a footgun** — Mutable versions in a registry that otherwise enforces immutability. "Works on my machine" becomes "works with my SNAPSHOT but not yours."
- **Clojure-specific tooling** — Clojars is built around Leiningen and Maven. Adapting it for T-Lisp means significant customization.

### T-Lisp fit

| Requirement | Assessment |
|---|---|
| Discovery | Moderate — group browsing, search |
| Installation | Strong — single command, semver |
| Publishing | Strong — validated, group-scoped tokens |
| Integrity | Strong — immutable + checksums |
| Namespace stability | Strong — verified groups prevent collisions |
| Author identity | Strong — DNS/org verification |
| Dependency resolution | Strong — semver |
| Small ecosystem fit | Moderate — DNS verification is heavy for early stage |

---

## Comparative Summary

| Criterion | JSR (A) | crates.io (B) | npm (C) | Racket (D) | Clojars (E) |
|---|---|---|---|---|---|
| **Name collision prevention** | Strong (scoped) | Weak (flat) | Moderate (both) | Weak (flat) | Strong (verified groups) |
| **Semver dependency resolution** | Yes | Yes | Yes | No | Yes |
| **Publish validation** | Exports matched | Compile check | Minimal | None | POM check |
| **Auth model** | OAuth + OIDC | API token | Token + OTP | None | Deploy token |
| **Infrastructure complexity** | High | High | High | Low | Medium |
| **Small ecosystem fit** | Moderate | Strong | Weak | Strong | Moderate |
| **Aligns with RFC-005 design** | Direct | Partial | Partial | No | Partial |
| **Immutability** | Yes | Yes (yank) | Yes (72h window) | No | Yes |
| **Supply chain security** | OIDC provenance | Minimal | Provenance + signing | None | Token scoping |
| **Naming convention** | `@scope/pkg` | `pkg` | `@scope/pkg` or `pkg` | `pkg` | `group/artifact` |

---

## Recommendation

**Option A (JSR-Style) with crates.io's yank primitive.**

### Why JSR

1. **Scoped names align with the module system.** RFC-005's module naming uses `editor/motions`, `editor/commands/operators`. Packages use `@mekael/git-blame`. Both are path-like, hierarchical names. This is one mental model, not two.

2. **Export validation at publish time is the right check.** T-Lisp's module system has explicit `(export ...)` lists. The registry should verify that `tpkg.json`'s `exports` field matches the code's actual exports. JSR does exactly this ("slow types" rejection is their version). This prevents stale manifests — a real problem when authors forget to update `tpkg.json` after adding a function.

3. **No name squatting.** The JSR lesson from crates.io is clear: flat namespaces are a governance nightmare. `@mekael/git-blame` and `@alice/git-blame` coexist. No admin intervention needed.

4. **Browser OAuth lowers the barrier.** No tokens to manage, no credentials to leak. For a small ecosystem where most authors publish from their laptop, this is the right default. OIDC for CI is a bonus.

### Why steal yank from crates.io

npm's 72-hour unpublish is a band-aid. JSR has no deletion. crates.io's yank is the right primitive:
- Published versions are never deleted (dependents stay working)
- Yanked versions are excluded from new resolution (new projects can't adopt them)
- Yank is reversible (un-yank if it was accidental)

### What NOT to take

- **Not npm's dual naming** — Supporting both scoped and unscoped is complexity without benefit for a young registry. Require scopes.
- **Not Racket's decentralization** — No semver is a dealbreaker. No hosting means no integrity guarantee. The infrastructure cost is worth paying.
- **Not Clojars' DNS verification** — Too heavy for early stage. GitHub OAuth as identity provider is sufficient. DNS verification can be added later if needed.

### Phased approach

The registry doesn't need to launch at full scale:

**Phase 1: Local-only (with SPEC-007)**
- Module system works. Packages are directories in `~/.config/tmax/packages/`.
- No registry. Users manually place packages.
- `tpkg.json` is the manifest format, but no server validates it.

**Phase 2: Centralized index**
- Static catalog (JSON file served over HTTPS) listing available packages.
- `tmax pkg search` queries the catalog.
- `tmax pkg install @mekael/git-blame` downloads from the catalog.
- GitHub OAuth for publish. No OIDC yet.
- Export validation at publish time.

**Phase 3: Full registry**
- API server with search, version history, download counts.
- OIDC for CI publishing.
- Provenance signing.
- Web UI for browsing.

This defers infrastructure cost until the ecosystem justifies it. The module system (SPEC-007) is the foundation that makes all three phases work.

---

## `tpkg.json` Specification

The manifest format, consistent across all phases:

```json
{
  "name": "@mekael/git-blame",
  "version": "1.3.0",
  "description": "Inline git blame annotations for tmax",
  "author": "Mekael Turner",
  "license": "MIT",
  "tmax": "^0.2.0",
  "module": "plugin.tlisp",
  "exports": ["git-blame", "git-blame-line", "git-blame-mode"],
  "dependencies": {
    "tmax/completion": "^1.0.0"
  },
  "commands": {
    "git-blame": "Show git blame for current line",
    "git-blame-mode": "Toggle automatic blame annotations"
  },
  "keywords": ["git", "blame", "vcs"],
  "repository": "https://github.com/mekael/tmax-git-blame"
}
```

**Field rules:**
- `name` — Required. Must be `@scope/pkg` format. Scope matches the author's account.
- `version` — Required. Semver.
- `exports` — Required. Must match the `defmodule` export list. Validated at publish time.
- `module` — Required. Entry point file. Defaults to `plugin.tlisp`.
- `dependencies` — Map of `@scope/pkg` to semver range. Resolved transitively at install time.
- `commands` — Map of command name to description. Auto-registered for `M-x` discovery.
- `tmax` — Editor version constraint. Like `engines` in `package.json`.
- `keywords` — For search. Max 10.
- `license` — Required for publish. SPDX identifier.

### File layout

```
~/.config/tmax/
├── init.tlisp
├── packages/
│   ├── mekael/
│   │   └── git-blame/
│   │       ├── tpkg.json
│   │       ├── plugin.tlisp
│   │       └── README.md
│   └── community/
│       └── org-mode/
│           ├── tpkg.json
│           └── plugin.tlisp
└── package-lock.json
```

### CLI commands

```bash
tmax pkg install @mekael/git-blame     # Install package + deps
tmax pkg uninstall @mekael/git-blame   # Remove package
tmax pkg publish                       # Publish current directory
tmax pkg search "git"                  # Search catalog
tmax pkg list                          # List installed packages
tmax pkg outdated                      # Check for updates
tmax pkg update                        # Update all packages
```

---

## Open Questions

1. **Should first-party packages use `@tmax/` prefix or be unscoped?** Recommend `@tmax/` — one naming model everywhere. The prefix is 6 extra characters and eliminates the "is this official?" question.

2. **Should packages be allowed to depend on specific editor versions?** The `tmax` field exists for this. Start with a warning (not an error) when the editor version doesn't match.

3. **Should the registry host source files or only metadata?** Host source files. Racket's index-only approach means no integrity guarantee. Hosting means we can validate, sign, and serve reliably.

4. **What's the minimum viable registry?** A static JSON catalog on GitHub Pages + a `tmax pkg` CLI that reads it. No API server needed for Phase 2. The CLI can parse the JSON and download tarballs from GitHub releases.

5. **Should packages support multiple modules?** Yes — a package can have multiple `.tlisp` files each with their own `defmodule`. The `exports` field in `tpkg.json` is the union of all modules' exports.

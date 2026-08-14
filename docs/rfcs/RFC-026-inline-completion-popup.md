# RFC-026: Inline Completion-at-Point Popup

**Status:** Proposed — *not approved for implementation*
**Date:** 2026-08-14
**Related:** [SPEC-116-wiki-link-follow-create](../specs/SPEC-116-wiki-link-follow-create.md) (the plumbing this builds on), [RFC-019](RFC-019-performance-audit.md) (the latency discipline), ADR-0212 (the cache-invalidation pattern), the M-x completion machinery (`completing-read` + command-completion-refresh)

## Summary

A proposal for **type-time completion at point** in tmax: a popup rendered at
the cursor that offers candidates (note names inside `[[…]]` first, extensible
to other sources) while you type, so linking and authoring happen without a
context switch. This is the layer SPEC-116 deliberately deferred: that spec
ships follow-or-create with a **minibuffer** prompt plus the reusable plumbing
(note-candidate source + resolve-or-create core); this RFC specifies the inline
popup UI that consumes the same core.

This RFC is a design proposal only. It exists so the SPEC-116 plumbing is
shaped correctly *now* and the popup can be added later without rework.

## Motivation

The minibuffer prompt (SPEC-116) is the right surface for an occasional,
deliberate act — following a link. It is the wrong surface for the *authoring*
moment: while writing, you want candidates to appear as you type
`[[mar…`, refine per keystroke, and accept without leaving the sentence.
That is a different interaction with different requirements:

- **Frequency**: many times per minute, not once per link.
- **Inline-ness**: eyes and cursor never leave the text.
- **Dedup at the moment of reference**: the single best point to prevent
  orphan notes is when the link is *written*, not when it's followed.

What completion-at-point additionally buys over the follow-time prompt:
convergence to canonical names while typing, recall of forgotten notes,
multi-source candidates (titles + aliases + headings), and a post-commit hook
point for actions on what was accepted.

## Design

### 1. The completion hook (`completion-at-point-functions`)

An Emacs-capf-style registry: an ordered list of **sources**, each a function
returning `(bounds candidates . properties)` for the text at point, or nil to
decline. First source to return wins.

- **Source: wiki-link note names** — active when point is inside `[[…]]`;
  candidates from SPEC-116's `markdown-vault-notes` (via the completion
  table), the typed text as the filter prefix.
- Future sources: `#heading` inside links, frontmatter `aliases:`, tag
  completion, and general word completion.

**Properties per source**:
- `:exit-function` — a hook fired on accept (the create-if-new side effect
  routes to SPEC-116's resolve-or-create dispatch; this is the *only* place
  creation is triggered, and it must show an explicit `+ Create:` candidate,
  never infer creation from a non-match).
- `:annotation-function` — candidate metadata (backlink count, dangling flag).
- `:company-prefix-length`-style minimum prefix (don't fire on bare `[[`).

### 2. Popup rendering in the TUI

The frame renderer (captureFrame) already composites an overlay layer (the
which-key pane). Extend that mechanism to a **candidate menu at point**:

- **Geometry**: anchored at the cursor; flips above/below on viewport edges;
  width capped (truncate with ellipsis); max N visible rows with scroll state.
- **Degradation**: when the terminal is too narrow, the candidate list too
  long to be useful, or overlay compositing is unavailable — **fall back to
  the SPEC-116 minibuffer prompt**. The popup is an enhancement, never a
  dependency.
- **Coexistence**: rules for stacking against the which-key overlay and the
  status line (which-key yields while completion is active).

### 3. Key-routing state machine

While the popup is active every keystroke is disambiguated:

| Key | Meaning |
|-----|---------|
| printable | self-insert + refilter |
| `C-n`/`C-p`, arrows | move selection |
| `TAB` | accept candidate |
| `RET` | accept candidate and continue (policy: configurable; see open questions) |
| `C-g` | dismiss, leave text as typed |

The Enter ambiguity (accept vs. newline) is the classic papercut — the default
above keeps `RET` as accept-and-continue so accepting never fights prose
flow; newline stays literal otherwise.

### 4. Latency budget and index cache

The popup must re-filter + re-render **per keystroke**; the budget is a frame
or two (~30ms), not the minibuffer's tolerant tens. Lessons already paid for:

- The M-x candidate build was ~280ms uncached (BUG-78/#182) — the vault index
  **must** ship cached from day one, not as an optimization.
- **Cache**: a vault index (names, paths, and later backlink counts) held per
  session, invalidated by a generation counter bumped on note create/rename/
  delete — the exact pattern of `module-registry-generation` (ADR-0212). The
  SPEC-116 primitives are the uncached on-demand scan; the cached index wraps
  them and lives here.
- Debounce/min-prefix thresholds; candidates enumerated once per prefix
  change, not per render.

### 5. Migration path

1. SPEC-116 ships the follow-time prompt + plumbing (no popup).
2. This RFC adds the capf hook with the wiki-link source, popup UI, and the
   cached index — **additively**. The minibuffer prompt remains the fallback
   (narrow terminals) and the command-like path (follow still prompts).
3. Later sources (aliases, headings, tags) register on the same hook.

No user-visible behavior changes until the popup is enabled; the fallback
guarantees the feature degrades to today's UX.

## Drawbacks / Open Questions

- **Rendering cost**: a scrollable, live-filtered overlay is a real rendering
  subsystem (geometry, flicker, resize) — the largest chunk of this RFC.
- **Vault-scale behavior**: unmeasured on large vaults (thousands of notes);
  the index cache must be benchmarked before shipping (bench, in the spirit
  of RFC-019/CHORE-84 — a `minibuffer`-style benchmark for the index).
- **Fuzzy vs prefix default** for candidate filtering (orderless is
  discoverable but unpredictable; prefix is the opposite). Proposal: fuzzy
  default, configurable.
- **Enter/Tab policy** — accept-and-continue proposed; needs user validation.
- **Alias support** (frontmatter `aliases:`) — valuable, but adds index
  surface; defer to a source of its own.
- **Accessibility/noise**: popup flicker while typing prose; mitigate with
  min-prefix + debounce; needs a user preference to disable outright (falling
  back to the SPEC-116 prompt everywhere).

## Status

Proposal only. Implementation should follow SPEC-116 (which shapes the
plumbing for this RFC) and requires: the cached index, a benchmark for it, and
a rendering spike for the at-point overlay before any of this is scheduled.

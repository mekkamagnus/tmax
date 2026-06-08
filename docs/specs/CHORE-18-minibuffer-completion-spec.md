# Chore: Consolidate Minibuffer Completion User Stories into HTML Spec

## Chore Description
Create an HTML specification document that consolidates all minibuffer completion user stories (derived from the Emacs Vertico/Corfu/Cape/Orderless/Marginalia setup) into a single, well-structured spec. The spec must:
1. Be a single HTML file with embedded CSS matching the tmax dark-theme spec style (see SPEC-009-tlisp-diagnostics-debugging.html for the design system).
2. Organize user stories by subsystem (Vertico, Orderless, Marginalia, Corfu, Cape, Consult, Embark, Savehist, Which-Key).
3. Include acceptance criteria for every user story (Given/When/Then format).
4. Include a high-definition ASCII/Unicode terminal mockup of the minibuffer for each user story, rendered as a styled `<pre>` block that visually demonstrates the layout being described.

The user stories are documented in the current conversation context and cover the full Emacs completion stack (Vertico vertical minibuffer, Orderless component matching, Marginalia annotations, Corfu popup, Cape extensions, Consult enhanced search, Embark context actions, Savehist persistence, Which-Key discovery).

## Relevant Files

### Reference Files
- `specs/SPEC-009-tlisp-diagnostics-debugging.html` — HTML design system (colors, typography, card layout, code blocks). The new spec must reuse this visual language exactly.
- `src/tlisp/core/completion/vertico.tlisp` — Current tmax vertico implementation for cross-referencing
- `src/tlisp/core/completion/minibuffer.tlisp` — Current tmax minibuffer state machine
- `src/tlisp/core/completion/orderless.tlisp` — Current tmax orderless style
- `src/tlisp/core/completion/marginalia.tlisp` — Current tmax marginalia annotations
- `src/tlisp/core/completion/completion.tlisp` — Current tmax completion protocol
- `src/frontend/render/minibuffer.ts` — Current tmax minibuffer renderer

### New Files
- `specs/SPEC-011-minibuffer-completion.html` — The consolidated HTML spec document

## Step by Step Tasks

### Create the HTML spec file
- Create `specs/SPEC-011-minibuffer-completion.html` with the full dark-theme design system from SPEC-009
- Structure the document with these sections:
  1. **Hero/Header** — "SPEC-011: Minibuffer Completion System" with subtitle and summary
  2. **Table of Contents** — Pill-style navigation links to each subsystem section
  3. **Overview** — Brief description of the full completion stack and how components interrelate
  4. **Vertico — Vertical Minibuffer Completion** (US-1 through US-5)
  5. **Orderless — Component-wise Matching** (US-6 through US-9)
  6. **Marginalia — Candidate Annotations** (US-10 through US-11)
  7. **Corfu — In-Buffer Popup Completion** (US-12 through US-19)
  8. **Cape — Completion-at-Point Extensions** (US-20 through US-22)
  9. **Consult — Enhanced Search & Navigation** (US-23 through US-28)
  10. **Embark — Context Actions** (US-29 through US-31)
  11. **Savehist — Persistent History** (US-32)
  12. **Which-Key — Key Discovery** (US-33)

- For each user story, include:
  - **Story card** with US number, title, and narrative ("As a user...")
  - **Acceptance Criteria** in Given/When/Then format (at least 1, typically 2-3 per story)
  - **Mockup** — A styled `<pre>` terminal mockup showing the minibuffer layout relevant to that story. Mockups must show:
    - Prompt line at the TOP of the minibuffer area
    - Candidates flowing downward below the prompt
    - Match highlighting indicated via `[bold/underline]` markers
    - Annotation text indicated via `dim` styling
    - Selection indicated via `▸` marker or `▶` prefix
    - Message/count indicator on the prompt line (e.g. `3/15`)
    - Proper terminal-width alignment (80 chars)

### User Stories to Include (from conversation)

**Vertico:**
- US-1: Vertical candidate stack in minibuffer
- US-2: Input at the top, candidates flow downward (corrected orientation)
- US-3: Live filtering on every keystroke
- US-4: Vertical navigation with cycling
- US-5: Selection auto-scrolls the view

**Orderless:**
- US-6: Space-separated multi-component filtering
- US-7: Orderless by default, basic as fallback
- US-8: File paths use prefix/partial-completion matching
- US-9: Smart case sensitivity

**Marginalia:**
- US-10: Rich annotations beside candidates
- US-11: Cycle annotation detail with M-A

**Corfu:**
- US-12: Auto-triggered popup at point
- US-13: Popup shows candidates inline
- US-14: Cycling through popup candidates
- US-15: No preselection of first candidate
- US-16: Preview current candidate via insert
- US-17: Echo documentation for selected candidate
- US-18: Enter and Tab unbound from Corfu
- US-19: Corfu disabled in org-mode

**Cape:**
- US-20: Fallback from Corfu to Vertico
- US-21: Cape line completion
- US-22: Dabbrev as default completion source

**Consult:**
- US-23: Live preview while navigating candidates
- US-24: Consult-line incremental search
- US-25: Consult-ripgrep project search
- US-26: Consult-buffer with preview
- US-27: Narrowing with < key
- US-28: Consult history

**Embark:**
- US-29: Act on any candidate
- US-30: DWIM action with C-;
- US-31: Embark collect completions

**Savehist:**
- US-32: Persistent completion history across sessions

**Which-Key:**
- US-33: Key binding discovery popup

## Validation Commands
- `open specs/SPEC-011-minibuffer-completion.html` — Verify the file renders correctly in a browser
- `wc -l specs/SPEC-011-minibuffer-completion.html` — Confirm the file is substantive (should be 500+ lines)
- `grep -c "user-story" specs/SPEC-011-minibuffer-completion.html` — Confirm all 33 user stories are present
- `grep -c "acceptance-criteria" specs/SPEC-011-minibuffer-completion.html` — Confirm acceptance criteria sections exist
- `grep -c "<pre" specs/SPEC-011-minibuffer-completion.html` — Confirm mockup blocks exist (should be 10+, one per subsystem at minimum)

## Notes
- The mockups should be ASCII/Unicode art rendered inside styled `<pre>` blocks — NOT images. This keeps the spec self-contained and version-controllable.
- Use the corrected minibuffer orientation: prompt at TOP, candidates flow DOWNWARD. This matches the Emacs Vertico behavior observed in the screenshot.
- The spec is a *reference design* for the tmax minibuffer, describing the target Emacs-like behavior. It is not a description of the current tmax implementation (which has input at the bottom).
- Follow the exact CSS design system from SPEC-009 (dark terminal theme, card layouts, pill navigation, etc.)

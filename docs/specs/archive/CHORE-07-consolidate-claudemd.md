# Chore: Consolidate CLAUDE.md

## Chore Description
CLAUDE.md has significant content duplication both within itself and with files in `rules/`. The consolidation will:
1. Merge sections that repeat the same information
2. Remove detailed content that already exists (or belongs) in path-scoped rules files
3. Keep CLAUDE.md focused on: behavioral guidelines, project identity, and pointers to rules

## Relevant Files

- `CLAUDE.md` — the file being consolidated (272 lines, ~50% redundant)
- `rules/editor.md` — already contains Editor Architecture, Editor API, and Common Tasks sections that are duplicated verbatim in CLAUDE.md
- `rules/tlisp.md` — already contains T-Lisp Architecture section duplicated verbatim in CLAUDE.md
- `rules/typescript.md` — already contains TypeScript/Bun conventions relevant to architecture overview
- `rules/testing.md` — already contains test strategy and commands
- `rules/functional-programming.md` — already contains FP patterns reference

### New Files
None needed — all rules files already exist and contain the detailed content.

## Step by Step Tasks

### Step 1: Remove duplicated "Key Components" section (lines 159–182)
The entire "Key Components" section is verbatim duplicated in rules files:
- **T-Lisp Interpreter** (lines 161–167) → identical to `rules/tlisp.md` Architecture section
- **Editor Interface** (lines 169–174) → identical to `rules/editor.md` Architecture section
- **Editor API** (lines 176–182) → identical to `rules/editor.md` Editor API section

**Action:** Delete the entire `## Key Components` section from CLAUDE.md. The rules files already contain this information and are loaded when touching relevant paths.

### Step 2: Remove duplicated "Architecture Overview" section (lines 140–157)
This section splits responsibilities into "TypeScript Core" and "T-Lisp Engine" but:
- T-Lisp Engine responsibilities (lines 151–157) are already covered by `rules/tlisp.md` ("All higher-level editor functionality lives in T-Lisp...")
- TypeScript Core responsibilities are implied by `rules/typescript.md` and the brief project description

**Action:** Replace the detailed Architecture Overview with a one-sentence summary. The first paragraph already says "TypeScript core handles terminal I/O, file system, and rendering, while T-Lisp handles all editor logic."

### Step 3: Remove duplicated "Common Tasks" section (lines 255–271)
This section is **identical** to `rules/editor.md` Common Tasks section (lines 42–58).

**Action:** Delete the entire `## Common Tasks` section from CLAUDE.md.

### Step 4: Consolidate "Project Overview" with the intro paragraph
Lines 1–3 (intro paragraph) and lines 119–138 (Project Overview) describe the same thing. The Project Overview section adds: status badge, key features list, and target users. The intro paragraph is more concise.

**Action:** Merge into a single `## Project Overview` section right after the intro paragraph, keeping the concise intro as the opening and adding only the unique content (status, target users) that isn't covered elsewhere. Move the Key Features list into a brief bullet list (it's useful context that doesn't exist in rules).

### Step 5: Consolidate rules pointers (Section 7 + Path-Scoped Rules table)
Section 7 "Further rules" (lines 93–96) and the `## Path-Scoped Rules` table (lines 242–253) both point to the rules directory.

**Action:** Keep only the Path-Scoped Rules table (it's more useful — shows scopes). Add the directory-level Claude.md note from Section 7 as a bullet point under the table. Remove Section 7 entirely.

### Step 6: Remove "Usage Examples" section (lines 201–240)
Usage examples (CLI commands, T-Lisp customization, M-x commands) are user-facing documentation, not coding guidance. They don't help an AI write better code for this project. They belong in README.md (if not already there), not in CLAUDE.md.

**Action:** Delete the entire `## Usage Examples` section from CLAUDE.md.

### Step 7: Remove "Project Structure" tree (lines 184–199)
This is discoverable via the filesystem and goes stale. The rules files and path-scoped tables already tell Claude where to look. The project description says enough about the architecture.

**Action:** Delete the `## Project Structure` section.

### Step 8: Rewrite CLAUDE.md
Apply all the above changes in one edit. The resulting CLAUDE.md should be structured as:

```
# CLAUDE.md

<one-paragraph project description — keep existing intro>

## Project Overview
<brief status + target users + key features — merged from old sections>

## Behavioral Guidelines
<sections 1-4 unchanged — these are the core value of CLAUDE.md>

## Installed CLI Tools
<section 5 unchanged>

## Learn From Corrections
<section 6 unchanged>

## Verify Before Reporting Complete
<section 8 unchanged>

## Path-Scoped Rules
<table from current Path-Scoped Rules + directory Claude.md note>
```

### Step 9: Validate
Run type checking and tests to confirm nothing was broken (CLAUDE.md changes shouldn't affect code, but verify).

## Validation Commands
- `bunx tsc --noEmit` — confirm no type errors
- `bun test` — confirm all tests still pass

## Notes
- The rules files are not being modified — they already contain all the detailed content being removed from CLAUDE.md
- No directory-level Claude.md files exist currently (the Section 7 reference is aspirational)
- The behavioral guidelines (sections 1-4, 6, 8) are the most valuable part of CLAUDE.md and must be preserved exactly

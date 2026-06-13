---
name: update-tmax-documentation
description: "Audit and update all tmax documentation including texinfo manuals and README. Recompiles .info files after changes. Triggers on: update tmax documentation, update tmax docs, sync tmax docs, rebuild texinfo, update info files, refresh docs."
---

# Update tmax Documentation

Systematically audit and update all tmax documentation files to accurately reflect the currently implemented codebase, then recompile texinfo manuals.

## Instructions

1. **Read the current codebase** to understand what is actually implemented:
   - Read `src/editor/tlisp-api.ts` for the complete API registry
   - Scan `src/editor/api/*.ts` for all API function signatures (read the `api.set('name', ...)` calls)
   - Read `src/tlisp/stdlib.ts` for standard library functions
   - Read `src/tlisp/evaluator.ts` for special forms and built-in functions (the `createEvaluatorWithBuiltins` function)
   - Read `src/editor/editor.ts` for editor modes, key handling, and features
   - Read `src/server/server.ts` for daemon/client architecture
   - Read `src/client/tui-client.ts` for TUI client features

2. **Read each documentation file** and compare against the codebase:
   - `docs/tmax/tmax.texinfo` — tmax editor manual
   - `docs/tmax/tlisp.texinfo` — T-Lisp language and API reference
   - `README.md` — Project overview

3. **Fix inaccuracies** — For each doc, correct:
   - Missing API functions (compare `api.set()` calls vs documented functions)
   - Wrong function signatures or parameter descriptions
   - Outdated feature descriptions (e.g., features marked "planned" that are implemented)
   - Wrong runtime references (must say "Bun", not "Deno")
   - Missing editor features or modes
   - Stale key binding or command descriptions
   - Missing chapters for new API modules

4. **Add missing sections** if a significant implemented feature has no documentation. Keep additions concise and match the existing texinfo style.

5. **Preserve existing structure and style** — Don't rewrite docs from scratch. Make targeted edits to fix inaccuracies while keeping the original document's voice, format, and organization.

6. **Recompile texinfo** after making any changes:
   ```bash
   cd docs/tmax && make info
   ```

7. **Validate** the compiled output:
   ```bash
   cd docs/tmax && make validate
   ```

8. **Cross-reference check** — Verify all documented API functions exist in source:
   ```bash
   # Extract documented function names from tlisp.texinfo
   # Compare against api.set() calls in src/editor/api/*.ts
   # Report any functions in docs but not in code, or in code but not in docs
   ```

## Relevant Files

### Source of truth (read these to understand what's implemented)
- `src/editor/tlisp-api.ts` — Complete API registry
- `src/editor/api/*.ts` — All API modules (35 files)
- `src/tlisp/stdlib.ts` — Standard library functions
- `src/tlisp/evaluator.ts` — Special forms and built-in functions
- `src/tlisp/types.ts` — T-Lisp value types
- `src/editor/editor.ts` — Editor state and features
- `src/server/server.ts` — Daemon architecture
- `src/client/tui-client.ts` — TUI client

### Documentation files to update
- `docs/tmax/tmax.texinfo` — tmax editor manual
- `docs/tmax/tlisp.texinfo` — T-Lisp language and API reference
- `README.md` — Project overview (if needed)

## Plan Format

When planning the documentation update, create a structured diff list:

```md
# tmax Documentation Update Plan

## Files to Update
- `docs/tmax/tmax.texinfo` — <summary of changes>
- `docs/tmax/tlisp.texinfo` — <summary of changes>
- `README.md` — <summary of changes, if any>

## Changes per File

### docs/tmax/tmax.texinfo
- [ ] <specific change>
- [ ] <specific change>

### docs/tmax/tlisp.texinfo
- [ ] <specific change>

## Validation
- [ ] All documented functions exist in source code
- [ ] No functions in source are missing from docs
- [ ] Runtime references say "Bun" not "Deno"
- [ ] `make validate` passes
- [ ] `make info` compiles without errors
```

## Validation Commands

After updating, run these commands to verify:
```bash
# Validate texinfo syntax
cd docs/tmax && make validate

# Compile info manuals
cd docs/tmax && make info

# Verify no Deno references remain (should return empty)
grep -rn "Deno\|deno" docs/tmax/tmax.texinfo docs/tmax/tlisp.texinfo

# Verify info files exist
test -f docs/tmax/tmax.info && test -f docs/tmax/tlisp.info && echo "OK"
```

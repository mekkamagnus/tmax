# Bug: `defmodule` does not define functions whose names contain `--` (NOT REPRODUCIBLE — closed as misdiagnosis)

> **Status (investigated 2026-08-06): NOT REPRODUCIBLE.** The defect described
> below does not exist in the current interpreter. The "Undefined symbol" the
> SPEC-073 implementer hit was caused by the export name and the defun name
> *differing* (a typo in the module source), not by any mishandling of `--`.
> The T-Lisp module system exports and resolves `--`/`---` names identically to
> single-`-` names on every code path (sync `execute`, async `executeAsync`,
> disk-load via the standalone module loader, qualified/aliased/selective/
> unique-export resolution). This spec is kept as a record of the investigation
> and its corrective finding. Recommend closing issue #112 / dropping to wontfix.

## Goals

- Confirm whether a `(defun name-with--double-dash …)` inside a `(defmodule …)` is actually unreachable after `require-module`, and if so, fix it.
- *(Outcome: it IS reachable. No interpreter fix needed.)*

## Completion Criteria (Definition of Done)

- [x] A double-dash `defun` whose name is listed verbatim in the module's `(export ...)` resolves after `require-module` on the sync `execute` path. *(Verified 2026-08-06 — see Test Plan.)*
- [x] Same, on the async `executeAsync` path (the path the burn-down note suspected).
- [x] Same, on the disk-load path via the standalone module loader (`createStandaloneInterpreter` + `TLISP_PATH`).
- [x] Qualified (`m/foo--bar`), aliased (`:as`), selective (`:import`), and unqualified unique-export resolution all resolve `--` names.
- [ ] A regression-guard unit test is added to `test/unit/module-system.test.ts` that exercises a `--` and `---` export so this cannot silently regress. *(The investigation proves the behaviour is correct today; this test is the only code change warranted — see Implementation Plan.)*
- [x] `bun run typecheck` + `bun run test:unit` pass (no source change required for the first four criteria).

## Root Cause (investigated 2026-08-06 — original framing was a MISDIAGNOSIS)

**Original claim:** "`--`-named `defun`s are left undefined after `require-module`; the name is lost between the module-body `defun` binding and the export-set/lookup (symbol-interning or an export-name split on `-`)."

**Corrected finding:** The name is NOT lost. The module export/registration path handles `--` correctly at every stage. The "Undefined symbol" the SPEC-073 implementer observed was caused by the `(export ...)` list naming a *different* symbol than the `(defun ...)` defined — i.e. a source typo, not an interpreter defect. The implementer's module effectively read:

```lisp
(defmodule …
  (export … buffer-non-special)   ; <-- single dash in the EXPORT list
  (defun buffer--non-special …)   ; <-- double dash in the DEFUN
  …)
```

The interpreter dutifully exported `buffer-non-special` (the name it was told to export) and bound `buffer--non-special` (the name it was told to define); the two never matched, so the qualified/unqualified call to `buffer--non-special` reported it as unexported. The workaround (inline `(lambda …)`) "fixed" it by removing the mismatched name entirely.

### Evidence (all gathered 2026-08-06 against the current `main`)

The export machinery and the lookup machinery were traced end-to-end:

1. **Tokenizer** (`src/tlisp/tokenizer.ts:212-244`) — `-` is a symbol char (`isSymbolChar` regex `[a-zA-Z0-9_+\-*/=<>!?&#:]`), so `double--dash` and `triple---dash` tokenise as single intact symbols. Verified directly: `TLispTokenizer.tokenize("(defun double--dash (x) x)")` → `["(","defun","double--dash","(","x",")","x",")"]`.

2. **Parser** (`src/tlisp/parser.ts`) — preserves the symbol's `.value` byte-for-byte. Verified: parsing `(export a--b c-d)` yields symbols with `value: "a--b"` and `value: "c-d"`.

3. **`defmodule` body** (`src/tlisp/evaluator/module-forms.ts:218-272`) — the export set is built straight from the parsed symbol values: `exports.add(exportSym.value as string)` (line 243). No transformation, no `-` splitting, no interning. The `defun` then binds `name!.value as string` (`src/tlisp/evaluator.ts:1256`) in the module env. Both use the identical raw string from the AST, so as long as the export symbol and the defun symbol are spelled the same, the set and the env agree.

4. **Registry storage** — dumping `(moduleRegistry as any).resolve("dd/test")` after defining a module with matching `--` export+defun names shows `exports: ["single-dash","double--dash"]` and `env.lookup("double--dash") → FOUND` (and `env.lookup("double-dash") → MISSING`). The store is correct.

5. **Lookup** (`src/tlisp/evaluator.ts:432-540`, `evalSymbol`) — qualified-name resolution splits on `/` only (`name.indexOf("/")`, line 443), never on `-`. `record.exports.has(symName)` and `record.env.lookup(symName)` both receive the intact `--` name. Selective-import (`:import`) and unique-export (`resolveUniqueExport`) resolution likewise use exact string equality against the stored export set.

6. **End-to-end calls succeed** when the export name == the defun name. The following were all verified to return `Right`:
   - `(test/double--dash 10)` → 12, sync and async.
   - `(test/triple---dash 10)` → 13 (triple dash, for completeness).
   - `(progn (require-module dd/test :import (double--dash)) (double--dash 10))` → 12.
   - `(progn (require-module dd/test) (double--dash 10))` → 12 (unqualified unique-export path).
   - Disk load via `createStandaloneInterpreter({ tlispPath })` of a `mod.tlisp` containing a `--` export, then `(m/double--dash 10)` → 12.

The burn-down note's hypothesis that the bug "repros only on the async module-load path" and that "the standalone CLI's sync `execute` lacks `load`/`require-module`" is half-right about the CLI (the standalone top level indeed does not wire `load`), but is wrong about the async path being defective: `defmodule`/`defun`/`require-module` are all classified `sync-only` in `src/tlisp/evaluator/special-form-dispatch.ts:79,97-98`, and the async path delegates to the *same* `evalDefmoduleForm`/`evalDefun` handlers — so there is no separate async code path to diverge.

## Implementation Plan

**No interpreter/module-system code change is warranted** — the behaviour is already correct. The only change worth making is a small regression guard so the question never has to be re-investigated:

1. **Add a regression test** to `test/unit/module-system.test.ts` (mirrors the existing `"supports qualified, aliased, and selective imports …"` test at lines 26-39). Pattern to copy: construct a `TLispInterpreterImpl`, evaluate a `defmodule` whose `(export ...)` lists a single-dash, a double-dash, AND a triple-dash symbol (with matching `(defun …)` bodies), then assert each resolves via:
   - qualified call `(mod/single-dash …)`, `(mod/double--dash …)`, `(mod/triple---dash …)`;
   - selective import `(require-module mod :import (double--dash))` then `(double--dash …)`;
   - unqualified unique-export `(progn (require-module mod) (double--dash …))`.
   Assert each returns the expected numeric value (e.g. 11 / 12 / 13). Use the `rightValue(result)` helper already defined at the top of that file. Keep it to ONE focused test (the existing file is the right home; do not create a new file).

2. **(Optional, documentation only)** If the project wants to forestall repeat reports, add a one-line note to the T-Lisp module docs (wherever `defmodule`/`export` is documented) reminding authors that the `(export ...)` list must name the defun symbols *exactly* — a `--` in the defun must appear verbatim in the export list. This is documentation, not code; skip if no such doc section exists.

3. **Do NOT** modify `module-registry.ts`, `module-loader.ts`, `module-forms.ts`, `evaluator.ts`, the tokenizer, or the parser. They are correct. Any "fix" applied there would be changing correct code on the basis of a misdiagnosed report.

4. **Close issue #112** as wontfix / not-reproducible after the regression test lands (the test is the artifact that proves the closure is correct and prevents regression).

## Codex adversarial review (2026-08-06) — correction

- **Finding:** The Test Plan regression example defined `d--d`/`t---t` but exported `d`/`t`. With `(export s d t)`, the export set names symbols (`d`, `t`) that no `(defun …)` ever binds, so the test would assert the *typo* the report was about — not the `--` resolution it claims to guard. To actually exercise double-/triple-dash export+lookup, the export list must name the defined `--`/`---` symbols verbatim.
- **Correction applied:** changed the example to `(export s d--d t---t)` so the exports match the defuns. The same exact-match rule applies to the permanent regression test added per Implementation Plan step 1 (export `single-dash`/`double--dash`/`triple---dash`, matching the defuns).

### If a future report reproduces a REAL `--` failure

The investigation above is the bisect trail. Re-run the dump test (define a module with matching export+defun `--` names, then inspect `(moduleRegistry as any).resolve(name).exports` and `.env.lookup(name)`). If `exports` and the env binding ever disagree, the bug is in `evalDefmoduleForm` (`module-forms.ts:239-247`) or `evalDefun` (`evaluator.ts:1217-1259`); if they agree but lookup still fails, the bug is in `evalSymbol` (`evaluator.ts:432-540`). Today neither branch reproduces.

## Test Plan

The investigation's verification (already executed, all green):

```ts
// Sync execute (inline module) — all Right
const i = new TLispInterpreterImpl();
i.execute(`(defmodule dd/test (export s d--d t---t)
              (defun s (x) (+ x 1))
              (defun d--d (x) (+ x 2))
              (defun t---t (x) (+ x 3)))`);
i.execute("(require-module dd/test)");
expect(i.execute("(test/d--d 10)")).toEqual Right 12      // qualified
expect(i.execute("(test/t---t 10)")).toEqual Right 13     // triple-dash

// Async executeAsync — same assertions, all Right (await i.executeAsync(...))

// Selective import — Right
i.execute("(progn (require-module dd/test :import (d--d)) (d--d 10))") → Right 12

// Unqualified unique export — Right
i.execute("(progn (require-module dd/test) (d--d 10))") → Right 12

// Disk-load (standalone module loader) — Right
createStandaloneInterpreter({ tlispPath: dir }).execute("(require-module mod :as m)")
  → (m/d--d 10) === Right 12
```

The one artifact to add: a permanent version of the above as a regression test in `test/unit/module-system.test.ts` (see Implementation Plan step 1). After adding it:

- `bun run typecheck` must pass.
- `bun run test:unit -- test/unit/module-system.test.ts` must pass with the new case included.

## Relevant Files

Read these before touching anything (none require changes for the core finding):

- `src/tlisp/tokenizer.ts:212-244` — `readSymbol`/`isSymbolChar`; `-` is a legal symbol char, `--` stays intact.
- `src/tlisp/parser.ts` — preserves symbol `.value` verbatim.
- `src/tlisp/evaluator/module-forms.ts:156-275` — `evalDefmoduleForm`; export set built at lines 218-247 (`exports.add(exportSym.value as string)`), module registered at line 272.
- `src/tlisp/evaluator.ts:1217-1259` — `evalDefun`; binds `name!.value as string` via `env.define`.
- `src/tlisp/evaluator.ts:432-540` — `evalSymbol`; qualified/selective/unique-export resolution; splits on `/` only (line 443).
- `src/tlisp/module-registry.ts:108-156` — `listExports`/`resolveUniqueExport`; `record.exports.has(exportName)` + `record.env.lookup(exportName)` (lines 122-124, 152).
- `src/tlisp/module-loader.ts:80-173` — `createModuleLoader`; disk-load path (uses `interpreter.execute`, i.e. sync, then registers source path).
- `src/tlisp/evaluator/special-form-dispatch.ts:79,97-98` — `defun`/`defmodule`/`require-module` are all `sync-only`; async path delegates, so there is no divergent async handler to blame.
- `test/unit/module-system.test.ts:1-39` — the test fixture pattern to mirror for the regression test.
- `test/unit/tlisp-standalone-module-loader.test.ts:1-40` — the disk-load test fixture pattern.

## Severity / Notes

- **Original priority:** low (trivial workaround: inline lambda / single-dash rename).
- **Investigated priority:** wontfix / not-a-bug. The interpreter is correct; the report was a source typo in the SPEC-073 module (`(export buffer-non-special)` vs `(defun buffer--non-special …)`).
- **Action:** add the regression test, then close #112.

# Options Analysis: T-Lisp as a Standalone Language

**Date:** 2026-06-05
**Depends on:** Gap Analysis (standalone-tlisp-gap-analysis.md)
**Purpose:** Evaluate architectural approaches for making T-Lisp usable outside the tmax editor and recommend one

---

## Requirements

A standalone T-Lisp must satisfy:

1. **Independence** — Runs without an editor instance
2. **Utility** — Useful for real tasks beyond editor configuration
3. **Compatibility** — Existing tmax T-Lisp code works unchanged
4. **Embeddability** — Other apps can embed T-Lisp as a scripting language
5. **Maintainability** — One interpreter, not two forks
6. **Zero dependencies** — Continues the project's zero-dep philosophy
7. **Single-binary distribution** — Users download one executable, no runtime needed

---

## Top Three Options

The practical top three are:

1. **Runtime Profiles + Bun-compiled CLI** — fastest path to a standalone T-Lisp executable. This is the MVP.
2. **Extract and Package** — best path once embedding by other apps or npm distribution becomes a real requirement.
3. **Compile to JavaScript** — useful for browser/serverless deployment or performance work, but not needed for a standalone binary.

Self-hosting is intentionally not in the top three. It is a future language-research project, not a practical path to standalone usability.

---

## Option A: Extract and Package (Library-First)

**Model:** Extract the `src/tlisp/` interpreter into a standalone npm package (`@tmax/tlisp`). The editor depends on this package. Other apps can too.

### Architecture

```
@tmax/tlisp (standalone package)
├── src/
│   ├── tokenizer.ts
│   ├── parser.ts
│   ├── evaluator.ts
│   ├── environment.ts
│   ├── types.ts
│   ├── values.ts
│   ├── stdlib.ts
│   ├── module-registry.ts
│   ├── module-loader.ts
│   ├── io-ops.ts          # NEW: standalone I/O
│   ├── sys-ops.ts          # NEW: system operations
│   ├── cli.ts              # NEW: REPL + script runner
│   └── stdlib/             # NEW: .tlisp standard library files
│       ├── lists.tlisp
│       ├── strings.tlisp
│       └── math.tlisp
└── package.json            # zero deps, Bun/Node compat

tmax (editor)
├── src/editor/tlisp-api.ts  # imports @tmax/tlisp, injects editor primitives
├── src/tlisp/core/          # editor-specific .tlisp files
└── package.json             # depends on @tmax/tlisp
```

### How it works

The interpreter package exports:

```typescript
import { createInterpreter } from "@tmax/tlisp";

// Standalone usage
const interp = createInterpreter();
interp.execute('(+ 1 2)'); // → 3

// With I/O primitives
import { registerIOPrimitives } from "@tmax/tlisp/io";
registerIOPrimitives(interp);

// Embedded in an app
import { createInterpreter } from "@tmax/tlisp";
const interp = createInterpreter();
interp.defineBuiltin("my-app-do-thing", (args) => { ... });
interp.execute('(my-app-do-thing "hello")');
```

The editor does exactly what it does today — creates an interpreter and injects editor primitives — but imports the interpreter from the package instead of relative paths.

### Strengths

- **One codebase, two use cases** — No fork. The interpreter is maintained once.
- **Natural dependency direction** — Editor depends on language, not the reverse. This is how it should be.
- **Already mostly done** — The interpreter core has zero editor imports. Extraction is file moves + package.json.
- **Other apps benefit** — Any TypeScript project can `npm install @tmax/tlisp` and have a Lisp scripting engine.
- **Testing isolation** — Interpreter tests don't need editor fixtures.
- **Single-binary distribution** — `bun build --compile` produces a standalone `tlisp` executable with the Bun runtime baked in. No Node, no Bun, no npm needed on the target machine. Just download and run. Cross-compilation via `--target` flag (linux-x64, macos-arm64, windows-x64).

### Weaknesses

- **Build complexity** — Monorepo with package linking. TypeScript project references or Bun workspaces needed.
- **Release coupling** — Interpreter and editor versions must stay compatible. `peerDependencies` or version pinning.
- **Stdlib split** — Generic stdlib functions (hashmap ops, string ops) live in the package. Editor-adjacent ones (keymap ops) stay in the editor. The boundary requires judgment.
- **Module resolution divergence** — Standalone T-Lisp resolves modules from `TLISP_PATH`. Editor T-Lisp resolves from `src/tlisp/core/`. Two search strategies, one module loader.
- **Binary size** — `bun build --compile` produces ~80-100MB binaries (includes the entire Bun runtime). Acceptable for a desktop tool, not for embedded/serverless.

### Distribution

```bash
# Build standalone binary
bun build --compile ./src/tlisp/cli.ts --outfile tlisp

# Cross-compile for other platforms
bun build --compile ./src/tlisp/cli.ts --outfile tlisp-linux --target=bun-linux-x64
bun build --compile ./src/tlisp/cli.ts --outfile tlisp-macos --target=bun-darwin-arm64
bun build --compile ./src/tlisp/cli.ts --outfile tlisp-windows --target=bun-windows-x64
```

Users download a single binary. No installation step beyond `chmod +x` and moving to PATH.

### Effort

| Task | Estimate |
|---|---|
| Extract `src/tlisp/` into package | 2-3 days |
| Create standalone I/O and sys primitives | 3-5 days |
| Build CLI (REPL + script runner) | 2-3 days |
| Wire editor to import from package | 1-2 days |
| Update build system (monorepo) | 2-3 days |
| Stdlib expansion (string, I/O, type conversion, seq polish) | 3-5 days |
| Error handling (condition-case) | 3-5 days |
| Build pipeline (`bun build --compile` + cross-compile) | 1-2 days |
| **Total** | **3-4 weeks** |

---

## Option B: Runtime Profiles + Bun-Compiled CLI (MVP)

**Model:** Keep everything in one repo. Add a standalone CLI entry point and a "profile" system that controls which primitives are available. `editor` profile loads all editor APIs. `standalone` profile loads only I/O, system operations, standalone module loading, and generic stdlib.

### Architecture

```
tmax/  (single repo)
├── src/
│   ├── tlisp/
│   │   ├── interpreter.ts
│   │   ├── stdlib.ts
│   │   ├── profiles/
│   │   │   ├── standalone.ts    # registerIOPrimitives + stdlib
│   │   │   └── editor.ts        # existing tlisp-api.ts
│   │   └── cli.ts               # REPL using standalone profile
│   ├── editor/
│   │   └── tlisp-api.ts         # editor profile
│   └── main.tsx
└── bin/
    ├── tmax                     # editor entry point
    └── tlisp                    # standalone entry point
```

### How it works

```typescript
// bin/tlisp — standalone entry point
import { createInterpreter } from "../src/tlisp/interpreter.ts";
import { registerStandaloneProfile } from "../src/tlisp/profiles/standalone.ts";

const interp = createInterpreter();
registerStandaloneProfile(interp);

// REPL or script execution
```

```typescript
// src/editor/editor.ts — editor entry point (unchanged)
import { createInterpreter } from "../tlisp/interpreter.ts";
import { createEditorAPI } from "./tlisp-api.ts";

const interp = createInterpreter();
const api = createEditorAPI(editorState);
// inject api into interp...
```

### Strengths

- **No monorepo complexity** — Everything stays in one package. No workspace linking, no version coordination.
- **Fastest to implement** — Add a profile file and a CLI entry point. No file moves.
- **Easy testing** — Tests can create either profile without package boundaries.
- **Shared stdlib** — No question about where a function lives. Everything is in one codebase.
- **Single-binary distribution still works** — `bun build --compile ./src/tlisp/cli.ts --outfile tlisp` bundles only the reachable code. The standalone profile's CLI entry point never imports editor code, so the compiled binary excludes it. Tree-shaking handles separation at the build level even without a package split.
- **Matches current architecture** — The evaluator already has module support and the interpreter already registers host primitives through `defineBuiltin`.

### Weaknesses

- **Not distributable via npm** — Other apps can't `npm install @tmax/tlisp`. They'd have to copy source or depend on all of tmax. (Binary distribution is fine for end users, but embedding requires package extraction — which is Option A.)
- **Tight coupling risk** — Standalone and editor code live together. Pressure to make standalone features editor-aware, or vice versa.
- **Import boundary is implicit** — Without a package boundary, nothing prevents standalone code from accidentally importing editor modules. Relies on discipline and lint rules rather than build enforcement.
- **Stdlib asset decision remains** — If standalone `.tlisp` stdlib files are introduced, the compiled binary needs either embedded virtual stdlib modules, sidecar files, or both.

### Effort

| Task | Estimate |
|---|---|
| Create standalone profile | 1-2 days |
| Add I/O and sys primitives | 3-5 days |
| Build CLI (REPL + script runner) | 2-3 days |
| Standalone module loader and stdlib asset strategy | 1-3 days |
| Stdlib expansion | 3-5 days |
| Error handling | 3-5 days |
| **Total for MVP** | **1-2 weeks** |
| **Total with error handling and polish** | **2.5-3.5 weeks** |

---

## Option C: Compile to JavaScript (T-Lisp -> JS Transpiler)

**Model:** Write a compiler that translates T-Lisp to JavaScript. Standalone T-Lisp programs compile to `.js` files that run anywhere. Like ClojureScript or Elixir's approach.

### Architecture

```
src/tlisp/
├── tokenizer.ts
├── parser.ts
├── compiler.ts             # NEW: T-Lisp AST -> JavaScript AST -> JS source
├── runtime.js              # NEW: minimal runtime (cons cells, hashmap ops)
└── cli.ts                  # tlisp compile script.tlisp -> script.js
```

### How it works

```lisp
;; input.tlisp
(defun fibonacci (n)
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))

(print (fibonacci 10))
```

Compiles to:

```javascript
// output.js
const { car, cdr, cons, print } = require("@tmax/tlisp/runtime");
function fibonacci(n) {
  return n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}
print(fibonacci(10));
```

### Strengths

- **Deployment everywhere** — Runs in browsers, Node, Deno, Bun, Cloudflare Workers. Anywhere JS runs.
- **Performance** — Compiled JS benefits from V8's JIT. Potentially faster than tree-walking interpretation.
- **Ecosystem access** — Generated JS can import npm packages. `(require-js "lodash")` gives access to the entire JS ecosystem.
- **Tooling integration** — JS output works with existing source maps, debuggers, bundlers.

### Weaknesses

- **Dynamic features don't compile cleanly** — Macros, `eval`, dynamic binding, and `(apply fn args-list)` require a runtime. The compiler becomes complex for features that make Lisp a Lisp.
- **Two backends to maintain** — The interpreter stays for the editor (REPL, interactive evaluation). The compiler is a new backend. Same frontend, two code generators.
- **Debugging experience is poor** — Errors reference generated JS line numbers, not T-Lisp source. Source maps help but don't fully solve this.
- **Loss of interactive development** — Compilation is batch-oriented. The REPL experience (incremental evaluation, redefining functions on the fly) doesn't map to a compiled model.
- **Premature optimization** — The interpreter is fast enough for an editor. Compilation solves a performance problem that does not exist yet.
- **`bun build --compile` makes most standalone distribution use cases redundant** — Bun already produces a standalone binary from the interpreter. A custom transpiler adds browser/serverless reach, but at 3-4 months of extra effort.

### Effort

| Task | Estimate |
|---|---|
| Design compilation model and runtime | 2-3 weeks |
| Implement compiler (AST -> JS) | 6-8 weeks |
| Implement runtime library | 2-3 weeks |
| Source map generation | 1-2 weeks |
| Integration testing | 2-3 weeks |
| **Total** | **3-4 months** |

---

## Future / Research Option: Self-Hosted Subset (T-Lisp in T-Lisp)

**Model:** Write a T-Lisp evaluator in T-Lisp. The TypeScript interpreter bootstraps the self-hosted evaluator, then the self-hosted one takes over. Like Clojure's approach (Clojure-in-Clojure after bootstrap).

### Architecture

```
src/tlisp/
├── evaluator.ts           # TypeScript evaluator (bootstrap only)
├── self-hosted/
│   ├── eval.tlisp         # T-Lisp evaluator written in T-Lisp
│   ├── reader.tlisp       # T-Lisp reader (parser) in T-Lisp
│   └── compiler.tlisp     # Optional: T-Lisp → bytecode compiler in T-Lisp
```

### How it works

1. TypeScript interpreter boots, loads `eval.tlisp`
2. `eval.tlisp` defines a `tlisp-eval` function that can evaluate T-Lisp expressions
3. From that point, all evaluation goes through `tlisp-eval` (written in T-Lisp)
4. TypeScript provides only the thinnest primitives: cons, car, cdr, apply, print

### Strengths

- **Maximum portability** — Once bootstrapped, the evaluator can run on any platform that provides ~10 primitives. Port to Python? Just implement the 10 primitives.
- **Language proves itself** — A language that can interpret itself demonstrates capability. Strong marketing.
- **Unlimited extensibility** — Users can modify the evaluator itself from within the language. Scheme-style.
- **Academic credibility** — Self-hosting is the gold standard for language design.

### Weaknesses

- **Enormous effort** — Writing a metacircular evaluator in the language itself is a 2-3 month project minimum. Debugging a language that runs on itself is notoriously hard.
- **Performance** — Metacircular evaluation is 10-100x slower than a native evaluator. The TypeScript evaluator has the JIT advantage; T-Lisp-on-T-Lisp does not.
- **Bootstrap chicken-and-egg** — You need the TypeScript evaluator working perfectly to develop the T-Lisp evaluator. Any TypeScript evaluator bug becomes a self-hosting bug that's invisible because the self-hosted evaluator masks it.
- **Not what users need** — Nobody is asking for T-Lisp to be self-hosting. They want I/O and a REPL. This solves the wrong problem first.
- **Maintenance burden** — Two evaluators to maintain. When you find a bug, is it in the TS evaluator or the T-Lisp one?

### Effort

| Task | Estimate |
|---|---|
| Design self-hosted evaluator architecture | 2-3 weeks |
| Implement reader in T-Lisp | 2-3 weeks |
| Implement evaluator in T-Lisp | 4-6 weeks |
| Bootstrap and debug | 2-4 weeks |
| Performance optimization | 2-4 weeks |
| **Total** | **3-5 months** |

---

## Comparative Summary

| Criterion | Runtime Profiles + CLI (B) | Extract & Package (A) | Compile to JS (C) | Self-Hosted (Research) |
|---|---|---|---|---|
| **Time to usable** | 1-2 weeks MVP, 2.5-3.5 weeks polished | 3-4 weeks | 3-4 months | 3-5 months |
| **Independence from editor** | Full for binary/runtime, partial at repo boundary | Full | Full | Full |
| **Embeddable by other apps** | No npm package | Yes (`npm install`) | Yes (JS output/runtime) | Theoretically |
| **One interpreter** | Yes | Yes | No, adds compiler backend | No, adds evaluator |
| **Editor compatibility risk** | Low | Low-Medium during import migration | Medium | High |
| **Performance** | Same as now | Same as now | Potentially faster | 10-100x slower |
| **Maintenance burden** | Low | Low-Medium | High | Very high |
| **Stdlib split required** | No | Yes | Yes, runtime-specific | No |
| **Single-binary distribution** | `bun build --compile` | `bun build --compile` | Not the primary output | Bootstrapped runtime still needed |
| **Binary size** | ~80-100MB | ~80-100MB | N/A | N/A |
| **npm package** | No | Yes | Likely yes | No |
| **Main unresolved issue** | Bundled `.tlisp` stdlib/module assets | Package boundary and versioning | Compiler semantics/debuggability | Wrong problem for now |

---

## Recommendation

**Option B first: Runtime Profiles + Bun-compiled CLI. Option A second when embedding demand appears. Option C only for future browser/serverless or performance needs.**

### Why this order

**Start with B, ship quickly.** Add `src/tlisp/profiles/standalone.ts`, a CLI entry point, I/O primitives, a standalone module loader, and a `bun build --compile` target. This gets a working standalone T-Lisp in 1-2 weeks without changing the project structure. Users can run scripts, use a modest REPL, and download a single binary.

**Then extract to A when the standalone story is proven.** Once standalone T-Lisp has real users or another app wants to embed it, extract `src/tlisp/` into `@tmax/tlisp`. This is a file reorganization, not a rewrite, but it should wait until the API boundary is clear.

**Keep C as a later target.** A JS compiler is useful only if T-Lisp needs browser/serverless deployment, source-map debugging, or performance beyond the interpreter. Bun compilation already solves the standalone executable problem.

### Why not self-hosting now

Self-hosting is a language engineering project in its own right. It is interesting, but it does not serve the immediate need: making T-Lisp useful outside the editor. A self-hosted evaluator is a v2.0 research project, not a v0.3 standalone plan.

### Phased approach

**Phase 1: Standalone MVP (Weeks 1-2)**

1. Create `src/tlisp/profiles/standalone.ts` — registers standalone I/O, sys, module loading, and generic stdlib primitives
2. Create `src/tlisp/cli.ts` — REPL with readline + script execution via `bun run tlisp script.tlisp`
3. Add I/O primitives: `print`, `princ`, `read-line`, `read-file`, `write-file`, `file-exists?`, `directory-files`
4. Add standalone module loader: bundled stdlib modules, current working directory, then `TLISP_PATH`
5. Decide compiled-binary stdlib strategy: embedded virtual modules, sidecar files, or both
6. Add string/type-conversion MVP: `string-join`, `string-trim`, `string-replace`, `number-to-string`, `string-to-number`
7. Add small compatibility aliases if desired: `nilp`, `ceil`, `pow`
8. Wire `bin/tlisp` to use the standalone profile
9. Add `bun build --compile` script to `package.json`: `"build:tlisp": "bun build --compile ./src/tlisp/cli.ts --outfile dist/tlisp"`

**Verify:** `bun run tlisp` opens REPL. `bun run tlisp script.tlisp` runs a script. `bun run build:tlisp` produces a standalone binary that works without Bun installed.

**Phase 2: Polish and Error Handling (Weeks 3-5)**

1. Implement `condition-case` in the evaluator
2. Add `signal` and `error` builtins for raising errors
3. Add `unwind-protect` (like `finally`)
4. Write standard error types: `file-error`, `type-error`, `arity-error`
5. REPL improvements: history, completion, `*1`/`*2`/`*3`, `*e`, `doc`
6. Documentation/introspection: standalone `doc`, `apropos`, source metadata where practical

**Verify:** T-Lisp code can catch and handle errors gracefully.

**Phase 3: Package Extraction, If Needed (Weeks 6-7)**

1. Move `src/tlisp/` to a workspace package `packages/tlisp/`
2. Configure Bun workspaces in root `package.json`
3. Editor imports from `@tmax/tlisp` instead of relative paths
4. Publish to npm (optional, can be local workspace only initially)
5. Update all import paths in `src/editor/`
6. Update `build:tlisp` script to compile from the workspace package

**Verify:** `bun run build` succeeds. `bun test` passes. Editor works identically. Standalone REPL works independently. `bun run build:tlisp` still produces a working binary.

**Phase 4: Release Automation (Week 8+)**

1. Standalone `.tlisp` stdlib files (`stdlib/lists.tlisp`, `stdlib/strings.tlisp`) if not embedded directly
2. Documentation: language reference, getting started guide
3. CI pipeline: cross-compile binaries for linux-x64, darwin-arm64, windows-x64
4. Attach binaries to GitHub Releases via `gh release upload`

---

## Open Questions

1. **Should the standalone package include the testing framework?** The testing builtins (`deftest`, `assert-*`) are in `stdlib.ts` and have no editor dependencies. Include them — they're useful for standalone testing and cost nothing.

2. **What's the REPL library?** Bun has no built-in readline. Options: (a) minimal hand-rolled line editing, (b) depend on a readline-like package (breaks zero-dep), (c) use Node's `readline` module (Bun supports it). Recommend (c) — it's a Node compat module, not an external dependency.

3. **Should standalone T-Lisp support async?** The editor uses async file operations. Standalone scripts might want `(await (read-file path))` or `(read-file-async path)`. Start sync-only. Async is a v2 concern.

4. **How are `.tlisp` stdlib modules loaded in a compiled binary?** Options: (a) embed stdlib source in a TypeScript virtual module map, (b) copy stdlib files beside the binary, (c) support both. Recommend (c): embedded core stdlib for reliability, sidecar/user paths for extension.

5. **What version of the module system does standalone use?** Same one. `defmodule` and `require-module` work identically. Module resolution paths differ by loader profile: editor resolves editor modules; standalone resolves bundled stdlib, CWD, and `TLISP_PATH`.

6. **Should we support `#!/usr/bin/env tlisp` shebangs?** Yes. The CLI should skip the first line if it starts with `#!`. One line of code.

7. **Is ~80-100MB binary size acceptable?** `bun build --compile` bundles the full Bun runtime. For a Lisp interpreter that's heavier than ideal. Options: (a) accept it, (b) use `--minify` to reduce, (c) ship as npm package instead and let users bring their own runtime. Recommend (a) for now — disk space is cheap, and the alternative (requiring a runtime) defeats the "download and run" UX.

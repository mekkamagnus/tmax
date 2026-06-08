# Syntax Highlighting & AST Strategy — Option Analysis

What tmax should do about syntax highlighting, structural editing, and AST-driven AI context. Covers the current system's limitations, five options for providing real ASTs, and a phased recommendation tied to the AI subscription roadmap (see ai-subscription-gap-analysis.md).

Date: 2026-06-07

---

## Current State

### How Highlighting Works Today

Three-layer pipeline in `src/syntax/`:

1. **Tokenizer** (`syntax/tokenizer.ts`) — Generic regex engine. Takes a line + `SyntaxRule[]` array. Rules sorted by priority, longest match wins, already-covered spans skipped.

2. **Highlighter** (`syntax/highlighter.ts`) — Maps `SyntaxToken[]` → `HighlightSpan[]` using a theme. Each span is a `(start, end, ANSIStyle)` triple.

3. **Language definitions** (`syntax/languages/*.ts`) — Regex rule sets for TypeScript/JS, Python, Lisp/T-Lisp, and Go. Each exports a `SyntaxRule[]` with token types (keyword, string, comment, etc.).

**Theme** (`syntax/types.ts`) — `defaultDarkTheme` maps token types to 256-color ANSI styles (e.g., `keyword → magenta+bold`, `string → green`).

**T-Lisp API** (`editor/api/syntax-ops.ts`) — Exposes `syntax-set-language`, `syntax-highlight-line`, `syntax-highlight-enable`, etc. as T-Lisp primitives.

**Rendering** — The editor stores `highlightSpans` on state. `buffer-lines.ts` calls `applyHighlights()` which maps spans through `style()` from `steep/style.ts`. Currently uses 256-color mode (`\x1b[38;5;Nm`), not ANSI 16.

### Limitations

| Limitation | Root Cause |
|-----------|-----------|
| Multi-line constructs break (block comments, template literals) | Regex tokenizer is stateless per line — no parse state carries across lines |
| No structural editing | No AST, only flat token lists |
| No code navigation (go-to-def, find-refs) | No scope/symbol information |
| No AI context for non-T-Lisp files | No AST to serialize for the AI bridge |
| 256-color palette | Theme uses named colors mapped to 256-color codes; no hex/RGB support |

### Comparison with Emacs and Neovim

| Aspect | tmax | Emacs | Neovim |
|--------|------|-------|--------|
| Parsing engine | Regex tokenizer | Font-lock + tree-sitter (29+) | Tree-sitter (primary) |
| Multi-line state | None | Syntax tables carry comment/string depth across lines | Full AST handles natively |
| Incrementality | Recomputes per line on demand | jit-lock defers to visible lines | Incremental subtree reparse |
| Colors | 256-color ANSI | 24-bit RGB faces | 24-bit RGB highlight groups |
| Theme mechanism | Static `HighlightTheme` map | Face inheritance, per-frame customization | Highlight groups with semantic linking |
| User-extensible parsing | No | Yes (Elisp font-lock keywords) | Yes (Lua captures and queries) |

---

## Color Upgrade: 256-Color to 24-bit

Currently using 256-color mode via `\x1b[38;5;Nm` in `steep/style.ts`. Upgrading to true-color (`\x1b[38;2;R;G;Bm`) is straightforward:

**What changes:**
- `style.ts` — `AnsiColor` type expands to accept `#RRGGBB` alongside named colors. Replace `colorCodes` lookup with RGB output.
- `core/types.ts` — `ANSIStyle.fg`/`bg` accept hex strings.
- `syntax/types.ts` — Theme can specify exact hex values (e.g., `keyword: { fg: "#c678dd" }`).

**What doesn't change:**
- `buffer-lines.ts:98` — The ANSI strip regex `/\x1b\[[0-9;]*m/g` already handles both 256 and 24-bit escapes.
- Render pipeline — Everything calls `style()`, picks up RGB automatically.

**Effort:** ~30 lines changed across 3 files.

**Recommendation:** Do this when adding theme portability (Catppuccin, One Dark, Dracula). Those themes are defined in hex and can't be accurately expressed in 256-color. Not urgent if the stateful tokenizer is the priority.

---

## AST Options Analysis

### What the AI Roadmap Needs

From the AI subscription gap analysis, Phase 1 requires:
- **AST serializer** — AST nodes serialized to LLM-consumable format
- **Context builder** — Current buffer + loaded modules + editor APIs assembled into structured AI prompt
- **Code validator** — Parse + sandbox eval of AI-generated code

For T-Lisp files, the existing `parser.ts` already produces AST nodes with `SourceSpan` metadata. The gap is for non-T-Lisp files (TypeScript, Python, Go) that users edit and want AI assistance with.

Three use cases with different depth requirements:

| Use case | Needs | Depth |
|----------|-------|-------|
| Syntax highlighting | Token types + spans | Shallow (flat token list) |
| AI context / structural editing | Named nodes, parent-child, ranges, incremental updates | Deep (full tree) |
| Code navigation (go-to-def, find-refs) | Scope awareness, symbol resolution | Deepest (semantic analysis) |

---

### Option A: tree-sitter (WASM)

Industry-standard incremental parser. GLR algorithm, 60+ grammars, used by Neovim, Helix, Zed, GitHub.

**Integration path:**
```
tree-sitter WASM grammars → loaded at runtime
  ↓
src/syntax/tree-sitter.ts  (new: WASM bridge, ~300 lines)
  ↓
tree-sitter AST → HighlightSpan[] (highlighting)
tree-sitter AST → JSON context (AI bridge)
```

| Criterion | Assessment |
|-----------|-----------|
| Highlighting fix | Yes |
| AST for AI context | Full |
| Structural editing | Yes |
| Incremental parsing | Built-in |
| Language coverage | 60+ grammars (community-maintained) |
| Zero dependencies | **No** — 2-5MB WASM per grammar |
| User-extensible | No |
| Effort | 2-3 weeks integration |
| Performance | Excellent (compiled WASM) |
| Maintenance | Low (community updates grammars) |

**Pros:** Most powerful option. 60+ production grammars. Proven at scale. Fastest path to "every language has an AST."

**Cons:** Breaks zero-dep identity. ~10-25MB for 5 languages. WASM initialization cost (~50-100ms cold). Grammar versioning becomes a maintenance concern. Can't be extended in T-Lisp.

---

### Option B: Lezer (CodeMirror's parser)

Pure JS/TS incremental parser system. LR(1) with GLR fallback. Designed for CodeMirror 6.

**Integration path:**
```
Lezer grammar .grammar files → compiled to JS
  ↓
src/syntax/lezer-bridge.ts  (new: ~200 lines)
  ↓
Lezer syntax tree → HighlightSpan[] / AI context
```

| Criterion | Assessment |
|-----------|-----------|
| Highlighting fix | Yes |
| AST for AI context | Full |
| Structural editing | Yes |
| Incremental parsing | Built-in |
| Language coverage | ~15 languages (smaller ecosystem) |
| Zero dependencies | **No** — JS library dependency |
| User-extensible | No (grammars are compiled separately) |
| Effort | 2-3 weeks integration + grammar work |
| Performance | Good (pure JS) |
| Maintenance | Low-Medium |

**Pros:** Pure JS, no WASM. ~50-200KB per grammar (10-20x smaller than tree-sitter). Incremental parsing designed for editors. Fits zero-dep philosophy better than tree-sitter.

**Cons:** Much smaller grammar ecosystem (~15 vs 60+). No semantic analysis (purely syntactic). Some languages would need grammars written from scratch.

---

### Option C: Stateful regex tokenizer (enhance existing)

Evolve current `syntax/tokenizer.ts` by adding a `ParseState` that carries across lines.

**Integration path:**
```
src/syntax/parse-state.ts (new: ~150 lines)
  ↓
Existing tokenize() modified (~30 lines)
  ↓
Existing highlighter.ts (unchanged)
```

The state tracks block comment depth, string literal type/delimiter, heredoc/interpolation context.

| Criterion | Assessment |
|-----------|-----------|
| Highlighting fix | Yes |
| AST for AI context | **No** — flat tokens only |
| Structural editing | No |
| Incremental parsing | N/A |
| Language coverage | 4 (existing) |
| Zero dependencies | Yes |
| User-extensible | No |
| Effort | 3-5 days |
| Performance | Good |
| Maintenance | Low |

**Pros:** Minimal change. Fixes the immediate multi-line highlighting bug. No new dependencies. Existing language rules unchanged.

**Cons:** Still flat tokens. Doesn't help with AI context, structural editing, or code navigation. Each language's edge cases need per-language state machines.

**Verdict:** Do this now regardless. It fixes a real bug and is orthogonal to the AST decision.

---

### Option D: Hand-written recursive-descent parsers in TypeScript

For each target language, write a TS parser producing proper AST with named nodes and source spans. Similar to existing `tlisp/parser.ts`.

**Integration path:**
```
src/syntax/ast/
  ├── types.ts            (~100 lines: ASTNode, ASTVisitor)
  ├── typescript-parser.ts (~800 lines)
  ├── python-parser.ts     (~600 lines)
  ├── go-parser.ts         (~500 lines)
  └── lisp-parser.ts       (~200 lines, reuse TLispParser)
  ↓
ASTNode → HighlightSpan[] / AI JSON context / structural edits
```

| Criterion | Assessment |
|-----------|-----------|
| Highlighting fix | Yes |
| AST for AI context | Full |
| Structural editing | Yes |
| Incremental parsing | Must build (memoize per line range) |
| Language coverage | As many as you write |
| Zero dependencies | Yes |
| User-extensible | No |
| Effort | 2-3 weeks per language, 8-12 weeks for 4 |
| Performance | Good |
| Maintenance | High (keep up with language evolution) |

**Pros:** Zero dependencies. Full control over AST shape — nodes can map cleanly to T-Lisp primitives. Reuses existing `SourceSpan`/`SourcePosition` types and `WeakMap` source metadata pattern. For T-Lisp, this already exists (`parser.ts`). Debuggable, testable, no build step.

**Cons:** 6-10 weeks for 4-5 production parsers. Language edge cases (JSX, decorators, Python f-strings, Go generics) are a long tail. No GLR error recovery — one syntax error cascades. You're reinventing what tree-sitter and Lezer already do.

---

### Option E: Parser generator in T-Lisp

A T-Lisp library that takes grammar definitions (in T-Lisp) and produces parsers. tmax's equivalent of Emacs's `semantic.el`.

**Grammar DSL concept:**
```lisp
(defgrammar typescript
  :rules ((statement := (if-stmt | for-stmt | return-stmt | expr-stmt))
          (if-stmt := "if" "(" expr ")" block ("else" block)?)
          (block := "{" statement* "}")
          ...))
```

| Criterion | Assessment |
|-----------|-----------|
| Highlighting fix | Yes |
| AST for AI context | Full (native T-Lisp data) |
| Structural editing | Yes |
| Incremental parsing | Must build |
| Language coverage | As many as you write |
| Zero dependencies | Yes |
| User-extensible | **Yes — core differentiator** |
| Effort | 6-10 weeks for generator + 1-2 weeks per grammar |
| Performance | **Concern** — interpreter speed for large files |
| Maintenance | High (compiler + grammars) |

**Pros:** Deeply consistent with tmax architecture. Users can write grammars in `init.tlisp`. Parse trees are native T-Lisp data — no serialization needed for AI bridge. AI can generate grammars. No other editor lets users write parsers in its extension language.

**Cons:** Building a parser generator is a CS research project. T-Lisp interpreter parsing a 10,000-line file will be orders of magnitude slower than compiled alternatives. No error recovery without significant effort. Debugging a parser generator in an interpreter is hard.

**Verdict:** Strategically the most interesting option (genuine differentiator), but it's a v2/v3 research track, not something to bet the AI launch on.

---

## Comparison Summary

| Criterion | tree-sitter | Lezer | Stateful regex | TS parsers | T-Lisp parser-gen |
|-----------|------------|-------|----------------|------------|-------------------|
| Highlighting fix | Yes | Yes | Yes | Yes | Yes |
| AST for AI context | Full | Full | No | Full | Full |
| Structural editing | Yes | Yes | No | Yes | Yes |
| Incremental parsing | Built-in | Built-in | N/A | Must build | Must build |
| Language coverage | 60+ | ~15 | 4 | As you write | As you write |
| Zero dependencies | No | No | Yes | Yes | Yes |
| User-extensible | No | No | No | No | Yes |
| Implementation effort | 2-3 wk | 2-3 wk | 3-5 days | 8-12 wk | 10-16 wk |
| Runtime performance | Excellent | Good | Good | Good | Concern |
| Maintenance burden | Low | Low-Med | Low | High | High |
| AI-ready timeline | Fastest | Fast | N/A | Slow | Slowest |

---

## Recommendation: Phased Approach

### Phase 0 (now): Stateful tokenizer — Option C
Fix the multi-line highlighting bug. 3-5 days. No decisions deferred. This is orthogonal to everything else.

**Also now:** 24-bit color upgrade (~30 lines across 3 files). Enables hex theme definitions.

### Phase 1 (AI months 1-2): T-Lisp AST enrichment — Option D-light
Extend the existing `parser.ts` to produce richer AST nodes for T-Lisp files. This already has `SourceSpan`, `SourcePosition`, and `WeakMap` metadata. Feed it directly to the AI context builder. The AI MVP only needs structural context for T-Lisp (the language users extend), so this is sufficient.

### Phase 2 decision point (AI month 3-4): Non-T-Lisp AST
When AI features are getting traction and users are editing TypeScript/Python/Go files with AI assist:

- **If zero-dep matters:** Lezer (Option B). JS-native, incremental, 15 languages is enough for paid beta. ~50-200KB per grammar.
- **If zero-dep doesn't matter:** tree-sitter WASM (Option A). 60+ languages, proven, fastest path to "works for every language." ~2-5MB per grammar.
- **If you want to differentiate long-term:** Start T-Lisp parser generator (Option E) as a research track. Fund it from AI revenue.

### Phase 3 (month 6+): T-Lisp parser generator — Option E
This is the kind of feature that makes tmax genuinely unique. Start as a research track once AI revenue funds development. The parser generator itself becomes an AI-assisted feature — the AI can generate grammars from language specifications.

---

## Open Questions

1. **Grammar for the AI MVP:** Do users need AI-assisted editing of non-T-Lisp files in the paid beta, or is T-Lisp-only context sufficient for v1?
2. **Zero-dependency identity:** Is "zero external dependencies" a hard constraint or a preference? tree-sitter WASM breaks it; Lezer is a soft break (JS library, no native code).
3. **Performance tolerance:** For the T-Lisp parser generator (Option E), is "correct but slow" acceptable for a v1, or does it need to match tree-sitter performance from day one?
4. **Language priority:** Which non-T-Lisp languages matter most for the AI use case? TypeScript almost certainly, but is Python second, or Go?

# What T-Lisp/Elisp Can Learn from Clojure

A memo on language design ideas from Clojure applicable to T-Lisp (and relevant to any Emacs-like editor Lisp).

## 1. Destructuring in Bindings

**Clojure does:** Every binding form (`let`, `defn` params, `loop`) supports destructuring — pulling data apart where you bind it.

```clojure
;; Clojure
(let [[x y] [1 2]
      {:keys [name age]} user-map]
  (str name " is " age))

(defn handle-point [[x y]]
  (+ x y))
```

**T-Lisp today:** Only flat symbol bindings in `let`. Extracting data requires manual `car`/`cdr`/`hashmap-get` chains.

```lisp
;; T-Lisp - verbose
(let ((x (car point))
      (y (car (cdr point))))
  ...)
```

**Why it matters for an editor Lisp:** Editor code constantly works with structured data — cursor positions `[line col]`, ranges `[[start-line start-col] [end-line end-col]]`, keymap entries. Destructuring cuts noise dramatically.

**Adoption path:** Extend `let` and `defun` parameter parsing to recognize vector/map patterns. Start with positional vector destructuring only — it covers 80% of cases and maps cleanly to T-Lisp's list type.

---

## 2. Threading Macros

**Clojure does:** The `->` (thread-first) and `->>` (thread-last) macros rewrite nested calls into a linear pipeline.

```clojure
;; Clojure - instead of this:
(substring (string-upcase (string-trim input)) 0 10)

;; write this:
(-> input
    string-trim
    string-upcase
    (substring 0 10))
```

**T-Lisp today:** Deep nesting, especially for editor operations.

```lisp
;; T-Lisp - reads inside-out
(substring (string-upcase (buffer-line (cursor-line))) 0 10)
```

**Why it matters for an editor Lisp:** Editor scripts chain operations constantly — get text, transform it, set status, move cursor. Pipelines are the natural shape. Emacs users reach for `(->)` from dash.el constantly.

**Adoption path:** Two macros — `->` (thread-first) and `->>` (thread-last). They're pure syntactic transforms, implementable entirely in T-Lisp's existing `defmacro`:

```lisp
(defmacro -> (expr &rest forms)
  ...)
```

---

## 3. Namespaces / Module System

**Clojure does:** `ns` macro creates isolated namespaces with explicit imports/exports.

```clojure
(ns editor.commands
  (:require [editor.buffer :as buf]))
```

**T-Lisp today:** Single flat global environment. All `defun`s and `defvar`s share one namespace. This already causes issues — the init.tlisp example defines `delete-line` which could collide with a built-in.

**Why it matters for an editor Lisp:** Emacs Elisp's single namespace is its most cited pain point. An editor accumulates hundreds of packages over time. Without isolation, every global name is a potential collision.

**Adoption path:** This is the hardest item on the list. A minimal version:
- Add a `namespace` concept to the environment (just a string prefix on symbols internally)
- `(defmodule editor.commands ...)` wraps definitions
- `(use editor.commands)` imports into current scope
- Don't need Clojure's full `ns` machinery — just prefix-based isolation and selective import

---

## 4. Persistent Data Structures as Default

**Clojure does:** All core collections (lists, vectors, maps, sets) are immutable and persistent. "Mutation" returns a new version sharing structure with the old.

```clojure
(def m {:a 1 :b 2})
(assoc m :c 3)   ;; new map, m unchanged
```

**T-Lisp today:** Hashmaps are already mostly immutable (`hashmap-set` returns a new map). Lists are plain arrays. The stdlib has no mutation functions on lists, which is good — but there's no structural sharing, so every "modification" copies.

**Why it matters for an editor Lisp:** An editor holds buffer text, keymaps, mode state, undo history — all potentially large. Structural sharing makes functional updates cheap enough to be the default. T-Lisp already committed to the functional style (see `rules/functional-programming.md`); persistent structures make that commitment performant.

**Adoption path:** T-Lisp's hashmap already uses `new Map(oldMap)` — replace with a HAMT (hash array mapped trie) for O(log32 n) structural sharing. For lists, consider a RRB-tree (relaxed radix balanced) if large-list performance becomes an issue. Start with the map optimization — editor keymaps and mode state are maps.

---

## 5. Keyword Arguments

**Clojure does:** Maps-as-arguments and keyword syntax for named parameters.

```clojure
(defn move-cursor [opts]
  (let [{:keys [line col preserve-column?]} opts]
    ...))

(move-cursor {:line 5 :col 10 :preserve-column? true})
```

**T-Lisp today:** All arguments are positional. Functions with 3+ parameters become hard to read at call sites.

```lisp
(cursor-move 5 10)  ;; which is line, which is col?
```

**Why it matters for an editor Lisp:** Editor APIs have many optional parameters. `buffer-create`, `cursor-move`, `editor-set-mode` all accumulate flags over time. Named args are the difference between readable and cryptic call sites.

**Adoption path:** Allow hashmap literals as the last argument to any function call. Functions can destructure it. This requires no new syntax — T-Lisp already has hashmaps. Just a convention plus a small `defmacro` wrapper.

---

## 6. Lazy Sequences

**Clojure does:** Most collection operations return lazy seqs — computed on demand, potentially infinite.

```clojure
(take 10 (map inc (range)))  ;; first 10 even numbers
```

**T-Lisp today:** All lists are eagerly realized arrays. `map`, `filter`, etc. don't exist yet — but when added, they'll be eager.

**Why it matters for an editor Lisp:** Editor operations often work with "all lines matching X", "all occurrences of a regex", "all buffers". These sets can be large but you typically need only the first N results. Lazy seqs avoid building intermediate lists.

**Adoption path:** Don't need full Clojure laziness. A simpler approach: add a `seq` abstraction (a thunk that returns the next element or a sentinel) and implement `map-seq`, `filter-seq`, `take`, `reduce` on it. This is a library, not a language change.

---

## 7. Multimethods (or Protocol Dispatch)

**Clojure does:** `defmulti`/`defmethod` dispatch on arbitrary functions, not just type.

```clojure
(defmulti render :shape)  ;; dispatch on the :shape key

(defmethod render :circle [c] ...)
(defmethod render :rect [r] ...)
```

**T-Lisp today:** No polymorphism mechanism beyond checking types manually with `cond`.

**Why it matters for an editor Lisp:** An editor renders text objects, handles different file types, dispatches on modes. Right now T-Lisp would need a big `cond` chain for each operation. Multimethods give you open extension — new file types add methods without touching existing code.

**Adoption path:** Start with a simple `defgeneric`/`defmethod` pair that dispatches on a discriminator function. This is implementable entirely as a library using hashmaps (dispatch table) and closures. No language changes needed.

---

## 8. reader syntax for Common Data

**Clojure does:** Compact literal syntax for vectors `[]`, maps `{}`, sets `#{}`.

```clojure
[1 2 3]        ;; vector
{:a 1 :b 2}   ;; map
#{:a :b :c}   ;; set
```

**T-Lisp today:** Everything uses parentheses. Maps require `(hashmap "key" val ...)`.

```lisp
(hashmap "mode" "normal" "parent" nil "bindings" (hashmap))
```

**Why it matters for an editor Lisp:** Readability. Editor configuration involves a lot of map data (keymaps, mode definitions, face attributes). Distinct bracket types make data structures visually parseable at a glance.

**Adoption path:** Add `[]` as vector syntax (parsed identically to lists but tagged differently) and `{}` as map literal syntax. This requires tokenizer and parser changes but no evaluator changes — vectors desugar to lists, maps desugar to `(hashmap ...)` calls. Keywords (symbols starting with `:`) would be a natural companion — they're self-evaluating symbols used as map keys.

---

## 9. Better Error Messages via Specs / Contracts

**Clojure does:** `clojure.spec` provides rich descriptions of expected data shapes, yielding errors like `"val: [] fails spec: :editor/point predicate: (fn [p] (and (vector? p) (= 2 (count p))))"`.

**T-Lisp today:** Errors are generic: `"hashmap keys must be strings, got number"`. No indication of which call site or what the surrounding context was.

**Why it matters for an editor Lisp:** Users write T-Lisp in their init files and debug interactively. Good errors are the difference between a 30-second fix and a 30-minute hunt.

**Adoption path:** Don't need full spec. Add source location tracking to parsed values (line/column from the tokenizer, which already tracks position). Include it in error messages: `"hashmap keys must be strings, got number at line 15, col 8"`. This is a quality-of-life improvement, not a language feature.

---

## 10. The `condp` / `case` Pattern

**Clojure does:** `case` (constant-time dispatch on values), `condp` (pattern-based conditional).

```clojure
(case mode
  "normal" (handle-normal key)
  "insert" (handle-insert key)
  "visual" (handle-visual key)
  (handle-unknown key))  ;; default
```

**T-Lisp today:** Only `cond`, which evaluates every condition sequentially and requires explicit `t` for default.

```lisp
(cond
  ((eq mode "normal") (handle-normal key))
  ((eq mode "insert") (handle-insert key))
  (t (handle-unknown key)))
```

**Why it matters for an editor Lisp:** Mode dispatch happens on every keystroke. `case` is both faster (hash lookup) and more readable than `cond` chains.

**Adoption path:** Add `case` as a special form. Simple to implement — evaluate the test expression once, then match against literal values. Falls through to default if nothing matches.

---

## Prioritized Recommendations

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Threading macros (`->`, `->>`) | Low (pure macros) | High — immediate readability win |
| 2 | `case` special form | Low | High — mode dispatch on every keystroke |
| 3 | Source locations in errors | Medium (tokenizer changes) | High — UX for init file debugging |
| 4 | Destructuring in `let`/`defun` | Medium | High — less boilerplate |
| 5 | Vector/map literal syntax `[]` `{}` | Medium (tokenizer + parser) | Medium — readability |
| 6 | Keyword arguments via map convention | Low (macro + convention) | Medium — API ergonomics |
| 7 | Persistent map (HAMT) | High | Medium — performance for large state |
| 8 | Lazy sequences | Medium | Medium — deferred computation |
| 9 | Multimethods | Low (library) | Medium — extensibility |
| 10 | Namespaces | High | High — but complex, defer until needed |

The first three can be done without touching the evaluator core. Items 4-5 require parser changes. Items 7-10 are architectural decisions best deferred until T-Lisp has more real-world usage to validate the need.

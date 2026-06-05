# Minibuffer Completion

tmax ships an Emacs-style minibuffer completion stack implemented in T-Lisp:

- `completion.tlisp` defines named completion tables, metadata, categories, and replaceable styles.
- `orderless.tlisp` filters all space-separated components in any order and produces highlight spans.
- `marginalia.tlisp` maps completion categories to replaceable annotators.
- `vertico.tlisp` owns selection, scrolling, visible rows, counts, and the published render view.
- `minibuffer.tlisp` owns input editing, histories, key dispatch, acceptance, and cancellation.

TypeScript provides only general runtime primitives, factual metadata queries, opaque frame-local state transport, normalized key identity, and generic rendering. It does not choose, filter, sort, annotate, select, or accept candidates.

## Completion Tables

A named table receives the current input and an action:

```lisp
(defun my-completion-table (input action)
  (if (string= action "metadata")
    (hashmap "category" "my-category")
    (list
      (hashmap "value" "alpha" "display" "alpha" "annotation" "")
      (hashmap "value" "beta" "display" "beta" "annotation" ""))))
```

Start a serializable completion read with named functions:

```lisp
(completing-read
  "Choose: "
  "my-completion-table"
  nil
  t
  ""
  "my-history"
  "my-accept-function")
```

## Customization

Completion styles and category annotators are ordinary T-Lisp registrations:

```lisp
(completion-register-style "my-style" "my-style-filter")
(completion-set-category-styles "buffer" (list "my-style"))

(marginalia-register-annotator "buffer" "my-buffer-annotator")
```

Active daemon-frame sessions store only serializable T-Lisp data and globally named function references.

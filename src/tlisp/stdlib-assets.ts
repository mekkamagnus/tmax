/**
 * @file stdlib-assets.ts
 * @description Embedded T-Lisp stdlib modules for compiled standalone binaries.
 */

export const STANDALONE_STDLIB_MODULES: Record<string, string> = {
  "std/strings": `
(defmodule std/strings
  (export join trim replace split prefix? suffix? contains?)

  (defun join (separator values)
    (string-join separator values))

  (defun trim (value)
    (string-trim value))

  (defun replace (value search replacement)
    (string-replace value search replacement))

  (defun split (value separator)
    (string-split value separator))

  (defun prefix? (prefix value)
    (string-prefix-p prefix value))

  (defun suffix? (suffix value)
    (string-suffix-p suffix value))

  (defun contains? (needle value)
    (string-contains-p needle value)))
`,
  "std/lists": `
(defmodule std/lists
  (export map filter slice)

  (defun map (fn values)
    (mapcar fn values))

  (defun filter (fn values)
    (filter fn values))

  (defun slice (values start end)
    (list-slice values start end)))
`,
};

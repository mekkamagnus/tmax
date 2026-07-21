/**
 * @file lisp.ts
 * @description Lisp/T-Lisp syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/contracts/editor.ts";

export const extensions = [".tlisp", ".lisp", ".el", ".clj"];

export const rules: SyntaxRule[] = [
  // Line comments
  { pattern: /;.*$/g, type: "comment", priority: 100 },
  // Block comments #| ... |#
  { pattern: /#\|[\s\S]*?\|#/g, type: "comment", priority: 100 },
  // Strings
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  // Special forms / core macros
  { pattern: /\b(?:defun|defmacro|defvar|defconst|let|let\*|if|cond|when|unless|progn|lambda|quote|set!|setq|while|for|dolist|dotimes|return-from|defmethod|defclass|defstruct|deftest|defixture|do)\b/g, type: "keyword", priority: 70 },
  // Built-in functions
  { pattern: /\b(?:car|cdr|cons|list|append|length|map|filter|reduce|not|and|or|apply|funcall|eval|type-of|print|format|concat|split-string|string-match|string-replace|assert-true|assert-false|assert-equal)\b/g, type: "builtin", priority: 60 },
  // Boolean / nil
  { pattern: /\b(?:nil|t|true|false)\b/g, type: "boolean", priority: 65 },
  // Numbers
  { pattern: /\b-?\d+\.?\d*\b/g, type: "number", priority: 55 },
  // Parentheses
  { pattern: /[()]/g, type: "punctuation", priority: 40 },
];

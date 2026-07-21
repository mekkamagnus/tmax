/**
 * @file language-registry.ts
 * @description Central registry mapping language names to syntax rules.
 */

import type { SyntaxRule } from "../core/contracts/editor.ts";
import { rules as tsRules } from "./languages/typescript.ts";
import { rules as pyRules } from "./languages/python.ts";
import { rules as lispRules } from "./languages/lisp.ts";
import { rules as goRules } from "./languages/go.ts";
import { rules as cRules } from "./languages/c.ts";
import { rules as clojureRules } from "./languages/clojure.ts";
import { rules as mdRules } from "./languages/markdown.ts";

export const languageMap: Map<string, SyntaxRule[]> = new Map([
  ["typescript", tsRules],
  ["javascript", tsRules],
  ["tsx", tsRules],
  ["jsx", tsRules],
  ["python", pyRules],
  ["lisp", lispRules],
  ["tlisp", lispRules],
  ["go", goRules],
  ["c", cRules],
  ["cpp", cRules],
  ["h", cRules],
  ["clojure", clojureRules],
  ["clj", clojureRules],
  ["markdown", mdRules],
]);

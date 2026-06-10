/**
 * @file highlight-buffer.ts
 * @description Bridge from tokenizer/highlighter to HighlightSpan[][] for the render pipeline.
 */

import type { HighlightSpan } from "../core/types.ts";
import { tokenize } from "./tokenizer.ts";
import type { ParseState } from "./parse-state.ts";
import type { SyntaxToken } from "../core/types.ts";
import { highlightLine } from "./highlighter.ts";
import { languageMap } from "./language-registry.ts";

const extToLang: Map<string, string> = new Map([
  [".ts", "typescript"], [".tsx", "tsx"], [".js", "javascript"], [".jsx", "jsx"], [".mjs", "javascript"],
  [".py", "python"], [".pyi", "python"],
  [".tlisp", "tlisp"], [".lisp", "lisp"], [".el", "lisp"],
  [".go", "go"],
  [".c", "c"], [".h", "h"], [".cpp", "cpp"], [".hpp", "cpp"],
  [".clj", "clojure"], [".cljs", "clojure"], [".cljc", "clojure"],
  [".md", "markdown"], [".markdown", "markdown"], [".mdx", "markdown"],
]);

export function languageFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return extToLang.get(filename.slice(dot).toLowerCase());
}

export function computeHighlightSpans(
  getLine: (line: number) => string,
  startLine: number,
  endLine: number,
  filename?: string,
): HighlightSpan[][] {
  const lang = languageFromFilename(filename);
  if (!lang) return [];

  const rules = languageMap.get(lang);
  if (!rules) return [];

  const spans: HighlightSpan[][] = [];
  let state: ParseState | undefined;

  for (let lineNum = startLine; lineNum < endLine; lineNum++) {
    const lineText = getLine(lineNum);
    const result = tokenize(lineText, lineNum, rules, state ?? undefined, lang);

    let tokens: SyntaxToken[];
    if (Array.isArray(result)) {
      tokens = result;
    } else {
      tokens = result.tokens;
      state = result.nextState;
    }
    spans[lineNum] = highlightLine(tokens);
  }

  return spans;
}

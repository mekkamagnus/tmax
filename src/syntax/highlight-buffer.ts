/**
 * @file highlight-buffer.ts
 * @description Bridge from tokenizer/highlighter to HighlightSpan[][] for the render pipeline.
 */

import type { HighlightSpan } from "../core/contracts/editor.ts";
import { tokenize } from "./tokenizer.ts";
import type { ParseState } from "./parse-state.ts";
import type { SyntaxToken } from "../core/contracts/editor.ts";
import { highlightLine } from "./highlighter.ts";
import type { WikiLinkClass } from "./wiki-link-faces.ts";
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
  /** SPEC-118: re-classify [[wiki-link]] tokens as resolved/dangling. Only
   *  applied to markdown buffers; callers pass the classifier built from the
   *  buffer under render (see wiki-link-faces.ts). */
  resolveWikiLink?: (target: string) => WikiLinkClass,
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
    if (resolveWikiLink && lang === "markdown") {
      for (const token of tokens) {
        // SPEC-121: inline markdown links whose target is a RELATIVE FILE
        // get the same resolved/dangling health faces as wiki-links;
        // URLs, mailto, and #anchors keep the plain link face.
        if (token.type === "link") {
          const m = /\]\(([^()]*)\)/.exec(lineText.slice(token.startCol, token.endCol));
          const url = m?.[1] ?? "";
          if (url !== "" && !/^(https?:|mailto:|#)/.test(url)) {
            token.type = resolveWikiLink(url);
          }
          continue;
        }
        if (token.type !== "wiki-link") continue;
        const target = lineText
          .slice(token.startCol, token.endCol)
          .replace(/^\[\[/, "")
          .replace(/\]\]$/, "");
        token.type = resolveWikiLink(target);
      }
    }
    spans[lineNum] = highlightLine(tokens);
  }

  return spans;
}

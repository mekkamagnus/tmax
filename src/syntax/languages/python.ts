/**
 * @file python.ts
 * @description Python syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/contracts/editor.ts";

export const extensions = [".py", ".pyi"];

export const rules: SyntaxRule[] = [
  // Comments
  { pattern: /#.*$/g, type: "comment", priority: 100 },
  // Triple-quoted strings
  { pattern: /"""[\s\S]*?"""/g, type: "string", priority: 95 },
  { pattern: /'''[\s\S]*?'''/g, type: "string", priority: 95 },
  // F-strings
  { pattern: /f"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  { pattern: /f'(?:[^'\\]|\\.)*'/g, type: "string", priority: 90 },
  // Regular strings
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 85 },
  { pattern: /'(?:[^'\\]|\\.)*'/g, type: "string", priority: 85 },
  // Decorators
  { pattern: /@\w+/g, type: "decorator", priority: 80 },
  // Keywords
  { pattern: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g, type: "keyword", priority: 70 },
  // Built-in constants
  { pattern: /\b(?:True|False|None)\b/g, type: "constant", priority: 65 },
  // Built-in functions
  { pattern: /\b(?:abs|all|any|bin|bool|chr|dir|divmod|enumerate|eval|filter|float|format|frozenset|getattr|hasattr|hash|hex|id|input|int|isinstance|issubclass|iter|len|list|map|max|min|next|oct|open|ord|pow|print|range|repr|reversed|round|set|setattr|slice|sorted|str|sum|super|tuple|type|vars|zip)\b/g, type: "builtin", priority: 60 },
  // Numbers
  { pattern: /\b(?:0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)\b/g, type: "number", priority: 55 },
];

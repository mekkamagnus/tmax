/**
 * @file typescript.ts
 * @description TypeScript/TSX syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/types.ts";

export const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

export const rules: SyntaxRule[] = [
  // Line comments (highest priority to prevent partial matches)
  { pattern: /\/\/.*$/g, type: "comment", priority: 100 },
  // Block comments
  { pattern: /\/\*[\s\S]*?\*\//g, type: "comment", priority: 100 },
  // Strings (template literals)
  { pattern: /`(?:[^`\\]|\\.)*`/g, type: "string", priority: 90 },
  // Strings (double-quoted)
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  // Strings (single-quoted)
  { pattern: /'(?:[^'\\]|\\.)*'/g, type: "string", priority: 90 },
  // Decorators
  { pattern: /@\w+/g, type: "decorator", priority: 80 },
  // Keywords
  { pattern: /\b(?:abstract|as|asserts|async|await|break|case|catch|class|const|constructor|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|of|package|private|protected|public|readonly|require|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/g, type: "keyword", priority: 70 },
  // Built-in types
  { pattern: /\b(?:any|bigint|boolean|never|null|number|object|string|symbol|undefined|unknown|void|infer)\b/g, type: "type", priority: 65 },
  // Boolean literals
  { pattern: /\b(?:true|false)\b/g, type: "boolean", priority: 65 },
  // Numbers
  { pattern: /\b(?:0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, type: "number", priority: 60 },
  // Regex literals
  { pattern: /\/(?![/*])(?:[^/\\\[\]]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, type: "regexp", priority: 50 },
];

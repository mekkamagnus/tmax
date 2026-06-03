/**
 * @file go.ts
 * @description Go syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/types.ts";

export const extensions = [".go"];

export const rules: SyntaxRule[] = [
  // Line comments
  { pattern: /\/\/.*$/g, type: "comment", priority: 100 },
  // Block comments
  { pattern: /\/\*[\s\S]*?\*\//g, type: "comment", priority: 100 },
  // Strings (interpreted)
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  // Strings (raw)
  { pattern: /`[^`]*`/g, type: "string", priority: 90 },
  // Keywords
  { pattern: /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/g, type: "keyword", priority: 70 },
  // Built-in types
  { pattern: /\b(?:bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr)\b/g, type: "type", priority: 65 },
  // Built-in functions
  { pattern: /\b(?:append|cap|close|copy|delete|imag|len|make|new|panic|print|println|real|recover)\b/g, type: "builtin", priority: 60 },
  // Boolean / nil
  { pattern: /\b(?:true|false|nil|iota)\b/g, type: "constant", priority: 65 },
  // Numbers
  { pattern: /\b(?:0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, type: "number", priority: 55 },
  // Operators
  { pattern: /[:=<>&|+\-*\/%!^]+/g, type: "operator", priority: 30 },
];

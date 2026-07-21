/**
 * @file c.ts
 * @description C syntax rules for the tokenizer
 */

import type { SyntaxRule } from "../../core/contracts/editor.ts";

export const extensions = [".c", ".h"];

export const rules: SyntaxRule[] = [
  // Line comments
  { pattern: /\/\/.*$/g, type: "comment", priority: 100 },
  // Block comments
  { pattern: /\/\*[\s\S]*?\*\//g, type: "comment", priority: 100 },
  // Strings
  { pattern: /"(?:[^"\\]|\\.)*"/g, type: "string", priority: 90 },
  // Character literals
  { pattern: /'(?:[^'\\]|\\.)*'/g, type: "string", priority: 89 },
  // Preprocessor directives
  { pattern: /^#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning|line)\b.*$/gm, type: "special", priority: 95 },
  // Keywords (C11)
  { pattern: /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|_Alignas|_Alignof|_Atomic|_Bool|_Complex|_Generic|_Imaginary|_Noreturn|_Static_assert|_Thread_local)\b/g, type: "keyword", priority: 70 },
  // Built-in types
  { pattern: /\b(?:int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|size_t|ptrdiff_t|intptr_t|uintptr_t|intptr_t|FILE|DIR)\b/g, type: "type", priority: 65 },
  // Boolean / null
  { pattern: /\b(?:true|false|NULL)\b/g, type: "constant", priority: 65 },
  // Numbers
  { pattern: /\b(?:0[xX][\da-fA-F]+[uUlL]*|0[oO]?[0-7]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*)\b/g, type: "number", priority: 60 },
  // Operators
  { pattern: /[+\-*\/%=!<>&|^~?:]+/g, type: "operator", priority: 30 },
];

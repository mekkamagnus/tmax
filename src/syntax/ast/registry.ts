/**
 * @file registry.ts
 * @description Language → parser + scope builder registry
 */

import type { LanguageParser, ASTNode } from "./types.ts";
import type { SymbolTable } from "./scope.ts";
import { tlispParser } from "./parsers/tlisp-parser.ts";
import { typescriptParser } from "./parsers/typescript-parser.ts";
import { pythonParser } from "./parsers/python-parser.ts";
import { cParser } from "./parsers/c-parser.ts";
import { goParser } from "./parsers/go-parser.ts";
import { buildTlispScopes } from "./scopes/tlisp-scope.ts";
import { buildTypeScriptScopes } from "./scopes/typescript-scope.ts";
import { buildPythonScopes } from "./scopes/python-scope.ts";
import { buildCScopes } from "./scopes/c-scope.ts";
import { buildGoScopes } from "./scopes/go-scope.ts";

type ScopeBuilderFn = (root: ASTNode) => SymbolTable;

interface LanguageEntry {
  parser: LanguageParser;
  buildScopes: ScopeBuilderFn;
}

const registry = new Map<string, LanguageEntry>();

const EXT_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".c": "c",
  ".h": "c",
  ".go": "go",
  ".tlisp": "tlisp",
  ".lisp": "tlisp",
};

function registerLanguage(
  name: string,
  parser: LanguageParser,
  buildScopes: ScopeBuilderFn,
): void {
  registry.set(name, { parser, buildScopes });
}

export function getParserForLanguage(name: string): LanguageParser | null {
  return registry.get(name)?.parser ?? null;
}

export function getParserForFile(filename: string): LanguageParser | null {
  const lang = getLanguageForFile(filename);
  return lang ? getParserForLanguage(lang) : null;
}

export function getScopeBuilder(name: string): ScopeBuilderFn | null {
  return registry.get(name)?.buildScopes ?? null;
}

export function getLanguageForFile(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT_MAP[filename.slice(dot)] ?? "";
}

// Register all languages
registerLanguage("tlisp", tlispParser, buildTlispScopes);
registerLanguage("typescript", typescriptParser, buildTypeScriptScopes);
registerLanguage("python", pythonParser, buildPythonScopes);
registerLanguage("c", cParser, buildCScopes);
registerLanguage("go", goParser, buildGoScopes);

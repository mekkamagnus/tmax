/**
 * @file cross-file-resolver.ts
 * @description Cross-file symbol resolution: import tracking, multi-file definition lookups
 */

import type { ASTNode } from "./types.ts";
import type { SymbolTable, Symbol } from "./scope.ts";
import { Either } from "../../utils/task-either.ts";
import { getParserForFile } from "./registry.ts";
import { resetNodeIdCounter } from "./types.ts";

export interface ModuleEntry {
  filePath: string;
  tree: ASTNode;
  symbolTable: SymbolTable;
  sourceHash: number;
}

/**
 * ModuleGraph: tracks which files import which, parses on demand.
 */
export class ModuleGraph {
  private modules = new Map<string, ModuleEntry>();
  private readFile: (path: string) => Promise<string | null>;
  private buildScopes: (tree: ASTNode, language: string) => SymbolTable;

  constructor(deps: {
    readFile: (path: string) => Promise<string | null>;
    buildScopes: (tree: ASTNode, language: string) => SymbolTable;
  }) {
    this.readFile = deps.readFile;
    this.buildScopes = deps.buildScopes;
  }

  /**
   * Resolve an import node's path to an actual file path.
   */
  resolveImport(importDecl: ASTNode, sourceDir: string): string | null {
    // Find the import path — typically a string child or label
    const pathNode = importDecl.children.find(c => c.kind === "string");
    if (!pathNode?.label) return null;

    let importPath = pathNode.label;
    // Strip quotes if present
    if (importPath.startsWith('"') && importPath.endsWith('"')) {
      importPath = importPath.slice(1, -1);
    } else if (importPath.startsWith("'") && importPath.endsWith("'")) {
      importPath = importPath.slice(1, -1);
    }

    // Relative imports
    if (importPath.startsWith(".")) {
      return this.resolveRelativePath(sourceDir, importPath);
    }

    // Bare module name — try sourceDir + node_modules lookup
    return null;
  }

  /**
   * Parse a file if not cached, or return cached AST.
   */
  async parseIfCached(filePath: string): Promise<ModuleEntry | null> {
    const cached = this.modules.get(filePath);
    if (cached) return cached;

    const source = await this.readFile(filePath);
    if (!source) return null;

    const parser = getParserForFile(filePath);
    if (!parser) return null;

    resetNodeIdCounter();
    const result = parser.parse(source, filePath);
    if (Either.isLeft(result)) return null;

    const tree = result.right;
    const lang = this.detectLanguage(filePath);
    const symbolTable = this.buildScopes(tree, lang);

    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }

    const entry: ModuleEntry = { filePath, tree, symbolTable, sourceHash: hash };
    this.modules.set(filePath, entry);
    return entry;
  }

  /**
   * Follow imports to find a definition across files.
   */
  async findDefinitionAcrossFiles(
    symbol: Symbol,
    sourceFilePath: string,
  ): Promise<Symbol | null> {
    const entry = this.modules.get(sourceFilePath);
    if (!entry) return null;

    // Walk imports in the source file to find where the symbol might originate
    const imports = this.findImportNodes(entry.tree);
    const sourceDir = sourceFilePath.substring(0, sourceFilePath.lastIndexOf("/") + 1);

    for (const importNode of imports) {
      const resolvedPath = this.resolveImport(importNode, sourceDir);
      if (!resolvedPath) continue;

      const targetModule = await this.parseIfCached(resolvedPath);
      if (!targetModule) continue;

      const sym = targetModule.symbolTable.root.bindings.get(symbol.name);
      if (sym) return sym;
    }

    return null;
  }

  getModules(): ReadonlyMap<string, ModuleEntry> {
    return this.modules;
  }

  clear(): void {
    this.modules.clear();
  }

  private findImportNodes(tree: ASTNode): ASTNode[] {
    const results: ASTNode[] = [];
    const visit = (node: ASTNode) => {
      if (node.kind === "import") results.push(node);
      for (const child of node.children) visit(child);
    };
    visit(tree);
    return results;
  }

  private resolveRelativePath(sourceDir: string, importPath: string): string | null {
    const resolved = sourceDir + importPath;
    // Try common extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".c", ".h", ".lisp", ".tlisp"];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      // The actual file existence check happens in readFile during parseIfCached
      return candidate;
    }
    return resolved;
  }

  private detectLanguage(filePath: string): string {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const langMap: Record<string, string> = {
      ".ts": "typescript", ".tsx": "typescript",
      ".js": "typescript", ".jsx": "typescript",
      ".py": "python",
      ".go": "go",
      ".c": "c", ".h": "c",
      ".lisp": "lisp", ".tlisp": "tlisp",
      ".clj": "clojure",
    };
    return langMap[ext] ?? "unknown";
  }
}

/**
 * @file snippet-ops.ts
 * @description Snippet loading, parsing, and expansion — yasnippet-style template
 * expansion with Tab-navigable placeholders ($1, $2, $0) and mirror fields.
 * @see SPEC-101 #167
 */

import { existsSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createBoolean, createList, createNumber } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

/** A parsed snippet file. */
export interface Snippet {
  key: string;
  name: string;
  body: string;
  condition?: string;
}

/** A field placeholder in an expanded snippet. */
export interface SnippetField {
  id: number;           // $1, $2, ... (0 = final position)
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  defaultText?: string;
  mirrors: { line: number; col: number }[];
}

/** Active snippet expansion state. */
export interface SnippetExpansion {
  fields: SnippetField[];
  currentFieldIndex: number;  // index into fields[] (sorted by id); -1 = done
}

/**
 * Manages snippet loading + active expansions.
 * One per editor instance.
 */
export class SnippetManager {
  /** Cache: mode → snippets[] */
  private cache = new Map<string, Snippet[]>();
  /** Active expansion (null when not navigating fields) */
  active: SnippetExpansion | null = null;

  /** Snippet directory root (default: ~/.config/tmax/snippets) */
  private snippetRoot: string;

  constructor(snippetRoot?: string) {
    this.snippetRoot = snippetRoot ?? join(process.env.HOME ?? "", ".config", "tmax", "snippets");
  }

  /** Load snippets for a mode from its directory. Returns parsed snippets. */
  loadMode(modeName: string): Snippet[] {
    const cached = this.cache.get(modeName);
    if (cached) return cached;

    const dir = join(this.snippetRoot, modeName);
    if (!existsSync(dir)) {
      this.cache.set(modeName, []);
      return [];
    }

    const snippets: Snippet[] = [];
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        const parsed = this.parseSnippetFile(filePath);
        if (parsed) snippets.push(parsed);
      }
    } catch { /* dir unreadable */ }

    this.cache.set(modeName, snippets);
    return snippets;
  }

  /** Parse a snippet file (yasnippet format: # key: / # name: / # -- / body). */
  private parseSnippetFile(filePath: string): Snippet | null {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch { return null; }

    const lines = content.split("\n");
    let key = "";
    let name = "";
    let condition: string | undefined;
    let bodyStart = 0;

    // Parse headers until # --
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith("# key:")) {
        key = line.slice(6).trim();
      } else if (line.startsWith("# name:")) {
        name = line.slice(7).trim();
      } else if (line.startsWith("# condition:")) {
        condition = line.slice(12).trim();
      } else if (line === "# --" || line.startsWith("# --")) {
        bodyStart = i + 1;
        break;
      } else if (line.startsWith("#") && !line.startsWith("# key") && !line.startsWith("# name") && !line.startsWith("# condition")) {
        // Skip unknown header comments
      } else {
        // No # -- separator → entire file is body (use filename as key)
        bodyStart = i;
        break;
      }
    }

    // If no key found, use the filename
    if (!key) {
      const filename = filePath.split("/").pop() ?? "";
      key = filename;
    }

    const body = lines.slice(bodyStart).join("\n");
    if (!body.trim()) return null;

    return { key, name: name || key, body, condition };
  }

  /** Look up a snippet by key for a mode (+ global text-mode fallback). */
  lookup(key: string, modeName: string): Snippet | null {
    const modeSnippets = this.loadMode(modeName);
    const found = modeSnippets.find(s => s.key === key);
    if (found) return found;
    // Fallback: text-mode (global)
    if (modeName !== "text-mode" && modeName !== "fundamental") {
      const globalSnippets = this.loadMode("text-mode");
      return globalSnippets.find(s => s.key === key) ?? null;
    }
    return null;
  }

  /** List all snippets for a mode. */
  list(modeName: string): Snippet[] {
    const mode = this.loadMode(modeName);
    if (modeName !== "text-mode" && modeName !== "fundamental") {
      return [...mode, ...this.loadMode("text-mode")];
    }
    return mode;
  }

  /** Parse placeholders ($1, ${1:default}, $0) from a template body.
   * Returns { body: string (placeholders replaced with defaults or empty),
   *           fields: SnippetField[] (positions in the EXPANDED text) } */
  parsePlaceholders(body: string): { expandedBody: string; fields: { id: number; defaultText?: string; positions: { line: number; col: number }[] }[] } {
    const fieldsMap = new Map<number, { id: number; defaultText?: string; positions: { line: number; col: number }[] }>();
    let result = "";
    let i = 0;
    let line = 0;
    let col = 0;

    while (i < body.length) {
      if (body[i] === "$") {
        // Check for ${N:default}
        if (body[i + 1] === "{") {
          const closeIdx = body.indexOf("}", i + 2);
          if (closeIdx > 0) {
            const content = body.slice(i + 2, closeIdx);
            const colonIdx = content.indexOf(":");
            const id = colonIdx >= 0 ? parseInt(content.slice(0, colonIdx)) : parseInt(content);
            const defaultText = colonIdx >= 0 ? content.slice(colonIdx + 1) : undefined;

            if (!isNaN(id)) {
              if (!fieldsMap.has(id)) {
                fieldsMap.set(id, { id, defaultText, positions: [] });
              } else if (defaultText && !fieldsMap.get(id)!.defaultText) {
                fieldsMap.get(id)!.defaultText = defaultText;
              }
              fieldsMap.get(id)!.positions.push({ line, col });
              // Insert default text (or empty)
              const text = defaultText ?? "";
              result += text;
              for (const ch of text) {
                if (ch === "\n") { line++; col = 0; } else { col++; }
              }
              i = closeIdx + 1;
              continue;
            }
          }
        }
        // Check for $N (simple)
        const numMatch = body.slice(i + 1).match(/^(\d+)/);
        if (numMatch) {
          const id = parseInt(numMatch[1]!);
          if (!fieldsMap.has(id)) {
            fieldsMap.set(id, { id, positions: [] });
          }
          fieldsMap.get(id)!.positions.push({ line, col });
          // $0 = just a cursor position (no text inserted)
          // $1+ = empty field (no text inserted for now)
          i += 1 + numMatch[1]!.length;
          continue;
        }
      }
      // Regular char
      result += body[i];
      if (body[i] === "\n") { line++; col = 0; } else { col++; }
      i++;
    }

    const fields = [...fieldsMap.values()].sort((a, b) => {
      // Sort by first position, $0 last
      if (a.id === 0) return 1;
      if (b.id === 0) return -1;
      return a.id - b.id;
    });

    return { expandedBody: result, fields };
  }

  /** Clear the cache (force re-read from disk). */
  reload(): void {
    this.cache.clear();
  }

  /** Ensure the snippet directory exists. */
  ensureDir(): void {
    if (!existsSync(this.snippetRoot)) {
      mkdirSync(this.snippetRoot, { recursive: true });
    }
  }
}

export function createSnippetOps(
  access: EditorModelAccess,
  manager: SnippetManager,
  getCurrentMajorMode: () => string,
  getBufferName: () => string,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("snippet-load-dir", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "snippet-load-dir");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const pv = validateArgType(args[0], "string", 0, "snippet-load-dir");
    if (Either.isLeft(pv)) return Either.left(pv.left);

    const mode = args[0]!.value as string;
    const snippets = manager.loadMode(mode);
    return Either.right(createList(snippets.map(s => createList([
      createString(s.key), createString(s.name), createString(s.body),
    ]))));
  });

  api.set("snippet-lookup", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 2, "snippet-lookup");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const kv = validateArgType(args[0], "string", 0, "snippet-lookup");
    if (Either.isLeft(kv)) return Either.left(kv.left);
    const mv = validateArgType(args[1], "string", 1, "snippet-lookup");
    if (Either.isLeft(mv)) return Either.left(mv.left);

    const key = args[0]!.value as string;
    const mode = args[1]!.value as string;
    const snippet = manager.lookup(key, mode);
    if (!snippet) return Either.right(createNil());
    return Either.right(createList([
      createString(snippet.key), createString(snippet.name), createString(snippet.body),
    ]));
  });

  api.set("snippet-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const mode = args.length > 0 && args[0]?.type === "string"
      ? args[0]!.value as string
      : getCurrentMajorMode();
    const snippets = manager.list(mode);
    return Either.right(createList(snippets.map(s => createList([
      createString(s.key), createString(s.name),
    ]))));
  });

  api.set("snippet-reload", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    manager.reload();
    return Either.right(createNil());
  });

  api.set("snippet-field-active-p", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    return Either.right(createBoolean(manager.active !== null));
  });

  api.set("snippet-parse-body", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "snippet-parse-body");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const bv = validateArgType(args[0], "string", 0, "snippet-parse-body");
    if (Either.isLeft(bv)) return Either.left(bv.left);

    const body = args[0]!.value as string;
    const { expandedBody, fields } = manager.parsePlaceholders(body);
    return Either.right(createList([
      createString(expandedBody),
      createList(fields.map(f => createList([
        createNumber(f.id),
        f.defaultText ? createString(f.defaultText) : createNil(),
        createNumber(f.positions.length),
      ]))),
    ]));
  });

  return api;
}

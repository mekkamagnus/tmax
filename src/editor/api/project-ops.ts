/**
 * @file project-ops.ts
 * @description Project operations: root detection + file discovery + search.
 * @see SPEC-097 RFC-014B (project-mode)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, parse as parsePath } from "node:path";
import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList, createNumber } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

const PROJECT_MARKERS = [
  ".git", ".hg", ".svn",
  "package.json", "tsconfig.json", "go.mod", "Cargo.toml",
  "pyproject.toml", "pom.xml", "build.gradle", "Makefile",
  "CMakeLists.txt", "project.clj", "mix.exs", "composer.json",
  "Gemfile", "Rakefile", "setup.py", "requirements.txt",
  ".tmax.project",
];

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", "dist", "build", "target", "bin", "obj",
  ".idea", ".vscode", "__pycache__", ".next", ".nuxt", "coverage",
  ".cache", ".turbo", "*.pyc", "*.o", "*.so", "*.dll", "*.exe",
  ".DS_Store", "Thumbs.db", "*.egg-info", "*.class",
]);

export function createProjectOps(
  getCurrentFilename?: () => string | undefined,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("project-detect-root", (args: TLispValue[]): Either<AppError, TLispValue> => {
    let startPath: string;
    if (args.length > 0 && args[0]!.type !== "nil") {
      const v = validateArgType(args[0], "string", 0, "project-detect-root");
      if (Either.isLeft(v)) return Either.left(v.left);
      startPath = args[0]!.value as string;
    } else {
      startPath = getCurrentFilename?.() ?? process.cwd();
    }
    if (existsSync(startPath) && statSync(startPath).isFile()) startPath = dirname(startPath);

    let dir = resolve(startPath);
    const root = parsePath(dir).root;
    while (dir !== root && dir !== dirname(dir)) {
      for (const marker of PROJECT_MARKERS) {
        if (existsSync(join(dir, marker))) return Either.right(createString(dir));
      }
      dir = dirname(dir);
    }
    return Either.right(createNil());
  });

  api.set("project-files-walk", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 1, "project-files-walk");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const pv = validateArgType(args[0], "string", 0, "project-files-walk");
    if (Either.isLeft(pv)) return Either.left(pv.left);

    const root = args[0]!.value as string;
    const extraIgnores = args.length > 1 && args[1]!.type === "list"
      ? (args[1]!.value as TLispValue[]).filter(v => v.type === "string").map(v => v.value as string)
      : [];
    const allIgnores = new Set([...DEFAULT_IGNORES, ...extraIgnores]);

    const results: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 20) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (shouldIgnore(e.name, allIgnores)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile()) results.push(full);
      }
    };
    walk(root, 0);
    return Either.right(createList(results.map(p => createString(p))));
  });

  api.set("project-search", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const vc = validateArgsCount(args, 2, "project-search");
    if (Either.isLeft(vc)) return Either.left(vc.left);
    const rv = validateArgType(args[0], "string", 0, "project-search");
    if (Either.isLeft(rv)) return Either.left(rv.left);
    const pv = validateArgType(args[1], "string", 1, "project-search");
    if (Either.isLeft(pv)) return Either.left(pv.left);

    const root = args[0]!.value as string;
    const pattern = args[1]!.value as string;
    const extraIgnores = args.length > 2 && args[2]!.type === "list"
      ? (args[2]!.value as TLispValue[]).filter(v => v.type === "string").map(v => v.value as string)
      : [];
    const allIgnores = new Set([...DEFAULT_IGNORES, ...extraIgnores]);

    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 20) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (shouldIgnore(e.name, allIgnores)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile()) files.push(full);
      }
    };
    walk(root, 0);

    const matches: TLispValue[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes(pattern)) {
            matches.push(createList([
              createString(file), createNumber(i + 1), createString(lines[i]!.trim()),
            ]));
          }
        }
      } catch { /* skip unreadable */ }
    }
    return Either.right(createList(matches));
  });

  return api;
}

function shouldIgnore(name: string, ignores: Set<string>): boolean {
  if (ignores.has(name)) return true;
  for (const pat of ignores) {
    if (pat.startsWith("*") && name.endsWith(pat.slice(1))) return true;
  }
  return false;
}

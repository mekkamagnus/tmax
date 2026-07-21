/**
 * @file browse-url-ops.ts
 * @description SPEC-056 browse-url primitives.
 *
 * Two groups of primitives live here:
 *
 *  1. Pure helpers for injection-safe browser dispatch — exported so unit tests
 *     can drive the candidate-selection / spawn logic without launching a real
 *     browser. The T-Lisp primitive `ts-open-external` (registered in
 *     tlisp-api.ts) wires these helpers to real Bun.spawn + node:fs.
 *
 *  2. Buffer scanning and filesystem/git context primitives — low-level
 *     factual queries the T-Lisp command library composes to implement URL
 *     detection and contextual resolution. These belong in TypeScript per the
 *     src/editor/CLAUDE.md rule (TypeScript provides primitives only; T-Lisp
 *     owns editor logic).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createHashmap } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import { existsSync, readFileSync, realpathSync, statSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve as pathResolve, sep as pathSep } from "node:path";

// ── Pure browser dispatch helpers ───────────────────────────────────────

/**
 * Allowlist of URL schemes that ts-open-external will hand to a browser
 * unconditionally. `file` is also accepted but goes through restricted-root
 * validation before being opened.
 */
export const URL_SCHEME_ALLOWLIST = ["http", "https", "mailto", "file"] as const;

/** Repository-relative roots under which `file:` URLs are accepted. */
export const FILE_URL_ALLOWED_ROOTS_REL = ["docs/rfcs", "docs/specs"] as const;

export type TriedStatus = "invalid-browser-template" | "not-executable" | "spawn-failed";

export interface TriedEntry {
  command: string;
  argv?: string[];
  status: TriedStatus;
  message?: string;
}

export type DispatchOutcome =
  | { ok: true; url: string; command: string; argv: string[]; pid: number }
  | { ok: false; reason: "unsupported-scheme"; scheme: string; supported: string[] }
  | { ok: false; reason: "file-url-not-allowed"; path: string; allowedRoots: string[] }
  | { ok: false; reason: "browser-not-found"; tried: TriedEntry[] }
  | { ok: false; reason: "browser-dispatch-failed"; command: string; message: string };

export interface DispatchDeps {
  /** Spawn an argv array. Returns either a pid or an Error thrown before spawn. */
  spawn: (argv: string[]) => { pid: number } | { error: Error };
  /** Resolve a bare command name to an absolute path via PATH, or null if not found. */
  resolveExecutable: (cmd: string) => string | null;
  /** Canonicalize a path (follow symlinks). */
  realpathSync: (path: string) => string;
  /** Stat a path; throws on missing. */
  statSync: (path: string) => { isFile: () => boolean; isDirectory: () => boolean };
  platform: string;
  env: Record<string, string | undefined>;
  /** Absolute roots under which file: URLs are permitted. */
  allowedFileRoots: string[];
  /** Fallback browsers tried after $BROWSER and platform opener. */
  fallbackBrowsers: string[];
}

/**
 * Split a $BROWSER-style env value into one entry per colon, where the colon
 * separator is honored only outside single quotes, double quotes, and
 * backslash escapes. Empty entries are filtered out.
 */
export function splitBrowserEntries(browserEnv: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of browserEnv) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ":") {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  entries.push(current);
  return entries.filter((e) => e.length > 0);
}

/**
 * Tokenize a single command template into an argv array using a small
 * shell-like parser: whitespace separates, single/double quotes group, and
 * backslash escapes the next character. No shell expansion is performed.
 */
export function shellSplit(input: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let hasChar = false;
  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      hasChar = true;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasChar = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasChar) {
        argv.push(current);
        current = "";
        hasChar = false;
      }
      continue;
    }
    current += ch;
    hasChar = true;
  }
  if (hasChar) argv.push(current);
  return argv;
}

/**
 * Apply URL substitution to an argv template. If any element contains `%s` or
 * `%u`, the URL is substituted in-place and no extra argv element is added.
 * Otherwise, the URL is appended as the final argv element.
 */
export function substituteUrlArgv(argvTemplate: string[], url: string): { argv: string[]; appended: boolean } {
  for (const arg of argvTemplate) {
    if (arg.includes("%s") || arg.includes("%u")) {
      const argv = argvTemplate.map((a) => a.replaceAll("%s", url).replaceAll("%u", url));
      return { argv, appended: false };
    }
  }
  return { argv: [...argvTemplate, url], appended: true };
}

/**
 * Build the ordered list of browser candidates from $BROWSER, the platform
 * opener, and the fallback list. Each candidate carries its source label and
 * argv template (before URL substitution).
 */
export function buildBrowserCandidates(deps: DispatchDeps): { source: string; argvTemplate: string[] }[] {
  const candidates: { source: string; argvTemplate: string[] }[] = [];
  const browserEnv = deps.env.BROWSER;
  if (browserEnv) {
    for (const entry of splitBrowserEntries(browserEnv)) {
      const argv = shellSplit(entry);
      if (argv.length > 0) candidates.push({ source: "BROWSER", argvTemplate: argv });
    }
  }
  const platformOpener = deps.platform === "darwin" ? "open" : "xdg-open";
  candidates.push({ source: platformOpener, argvTemplate: [platformOpener] });
  for (const fb of deps.fallbackBrowsers) {
    candidates.push({ source: fb, argvTemplate: [fb] });
  }
  return candidates;
}

/**
 * Validate a `file:` URL against the allowed-roots policy. The decoded path is
 * canonicalized via realpathSync; non-local hosts, missing files, directories,
 * and symlinks escaping the allowed roots are rejected.
 */
export function validateFileUrl(
  rawUrl: string,
  deps: DispatchDeps,
): { ok: true; path: string } | { ok: false; reason: "file-url-not-allowed"; path: string; allowedRoots: string[] } {
  let urlObj: URL;
  try {
    urlObj = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "file-url-not-allowed", path: rawUrl, allowedRoots: [...deps.allowedFileRoots] };
  }
  if (urlObj.host && urlObj.host !== "localhost") {
    return { ok: false, reason: "file-url-not-allowed", path: rawUrl, allowedRoots: [...deps.allowedFileRoots] };
  }
  const decodedPath = decodeURIComponent(urlObj.pathname);
  let realPath: string;
  try {
    realPath = deps.realpathSync(decodedPath);
  } catch {
    return { ok: false, reason: "file-url-not-allowed", path: decodedPath, allowedRoots: [...deps.allowedFileRoots] };
  }
  try {
    const stat = deps.statSync(realPath);
    if (!stat.isFile()) {
      return { ok: false, reason: "file-url-not-allowed", path: realPath, allowedRoots: [...deps.allowedFileRoots] };
    }
  } catch {
    return { ok: false, reason: "file-url-not-allowed", path: decodedPath, allowedRoots: [...deps.allowedFileRoots] };
  }
  // Canonicalize the allowed roots too, so symlinked repo roots match.
  const canonicalRoots = deps.allowedFileRoots.map((r) => {
    try {
      return deps.realpathSync(r);
    } catch {
      return pathResolve(r);
    }
  });
  const isAllowed = canonicalRoots.some(
    (root) => realPath === root || realPath.startsWith(root + pathSep),
  );
  if (!isAllowed) {
    return { ok: false, reason: "file-url-not-allowed", path: realPath, allowedRoots: canonicalRoots };
  }
  return { ok: true, path: realPath };
}

/**
 * Pure dispatch routine: pick a browser candidate, validate the URL, and
 * spawn the process via the injected `spawn` dependency. Returns a structured
 * outcome that the T-Lisp primitive turns into a hashmap. Both success and
 * user-level failure reasons come back as values; argument/runtime errors are
 * the caller's responsibility (returned as Either.left at the primitive layer).
 */
export function dispatchUrl(rawUrl: string, deps: DispatchDeps): DispatchOutcome {
  // 1. Scheme allowlist.
  let scheme: string;
  try {
    const u = new URL(rawUrl);
    scheme = u.protocol.replace(/:$/, "").toLowerCase();
  } catch {
    scheme = "";
  }
  if (!(URL_SCHEME_ALLOWLIST as readonly string[]).includes(scheme)) {
    return { ok: false, reason: "unsupported-scheme", scheme: scheme || "", supported: [...URL_SCHEME_ALLOWLIST] };
  }

  // 2. file: restriction.
  if (scheme === "file") {
    const v = validateFileUrl(rawUrl, deps);
    if (!v.ok) return v;
  }

  // 3. Candidate iteration.
  const candidates = buildBrowserCandidates(deps);
  const tried: TriedEntry[] = [];

  for (const candidate of candidates) {
    const firstArg = candidate.argvTemplate[0]!;
    const resolved = isAbsolute(firstArg) ? (existsSync(firstArg) ? firstArg : null) : deps.resolveExecutable(firstArg);
    if (!resolved) {
      tried.push({ command: firstArg, status: "not-executable" });
      continue;
    }
    // Validate any %s/%u placeholder by ensuring at least one element references it;
    // a template with no executable is already handled above. An "invalid template"
    // is one where shell splitting yielded zero argv or the first element is empty.
    if (candidate.argvTemplate.length === 0 || !candidate.argvTemplate[0]) {
      tried.push({ command: candidate.argvTemplate[0] ?? "(empty)", status: "invalid-browser-template" });
      continue;
    }
    const { argv } = substituteUrlArgv(candidate.argvTemplate, rawUrl);
    // Replace the first element with the resolved absolute path so spawn is deterministic.
    const finalArgv = [resolved, ...argv.slice(1)];
    const spawned = deps.spawn(finalArgv);
    if ("error" in spawned) {
      return {
        ok: false,
        reason: "browser-dispatch-failed",
        command: resolved,
        message: spawned.error.message,
      };
    }
    return { ok: true, url: rawUrl, command: resolved, argv: finalArgv, pid: spawned.pid };
  }

  return { ok: false, reason: "browser-not-found", tried };
}

// ── T-Lisp primitives ───────────────────────────────────────────────────

/**
 * Dependencies the browse-url primitives need from the editor.
 */
export interface BrowseUrlPrimitiveDeps {
  /** CHORE-39 Phase 4: when provided, buffer/path reads use the State monad against EditorModel. */
  access?: EditorModelAccess;
  getCurrentBuffer: () => TextBuffer | null;
  getCurrentBufferName: () => string;
  getCurrentBufferPath: () => string | undefined;
  /** Spawn used by ts-open-external — exposed so tests can stub the browser. */
  spawn: (argv: string[]) => { pid: number } | { error: Error };
  /** Override filesystem + platform for tests. */
  realpathSync?: (path: string) => string;
  statSync?: (path: string) => { isFile: () => boolean; isDirectory: () => boolean };
  platform?: string;
  env?: Record<string, string | undefined>;
  cwd?: () => string;
  /** Override allowed file-URL roots (absolute paths). */
  allowedFileRoots?: string[];
  fallbackBrowsers?: string[];
  /** Custom resolveExecutable; defaults to a node-style PATH lookup. */
  resolveExecutable?: (cmd: string) => string | null;
}

function buildDispatchDeps(deps: BrowseUrlPrimitiveDeps): DispatchDeps {
  const cwd = deps.cwd ?? (() => process.cwd());
  const roots =
    deps.allowedFileRoots ?? FILE_URL_ALLOWED_ROOTS_REL.map((rel) => pathResolve(cwd(), rel));
  return {
    spawn: deps.spawn,
    resolveExecutable:
      deps.resolveExecutable ??
      ((cmd: string): string | null => {
        // Conservative PATH lookup that does not invoke a shell.
        const pathEnv = (deps.env ?? process.env).PATH;
        if (!pathEnv) return null;
        for (const dir of pathEnv.split(":")) {
          if (!dir) continue;
          const candidate = join(dir, cmd);
          if (existsSync(candidate)) {
            try {
              if (statSync(candidate).isFile()) return candidate;
            } catch {
              /* ignore */
            }
          }
        }
        return null;
      }),
    realpathSync: deps.realpathSync ?? ((p: string) => realpathSync(p)),
    statSync: deps.statSync ?? ((p: string) => statSync(p)),
    platform: deps.platform ?? process.platform,
    env: deps.env ?? process.env,
    allowedFileRoots: roots,
    fallbackBrowsers: deps.fallbackBrowsers ?? ["firefox", "google-chrome", "chromium", "brave-browser"],
  };
}

function triedEntryToTlisp(entry: TriedEntry): TLispValue {
  const pairs: [string, TLispValue][] = [
    ["command", createString(entry.command)],
    ["status", createString(entry.status)],
  ];
  if (entry.argv) pairs.push(["argv", createList(entry.argv.map(createString))]);
  if (entry.message) pairs.push(["message", createString(entry.message)]);
  return createHashmap(pairs);
}

/**
 * Wrap dispatchUrl into the SPEC-056 hashmap return shape. Always returns
 * Either.right; argument / runtime errors at the primitive layer become
 * Either.left instead.
 */
export function tsOpenExternalOutcome(
  rawUrl: string,
  deps: BrowseUrlPrimitiveDeps,
): Either<AppError, TLispValue> {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return Either.left(createValidationError("TypeError", "ts-open-external requires a non-empty URL string"));
  }
  const outcome = dispatchUrl(rawUrl, buildDispatchDeps(deps));
  if (outcome.ok) {
    return Either.right(
      createHashmap([
        ["ok", createBoolean(true)],
        ["url", createString(outcome.url)],
        ["command", createString(outcome.command)],
        ["argv", createList(outcome.argv.map(createString))],
        ["pid", createNumber(outcome.pid)],
      ]),
    );
  }
  let details: [string, TLispValue][];
  switch (outcome.reason) {
    case "unsupported-scheme":
      details = [
        ["scheme", createString(outcome.scheme)],
        ["supported", createList(outcome.supported.map(createString))],
      ];
      break;
    case "file-url-not-allowed":
      details = [
        ["path", createString(outcome.path)],
        ["allowed-roots", createList(outcome.allowedRoots.map(createString))],
      ];
      break;
    case "browser-not-found":
      details = [["tried", createList(outcome.tried.map(triedEntryToTlisp))]];
      break;
    case "browser-dispatch-failed":
      details = [
        ["command", createString(outcome.command)],
        ["message", createString(outcome.message)],
      ];
      break;
  }
  return Either.right(
    createHashmap([
      ["ok", createBoolean(false)],
      ["error", createString(outcome.reason)],
      ["details", createHashmap(details!)],
    ]),
  );
}

// ── Buffer scanning primitives ──────────────────────────────────────────

function getBufferLineText(buf: TextBuffer | null, line: number): string | null {
  if (!buf) return null;
  const countResult = buf.getLineCount();
  if (Either.isLeft(countResult)) return null;
  if (line < 0 || line >= countResult.right) return null;
  const lineResult = buf.getLine(line);
  if (Either.isLeft(lineResult)) return null;
  return lineResult.right;
}

/**
 * Create the browse-url T-Lisp primitives: buffer character access, same-line
 * scanning, regex span extraction, and filesystem/git context helpers.
 */
export function createBrowseUrlOps(deps: BrowseUrlPrimitiveDeps): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: prefer State-monad buffer/path reads when access is
  // supplied (real editor runtime); fall back to the legacy getters otherwise.
  const getCurrentBuffer = (): TextBuffer | null =>
    deps.access ? (runModel(deps.access, readModelField("currentBuffer")) ?? null) : deps.getCurrentBuffer();
  const getCurrentBufferPath = (): string | undefined =>
    deps.access ? runModel(deps.access, readModelField("currentFilename")) : deps.getCurrentBufferPath();
  const api = new Map<string, TLispFunctionImpl>();

  // (buffer-get-char-at-position line column) → char-string | nil
  api.set("buffer-get-char-at-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError("ConstraintViolation", "buffer-get-char-at-position requires 2 args: line, column"));
    }
    if (args[0]!.type !== "number" || args[1]!.type !== "number") {
      return Either.left(createValidationError("TypeError", "buffer-get-char-at-position args must be numbers"));
    }
    const line = Math.floor(Number(args[0]!.value));
    const column = Math.floor(Number(args[1]!.value));
    const text = getBufferLineText(getCurrentBuffer(), line);
    if (text === null) return Either.right(createNil());
    // column === text.length is out of bounds per spec (do not synthesize newline).
    if (column < 0 || column >= text.length) return Either.right(createNil());
    return Either.right(createString(text[column]!));
  });

  // (buffer-scan-backward-from line column stop-chars max-chars)
  //   → (hashmap "line" line "column" start "truncated" bool)
  // Scans left from the cursor char (or previous char when column == line-length).
  // Returns the inclusive start boundary of the run that excludes stop-chars.
  api.set("buffer-scan-backward-from", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 4) {
      return Either.left(createValidationError("ConstraintViolation", "buffer-scan-backward-from requires 4 args"));
    }
    if (args[0]!.type !== "number" || args[1]!.type !== "number" || args[2]!.type !== "string" || args[3]!.type !== "number") {
      return Either.left(createValidationError("TypeError", "buffer-scan-backward-from: (line number, column number, stop-chars string, max-chars number)"));
    }
    const line = Math.floor(Number(args[0]!.value));
    const column = Math.floor(Number(args[1]!.value));
    const stopChars = String(args[2]!.value);
    const maxChars = Math.floor(Number(args[3]!.value));
    if (maxChars <= 0) {
      return Either.left(createValidationError("ConstraintViolation", "buffer-scan-backward-from max-chars must be positive"));
    }
    const text = getBufferLineText(getCurrentBuffer(), line);
    if (text === null) {
      return Either.right(createHashmap([["line", createNumber(line)], ["column", createNumber(column)], ["truncated", createBoolean(false)]]));
    }
    if (column < 0 || column > text.length) {
      return Either.right(createHashmap([["line", createNumber(line)], ["column", createNumber(column)], ["truncated", createBoolean(false)]]));
    }
    // Start scanning from the character under the cursor, or the previous character
    // when column equals the line length.
    let i = column < text.length ? column : text.length - 1;
    let consumed = 0;
    let truncated = false;
    while (i >= 0) {
      if (consumed >= maxChars) {
        truncated = true;
        break;
      }
      const ch = text[i]!;
      if (stopChars.includes(ch)) break;
      i--;
      consumed++;
    }
    // i now points at the position before the run start; the run starts at i+1.
    const start = i + 1;
    return Either.right(
      createHashmap([
        ["line", createNumber(line)],
        ["column", createNumber(start)],
        ["truncated", createBoolean(truncated)],
      ]),
    );
  });

  // (buffer-scan-forward-from line column stop-chars max-chars)
  //   → (hashmap "line" line "column" end "truncated" bool)
  // Scans right from column, returns the exclusive end boundary of the run
  // that excludes stop-chars.
  api.set("buffer-scan-forward-from", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 4) {
      return Either.left(createValidationError("ConstraintViolation", "buffer-scan-forward-from requires 4 args"));
    }
    if (args[0]!.type !== "number" || args[1]!.type !== "number" || args[2]!.type !== "string" || args[3]!.type !== "number") {
      return Either.left(createValidationError("TypeError", "buffer-scan-forward-from: (line number, column number, stop-chars string, max-chars number)"));
    }
    const line = Math.floor(Number(args[0]!.value));
    const column = Math.floor(Number(args[1]!.value));
    const stopChars = String(args[2]!.value);
    const maxChars = Math.floor(Number(args[3]!.value));
    if (maxChars <= 0) {
      return Either.left(createValidationError("ConstraintViolation", "buffer-scan-forward-from max-chars must be positive"));
    }
    const text = getBufferLineText(getCurrentBuffer(), line);
    if (text === null) {
      return Either.right(createHashmap([["line", createNumber(line)], ["column", createNumber(column)], ["truncated", createBoolean(false)]]));
    }
    if (column < 0 || column > text.length) {
      return Either.right(createHashmap([["line", createNumber(line)], ["column", createNumber(column)], ["truncated", createBoolean(false)]]));
    }
    let i = column;
    let consumed = 0;
    let truncated = false;
    while (i < text.length) {
      if (consumed >= maxChars) {
        truncated = true;
        break;
      }
      const ch = text[i]!;
      if (stopChars.includes(ch)) break;
      i++;
      consumed++;
    }
    return Either.right(
      createHashmap([
        ["line", createNumber(line)],
        ["column", createNumber(i)],
        ["truncated", createBoolean(truncated)],
      ]),
    );
  });

  // (string-match-spans-all pattern text)
  //   → (hashmap "ok" t "matches" (match...))  |  (hashmap "ok" nil "error" "invalid-regex" "details" (hashmap "pattern" p "message" m))
  // Pure: does NOT mutate the global string-match state. Each match is:
  //   (hashmap "start" s "end" e "text" full "groups" (group...))
  // group entry: (hashmap "index" n "start" s-or-nil "end" e-or-nil "text" t-or-nil)
  // Group 0 is omitted because the full match is already top-level.
  api.set("string-match-spans-all", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError("ConstraintViolation", "string-match-spans-all requires 2 args: pattern, text"));
    }
    if (args[0]!.type !== "string" || args[1]!.type !== "string") {
      return Either.left(createValidationError("TypeError", "string-match-spans-all args must be strings"));
    }
    const pattern = String(args[0]!.value);
    const text = String(args[1]!.value);
    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch (e) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("invalid-regex")],
          ["details", createHashmap([["pattern", createString(pattern)], ["message", createString(e instanceof Error ? e.message : String(e))]])],
        ]),
      );
    }
    const matches: TLispValue[] = [];
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        // Avoid infinite loop on zero-width matches.
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = m.index + m[0].length;
      const groups: TLispValue[] = [];
      for (let g = 1; g < m.length; g++) {
        const gv = m[g];
        if (gv === undefined) {
          groups.push(createHashmap([["index", createNumber(g)], ["start", createNil()], ["end", createNil()], ["text", createNil()]]));
        } else {
          const gStart = text.indexOf(gv, m.index);
          groups.push(
            createHashmap([
              ["index", createNumber(g)],
              ["start", createNumber(gStart >= 0 ? gStart : start)],
              ["end", createNumber(gStart >= 0 ? gStart + gv.length : end)],
              ["text", createString(gv)],
            ]),
          );
        }
      }
      matches.push(
        createHashmap([
          ["start", createNumber(start)],
          ["end", createNumber(end)],
          ["text", createString(m[0])],
          ["groups", createList(groups)],
        ]),
      );
      if (guard++ > 100000) break;
    }
    return Either.right(
      createHashmap([
        ["ok", createBoolean(true)],
        ["matches", createList(matches)],
      ]),
    );
  });

  // (browse-doc-reference reference kind)
  //   kind is "rfc" or "spec". Returns (hashmap "ok" t "path" p "url" file://...)
  //   or (hashmap "ok" nil "error" "docs-reference-not-found" "details" ...)
  //   or (hashmap "ok" nil "error" "file-url-not-allowed" "details" ...)
  api.set("browse-doc-reference", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError("ConstraintViolation", "browse-doc-reference requires 2 args: reference, kind"));
    }
    if (args[0]!.type !== "string" || args[1]!.type !== "string") {
      return Either.left(createValidationError("TypeError", "browse-doc-reference args must be strings"));
    }
    const reference = String(args[0]!.value);
    const kind = String(args[1]!.value);
    if (kind !== "rfc" && kind !== "spec") {
      return Either.left(createValidationError("ConstraintViolation", `browse-doc-reference kind must be "rfc" or "spec"`));
    }
    const cwd = (deps.cwd ?? (() => process.cwd()))();
    const relRoot = kind === "rfc" ? "docs/rfcs" : "docs/specs";
    const rootAbs = pathResolve(cwd, relRoot);
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(rootAbs);
    } catch {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("docs-reference-not-found")],
          ["details", createHashmap([["reference", createString(reference)], ["root", createString(rootAbs)]])],
        ]),
      );
    }
    let entries: string[];
    try {
      entries = readdirSync(canonicalRoot);
    } catch {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("docs-reference-not-found")],
          ["details", createHashmap([["reference", createString(reference)], ["root", createString(canonicalRoot)]])],
        ]),
      );
    }
    const prefix = `${reference}-`;
    const match = entries.find((name) => name.startsWith(prefix));
    if (!match) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("docs-reference-not-found")],
          ["details", createHashmap([["reference", createString(reference)], ["root", createString(canonicalRoot)]])],
        ]),
      );
    }
    const candidatePath = join(canonicalRoot, match);
    let canonicalPath: string;
    try {
      canonicalPath = realpathSync(candidatePath);
    } catch {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("docs-reference-not-found")],
          ["details", createHashmap([["reference", createString(reference)], ["root", createString(canonicalRoot)]])],
        ]),
      );
    }
    // Reject if the realpath escapes the root (symlink chain).
    if (canonicalPath !== candidatePath && !canonicalPath.startsWith(canonicalRoot + pathSep)) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("file-url-not-allowed")],
          ["details", createHashmap([["path", createString(canonicalPath)], ["allowed-roots", createList([createString(canonicalRoot)])]])],
        ]),
      );
    }
    // Reject directories.
    try {
      if (statSync(canonicalPath).isDirectory()) {
        return Either.right(
          createHashmap([
            ["ok", createBoolean(false)],
            ["error", createString("file-url-not-allowed")],
            ["details", createHashmap([["path", createString(canonicalPath)], ["allowed-roots", createList([createString(canonicalRoot)])]])],
          ]),
        );
      }
    } catch {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("docs-reference-not-found")],
          ["details", createHashmap([["reference", createString(reference)], ["root", createString(canonicalRoot)]])],
        ]),
      );
    }
    return Either.right(
      createHashmap([
        ["ok", createBoolean(true)],
        ["path", createString(canonicalPath)],
        ["url", createString(`file://${canonicalPath}`)],
      ]),
    );
  });

  // (browse-git-github-remote)
  //   → (hashmap "ok" t "owner" o "repo" r "remote" n "url" u "worktree" w)
  //   |  (hashmap "ok" nil "error" "github-remote-not-found" "details" ...)
  api.set("browse-git-github-remote", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const bufferName = deps.getCurrentBufferName();
    const bufferPath = getCurrentBufferPath();
    const startDir = bufferPath ?? (deps.cwd ?? (() => process.cwd()))();
    // Walk up to find a .git file or directory.
    let dir = isAbsolute(startDir) ? pathResolve(startDir) : pathResolve((deps.cwd ?? (() => process.cwd()))(), startDir);
    let worktree: string | null = null;
    // If the buffer path is a file, start from its directory.
    try {
      if (bufferPath) {
        const stat = statSync(bufferPath);
        if (stat.isFile()) {
          dir = pathResolve(dir, "..");
        }
      }
    } catch {
      /* fall through */
    }
    let cur = dir;
    for (;;) {
      const dotGit = join(cur, ".git");
      if (existsSync(dotGit)) {
        worktree = cur;
        break;
      }
      const parent = pathResolve(cur, "..");
      if (parent === cur) break;
      cur = parent;
    }
    if (!worktree) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("github-remote-not-found")],
          ["details", createHashmap([["buffer", createString(bufferName)], ["path", bufferPath ? createString(bufferPath) : createNil()]])],
        ]),
      );
    }
    // .git may be a file (worktree pointer) or a directory.
    const dotGitPath = join(worktree, ".git");
    let configPath: string | null = null;
    try {
      const stat = statSync(dotGitPath);
      if (stat.isDirectory()) {
        configPath = join(dotGitPath, "config");
      } else {
        // gitdir file: "gitdir: /path/to/repo.git/worktrees/xxx"
        const content = readFileSync(dotGitPath, "utf-8").trim();
        const m = content.match(/^gitdir:\s*(.+)$/);
        if (m) {
          const gitdir = m[1]!.trim();
          const candidate = isAbsolute(gitdir) ? join(gitdir, "config") : join(worktree, gitdir, "config");
          if (existsSync(candidate)) configPath = candidate;
        }
      }
    } catch {
      /* fall through to not-found */
    }
    if (!configPath || !existsSync(configPath)) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("github-remote-not-found")],
          ["details", createHashmap([["buffer", createString(bufferName)], ["path", bufferPath ? createString(bufferPath) : createNil()]])],
        ]),
      );
    }
    let configText: string;
    try {
      configText = readFileSync(configPath, "utf-8");
    } catch {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("github-remote-not-found")],
          ["details", createHashmap([["buffer", createString(bufferName)], ["path", bufferPath ? createString(bufferPath) : createNil()]])],
        ]),
      );
    }
    const remotes = parseGitRemotes(configText);
    // Try origin, upstream, then any other remote whose URL parses as GitHub.
    const order = ["origin", "upstream", ...Object.keys(remotes).filter((r) => r !== "origin" && r !== "upstream")];
    for (const remoteName of order) {
      const url = remotes[remoteName];
      if (!url) continue;
      const gh = parseGithubUrl(url);
      if (gh) {
        return Either.right(
          createHashmap([
            ["ok", createBoolean(true)],
            ["owner", createString(gh.owner)],
            ["repo", createString(gh.repo)],
            ["remote", createString(remoteName)],
            ["url", createString(url)],
            ["worktree", createString(worktree)],
          ]),
        );
      }
    }
    return Either.right(
      createHashmap([
        ["ok", createBoolean(false)],
        ["error", createString("github-remote-not-found")],
        ["details", createHashmap([["buffer", createString(bufferName)], ["path", bufferPath ? createString(bufferPath) : createNil()]])],
      ]),
    );
  });

  return api;
}

// ── Git config parsing (pure helpers) ───────────────────────────────────

/**
 * Parse a git config text blob and return remote name → URL mappings.
 * Pure: no filesystem access, no shell.
 */
export function parseGitRemotes(configText: string): Record<string, string> {
  const remotes: Record<string, string> = {};
  let currentRemote: string | null = null;
  for (const rawLine of configText.split("\n")) {
    const line = rawLine.trim();
    const section = line.match(/^\[remote\s+"([^"]+)"\s*\]/);
    if (section) {
      currentRemote = section[1]!;
      continue;
    }
    if (currentRemote) {
      const url = line.match(/^url\s*=\s*(.+)$/);
      if (url && remotes[currentRemote] === undefined) {
        remotes[currentRemote] = url[1]!.trim();
      }
    }
  }
  return remotes;
}

/**
 * Parse a GitHub remote URL into owner/repo. Supports HTTPS, SSH, and
 * ssh://git@ forms. Returns null for non-GitHub URLs or malformed inputs.
 */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  let m = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return { owner: m[1]!, repo: m[2]! };
  m = url.match(/^ssh:\/\/git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return { owner: m[1]!, repo: m[2]! };
  m = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return { owner: m[1]!, repo: m[2]! };
  return null;
}

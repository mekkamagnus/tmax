/**
 * @file stdlib.ts
 * @description T-Lisp Standard Library Functions
 *
 * This file contains all built-in T-Lisp standard library functions.
 * These functions provide core functionality for hash-map manipulation,
 * and will be expanded to include additional utility functions in the future.
 *
 * Usage:
 *   import { registerStdlibFunctions } from "./stdlib.ts";
 *   registerStdlibFunctions(interpreter);
 *
 * The standard library functions are automatically registered with the
 * interpreter's global environment, making them available to all T-Lisp code.
 */

import type { EvalContext, TLispFunctionImpl, TLispInterpreter, TLispValue } from "./types.ts";
import {
  createBoolean,
  createHashmap,
  createList,
  createNil,
  createNumber,
  createPromise,
  createString,
  isHashmap,
  isPromise,
  isTruthy,
  valueToString,
  valuesEqual,
} from "./values.ts";
import { Either } from "../utils/task-either.ts";
import type { AppError } from "../error/types.ts";
import { awaitPromiseValue } from "./async.ts";

/** Wrap a raw TLispValue-returning function into a TLispFunctionImpl */
function raw(fn: (args: TLispValue[]) => TLispValue): (args: TLispValue[]) => Either<AppError, TLispValue> {
  return (args) => Either.right(fn(args));
}

// ── Completion span matching ────────────────────────────────────────────────
// Shared by the string-*-spans builtins below AND the bulk orderless filter,
// so the two can never drift (BUG-79: the bulk filter exists because driving
// these per candidate × per component through the interpreter cost ~250ms per
// M-x keystroke).

/** A [start, end) match span. */
type Span = [number, number];

function literalSpansOf(needle: string, target: string, caseSensitive: boolean): Span[] {
  const t = caseSensitive ? target : target.toLowerCase();
  const q = caseSensitive ? needle : needle.toLowerCase();
  if (q.length === 0) return [];
  const spans: Span[] = [];
  let start = 0;
  while (start <= t.length) {
    const index = t.indexOf(q, start);
    if (index < 0) break;
    spans.push([index, index + q.length]);
    start = index + Math.max(1, q.length);
  }
  return spans;
}

function regexpSpansOf(pattern: string, target: string, caseSensitive: boolean): Span[] {
  try {
    const regexp = new RegExp(pattern, caseSensitive ? "gu" : "giu");
    const spans: Span[] = [];
    for (const match of target.matchAll(regexp)) {
      if (match.index === undefined) continue;
      const text = match[0] ?? "";
      spans.push([match.index, match.index + text.length]);
      if (text.length === 0) regexp.lastIndex++;
    }
    return spans;
  } catch {
    // SPEC-121: an INVALID REGEX pattern (e.g. a completion component like
    // "(2026" typed into the minibuffer) must degrade to a LITERAL match,
    // not silently drop every candidate — "No match" for one paren was the
    // live bug. Orderless-style components stay usable for hostile input.
    return literalSpansOf(pattern, target, caseSensitive);
  }
}

function flexSpansOf(pattern: string, target: string, caseSensitive: boolean): Span[] {
  const p = caseSensitive ? pattern : pattern.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();
  const spans: Span[] = [];
  let targetIndex = 0;
  for (const character of p) {
    const index = t.indexOf(character, targetIndex);
    if (index < 0) return [];
    spans.push([index, index + character.length]);
    targetIndex = index + character.length;
  }
  return spans;
}

function initialismSpansOf(pattern: string, target: string, caseSensitive: boolean): Span[] {
  const p = caseSensitive ? pattern : pattern.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();
  const starts = Array.from(t.matchAll(/(^|[-_\s/])([\p{L}\p{N}])/gu))
    .map(match => (match.index ?? 0) + (match[1]?.length ?? 0));
  const spans: Span[] = [];
  let startIndex = 0;
  for (const character of p) {
    const found = starts.findIndex((position, index) =>
      index >= startIndex && t.slice(position).startsWith(character),
    );
    if (found < 0) return [];
    const position = starts[found]!;
    spans.push([position, position + character.length]);
    startIndex = found + 1;
  }
  return spans;
}

function spansToValue(spans: Span[]): TLispValue {
  return createList(spans.map(([s, e]) => createList([createNumber(s), createNumber(e)])));
}

/**
 * BUG-80 (#187): build one vertico row's segments in TS — a faithful port of
 * vertico-segments-from-spans / vertico-annotation-segments-from-spans /
 * vertico-candidate-segments / vertico-row in vertico.tlisp (the reference
 * implementation). Spans are sorted here by start position (no name-dispatched
 * predicate). Faces: "candidate" / "completion-match" for the display,
 * "annotation" / "completion-match" for the annotation.
 */
function verticoRowOf(candidate: TLispValue, selectedValue: string): [string, TLispValue][] {
  const map = candidate.type === "hashmap" ? candidate.value as Map<string, TLispValue> : new Map();
  const str = (key: string): string => {
    const v = map.get(key);
    return v?.type === "string" ? v.value as string : "";
  };
  const spans = (key: string): [number, number][] => {
    const v = map.get(key);
    if (!v || v.type !== "list") return [];
    return (v.value as TLispValue[])
      .map((pair) => {
        const p = pair?.type === "list" ? pair.value as TLispValue[] : [];
        const s = p[0]?.type === "number" ? p[0].value as number : 0;
        const e = p[1]?.type === "number" ? p[1].value as number : 0;
        return [s, e] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);
  };
  // Walk spans over TEXT emitting face-tagged segments (mirrors the recursive
  // segments-from-spans: leading plain run, matched run, recurse past end).
  const segmentsFrom = (text: string, spanList: [number, number][], point: number, plainFace: string, out: [string, TLispValue][]): void => {
    if (spanList.length === 0) {
      if (point < text.length) out.push(["", createHashmap([["text", createString(text.slice(point))], ["face", createString(plainFace)]])]);
      return;
    }
    const [rawStart, rawEnd] = spanList[0]!;
    const start = Math.max(point, rawStart);
    const end = Math.max(start, rawEnd);
    if (point < start) out.push(["", createHashmap([["text", createString(text.slice(point, start))], ["face", createString(plainFace)]])]);
    if (start < end) out.push(["", createHashmap([["text", createString(text.slice(start, end))], ["face", createString("completion-match")]])]);
    segmentsFrom(text, spanList.slice(1), end, plainFace, out);
  };

  const display = str("display");
  const annotation = str("annotation");
  const segments: [string, TLispValue][] = [];
  segmentsFrom(display, spans("spans"), 0, "candidate", segments);
  if (annotation.length > 0) {
    segments.push(["", createHashmap([["text", createString("  ")], ["face", createString("annotation")]])]);
    segmentsFrom(annotation, spans("annotation-spans"), 0, "annotation", segments);
  }
  return [
    ["selected", createBoolean(str("value") === selectedValue)],
    ["segments", createList(segments.map(([, v]) => v))],
  ];
}

/**
 * BUG-79: annotation for one candidate under one of the three BUILT-IN
 * marginalia categories — a faithful TS port of marginalia-buffer-annotation /
 * -command-annotation / -file-annotation in marginalia.tlisp (levels 0–2),
 * which stay the reference implementation. Returns "" for unknown categories
 * (the generic T-Lisp path handles custom annotators).
 */
function marginaliaAnnotationOf(category: string, level: number, candidate: TLispValue): string {
  const meta = candidate.type === "hashmap"
    ? ((candidate.value as Map<string, TLispValue>).get("metadata")?.value as Map<string, TLispValue> | undefined)
    : undefined;
  const field = (key: string): TLispValue | undefined => meta?.get(key);
  const str = (key: string): string => {
    const v = field(key);
    return v === undefined || v.type === "nil" ? "" : String(v.value);
  };
  const flag = (key: string, mark: string): string => {
    const v = field(key);
    return v !== undefined && isTruthy(v) ? mark : " ";
  };
  const firstBinding = (): string | null => {
    const bindings = field("bindings");
    if (!bindings || bindings.type !== "list") return null;
    const first = (bindings.value as TLispValue[])[0];
    return first?.type === "string" ? first.value as string : null;
  };
  if (category === "command") {
    if (level >= 2) return "  ";
    const key = firstBinding();
    const prefix = "  " + (key ? `[${key}] ` : "");
    return level === 1 ? prefix : prefix + str("documentation");
  }
  if (category === "buffer") {
    const marks = `${flag("current", "*")}${flag("modified", "+")}`;
    if (level === 0) {
      const filename = str("filename");
      return `  ${marks}  ${str("major-mode")}  ${str("characters")} chars${filename ? "  " + filename : ""}`;
    }
    return level === 1 ? `  ${marks}  ${str("major-mode")}` : `  ${marks}`;
  }
  if (category === "file") {
    const isDir = field("is-dir");
    return isDir !== undefined && isTruthy(isDir) ? "  dir" : `  ${str("size")} bytes`;
  }
  return "";
}

/**
 * Match one orderless component against a candidate. A faithful TS port of
 * orderless.tlisp's component dispatch: `=` literal, `^` prefix (literal at
 * 0), `~` flex, `,` initialism, `&` regexp on the annotation, default regexp
 * on the display; `!` negates (literal over the display). Smart-case is
 * computed on the FULL component (sigil included), as in the T-Lisp.
 */
function orderlessMatchComponent(
  component: string,
  display: string,
  annotation: string,
): { reject: boolean; spans: Span[]; onAnnotation: boolean } {
  const first = component[0] ?? "";
  const sigil = first !== "" && "=^~,!&".includes(first);
  const body = sigil ? component.slice(1) : component;
  const caseSensitive = component !== component.toLowerCase();
  if (first === "!") {
    return { reject: literalSpansOf(body, display, caseSensitive).length > 0, spans: [], onAnnotation: false };
  }
  const onAnnotation = first === "&";
  const target = onAnnotation ? annotation : display;
  let spans: Span[];
  switch (first) {
    case "=": spans = literalSpansOf(body, target, caseSensitive); break;
    case "^": {
      const literal = literalSpansOf(body, target, caseSensitive);
      spans = literal.length > 0 && literal[0]![0] === 0 ? literal : [];
      break;
    }
    case "~": spans = flexSpansOf(body, target, caseSensitive); break;
    case ",": spans = initialismSpansOf(body, target, caseSensitive); break;
    default: spans = regexpSpansOf(body, target, caseSensitive); break;
  }
  return { reject: spans.length === 0, spans, onAnnotation };
}

/**
 * Register all standard library functions with the T-Lisp interpreter
 * @param interpreter - The T-Lisp interpreter instance
 *
 * This function registers all built-in standard library functions
 * by calling interpreter.defineBuiltin() for each function.
 *
 * Standard library functions include:
 * - Hash-map manipulation (hashmap-get, hashmap-set, hashmap-keys, etc.)
 *
 * More functions will be added here as the standard library expands.
 */
export function registerStdlibFunctions(interpreter: TLispInterpreter): void {
  const resolveCallable = (value: TLispValue): TLispValue => {
    if (value.type === "symbol" || value.type === "string") {
      const name = value.value as string;
      let resolved = interpreter.globalEnv.lookup(name);

      // Try module exports for qualified names
      if (!resolved && (interpreter as any).moduleRegistry) {
        const registry = (interpreter as any).moduleRegistry;
        const slashIdx = name.indexOf("/");
        const publicExport = slashIdx > 0 && typeof registry.resolvePublicName === "function"
          ? registry.resolvePublicName(name)
          : undefined;
        if (publicExport) {
          resolved = publicExport.value;
        }

        if (slashIdx > 0) {
          const alias = name.substring(0, slashIdx);
          const symName = name.substring(slashIdx + 1);
          // Walk imports to find the module
          let current: any = interpreter.globalEnv;
          while (current) {
            if (current.moduleImports) {
              const imp = current.moduleImports.get(alias);
              if (imp) {
                const record = registry.resolve(imp.moduleName);
                if (record && record.state === "loaded" && record.exports.has(symName)) {
                  resolved = record.env.lookup(symName);
                  if (resolved) return resolved;
                }
              }
            }
            current = current.parent;
          }
        }
        // Check unique module exports for unqualified callback names.
        if (!resolved && slashIdx < 0 && typeof registry.resolveUniqueExport === "function") {
          const entry = registry.resolveUniqueExport(name);
          if (entry && entry !== "ambiguous") resolved = entry.value;
        }
      }

      if (!resolved) throw new Error(`Undefined function: ${String(value.value)}`);
      return resolved;
    }
    return value;
  };

  const call = (callable: TLispValue, args: TLispValue[]): TLispValue => {
    const resolved = resolveCallable(callable);
    if (resolved.type !== "function") {
      throw new Error("Value is not callable");
    }
    const result = (resolved.value as TLispFunctionImpl)(args);
    if (result && typeof result === "object" && "_tag" in result) {
      if (Either.isLeft(result)) {
        throw new Error(result.left.message);
      }
      return result.right;
    }
    return result as TLispValue;
  };

  interpreter.defineBuiltin("promise-resolved-p", (args: TLispValue[]) => {
    if (args.length !== 1 || !args[0] || !isPromise(args[0])) {
      return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-resolved-p requires a promise" });
    }
    return Either.right(createBoolean(args[0].resolved));
  });

  interpreter.defineAsyncBuiltin?.(
    "promise-value",
    () => Either.left({
      type: "EvalError",
      variant: "RuntimeError",
      message: "promise-value requires async evaluation; use async-let",
    }),
    async (args: TLispValue[], context: EvalContext) => {
      if (!context.asyncMode) {
        return Either.left({
          type: "EvalError",
          variant: "RuntimeError",
          message: "promise-value requires async evaluation; use async-let",
        });
      }
      if (args.length !== 1 || !args[0] || !isPromise(args[0])) {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-value requires a promise" });
      }
      return awaitPromiseValue(args[0]);
    }
  );

  interpreter.defineAsyncBuiltin?.(
    "promise-then",
    () => Either.left({
      type: "EvalError",
      variant: "RuntimeError",
      message: "promise-then requires async evaluation; use async-let",
    }),
    async (args: TLispValue[], context: EvalContext) => {
      if (!context.asyncMode) {
        return Either.left({
          type: "EvalError",
          variant: "RuntimeError",
          message: "promise-then requires async evaluation; use async-let",
        });
      }
      if (args.length !== 2 || !args[0] || !isPromise(args[0]) || !args[1]) {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-then requires a promise and function" });
      }

      const callback = resolveCallable(args[1]);
      if (callback.type !== "function") {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-then callback must be a function" });
      }

      return Either.right(createPromise(args[0].value.then(async (value) => {
        const fn = callback as any;
        const result = fn.asyncValue
          ? await fn.asyncValue([value], context)
          : fn.value([value], context);
        if (result && typeof result === "object" && "_tag" in result) {
          if (Either.isLeft(result)) {
            throw result.left;
          }
          return result.right;
        }
        return result as TLispValue;
      })));
    }
  );

  // make-promise — produces a T-Lisp promise from a zero-arg thunk. This is the
  // inverse of the existing consumer surface (promise-value/promise-then):
  // it lets user T-Lisp code *create* an async value rather than only receive
  // one from an async builtin. Required for the async Task/TaskEither family.
  // See RFC-018 Step 1.4.
  interpreter.defineAsyncBuiltin?.(
    "make-promise",
    () => Either.left({
      type: "EvalError",
      variant: "RuntimeError",
      message: "make-promise requires async evaluation; use async-let",
    }),
    async (args: TLispValue[], context: EvalContext) => {
      if (!context.asyncMode) {
        return Either.left({
          type: "EvalError",
          variant: "RuntimeError",
          message: "make-promise requires async evaluation; use async-let",
        });
      }
      if (args.length !== 1 || !args[0]) {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "make-promise requires a thunk" });
      }
      const thunk = resolveCallable(args[0]);
      if (thunk.type !== "function") {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "make-promise thunk must be a function" });
      }
      return Either.right(createPromise((async () => {
        const fn = thunk as any;
        // A thunk may itself return a promise (chained) or a plain value.
        const result = fn.asyncValue
          ? await fn.asyncValue([], context)
          : fn.value([], context);
        if (result && typeof result === "object" && "_tag" in result) {
          if (Either.isLeft(result)) {
            throw result.left;
          }
          return result.right;
        }
        return result as TLispValue;
      })()));
    }
  );

  interpreter.defineBuiltin("funcall", raw((args: TLispValue[]) => {
    if (args.length === 0) throw new Error("funcall requires a function");
    return call(args[0]!, args.slice(1));
  }));

  interpreter.defineBuiltin("apply", raw((args: TLispValue[]) => {
    if (args.length < 2) throw new Error("apply requires a function and argument list");
    const finalArg = args[args.length - 1]!;
    if (finalArg.type !== "list") throw new Error("apply final argument must be a list");
    return call(args[0]!, [...args.slice(1, -1), ...(finalArg.value as TLispValue[])]);
  }));

  interpreter.defineBuiltin("mapcar", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("mapcar requires a function and list");
    }
    return createList((args[1].value as TLispValue[]).map(value => call(args[0]!, [value])));
  }));

  interpreter.defineBuiltin("filter", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("filter requires a predicate and list");
    }
    return createList(
      (args[1].value as TLispValue[]).filter(value => isTruthy(call(args[0]!, [value]))),
    );
  }));

  interpreter.defineBuiltin("stable-sort", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("stable-sort requires a predicate and list");
    }
    const values = [...(args[1].value as TLispValue[])];
    values.sort((left, right) => {
      if (isTruthy(call(args[0]!, [left, right]))) return -1;
      if (isTruthy(call(args[0]!, [right, left]))) return 1;
      return 0;
    });
    return createList(values);
  }));

  interpreter.defineBuiltin("identity", raw((args: TLispValue[]) => {
    if (args.length !== 1) throw new Error("identity requires one argument");
    return args[0]!;
  }));

  interpreter.defineBuiltin("list-slice", raw((args: TLispValue[]) => {
    if (args.length !== 3 || args[0]?.type !== "list" || args[1]?.type !== "number" || args[2]?.type !== "number") {
      throw new Error("list-slice requires list, start, and end");
    }
    return createList((args[0].value as TLispValue[]).slice(args[1].value as number, args[2].value as number));
  }));

  interpreter.defineBuiltin("string-split", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-split requires string and separator");
    }
    return createList(
      (args[0].value as string)
        .split(args[1].value as string)
        .map(createString),
    );
  }));

  interpreter.defineBuiltin("string-prefix-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-prefix-p requires prefix and string");
    }
    return createBoolean((args[1].value as string).startsWith(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-suffix-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-suffix-p requires suffix and string");
    }
    return createBoolean((args[1].value as string).endsWith(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-contains-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-contains-p requires needle and string");
    }
    return createBoolean((args[1].value as string).includes(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-char-at", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "number") {
      throw new Error("string-char-at requires string and index");
    }
    return createString(Array.from(args[0].value as string)[args[1].value as number] ?? "");
  }));

  interpreter.defineBuiltin("string-printable-p", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-printable-p requires a string");
    }
    const value = args[0].value as string;
    return createBoolean(Array.from(value).length === 1 && value >= " " && value !== "\x7f");
  }));

  interpreter.defineBuiltin("regexp-quote", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("regexp-quote requires a string");
    }
    return createString((args[0].value as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }));

  interpreter.defineBuiltin("string-match-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-match-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    return spansToValue(regexpSpansOf(args[0].value as string, args[1].value as string, caseSensitive));
  }));

  interpreter.defineBuiltin("literal-match-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("literal-match-spans requires needle, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    return spansToValue(literalSpansOf(args[0].value as string, args[1].value as string, caseSensitive));
  }));

  interpreter.defineBuiltin("string-join", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "list") {
      throw new Error("string-join requires separator string and list");
    }
    const separator = args[0].value as string;
    const parts = args[1].value as TLispValue[];
    return createString(parts.map((part) => part.type === "string" ? part.value as string : valueToString(part)).join(separator));
  }));

  interpreter.defineBuiltin("string-trim", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-trim requires a string");
    }
    return createString((args[0].value as string).trim());
  }));

  interpreter.defineBuiltin("string-replace", raw((args: TLispValue[]) => {
    if (args.length !== 3 || args[0]?.type !== "string" || args[1]?.type !== "string" || args[2]?.type !== "string") {
      throw new Error("string-replace requires string, search, and replacement");
    }
    const source = args[0].value as string;
    const search = args[1].value as string;
    const replacement = args[2].value as string;
    return createString(source.split(search).join(replacement));
  }));

  // SPEC-044 Phase 5.D/E — case conversion builtins for ~, gu, gU, g~.
  // ASCII-only to match the primitives-only rule: these are pure string
  // transforms with no editor decisions.
  interpreter.defineBuiltin("string-upcase", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-upcase requires a string");
    }
    return createString((args[0].value as string).toUpperCase());
  }));

  interpreter.defineBuiltin("string-downcase", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-downcase requires a string");
    }
    return createString((args[0].value as string).toLowerCase());
  }));

  interpreter.defineBuiltin("char-toggle-case", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("char-toggle-case requires a single-character string");
    }
    const s = args[0].value as string;
    if (s.length === 0) return createString("");
    const ch = s[0]!;
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    // Non-letter chars round-trip to themselves.
    const toggled = (ch === lower && upper !== lower) ? upper : lower;
    return createString(toggled);
  }));

  // SPEC-044 Phase 5.D/E — whole-string toggle-case. Avoids per-char
  // iteration in T-Lisp (which is painful and error-prone).
  interpreter.defineBuiltin("string-toggle-case", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-toggle-case requires a string");
    }
    const s = args[0].value as string;
    let out = "";
    for (const ch of s) {
      const upper = ch.toUpperCase();
      const lower = ch.toLowerCase();
      out += (ch === lower && upper !== lower) ? upper : lower;
    }
    return createString(out);
  }));

  // SPEC-044 Phase 5.A — repeat a string N times. Used for indent spaces
  // so T-Lisp doesn't need a loop to build "    ".
  interpreter.defineBuiltin("string-repeat", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "number") {
      throw new Error("string-repeat requires a string and a number");
    }
    const s = args[0].value as string;
    const n = Math.max(0, args[1].value as number);
    return createString(s.repeat(n));
  }));

  interpreter.defineBuiltin("number-to-string", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "number") {
      throw new Error("number-to-string requires a number");
    }
    return createString(String(args[0].value as number));
  }));

  interpreter.defineBuiltin("string-to-number", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-to-number requires a string");
    }
    const value = Number(args[0].value as string);
    if (Number.isNaN(value)) {
      throw new Error("string-to-number invalid number");
    }
    return createNumber(value);
  }));

  interpreter.defineBuiltin("nilp", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("nilp requires exactly 1 argument");
    }
    return createBoolean(args[0]?.type === "nil");
  }));

  interpreter.defineBuiltin("error", (args: TLispValue[]) => {
    // Signal an error. Returns Either.left so the surrounding `condition-case` (or the runner)
    // can recover. If the first arg is a format string with %s/%d directives, interpolate
    // the remaining args (Emacs `(error)` semantics). Otherwise concatenate all string-able
    // args. This is the failure-signaling primitive the trt assertions build on (SPEC-049).
    // #72 / BUG-54: added %s/%d/%% format interpolation.
    if (args.length === 0) {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "error", details: {} });
    }
    const first = args[0]!;
    let message: string;
    if (first.type === "string" && /%[sd%]/.test(first.value as string) && args.length > 1) {
      let i = 1;
      message = (first.value as string).replace(/%([sd%])/g, (_m: string, spec: string): string => {
        if (spec === '%') return '%';
        const arg = args[i++];
        if (!arg) return '';
        if (spec === 'd') return String(Math.floor(Number(arg.type === 'number' ? arg.value : 0)));
        return String(arg.value);
      });
    } else {
      message = args.map(a => valueToString(a)).join(" ");
    }
    return Either.left({ type: 'EvalError', variant: 'RuntimeError', message, details: { signaled: true } });
  });

  interpreter.defineBuiltin("string-flex-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-flex-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    return spansToValue(flexSpansOf(args[0].value as string, args[1].value as string, caseSensitive));
  }));

  interpreter.defineBuiltin("string-initialism-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-initialism-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    return spansToValue(initialismSpansOf(args[0].value as string, args[1].value as string, caseSensitive));
  }));

  // BUG-79: bulk marginalia annotation. The built-in categories are ported to
  // TS (see marginaliaAnnotationOf); custom registered annotators keep the
  // generic T-Lisp path (this returns nil for unknown categories). One call
  // replaces ~candidates × annotator-function evals (~217ms per M-x keystroke
  // before this).
  interpreter.defineBuiltin("marginalia-annotate-builtin-candidates", raw((args: TLispValue[]) => {
    if (args.length !== 3 || args[0]?.type !== "string" || args[1]?.type !== "list" || args[2]?.type !== "number") {
      throw new Error("marginalia-annotate-builtin-candidates requires a category string, a candidate list, and a level number");
    }
    const category = args[0].value as string;
    if (category !== "buffer" && category !== "command" && category !== "file") return createNil();
    const level = args[2].value as number;
    const results: TLispValue[] = [];
    for (const candidate of (args[1].value as TLispValue[])) {
      const source = candidate.type === "hashmap"
        ? [...(candidate.value as Map<string, TLispValue>).entries()].filter(([k]) => k !== "annotation")
        : [];
      source.push(["annotation", createString(marginaliaAnnotationOf(category, level, candidate))]);
      results.push(createHashmap(source));
    }
    return createList(results);
  }));

  // BUG-80 (#187): bulk vertico row builder. One call replaces the per-row
  // vertico-row mapcar (name-dispatched stable-sort + recursive segment
  // building ≈ 50+ evals, ~9ms per M-x keystroke).
  interpreter.defineBuiltin("vertico-rows-bulk", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "list" || args[1]?.type !== "string") {
      throw new Error("vertico-rows-bulk requires a candidate list and the selected value string");
    }
    const selectedValue = args[1].value as string;
    const rows = (args[0].value as TLispValue[]).map((c) => createHashmap(verticoRowOf(c, selectedValue)));
    return createList(rows);
  }));
  interpreter.defineBuiltin("orderless-filter-candidates", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "list") {
      throw new Error("orderless-filter-candidates requires an input string and a candidate list");
    }
    const input = args[0].value as string;
    const candidates = args[1].value as TLispValue[];
    const components = input.split(" ").filter((c) => c.length > 0);
    const results: TLispValue[] = [];
    for (const candidate of candidates) {
      const source = candidate.type === "hashmap"
        ? candidate.value as Map<string, TLispValue>
        : new Map<string, TLispValue>();
      const displayVal = source.get("display");
      const display = displayVal?.type === "string" ? displayVal.value as string : "";
      const annotationVal = source.get("annotation");
      const annotation = annotationVal?.type === "string" ? annotationVal.value as string : "";
      let displaySpans: Span[] = [];
      let annotationSpans: Span[] = [];
      let keep = true;
      for (const component of components) {
        const m = orderlessMatchComponent(component, display, annotation);
        if (m.reject) { keep = false; break; }
        if (m.onAnnotation) annotationSpans = annotationSpans.concat(m.spans);
        else displaySpans = displaySpans.concat(m.spans);
      }
      if (!keep) continue;
      const out = [...source.entries()].filter(([k]) => k !== "spans" && k !== "annotation-spans");
      out.push(["spans", spansToValue(displaySpans)]);
      out.push(["annotation-spans", spansToValue(annotationSpans)]);
      results.push(createHashmap(out));
    }
    return createList(results);
  }));

  interpreter.defineBuiltin("display-width", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("display-width requires a string");
    }
    return createNumber(Array.from(args[0].value as string).length);
  }));

  interpreter.defineBuiltin("truncate-display", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "number") {
      throw new Error("truncate-display requires string and width");
    }
    return createString(Array.from(args[0].value as string).slice(0, Math.max(0, args[1].value as number)).join(""));
  }));

  interpreter.defineBuiltin("symbol-name", raw((args: TLispValue[]) => {
    if (args.length !== 1 || (args[0]?.type !== "symbol" && args[0]?.type !== "string")) {
      throw new Error("symbol-name requires a symbol or string");
    }
    return createString(args[0].value as string);
  }));

  interpreter.defineBuiltin("hashmapp", raw((args: TLispValue[]) => {
    if (args.length !== 1) throw new Error("hashmapp requires one argument");
    return createBoolean(args[0]?.type === "hashmap");
  }));

  /**
   * Create a hash-map from key-value pairs
   * Usage: (hashmap key1 value1 key2 value2 ...)
   * Returns a new hash-map with the given key-value pairs
   * Requires an even number of arguments
   */
  interpreter.defineBuiltin("hashmap", raw((args: TLispValue[]) => {
    if (args.length % 2 !== 0) {
      throw new Error("hashmap requires an even number of arguments: key-value pairs");
    }

    const entries: [string, TLispValue][] = [];

    for (let i = 0; i < args.length; i += 2) {
      const keyArg = args[i]!;
      const valueArg = args[i + 1]!;

      if (!keyArg || keyArg.type !== "string") {
        throw new Error(`hashmap keys must be strings, got ${keyArg?.type}`);
      }

      const key = keyArg.value as string;
      entries.push([key, valueArg]);
    }

    return createHashmap(entries);
  }));

  /**
   * Get a value from a hash-map by key
   * Usage: (hashmap-get map key)
   * Returns the value if found, nil if not found
   */
  interpreter.defineBuiltin("hashmap-get", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("hashmap-get requires exactly 2 arguments: map and key");
    }

    const [mapArg, keyArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-get first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-get second argument must be a string");
    }

    const key = keyArg.value as string;
    const map = mapArg.value;

    const value = map.get(key);

    // Return nil if key not found (following functional programming principles)
    return value === undefined ? createNil() : value;
  }));

  /**
   * Set a key-value pair in a hash-map (immutable operation)
   * Usage: (hashmap-set map key value)
   * Returns a new hash-map with the key-value pair set
   */
  interpreter.defineBuiltin("hashmap-set", raw((args: TLispValue[]) => {
    if (args.length !== 3) {
      throw new Error("hashmap-set requires exactly 3 arguments: map, key, and value");
    }

    const [mapArg, keyArg, valueArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-set first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-set second argument must be a string");
    }

    const key = keyArg.value as string;
    const oldMap = mapArg.value;

    // Create new Map for immutable operation (functional programming principle)
    const newMap = new Map(oldMap);
    newMap.set(key, valueArg!);

    return createHashmap(Array.from(newMap.entries()));
  }));

  /**
   * Get all keys from a hash-map
   * Usage: (hashmap-keys map)
   * Returns a list of all keys as strings
   */
  interpreter.defineBuiltin("hashmap-keys", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("hashmap-keys requires exactly 1 argument: map");
    }

    const [mapArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-keys argument must be a hash-map");
    }

    const map = mapArg.value;
    const keys = Array.from(map.keys()).map((key) => createString(key));

    return createList(keys);
  }));

  /**
   * Get all values from a hash-map
   * Usage: (hashmap-values map)
   * Returns a list of all values
   */
  interpreter.defineBuiltin("hashmap-values", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("hashmap-values requires exactly 1 argument: map");
    }

    const [mapArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-values argument must be a hash-map");
    }

    const map = mapArg.value;
    const values = Array.from(map.values());

    return createList(values);
  }));

  /**
   * Check if a hash-map contains a key
   * Usage: (hashmap-has-key? map key)
   * Returns true if key exists, false otherwise
   */
  interpreter.defineBuiltin("hashmap-has-key?", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("hashmap-has-key? requires exactly 2 arguments: map and key");
    }

    const [mapArg, keyArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-has-key? first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-has-key? second argument must be a string");
    }

    const key = keyArg.value as string;
    const map = mapArg.value;

    return createBoolean(map.has(key));
  }));

  /**
   * Create a new keymap with default properties
   * Usage: (defkeymap name)
   * Defines a new keymap variable with mode, parent, and bindings properties
   */
  interpreter.defineBuiltin("defkeymap", raw((args: TLispValue[]) => {
    if (args.length < 1) {
      throw new Error("defkeymap requires at least 1 argument: keymap name");
    }

    const nameArg = args[0];
    if (!nameArg || nameArg.type !== "string") {
      throw new Error("defkeymap requires a string as the first argument (keymap name)");
    }

    const keymapName = nameArg.value as string;

    // Create a new keymap with default properties
    const keymap = createHashmap([
      ["mode", createString("unknown")],
      ["parent", createNil()],
      ["bindings", createHashmap([])]
    ]);

    // Define the keymap in the global environment
    interpreter.globalEnv.define(keymapName, keymap);
    return keymap;
  }));

  /**
   * Get a property from a keymap
   * Usage: (keymap-get keymap property)
   * Returns the value of the specified property from the keymap
   */
  interpreter.defineBuiltin("keymap-get", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("keymap-get requires exactly 2 arguments: keymap and property");
    }

    const [keymapArg, propArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-get first argument must be a keymap (hashmap)");
    }

    if (!propArg || propArg.type !== "string") {
      throw new Error("keymap-get second argument must be a string property name");
    }

    const property = propArg.value as string;
    const keymap = keymapArg.value;

    const value = keymap.get(property);
    return value === undefined ? createNil() : value;
  }));

  /**
   * Define a key binding in a keymap
   * Usage: (keymap-define-key keymap key command)
   * Adds or updates a key-command binding in the keymap's bindings
   */
  interpreter.defineBuiltin("keymap-define-key", raw((args: TLispValue[]) => {
    if (args.length !== 3) {
      throw new Error("keymap-define-key requires exactly 3 arguments: keymap, key, command");
    }

    const [keymapArg, keyArg, commandArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-define-key first argument must be a keymap (hashmap)");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-define-key second argument must be a string key");
    }

    if (!commandArg) {
      throw new Error("keymap-define-key third argument must be a command value");
    }

    const key = keyArg.value as string;
    const keymap = keymapArg.value;

    // Get the current bindings
    const bindings = keymap.get("bindings");
    let newBindings = createHashmap([]);

    if (bindings && isHashmap(bindings)) {
      newBindings = bindings;
    }

    // Update the bindings with the new key-command mapping
    const bindingsMap = newBindings.value;
    const updatedBindingsMap = new Map(bindingsMap);
    updatedBindingsMap.set(key, commandArg);

    // Create the updated bindings hashmap
    const updatedBindings = createHashmap(Array.from(updatedBindingsMap.entries()));

    // Create a new keymap with updated bindings
    const newKeymap = createHashmap([
      ["mode", keymap.get("mode") || createString("unknown")],
      ["parent", keymap.get("parent") || createNil()],
      ["bindings", updatedBindings]
    ]);

    return newKeymap;
  }));

  /**
   * Lookup a command bound to a key in a keymap
   * Usage: (keymap-lookup keymap key)
   * Returns the command bound to the specified key, or nil if not found
   */
  interpreter.defineBuiltin("keymap-lookup", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("keymap-lookup requires exactly 2 arguments: keymap and key");
    }

    const [keymapArg, keyArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-lookup first argument must be a keymap (hashmap)");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-lookup second argument must be a string key");
    }

    const key = keyArg.value as string;
    const keymap = keymapArg.value;

    // Get the bindings from the keymap
    const bindings = keymap.get("bindings");

    if (!bindings || !isHashmap(bindings)) {
      return createNil();
    }

    const bindingsMap = bindings.value;
    const command = bindingsMap.get(key);

    return command === undefined ? createNil() : command;
  }));

  /**
   * Mutate a hashmap in place (for keymap bindings performance)
   * Usage: (keymap-mutable-set! hashmap key value)
   * Mutates the hashmap's internal map directly instead of copying
   */
  interpreter.defineBuiltin("keymap-mutable-set!", raw((args: TLispValue[]) => {
    if (args.length !== 3) {
      throw new Error("keymap-mutable-set! requires exactly 3 arguments: hashmap, key, value");
    }

    const [hashmapArg, keyArg, valueArg] = args as [TLispValue, TLispValue, TLispValue];

    if (!hashmapArg || !isHashmap(hashmapArg)) {
      throw new Error("keymap-mutable-set! first argument must be a hashmap");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-mutable-set! second argument must be a string key");
    }

    const key = keyArg.value as string;
    hashmapArg.value.set(key, valueArg);
    return hashmapArg;
  }));

  // NOTE: `setq` is a special form (alias of `set!`), not a builtin — see
  // SPECIAL_FORMS in evaluator/special-form-dispatch.ts (BUG-31). Registering
  // it here would shadow the special form and re-introduce eager evaluation of
  // the name argument.
}

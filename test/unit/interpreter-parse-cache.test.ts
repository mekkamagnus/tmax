/**
 * @file interpreter-parse-cache.test.ts
 * @description #234 (SPEC-234) — execute()/executeAsync() cache successful
 * parses keyed by sourceName+source. Pins the semantic contract: cache hits
 * still RE-EVALUATE (state changes visible), macro redefinitions take effect
 * (only the unexpanded parse is cached), syntax errors and empty programs are
 * never cached, sourceName participates in the key, and the cache is
 * LRU-bounded and clearable.
 */
import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { TLispValue, EvalError } from "../../src/tlisp/types.ts";

/** Extract the `.value` from a successful eval; throw the Left message if it failed. */
function val(r: Either<EvalError, TLispValue>): unknown {
  if (Either.isLeft(r)) {
    throw new Error(`eval failed: ${(r.left as EvalError).message}`);
  }
  return (r.right as { value: unknown }).value;
}

describe("#234 — interpreter parse cache", () => {
  test("cache hit re-EVALUATES: same source, changing results (sync)", () => {
    const i = new TLispInterpreterImpl();
    i.execute("(defvar n 0)");
    val(i.execute("(setq n (+ n 1))")); // populates the cache
    val(i.execute("(setq n (+ n 1))")); // cache hit — must still evaluate
    expect(i.parseCacheSize()).toBe(2);
    expect(val(i.execute("n"))).toBe(2);
  });

  test("cache hit re-EVALUATES: same source, changing results (async)", async () => {
    const i = new TLispInterpreterImpl();
    i.execute("(defvar n 0)");
    await i.executeAsync("(setq n (+ n 10))"); // populates the cache
    await i.executeAsync("(setq n (+ n 10))"); // cache hit — must still evaluate
    expect(val(i.execute("n"))).toBe(20);
  });

  test("distinct sources do not collide", () => {
    const i = new TLispInterpreterImpl();
    expect(val(i.execute("(+ 1 2)"))).toBe(3);
    expect(val(i.execute("(+ 1 3)"))).toBe(4);
    // Hits after both are cached — order-sensitivity would flip these.
    expect(val(i.execute("(+ 1 3)"))).toBe(4);
    expect(val(i.execute("(+ 1 2)"))).toBe(3);
  });

  test("macro redefinition after a cached parse takes effect on the next dispatch", () => {
    const i = new TLispInterpreterImpl();
    i.execute("(defmacro m () ''1)");
    expect(val(i.execute("(m)"))).toBe(1); // cached (m) parse
    i.execute("(defmacro m () ''2)");
    // The cached (m) parse is UNEXPANDED; expansion happens at eval, so the
    // redefined macro must win — no stale replay of the old expansion.
    expect(val(i.execute("(m)"))).toBe(2);
  });

  test("syntax errors are not cached", () => {
    const i = new TLispInterpreterImpl();
    val(i.execute("(+ 1 2)"));
    const before = i.parseCacheSize();
    for (const _ of [1, 2]) {
      const bad = i.execute("(");
      expect(Either.isLeft(bad)).toBe(true);
    }
    expect(i.parseCacheSize()).toBe(before);
  });

  test("empty programs are not cached", () => {
    const i = new TLispInterpreterImpl();
    const empty = i.execute("   ");
    expect(Either.isLeft(empty)).toBe(false);
    expect(i.parseCacheSize()).toBe(0);
  });

  test("sourceName participates in the cache key", () => {
    const i = new TLispInterpreterImpl();
    i.execute("(+ 1 2)", undefined, "binding-a");
    i.execute("(+ 1 2)", undefined, "binding-b");
    expect(i.parseCacheSize()).toBe(2);
  });

  test("LRU bound: cache never exceeds 256 entries and evicted sources re-parse", () => {
    const i = new TLispInterpreterImpl();
    // 300 distinct sources → size capped at 256, oldest evicted.
    for (let k = 0; k < 300; k++) {
      val(i.execute(`(+ 1 ${k})`));
    }
    expect(i.parseCacheSize()).toBe(256);
    // The first-inserted source was evicted; executing it again re-parses
    // (correct result) and lands back in the cache.
    expect(val(i.execute("(+ 1 0)"))).toBe(1);
    expect(i.parseCacheSize()).toBe(256);
  });

  test("LRU refresh: a hit keeps an entry alive across the bound (evicts by recency, not insert order)", () => {
    const i = new TLispInterpreterImpl();
    // Cache internals are private, but eviction IDENTITY is the behavior under
    // test — reach the Map to assert which key survived. Key format for a
    // no-sourceName execute is "\0" + source.
    const cached = (src: string) => (i as unknown as { parseCache: Map<string, unknown> }).parseCache.has(String.fromCharCode(0) + src);

    // Fill to the cap: s1 oldest, ..., s256 newest.
    for (let k = 1; k <= 256; k++) val(i.execute(`(+ 1 ${k * 10})`));
    expect(i.parseCacheSize()).toBe(256);

    // Touch s1 (LRU refresh), then overflow the cap once with s257.
    val(i.execute("(+ 1 10)"));
    val(i.execute("(+ 1 2570)"));

    // With refresh: s1 survives (recently used), s2 (least recently used) evicts.
    // Without the refresh delete/re-insert, s1 would evict and s2 survive.
    expect(cached("(+ 1 10)")).toBe(true);
    expect(cached("(+ 1 20)")).toBe(false);
    expect(i.parseCacheSize()).toBe(256);
  });

  test("clearParseCache empties the cache; re-execution still works", () => {
    const i = new TLispInterpreterImpl();
    val(i.execute("(+ 1 2)"));
    expect(i.parseCacheSize()).toBe(1);
    i.clearParseCache();
    expect(i.parseCacheSize()).toBe(0);
    expect(val(i.execute("(+ 1 2)"))).toBe(3);
  });
});

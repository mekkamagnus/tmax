/**
 * @file tlisp-sort.test.ts
 * @description #255 — `sort` as a first-class builtin (the Emacs name;
 *   `stable-sort` is the original alias). T-Lisp lists are values: sort is
 *   NON-destructive (deliberate divergence from Emacs's destructive sort,
 *   documented in tlisp.texinfo).
 */

import { describe, expect, it } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

const vals = (out: unknown): any[] => (out as any).value.map((v: any) => v.value);

describe("#255: sort builtin", () => {
  it("sorts strings via string< and numbers via <", async () => {
    const e = await createStartedEditor("");
    expect(vals(executeTlisp(e, '(sort string< (list "c" "a" "b"))'))).toEqual(["a", "b", "c"]);
    expect(vals(executeTlisp(e, "(sort < (list 3 1 2))"))).toEqual([1, 2, 3]);
  });

  it("accepts lambda predicates", async () => {
    const e = await createStartedEditor("");
    const out = executeTlisp(e, '(sort (lambda (a b) (< (length a) (length b))) (list "cc" "a" "bbb"))');
    expect(vals(out)).toEqual(["a", "cc", "bbb"]);
  });

  it("is non-destructive — the original list is unchanged", async () => {
    const e = await createStartedEditor("");
    executeTlisp(e, "(defvar sort-orig (list 2 1 3))");
    expect(vals(executeTlisp(e, "(sort < sort-orig)"))).toEqual([1, 2, 3]);
    expect(vals(executeTlisp(e, "sort-orig"))).toEqual([2, 1, 3]);
  });

  it("is stable for equal keys", async () => {
    const e = await createStartedEditor("");
    // equal keys keep insertion order: pairs with the same first element
    const out = executeTlisp(e, '(sort (lambda (a b) (< (car a) (car b))) (list (list 1 "first") (list 0 "zero") (list 1 "second")))');
    const flat = (out.value as any[]).map((p: any) => p.value.map((x: any) => x.value));
    expect(flat).toEqual([[0, "zero"], [1, "first"], [1, "second"]]);
  });

  it("handles empty and single-element lists; stable-sort alias still works", async () => {
    const e = await createStartedEditor("");
    expect(vals(executeTlisp(e, "(sort < (list))"))).toEqual([]);
    expect(vals(executeTlisp(e, "(sort < (list 42))"))).toEqual([42]);
    expect(vals(executeTlisp(e, '(stable-sort string< (list "b" "a"))'))).toEqual(["a", "b"]);
  });

  it("rejects a non-list second argument", async () => {
    const e = await createStartedEditor("");
    const r = e.getInterpreter().execute('(sort string< "abc")');
    expect(r?._tag).toBe("Left");
  });
});

/**
 * @file markdown-mx-discoverability.test.ts
 * @description BUG-75 (#190): the markdown command family must appear in the
 *   M-x (interactive-only) completion table. Root cause: the markdown
 *   aggregator re-LISTS every public name in its (export ...) form without
 *   defining them; the old duplicate counting marked them "duplicated" and
 *   qualified their publicNames out of M-x reach. Also pins the SPEC-115
 *   (interactive) migration of the markdown command defuns.
 */

import { describe, test, expect } from "bun:test";
import { executeTlisp, setupMdEditor } from "../helpers/editor-fixture.ts";

describe("BUG-75: markdown commands discoverable via M-x", () => {
  test("the markdown family is in the interactive-only command table", async () => {
    const e = await setupMdEditor("x\n", "t.md");
    const r = executeTlisp(e, "(callable-command-details t)") as any;
    const names: string[] = r.value.map((c: any) =>
      c.value instanceof Map ? c.value.get("name")?.value : undefined,
    ).filter((n: unknown): n is string => typeof n === "string");
    const md = names.filter((n) => n.startsWith("markdown-"));
    // 73 migrated commands (zero-required-arg defuns with (interactive)).
    expect(md.length).toBeGreaterThanOrEqual(70);
    // The SPEC-116 entry points specifically.
    expect(md).toContain("markdown-follow-wiki-link");
    expect(md).toContain("markdown-generate-toc");
    expect(md).toContain("markdown-next-heading");
  });

  test("arg-taking helpers are correctly NOT M-x commands", async () => {
    const e = await setupMdEditor("x\n", "t.md");
    const r = executeTlisp(e, "(callable-command-details t)") as any;
    const names: string[] = r.value.map((c: any) =>
      c.value instanceof Map ? c.value.get("name")?.value : undefined,
    ).filter((n: unknown): n is string => typeof n === "string");
    // Helpers with required args cannot be called from M-x (no arg source).
    expect(names).not.toContain("markdown-note-rank");
    expect(names).not.toContain("markdown-frontmatter-get");
  });

  test("plain public names survive the aggregator re-listing (no bogus qualification)", async () => {
    const e: any = await setupMdEditor("x\n", "t.md");
    const exp = e.interpreter.moduleRegistry.allExports();
    expect(exp.get("markdown-skip-front-matter")).toBeDefined();
    expect(exp.get("markdown-follow-wiki-link")).toBeDefined();
    // The aggregator lists but does not define — its non-resolving entries
    // must not qualify the feature module's plain name.
    expect(exp.has("editor/commands/markdown/markdown-skip-front-matter")).toBe(false);
  });

  test("genuinely conflicting exports still qualify (design preserved)", async () => {
    const e: any = await setupMdEditor("x\n", "t.md");
    // Two modules defining DIFFERENT values for one name must still get
    // qualified publicNames (the conflict-qualification design).
    executeTlisp(e, '(defmodule tstmod/a (export clash-fn) (defun clash-fn () "from-a"))');
    executeTlisp(e, '(defmodule tstmod/b (export clash-fn) (defun clash-fn () "from-b"))');
    const exp = e.interpreter.moduleRegistry.allExports();
    expect(exp.has("tstmod/a/clash-fn")).toBe(true);
    expect(exp.has("tstmod/b/clash-fn")).toBe(true);
    expect(exp.has("clash-fn")).toBe(false);
  });
});

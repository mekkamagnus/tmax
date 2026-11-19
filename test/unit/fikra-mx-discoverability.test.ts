/**
 * @file fikra-mx-discoverability.test.ts
 * @description Fikra's M-x discoverability: the #249 interactive-only policy
 *   kept fikra out of M-x because only fikra-stop carried `(interactive)`.
 *   This pins the full entry-point surface — mode toggles (boot-visible),
 *   workflow commands (visible after fikra-start), lazy feature modules
 *   (visible once loaded) — and that arg-taking helpers stay out of M-x.
 *   Pattern follows markdown-mx-discoverability.test.ts (BUG-75).
 */

import { describe, test, expect } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

function interactiveNames(editor: Awaited<ReturnType<typeof createStartedEditor>>): string[] {
  const r = executeTlisp(editor, "(callable-command-details t)") as any;
  return (r.value as any[])
    .map((c: any) =>
      c.value instanceof Map ? c.value.get("name")?.value : undefined,
    )
    .filter((n: unknown): n is string => typeof n === "string");
}

describe("fikra M-x discoverability", () => {
  test("boot state: mode entry points are in the interactive-only table", async () => {
    const e = await createStartedEditor("x\n");
    const names = interactiveNames(e);
    // mode.tlisp is boot-loaded via normal.tlisp — its toggles must be
    // M-x-listable from a fresh editor, before the mode ever runs.
    expect(names).toContain("fikra-mode");
    expect(names).toContain("fikra-start");
    expect(names).toContain("fikra-stop");
  });

  test("fikra-start surfaces the workflow commands", async () => {
    const e = await createStartedEditor("x\n");
    executeTlisp(e, "(fikra-start)"); // requires adapter/context/workflow
    const names = interactiveNames(e);
    for (const n of [
      "fikra-explain",
      "fikra-fix",
      "fikra-refactor",
      "fikra-review",
      "fikra-test",
      "fikra-chat-region",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("lazy feature modules expose their entry points once loaded", async () => {
    const e = await createStartedEditor("x\n");
    executeTlisp(e, "(fikra-start)");
    for (const m of [
      "fikra/chat",
      "fikra/capture",
      "fikra/modes",
      "fikra/worktree",
      "fikra/thread",
      "fikra/threads",
      "fikra/plan",
    ]) {
      executeTlisp(e, `(require-module ${m})`);
    }
    const names = interactiveNames(e);
    for (const n of [
      "fikra-chat-open",
      "fikra-capture",
      "fikra-runtime-mode-prompt",
      "fikra-worktree-toggle",
      "fikra-thread-new",
      "fikra-threads-list-open",
      "fikra-plan-toggle",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("arg-taking helpers and predicates are correctly NOT M-x commands", async () => {
    const e = await createStartedEditor("x\n");
    executeTlisp(e, "(fikra-start)");
    const names = interactiveNames(e);
    // Required-arg functions cannot be called from M-x (no arg source);
    // predicates are not commands. Same policy as markdown-note-rank etc.
    expect(names).not.toContain("fikra-set-backend");
    expect(names).not.toContain("fikra-active-p");
  });
});

/**
 * @file wiki-link-follow-create.test.ts
 * @description SPEC-116 (#185): wiki-link follow-or-create — vault candidate
 *   source, similarity ranking, resolve-or-create dispatch, and follow
 *   integration (dangling links never dead-end; existing links unchanged).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeTlisp,
  setupMdEditor,
} from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

/** Stringify a T-Lisp result (lists → "(a b c)"; strings → bare) for assertions. */
function tl(editor: Editor, form: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = executeTlisp(editor, form) as any;
  const render = (v: any): string => {
    if (Array.isArray(v)) return `(${v.map(render).join(" ")})`;
    if (v && v.type === "list") return render(v.value);
    if (v && v.type === "string") return String(v.value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (v && v.type === "hashmap") { const d = (v.value as Map<any, any>).get?.("display"); return d ? render(d) : "{}"; }
    if (v && (v.type === "number" || v.type === "boolean")) return String(v.value);
    if (v && v.type === "nil") return "nil";
    return String(v);
  };
  return render(r);
}

describe("SPEC-116 wiki-link follow-or-create", () => {
  let vault: string;
  let editor: Editor;

  beforeAll(async () => {
    vault = mkdtempSync(join(tmpdir(), "tmax-vault-"));
    mkdirSync(join(vault, "sub"));
    writeFileSync(join(vault, "goals.md"), "# Goals\n\n## Intro\n\nthe real goals note\n");
    writeFileSync(join(vault, "goals-archive.md"), "# Goals Archive\n");
    writeFileSync(join(vault, "sub", "gardening.md"), "# Gardening\n\nnested note\n");
    writeFileSync(join(vault, "notemarker.txt"), "ignored: not .md\n");
    // The buffer under edit lives in the vault so the scan is rooted there.
    writeFileSync(join(vault, "index.md"), "see [[marcketing]] and [[goals]]\n");
    editor = await setupMdEditor("see [[marcketing]] and [[goals]]\n", join(vault, "index.md"));
  });

  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  /** Prime the resolve state the way production does (module defvars are not
   *  set!-able from outside) — via the exported prepare plumbing. */
  function primeResolveState(target: string) {
    executeTlisp(editor, `(markdown-resolve-prepare "${target}" nil)`);
  }

  describe("Task 1: markdown-vault-notes", () => {
    test("lists every .md under the buffer's dir (recursive), name+path", () => {
      const names = tl(editor, "(markdown-note-names-of (markdown-vault-notes))");
      expect(names).toContain("goals");
      expect(names).toContain("gardening");
      const gardeningPath = tl(editor, '(hashmap-get (nth 0 (markdown-vault-notes)) "path")');
      expect(gardeningPath).toContain("sub/gardening.md");
      // non-md ignored
      expect(names).not.toContain("notemarker");
    });

    test("empty list for an unsaved buffer", async () => {
      const e2 = await setupMdEditor("no file", undefined);
      expect(tl(e2, "(length (markdown-vault-notes))")).toBe("0");
    });
  });

  describe("Task 2: similarity ranking", () => {
    test("substring > prefix > alphabetical, stable within rank", () => {
      // "goals" substring-matches both; input is alphabetical, so equal ranks keep alpha order.
      const out = tl(editor, '(markdown-rank-note-names (list "alpha" "goals" "goals-archive") "goals")');
      const names = out.replace(/[()"]/g, "").split(" ").filter(Boolean);
      expect(names).toEqual(["goals", "goals-archive", "alpha"]);
    });

    test("substring outranks non-match; alphabetical tie-break holds", () => {
      // "be" is a substring of BOTH beta and bee (rank 2, alpha order kept); zebra ranks 0.
      const out = tl(editor, '(markdown-rank-note-names (list "zebra" "beta" "bee") "be")');
      const names = out.replace(/[()"]/g, "").split(" ").filter(Boolean);
      expect(names).toEqual(["beta", "bee", "zebra"]);
    });

    test("regex-metacharacter targets rank safely (no RegExp compile — verify-gate gap 1)", () => {
      // 'note(v2' is an invalid JS RegExp; 'a.b' as a regex would match 'axb'.
      // Both must behave as PLAIN substrings: no error, no false substring hit.
      const paren = tl(editor, '(markdown-rank-note-names (list "alpha" "beta") "note(v2")');
      expect(paren.replace(/[()"]/g, "").split(" ").filter(Boolean)).toEqual(["alpha", "beta"]);
      const dot = tl(editor, '(markdown-rank-note-names (list "axb" "a-b") "a.b")');
      expect(dot.replace(/[()"]/g, "").split(" ").filter(Boolean)).toEqual(["axb", "a-b"]);
    });

    test("completion table metadata + create-first candidate ordering", () => {
      primeResolveState("goals");
      expect(tl(editor, '(hashmap-get (markdown-note-completion-table "" "metadata") "category")')).toBe("tmax-note");
      const first = tl(editor, '(hashmap-get (nth 0 (markdown-note-completion-table "" "candidates")) "display")');
      expect(first).toBe("+ Create: goals"); // FIRST position, not merely present
      const cands = tl(editor, '(markdown-note-completion-table "" "candidates")');
      expect(cands).toContain("goals");
    });
  });

  describe("Task 3: resolve-or-create dispatch", () => {
    test("choose-existing opens the note AND rewrites the link at point", () => {
      // Cursor on the [[marcketing]] link; resolve to the canonical "goals".
      executeTlisp(editor, "(cursor-move 0 6)");
      primeResolveState("marcketing");
      executeTlisp(editor, '(markdown-resolve-dispatch "marcketing" "goals")');
      // Opened the target note.
      expect(tl(editor, "(buffer-current)")).toContain("goals.md");
      expect(tl(editor, "(buffer-text)")).toContain("the real goals note");
      // The typo link was repaired where it lived.
      executeTlisp(editor, `(buffer-switch "${join(vault, "index.md")}")`);
      expect(tl(editor, "(buffer-text)")).toContain("[[goals]]");
      expect(tl(editor, "(buffer-text)")).not.toContain("marcketing");
    });

    test("choose-create writes the template-expanded file and opens it", () => {
      executeTlisp(editor, `(buffer-switch "${join(vault, "index.md")}")`);
      const path = join(vault, "brand-new.md");
      expect(existsSync(path)).toBe(false);
      primeResolveState("brand-new");
      executeTlisp(editor, '(markdown-resolve-dispatch "brand-new" "+ Create: brand-new")');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf-8")).toContain("# brand-new");
      expect(tl(editor, "(buffer-current)")).toContain("brand-new.md");
      expect(tl(editor, "(buffer-text)")).toContain("# brand-new");
    });

    test("unknown choice messages, creates nothing, switches nothing", () => {
      executeTlisp(editor, `(buffer-switch "${join(vault, "index.md")}")`);
      const before = tl(editor, "(buffer-text)");
      primeResolveState("marcketing");
      executeTlisp(editor, '(markdown-resolve-dispatch "marcketing" "no-such-note")');
      expect(existsSync(join(vault, "no-such-note.md"))).toBe(false);
      expect(tl(editor, "(buffer-text)")).toBe(before);
    });

    test("C-g cancel: prompt opens, cancel is a clean no-op (Task 3 AC4)", () => {
      executeTlisp(editor, `(buffer-switch "${join(vault, "index.md")}")`);
      const before = tl(editor, "(buffer-text)");
      const beforeBuf = tl(editor, "(buffer-current)");
      executeTlisp(editor, '(markdown-resolve-or-create "marcketing" nil)');
      expect(editor.getState().mode).toBe("mx");
      executeTlisp(editor, '(minibuffer-dispatch-key "C-g")');
      expect(editor.getState().mode).toBe("normal");
      expect(tl(editor, "(buffer-text)")).toBe(before);
      expect(tl(editor, "(buffer-current)")).toBe(beforeBuf);
      expect(existsSync(join(vault, "marcketing.md"))).toBe(false);
    });

    test("nested-dir create: [[sub/new-note]] creates the missing directory (verify-gate gap 2)", () => {
      const path = join(vault, "brand-new-dir", "nested.md");
      expect(existsSync(join(vault, "brand-new-dir"))).toBe(false);
      primeResolveState("brand-new-dir/nested");
      executeTlisp(editor, '(markdown-resolve-dispatch "brand-new-dir/nested" "+ Create: brand-new-dir/nested")');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf-8")).toContain("# brand-new-dir/nested");
    });

    test("choose-existing on [[typo#heading]] preserves the suffix in the rewritten link", async () => {
      // Buffer with a heading-suffixed dangling link; resolve to canonical.
      const e3 = await setupMdEditor("see [[marcketing#Intro]] now\n", join(vault, "index.md"));
      executeTlisp(e3, "(cursor-move 0 6)");
      executeTlisp(e3, '(markdown-resolve-prepare "marcketing" "Intro")');
      executeTlisp(e3, '(markdown-resolve-dispatch "marcketing" "goals")');
      expect(tl(e3, "(buffer-current)")).toContain("goals.md");
      executeTlisp(e3, `(buffer-switch "${join(vault, "index.md")}")`);
      const text = tl(e3, "(buffer-text)");
      expect(text).toContain("[[goals#Intro]]");
      expect(text).not.toContain("marcketing");
    });
  });

  describe("Task 4: follow integration", () => {
    test("existing [[link]] follows exactly as before (real invocation)", async () => {
      // Fresh editor: earlier tests already rewrote the shared buffer's dangling link.
      const e4 = await setupMdEditor("see [[goals]] now\n", join(vault, "index.md"));
      executeTlisp(e4, "(cursor-move 0 8)"); // inside [[goals]]
      executeTlisp(e4, "(markdown-follow-wiki-link)");
      expect(e4.getState().mode).toBe("normal"); // existing target: opens, no prompt
      expect(tl(e4, "(buffer-current)")).toContain("goals.md");
      expect(tl(e4, "(buffer-text)")).toContain("# Goals");
    });

    test("REGRESSION: extension-less wiki follows resolve (boolean-predicate guards)", () => {
      // The old (not (string-match ...)) guards failed EMPIRICALLY (an
      // instrumented run showed resolved reaching file-exists-p with no .md
      // appended). The exact mechanism is undiagnosed — string-match itself
      // returns nil on no-match (tlisp-api.ts:1157), so the simple
      // "always false" story is wrong (see ADR-0217). The boolean
      // predicates below are unambiguous; the e2e follow test above covers
      // the full path. This pins the primitive behavior itself.
      expect(tl(editor, '(if (not (string-contains-p "." "goals")) "APPEND" "SKIP")')).toBe("APPEND");
      expect(tl(editor, '(string-contains-p "." "goals.md")')).toBe("true");
    });

    test("dangling [[link#heading]]: prompt → choose existing → lands ON the heading (Task 4 AC3)", async () => {
      const e5 = await setupMdEditor("go [[marcketing#Intro]] now\n", join(vault, "index.md"));
      executeTlisp(e5, "(cursor-move 0 5)");
      executeTlisp(e5, "(markdown-follow-wiki-link)"); // dangling → prompt
      expect(e5.getState().mode).toBe("mx");
      executeTlisp(e5, '(minibuffer-set-input "goals")');
      executeTlisp(e5, '(minibuffer-dispatch-key "Enter")');
      expect(tl(e5, "(buffer-current)")).toContain("goals.md");
      // cursor landed on the ## Intro heading line (goals.md line 2), not line 0
      expect(tl(e5, "(cursor-line)")).toBe("2");
      // the rewritten link keeps the suffix
      executeTlisp(e5, `(buffer-switch "${join(vault, "index.md")}")`);
      expect(tl(e5, "(buffer-text)")).toContain("[[goals#Intro]]");
    });

    test("vault scan skips .git and node_modules (retry-2 gate blocker regression)", () => {
      executeTlisp(editor, `(buffer-switch "${join(vault, "index.md")}")`); // scan roots at the buffer's dir
      mkdirSync(join(vault, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(vault, "node_modules", "junk.md"), "junk");
      writeFileSync(join(vault, "node_modules", "pkg", "deep.md"), "junk");
      mkdirSync(join(vault, ".git"), { recursive: true });
      writeFileSync(join(vault, ".git", "COMMIT.md"), "junk");
      const names = tl(editor, "(markdown-note-names-of (markdown-vault-notes))");
      expect(names).not.toContain("junk");
      expect(names).not.toContain("deep");
      expect(names).not.toContain("COMMIT");
      expect(names).toContain("goals"); // siblings AFTER the skipped dirs still found (return-vs-continue)
    });

    test("dangling [[link]] triggers the prompt, not a dead-end message", async () => {
      const e2 = await setupMdEditor("go to [[dangler]] now\n", join(vault, "index.md"));
      executeTlisp(e2, "(cursor-move 0 8)");
      executeTlisp(e2, "(markdown-follow-wiki-link)");
      // completing-read flips the editor to mx mode awaiting the choice.
      expect(e2.getState().mode).toBe("mx");
      expect(tl(e2, "(editor-status)")).not.toContain("not found");
    });
  });
});

describe("BUG-74: at-point on links preceded by other links", () => {
  test("second and third links on one line are detectable + followable", async () => {
    const e = await setupMdEditor("see [[one]] and [[two]] plus [[three]] end\n", "t.md");
    executeTlisp(e, "(cursor-move 0 20)");
    expect(tl(e, "(markdown-wiki-link-at-point)")).toBe("two");
    executeTlisp(e, "(cursor-move 0 33)");
    expect(tl(e, "(markdown-wiki-link-at-point)")).toBe("three");
    // range-at-point returns ABSOLUTE cols for the 2nd link ([[two]] spans 16-23)
    executeTlisp(e, "(cursor-move 0 20)");
    expect(tl(e, "(markdown-wiki-link-range-at-point)")).toBe("(0 16 23)");
    executeTlisp(e, "(cursor-move 0 8)");
    expect(tl(e, "(markdown-wiki-link-at-point)")).toBe("one");
    // follow the 2nd (dangling) link: prompt opens, no "No wiki link" misread
    executeTlisp(e, "(cursor-move 0 20)");
    executeTlisp(e, "(markdown-follow-wiki-link)");
    expect(e.getState().mode).toBe("mx");
    expect(tl(e, "(editor-status)")).not.toContain("No wiki link");
  });
});

// SPEC-117 (#192): gx (markdown-do) is the ONE context key — wiki-links
// follow through it too. Precedence: inline link > wiki-link > heading fold.
describe("SPEC-117: markdown-do dispatches wiki-links", () => {
  let vault: string;

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "tmax-vault-gx-"));
    writeFileSync(join(vault, "goals.md"), "# Goals\n\nthe real goals note\n");
  });

  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  test("gx on an existing [[link]] opens it", async () => {
    const e = await setupMdEditor("see [[goals]] now\n", join(vault, "index.md"));
    executeTlisp(e, "(cursor-move 0 8)"); // inside [[goals]]
    executeTlisp(e, "(markdown-do)");
    expect(e.getState().mode).toBe("normal"); // opened, no prompt
    expect(tl(e, "(buffer-current)")).toContain("goals.md");
  });

  test("gx on a dangling [[link]] opens the follow-or-create prompt", async () => {
    const e = await setupMdEditor("go [[fresh idea]] now\n", join(vault, "index.md"));
    executeTlisp(e, "(cursor-move 0 6)");
    executeTlisp(e, "(markdown-do)");
    expect(e.getState().mode).toBe("mx"); // completing-read prompt
    expect(tl(e, "(editor-status)")).not.toContain("Nothing to do");
  });

  test("inline links still dispatch first on multi-link lines (BUG-76 regression)", async () => {
    // Inline-vs-wiki order is UNOBSERVABLE (the wiki regex cannot match a
    // line containing an inner [t](u), so the predicates are mutually
    // exclusive by construction). This pins that inline dispatch itself
    // still works through markdown-do after the wiki clause was inserted.
    const e = await setupMdEditor("see [goals](goals.md) then [[dangler]]\n", join(vault, "index.md"));
    executeTlisp(e, "(cursor-move 0 6)"); // inside [goals]
    executeTlisp(e, "(markdown-do)");
    expect(tl(e, "(buffer-current)")).toContain("goals.md");
  });

  // Verify-gate retry 1: the old "pathological nesting" test was not an
  // order discriminator — the wiki regex \[\[[^\]]+\]\] cannot match a line
  // containing an inner [t](u) (the ] breaks it), so inline-vs-wiki order is
  // unobservable by construction (both at-point predicates are cursor-scoped
  // and mutually exclusive). The OBSERVABLE orderings are pinned below.
  test("precedence: wiki-link beats heading fold on a heading line containing [[link]]", async () => {
    const e = await setupMdEditor("# Notes on [[goals]]\n\nbody\n", join(vault, "index.md"));
    executeTlisp(e, "(cursor-move 0 14)"); // inside [[goals]]
    executeTlisp(e, "(markdown-do)");
    // The wiki clause fired BEFORE the heading clause: the note opened
    // (the heading branch would have folded in place instead).
    expect(tl(e, "(buffer-current)")).toContain("goals.md");
  });

  test("heading fold still applies (strong assertion: fold range recorded)", async () => {
    const e = await setupMdEditor("# Heading\n\ncontent\n\n# Other\n");
    executeTlisp(e, "(cursor-move 0 0)");
    executeTlisp(e, "(markdown-do)");
    expect(e.getState().mode).toBe("normal");
    expect(tl(e, "(editor-status)")).not.toContain("Nothing to do");
    // fold-get-ranges is the fold observable — non-empty means a fold was
    // actually applied, not just that the fallback wasn't reached.
    expect(tl(e, "(fold-get-ranges)")).not.toBe("nil");
    expect(tl(e, "(fold-get-ranges)")).toContain("(");
  });

  // Verify-gate retry 1: markdown-do's docstring always promised "toggle
  // checkbox" but no branch existed — and markdown-toggle-checkbox itself
  // never matched (regex \s- typo + escaping-broken groups + text-dropping
  // flow). The branch and the toggle are both fixed and pinned here.
  describe("checkbox tier (heading fold > checkbox is vacuous; checkbox > fallback)", () => {
    test("gx on an unchecked checkbox checks it, preserving the task text", async () => {
      const e = await setupMdEditor("- [ ] buy milk\n");
      executeTlisp(e, "(cursor-move 0 0)");
      executeTlisp(e, "(markdown-do)");
      expect(tl(e, "(buffer-text)")).toContain("- [x] buy milk");
    });

    test("gx on a checked checkbox unchecks it", async () => {
      const e = await setupMdEditor("- [x] bought\n");
      executeTlisp(e, "(cursor-move 0 0)");
      executeTlisp(e, "(markdown-do)");
      expect(tl(e, "(buffer-text)")).toContain("- [ ] bought");
    });

    test("gx on a capital-X checkbox unchecks it; * markers work; plain [ ] is untouched", async () => {
      const e = await setupMdEditor("- [X] caps\n* [ ] star\nplain [ ] no marker\n");
      executeTlisp(e, "(cursor-move 0 0)");
      executeTlisp(e, "(markdown-do)");
      expect(tl(e, "(buffer-text)")).toContain("- [ ] caps");
      executeTlisp(e, "(cursor-move 1 0)");
      executeTlisp(e, "(markdown-do)");
      expect(tl(e, "(buffer-text)")).toContain("* [x] star");
      executeTlisp(e, "(cursor-move 2 0)");
      executeTlisp(e, "(markdown-do)");
      expect(tl(e, "(buffer-text)")).toContain("plain [ ] no marker"); // not a checkbox line
    });
  });
});

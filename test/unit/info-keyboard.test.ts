/**
 * @file info-keyboard.test.ts
 * @description FIX ORDER 2, item 5 — the info reader works from the keyboard,
 *   end to end; the T-Lisp manual is reachable.
 *
 *   Every key is driven THROUGH THE KEY HANDLER on the real manual
 *   (docs/tmax/tmax.info): the test sends the key and reads what the buffer
 *   shows afterwards. Each title says whether the test was red before the
 *   change ("red first") or was written as a guard for what already worked
 *   ("guard").
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, minibufferRowText } from "../helpers/editor-fixture.ts";

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

const str = (ed: Editor, form: string): string => {
  const r = executeTlisp(ed, form);
  return r?.type === "string" ? String(r.value) : JSON.stringify(r?.value ?? r);
};

let file = "";

beforeAll(() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tmax-info-keys-")));
  file = join(dir, "one.md");
  writeFileSync(file, "hello\n");
});

const node = (ed: Editor): string => str(ed, "(buffer-line 0)"); // "Node: <name>"
const text = (ed: Editor): string => str(ed, "(buffer-text)");
const rowTexts = (ed: Editor): string[] =>
  (ed.getState().minibufferView?.rows ?? []).map(minibufferRowText);

/** A started editor with the tmax manual open in *Info*. */
async function infoEditor(): Promise<Editor> {
  const ed = await createStartedEditor("");
  executeTlisp(ed, `(find-file-open "${file}")`);
  executeTlisp(ed, "(info)");
  expect(node(ed)).toBe("Node: Top");
  return ed;
}

/** Press KEY in the open prompt and accept it (what the user types, then Enter). */
function choose(ed: Editor, input: string): void {
  expect(ed.getState().mode).toBe("mx");
  executeTlisp(ed, `(minibuffer-set-input "${input}")`);
  executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
}

describe("item 5a: n, p, u, t, q on the real manual (through the key handler)", () => {
  test("guard: n shows the next node of the same level", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n");
    expect(node(ed)).toBe("Node: Introduction");
    expect(text(ed)).toContain("Node: Introduction");
  });

  test("guard: p shows the previous node", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n");
    await ed.handleKey("p");
    expect(node(ed)).toBe("Node: Top");
  });

  test("guard: u shows the parent node", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n");
    expect(node(ed)).toBe("Node: Introduction");
    await ed.handleKey("u");
    expect(node(ed)).toBe("Node: Top");
  });

  test("guard: t shows the Top node from anywhere", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n");
    await ed.handleKey("n"); // Installation
    expect(node(ed)).toBe("Node: Installation");
    await ed.handleKey("t");
    expect(node(ed)).toBe("Node: Top");
  });

  test("guard: q leaves to the buffer from which info was opened", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });
});

describe("item 5a: m is a prompt with the menu items of the node", () => {
  test("red first: m offers the menu items of the node; choosing one shows that node", async () => {
    const ed = await infoEditor();
    await ed.handleKey("m");
    expect(ed.getState().mode).toBe("mx");
    expect(ed.getState().minibufferView?.prompt).toContain("Menu item");
    let shown = rowTexts(ed).join("\n");
    expect(shown).toContain("Introduction");
    expect(shown).toContain("Installation");
    expect(shown).not.toContain("* Menu:"); // the menu heading is not an item
    // Only the first candidates are on screen; typing filters the list.
    executeTlisp(ed, '(minibuffer-set-input "Buffer")');
    shown = rowTexts(ed).join("\n");
    expect(shown).toContain("Buffer Management");
    expect(shown).not.toContain("Kill Ring");
    choose(ed, "Installation");
    expect(node(ed)).toBe("Node: Installation");
    expect(ed.getState().mode).toBe("normal");
  });

  test("red first: the first menu item of the Top node is the Introduction, not a leftover of the heading", async () => {
    // info-parse-links read "* Menu:" as an item whose target was the next
    // line, so the Introduction was missing from the items.
    const ed = await infoEditor();
    await ed.handleKey("m");
    const shown = rowTexts(ed);
    expect(shown[0]).toContain("Introduction");
    expect(shown.join("\n")).not.toMatch(/What tmax is/);
  });

  test("guard: m in a node without a menu says so and opens no prompt", async () => {
    const ed = await infoEditor();
    await ed.handleKey("n"); // the Introduction has no '* Menu:' section
    expect(text(ed)).not.toMatch(/(^|\n)\* Menu:/);
    await ed.handleKey("m");
    expect(ed.getState().mode).toBe("normal");
    expect(ed.getState().statusMessage).toContain("No menu items");
  });

  test("red first: m after n offers the menu of the node that is shown, not of Top", async () => {
    const ed = await infoEditor();
    // Walk down with n (past Top) to the first node that has a menu.
    await ed.handleKey("n");
    let steps = 0;
    while (!/(^|\n)\* Menu:/.test(text(ed)) && steps < 12) { await ed.handleKey("n"); steps++; }
    expect(text(ed)).toMatch(/(^|\n)\* Menu:/);
    const shownNode = node(ed);
    expect(shownNode).not.toBe("Node: Top");
    await ed.handleKey("m");
    expect(ed.getState().mode).toBe("mx");
    const shown = rowTexts(ed).join("\n");
    expect(shown.length).toBeGreaterThan(0);
    // Every offered item is a line of THIS node's menu, and none is Top's.
    const menuNames = text(ed).split("\n")
      .map((line) => /^\* ([^:*]+)::/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!.trim());
    expect(menuNames.length).toBeGreaterThan(0);
    expect(shown).toContain(menuNames[0]!);
    expect(shown).not.toContain("Kill Ring"); // an item of the Top menu only
    choose(ed, menuNames[0]!);
    expect(node(ed)).toBe(`Node: ${menuNames[0]!}`);
  });
});

describe("item 5a: i is a prompt for a node", () => {
  test("red first: i offers the nodes of the manual; choosing one shows it", async () => {
    const ed = await infoEditor();
    await ed.handleKey("i");
    expect(ed.getState().mode).toBe("mx");
    expect(ed.getState().minibufferView?.prompt).toMatch(/[Nn]ode/);
    const shown = rowTexts(ed).join("\n");
    expect(shown).toContain("Index");
    expect(shown).toContain("Installation");
    expect(rowTexts(ed)[0]).toContain("Index"); // Enter alone takes it
    choose(ed, "Installation");
    expect(node(ed)).toBe("Node: Installation");
  });

  test("red first: i then Enter alone shows the Index (the key's name: the index)", async () => {
    const ed = await infoEditor();
    await ed.handleKey("i");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(node(ed)).toBe("Node: Index");
  });

  test("red first: a node that does not exist is refused with a message", async () => {
    const ed = await infoEditor();
    await ed.handleKey("i");
    choose(ed, "no-such-node");
    expect(node(ed)).toBe("Node: Top");
    expect(ed.getState().statusMessage ?? "").toContain("not found");
  });
});

describe("item 5a: RET, and the scroll keys in the read-only buffer", () => {
  test("known, guard: RET is unbound in *Info* — the reader cannot follow a reference", async () => {
    // Written down, not built: following a menu item or a cross-reference
    // with RET is a decision for the user (FIX-REPORT.md, FOR THE USER).
    const ed = await infoEditor();
    const menuLine = text(ed).split("\n").findIndex((line) => /^\* Introduction::/.test(line));
    expect(menuLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${menuLine} 0)`);
    await ed.handleKey("\r");
    expect(node(ed)).toBe("Node: Top");
    expect(str(ed, "(cursor-line)")).toBe(String(menuLine));
  });

  /** A long node of the tmax manual, with the cursor at its first line. */
  async function longNode(): Promise<Editor> {
    const ed = await infoEditor();
    await ed.handleKey("n");
    await ed.handleKey("n");
    await ed.handleKey("n");
    await ed.handleKey("n"); // a node deep in the manual
    expect(Number(str(ed, "(buffer-line-count)"))).toBeGreaterThan(40);
    executeTlisp(ed, "(cursor-move 0 0)");
    return ed;
  }
  const top = (ed: Editor): number => Number(str(ed, "(viewport-top-get)"));
  const line = (ed: Editor): number => Number(str(ed, "(cursor-line)"));

  test("guard: C-d, C-f, C-b and C-u page through a long node (the cursor moves, the view follows)", async () => {
    const ed = await longNode();
    expect(line(ed)).toBe(0);
    await ed.handleKey("\x04"); // C-d: half a page down
    const afterD = line(ed);
    expect(afterD).toBeGreaterThan(0);
    await ed.handleKey("\x06"); // C-f: a page down
    const afterF = line(ed);
    expect(afterF).toBeGreaterThan(afterD);
    await ed.handleKey("\x02"); // C-b: a page up
    expect(line(ed)).toBeLessThan(afterF);
    expect(line(ed)).toBeGreaterThan(0);
    await ed.handleKey("\x15"); // C-u: half a page up
    expect(line(ed)).toBe(0);
  });

  test("guard: C-e and C-y scroll the view by a line", async () => {
    const ed = await longNode();
    await ed.handleKey("\x05"); // C-e: the view goes down one line
    expect(top(ed)).toBe(1);
    await ed.handleKey("\x19"); // C-y: the view goes up one line
    expect(top(ed)).toBe(0);
  });

  test("guard: G and gg move the cursor through a long node", async () => {
    const ed = await longNode();
    const lines = Number(str(ed, "(buffer-line-count)"));
    await ed.handleKey("G");
    expect(line(ed)).toBe(lines - 1);
    await ed.handleKey("g");
    await ed.handleKey("g");
    expect(line(ed)).toBe(0);
    expect(top(ed)).toBe(0);
  });

  test("guard: x and dd do not change the read-only text", async () => {
    for (const keys of [["x"], ["d", "d"]]) {
      const ed = await infoEditor();
      const before = text(ed);
      executeTlisp(ed, "(cursor-move 0 2)");
      for (const key of keys) await ed.handleKey(key);
      expect(text(ed)).toBe(before);
      expect(ed.getState().statusMessage).toContain("read-only");
    }
  });

  test("known gap, NOT this item: cw changes the text of a read-only buffer", async () => {
    // Measured on *Info*, *Help* and *Dired*: the read-only flag refuses
    // x, dd and p, but cw, dw, J, ~, S, D, >>, <<, r<char> and the visual d
    // get through. That is in the vim operators, not in the info reader
    // (FIX-REPORT.md, FOUND ON THE WAY). Pinned so that a fix of the flag
    // changes this test on purpose.
    const ed = await infoEditor();
    executeTlisp(ed, "(cursor-move 0 0)");
    await ed.handleKey("c");
    await ed.handleKey("w");
    await ed.handleKey("Escape");
    expect(node(ed)).not.toBe("Node: Top");
  });
});

describe("item 5b: the T-Lisp manual is reachable", () => {
  test("red first: (info \"tlisp\") shows the Top node of the T-Lisp manual and not the tmax manual", async () => {
    const ed = await createStartedEditor("");
    const r = ed.getInterpreter().execute('(info "tlisp")');
    expect(r._tag).toBe("Right");
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    expect(node(ed)).toBe("Node: Top");
    expect(text(ed)).not.toContain("tmax Manual");
    expect(text(ed)).toMatch(/T-Lisp/);
  });

  test("guard: (info) is unchanged — the Top node of the tmax manual", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, "(info)");
    expect(node(ed)).toBe("Node: Top");
    expect(text(ed)).toContain("tmax Manual");
  });

  test("red first: an unknown manual name gives a clear message and opens nothing", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(find-file-open "${file}")`);
    executeTlisp(ed, '(info "nosuch")');
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(str(ed, "(buffer-list)")).not.toContain("*Info*");
    const status = ed.getState().statusMessage ?? "";
    expect(status).toContain("nosuch");
    expect(status).toMatch(/no manual|unknown|not/i);
  });

  test("red first: (info \"tlisp\") from the tmax manual switches the manual", async () => {
    const ed = await infoEditor();
    executeTlisp(ed, '(info "tlisp")');
    expect(text(ed)).not.toContain("tmax Manual");
    await ed.handleKey("n"); // the keys read the manual that is open now
    expect(node(ed)).toBe("Node: Introduction");
    expect(text(ed)).not.toContain("tmax Manual");
    await ed.handleKey("i");
    expect(rowTexts(ed).join("\n")).toContain("Lexical Structure"); // a T-Lisp manual node
    choose(ed, "Lexical Structure");
    expect(node(ed)).toBe("Node: Lexical Structure");
  });

  test("red first: info-tlisp is an M-x command that opens the T-Lisp manual", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(find-file-open "${file}")`);
    // The M-x path: SPC ; then the name of the command.
    await ed.handleKey(" ");
    await ed.handleKey(";");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, '(minibuffer-set-input "info-tlisp")'); // the user types the name
    expect(rowTexts(ed).join("\n")).toContain("info-tlisp"); // the command exists
    choose(ed, "info-tlisp");
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    expect(text(ed)).not.toContain("tmax Manual");
    expect(text(ed)).toMatch(/T-Lisp/);
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("guard: both manuals sit in the docs directory the daemon names, each with a Top node", async () => {
    const ed = await createStartedEditor("");
    const dir = str(ed, "(helpgrep-docs-dir)");
    for (const manual of ["tmax", "tlisp"]) {
      const top = executeTlisp(ed, `(hashmap-get (hashmap-get (info-parse "${dir}/${manual}.info") "Top") "next")`) as any;
      expect(top.type, manual).toBe("string");
      expect(top.value, manual).toBe("Introduction");
    }
  });
});

describe("item 5c: the docstring of the mode", () => {
  test("red first: it names what the keys do and says that the buffer is read-only", async () => {
    const ed = await createStartedEditor("");
    const doc = str(ed, '(major-mode-description "info")');
    expect(doc).toMatch(/read-only/i);
    for (const key of ["n", "p", "u", "t", "m", "i", "q"]) expect(doc, key).toContain(key);
    expect(doc).toMatch(/[Mm]enu/);
    expect(doc).toMatch(/[Nn]ode/);
  });
});

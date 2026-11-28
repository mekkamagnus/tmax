/**
 * @file dired-delete-flow.test.ts
 * @description #372 — the dired deletion flow.
 *
 *   Part 1. The question says what to type (`Type yes:`), and the question
 *   with the typed `yes` fits one line at 40 and at 200 columns. An answer
 *   that is not the exact word `yes` says so and says that nothing was
 *   deleted.
 *   Part 2. `q` cancels the plan and keeps the marks.
 *   Part 3. No stale status: each step of the flow sets its own message or
 *   clears it, and a completed leader sequence does not leave the
 *   which-key line as the status (that was why the dired listing kept
 *   "Which-key: d : (dired)").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { renderMinibuffer } from "../../src/frontend/render/minibuffer.ts";

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

const PLAN = "*Dired-Delete-Plan*";
const LISTING = "*Dired*";
const FILES = ["alpha.txt", "beta.txt", "gamma.txt"];

let root = "";
let vault = "";
let originalCwd = "";

beforeAll(() => {
  originalCwd = process.cwd();
  root = mkdtempSync(join(tmpdir(), "tmax-dired-delete-"));
  process.chdir(root); // the daemon's working folder is NOT the listed folder
});
afterAll(() => {
  process.chdir(originalCwd);
  if (root) rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(vault, { recursive: true, force: true });
  mkdirSync(join(root, "vault"));
  vault = realpathSync(join(root, "vault"));
  for (const name of FILES) writeFileSync(join(vault, name), `${name}\n`);
  writeFileSync(join(root, "outside.txt"), "outside\n");
});

const str = (ed: Editor, form: string): string => {
  const r = executeTlisp(ed, form);
  return r?.type === "string" ? String(r.value) : JSON.stringify(r?.value ?? r);
};

const text = (ed: Editor): string => str(ed, "(buffer-text)");
const marked = (ed: Editor, name: string): boolean => text(ed).includes(`D ${name}`);

/** Open the listing, mark FILES, press x: the plan buffer is shown. */
async function openPlan(ed: Editor, names = FILES): Promise<void> {
  executeTlisp(ed, `(dired "${vault}")`);
  for (const name of names) {
    const rows = Number(str(ed, "(buffer-line-count)"));
    let row = -1;
    for (let i = 0; i < rows; i++) if (str(ed, `(buffer-line ${i})`) === `  ${name}`) row = i;
    expect(row, name).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${row} 0)`);
    await ed.handleKey("d");
    executeTlisp(ed, `(cursor-move ${row} 0)`);
  }
  await ed.handleKey("x");
  expect(str(ed, "(buffer-current)")).toBe(PLAN);
}

/** Press y in the plan and answer the question with INPUT. */
async function answer(ed: Editor, input: string): Promise<void> {
  await ed.handleKey("y");
  expect(ed.getState().mode).toBe("mx");
  executeTlisp(ed, `(minibuffer-set-input "${input}")`);
  executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
}

const allExist = (names = FILES): boolean => names.every((name) => existsSync(join(vault, name)));

describe("#372 part 1: the question says what to type", () => {
  test("the question names the count and says to type yes (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("y");
    expect(ed.getState().minibufferView!.prompt).toBe("Delete 3 shown entries? Type yes: ");
  });

  test("the question and the typed yes are complete at 40 columns (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("y");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    const view = ed.getState().minibufferView!;
    const rendered = renderMinibuffer(view, 40);
    const line = rendered.lines[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    // What the user reads on the 40-column line: the question, then the
    // answer, both complete; the cursor sits at the end of the answer.
    expect(line.startsWith("Delete 3 shown entries? Type yes: yes")).toBe(true);
    expect(rendered.cursorColumn).toBe("Delete 3 shown entries? Type yes: ".length + 3);
    expect(rendered.cursorColumn).toBeLessThan(40);
  });

  test("the question and the typed yes are complete at 200 columns (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("y");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    const view = ed.getState().minibufferView!;
    const line = renderMinibuffer(view, 200).lines[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    expect(line.startsWith("Delete 3 shown entries? Type yes: yes")).toBe(true);
  });

  test("what follows the answer on the line is recorded: the completion message of a free-form prompt", { timeout: 30_000 }, async () => {
    // Not #372 (true for every read-from-minibuffer prompt before it): the
    // renderer appends the completion message after the input. A free-form
    // prompt has no candidates, so that message is "No match"; on a
    // 40-column line it is cut to "No", which reads as "... Type yes: yes No".
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("y");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    const view = ed.getState().minibufferView!;
    expect(view.message).toBe("No match");
  });

  test("y then Enter deletes nothing and says that the full word was needed (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("y"); // the plan's confirm key
    await answer(ed, "y"); // the answer "y": not the full word
    expect(allExist()).toBe(true);
    expect(str(ed, "(buffer-current)")).toBe(LISTING);
    const status = ed.getState().statusMessage ?? "";
    expect(status).toContain("Not confirmed");
    expect(status).toContain("nothing deleted");
    expect(status).not.toContain("Deleted 3");
    expect(marked(ed, "alpha.txt")).toBe(true); // the marks are kept
  });

  test("yes deletes exactly the shown entries (guard: true before #372)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await answer(ed, "yes");
    expect(allExist()).toBe(false);
    expect(existsSync(join(root, "outside.txt"))).toBe(true);
    expect(ed.getState().statusMessage).toContain("Deleted 3 entries");
  });
});

describe("#372 part 2: q cancels the plan", () => {
  test("q cancels, keeps the marks, and starts no macro recording (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(LISTING);
    expect(allExist()).toBe(true);
    expect(marked(ed, "alpha.txt")).toBe(true);
    expect(str(ed, "(macro-record-pending-p)")).toBe("false");
    expect(str(ed, "(macro-record-active)")).toBe("false");
    const status = ed.getState().statusMessage ?? "";
    expect(status).toContain("nothing deleted");
  });

  test("the instruction line of the plan names q as the cancel key (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    const last = text(ed).trimEnd().split("\n").at(-1)!;
    expect(last).toContain("q");
    expect(last).toContain("cancel");
  });

  test("q in the plan is the plan's own q, not the first key of a macro recording (red first)", { timeout: 30_000 }, async () => {
    // Before #372, q in the plan asked for a macro register; the next key
    // was taken as the register (here: "Cancelled", still in the plan).
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(LISTING);
    expect(ed.getState().statusMessage ?? "").not.toContain("Macro record");
  });

  test("n still cancels (guard: true before #372)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    await openPlan(ed);
    await ed.handleKey("n");
    expect(str(ed, "(buffer-current)")).toBe(LISTING);
    expect(allExist()).toBe(true);
    expect(marked(ed, "beta.txt")).toBe(true);
  });
});

describe("#372 part 3: no stale status message", () => {
  test("the plan buffer does not show the status message of an earlier command (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    // An earlier command of the flow: a copy, whose result is a status message.
    let rows = Number(str(ed, "(buffer-line-count)"));
    let row = -1;
    for (let i = 0; i < rows; i++) if (str(ed, `(buffer-line ${i})`) === "  alpha.txt") row = i;
    executeTlisp(ed, `(cursor-move ${row} 0)`);
    await ed.handleKey("C");
    // An ABSOLUTE destination: a bare one counts from the daemon's working
    // folder, not from the listed folder, until #374 lands.
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "copy-of-alpha.txt")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(ed.getState().statusMessage ?? "").toContain("Copied"); // the copy reported
    // The deletion flow starts now.
    await openPlan(ed, ["beta.txt"]);
    expect(ed.getState().statusMessage ?? "").not.toContain("Copied");
    expect(readFileSync(join(vault, "copy-of-alpha.txt"), "utf8")).toBe("alpha.txt\n");
    await ed.handleKey("y");
    await answer(ed, "y");
    expect(ed.getState().statusMessage ?? "").not.toContain("Copied");
    expect(ed.getState().statusMessage ?? "").toContain("Not confirmed");
  });

  test("a cancelled plan leaves a message of its own, not the earlier one (red first)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(editor-set-status "Copied something earlier")');
    await openPlan(ed, ["gamma.txt"]);
    expect(ed.getState().statusMessage ?? "").toBe("");
    await ed.handleKey("q");
    const status = ed.getState().statusMessage ?? "";
    expect(status).not.toContain("Copied");
    expect(status).toContain("nothing deleted");
  });
});

describe("#372 part 3: a completed leader sequence does not keep the which-key line", () => {
  /** Wait until the which-key popup is active (the timer of the handle fired). */
  async function popupShown(ed: Editor): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (ed.getState().whichKeyActive) return;
      await Bun.sleep(10);
    }
    throw new Error("the which-key popup did not show");
  }

  test("control: after SPC alone the which-key line IS the status (guard: true before #372)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    ed.getWhichKeyHandle().reset(30);
    await ed.handleKey(" ");
    await popupShown(ed);
    expect(ed.getState().statusMessage ?? "").toMatch(/^Which-key: /);
  });

  for (const [name, keys, lands] of [
    ["SPC d d", [" ", "d", "d"], LISTING],
    ["SPC h m", [" ", "h", "m"], "*Help*"],
  ] as const) {
    test(`${name}: the which-key line is gone once the command ran (red first)`, { timeout: 30_000 }, async () => {
      const ed = await createStartedEditor("");
      ed.getWhichKeyHandle().reset(30);
      for (let i = 0; i < keys.length - 1; i++) {
        await ed.handleKey(keys[i]!);
        await popupShown(ed); // the user paused: the popup and its status line showed
      }
      expect(ed.getState().statusMessage ?? "").toMatch(/^Which-key: /);
      await ed.handleKey(keys.at(-1)!);
      expect(str(ed, "(buffer-current)")).toBe(lands);
      expect(ed.getState().whichKeyActive).toBe(false);
      expect(ed.getState().statusMessage ?? "").not.toMatch(/^Which-key: /);
    });
  }

  test("a real message set by the command is kept (guard: true before #372)", { timeout: 30_000 }, async () => {
    // SPC x z runs bury-buffer, whose message is "Buried <buffer>".
    const ed = await createStartedEditor("hello");
    ed.getWhichKeyHandle().reset(30);
    await ed.handleKey(" ");
    await popupShown(ed);
    await ed.handleKey("x");
    await popupShown(ed);
    await ed.handleKey("z");
    expect(ed.getState().statusMessage).toBe("Buried test");
  });
});

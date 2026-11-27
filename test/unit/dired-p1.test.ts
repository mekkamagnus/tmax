/**
 * @file dired-p1.test.ts
 * @description #360 / RFC-041 U3 phase 1 — the minimum usable dired.
 *
 * Vim-motion keymap (user-fixed): j/k entries, l descend/open, h parent,
 * RET/o alias l, q quit, + mkdir, d/u/x delete marks, R rename, C copy,
 * g refresh-keeping-cursor. Listing: name first, trailing / for folders,
 * ".." first, hidden files shown. One *Dired* buffer updated in place.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

let vault = join(tmpdir(), `tmax-dired-${process.pid}-`);
type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const tl = (ed: Editor, form: string): string => {
  const r = executeTlisp(ed, form) as { type: string; value?: unknown };
  if (r?.type === "string") return String(r.value);
  if (r?.type === "nil") return "nil";
  if (r?.type === "boolean") return String(r.value);
  return JSON.stringify(r?.value ?? r);
};

const line = (ed: Editor, i: number): string => tl(ed, `(buffer-get-line ${i})`);

beforeAll(() => {
  rmSync(vault, { recursive: true, force: true });
  mkdirSync(join(vault, "sub"), { recursive: true });
  writeFileSync(join(vault, "a.txt"), "alpha\n");
  writeFileSync(join(vault, ".hidden"), "dot\n");
  writeFileSync(join(vault, "z.txt"), "zulu\n");
  writeFileSync(join(vault, "sub", "inner.md"), "# inner\n");
  vault = realpathSync(vault); // canonical: dired resolves listing paths
});

describe("#360 phase 1: dired listing and mode", () => {
  test("listing: .. first, name-first format, trailing / for folders, hidden shown, dired-mode active", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(find-file-open "${join(vault, "a.txt")}")`);
    executeTlisp(ed, "(dired)");
    expect(tl(ed, "(buffer-current)")).toBe("*Dired*");
    expect(tl(ed, "(major-mode-get)")).toBe("dired");
    expect(tl(ed, "(buffer-filename)")).toBe(vault);
    expect(line(ed, 0)).toBe("  ..");
    const text = tl(ed, "(buffer-text)");
    expect(text).toContain("  sub/");
    expect(text).toContain("  a.txt");
    expect(text).toContain("  z.txt");
    expect(text).toContain("  .hidden"); // phase 1: hidden files shown
    expect(tl(ed, "(buffer-modified-p)")).toBe("false");
  });

  test("with no file open, lists the process working directory", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    expect(tl(ed, "(buffer-filename)")).toBe(vault);
  });

  test("j/k move entry by entry", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    expect(tl(ed, "(cursor-line)")).toBe("0");
    await ed.handleKey("j");
    expect(tl(ed, "(cursor-line)")).toBe("1");
    await ed.handleKey("j");
    expect(tl(ed, "(cursor-line)")).toBe("2");
    await ed.handleKey("k");
    expect(tl(ed, "(cursor-line)")).toBe("1");
  });

  test("l descends into a folder; h returns to the parent (same buffer)", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    // find the sub/ line
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let subLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  sub/") subLine = i;
    expect(subLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${subLine} 0)`);
    await ed.handleKey("l");
    expect(tl(ed, "(buffer-filename)")).toBe(join(vault, "sub"));
    expect(tl(ed, "(buffer-current)")).toBe("*Dired*"); // ONE buffer, updated
    expect(tl(ed, "(buffer-text)")).toContain("inner.md");
    await ed.handleKey("h");
    expect(tl(ed, "(buffer-filename)")).toBe(vault);
  });

  test("l on '..' goes up; o and Enter open the file under the cursor", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${join(vault, "sub")}")`);
    executeTlisp(ed, "(cursor-move 0 0)"); // on ".."
    await ed.handleKey("l");
    expect(tl(ed, "(buffer-filename)")).toBe(vault);
    // re-descend into sub/ and open inner.md with o
    executeTlisp(ed, `(dired "${join(vault, "sub")}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let inner = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i).endsWith("inner.md")) inner = i;
    executeTlisp(ed, `(cursor-move ${inner} 0)`);
    await ed.handleKey("o");
    expect(tl(ed, "(buffer-current)")).toBe(join(vault, "sub", "inner.md"));
    expect(tl(ed, "(buffer-text)")).toContain("# inner");
    // back to dired; Enter opens too
    executeTlisp(ed, `(dired "${join(vault, "sub")}")`);
    executeTlisp(ed, `(cursor-move ${inner} 0)`);
    await ed.handleKey("Enter");
    expect(tl(ed, "(buffer-current)")).toBe(join(vault, "sub", "inner.md"));
  });

  test("q closes the listing and returns to the previous buffer", async () => {
    const ed = await createStartedEditor("hello");
    expect(tl(ed, "(buffer-current)")).toBe("test");
    executeTlisp(ed, `(dired "${vault}")`);
    await ed.handleKey("q");
    expect(tl(ed, "(buffer-current)")).toBe("test");
    expect(tl(ed, "(buffer-list)")).not.toContain("Dired");
  });
});

describe("#360 phase 1: dired operations", () => {
  test("d marks, u unmarks, x deletes after confirm", async () => {
    writeFileSync(join(vault, "victim.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let vLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  victim.txt") vLine = i;
    executeTlisp(ed, `(cursor-move ${vLine} 0)`);
    await ed.handleKey("d");
    expect(line(ed, vLine)).toBe("D victim.txt");
    await ed.handleKey("k"); // step away and back to unmark without moving past
    executeTlisp(ed, `(cursor-move ${vLine} 0)`);
    await ed.handleKey("u");
    expect(line(ed, vLine)).toBe("  victim.txt");
    expect(existsSync(join(vault, "victim.txt"))).toBe(true);
    // u advances the cursor (mark-and-move-down) — return to the line first.
    executeTlisp(ed, `(cursor-move ${vLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    expect(ed.getState().mode).toBe("mx"); // the batch confirm is open
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "victim.txt"))).toBe(false);
    expect(tl(ed, "(buffer-text)")).not.toContain("victim.txt");
    expect(ed.getState().statusMessage).toContain("Deleted 1 entries");
  });

  test("x with no marks reports and does not prompt", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await ed.handleKey("x");
    expect(ed.getState().statusMessage).toContain("No marked entries");
    expect(ed.getState().mode).toBe("normal");
  });

  test("+ creates a directory inside the listing and refreshes", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await ed.handleKey("+");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "made-by-dired")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "made-by-dired"))).toBe(true);
    expect(tl(ed, "(buffer-text)")).toContain("made-by-dired/");
  });

  test("R renames the entry under the cursor (source filled in, then refresh)", async () => {
    writeFileSync(join(vault, "old-name.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let rLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  old-name.txt") rLine = i;
    executeTlisp(ed, `(cursor-move ${rLine} 0)`);
    await ed.handleKey("R");
    expect(ed.getState().mode).toBe("mx");
    expect(ed.getState().minibufferView?.prompt).toContain("old-name.txt");
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "new-name.txt")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "old-name.txt"))).toBe(false);
    expect(existsSync(join(vault, "new-name.txt"))).toBe(true);
    expect(tl(ed, "(buffer-text)")).toContain("new-name.txt");
  });

  test("C copies the entry under the cursor", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let cLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  new-name.txt") cLine = i;
    executeTlisp(ed, `(cursor-move ${cLine} 0)`);
    await ed.handleKey("C");
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "copy-of-new.txt")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "new-name.txt"))).toBe(true);
    expect(existsSync(join(vault, "copy-of-new.txt"))).toBe(true);
  });

  test("g refreshes and keeps the cursor on the same entry", async () => {
    writeFileSync(join(vault, "gg.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let zLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  z.txt") zLine = i;
    executeTlisp(ed, `(cursor-move ${zLine} 0)`);
    // change the directory behind dired's back: remove gg.txt
    unlinkSync(join(vault, "gg.txt"));
    await ed.handleKey("g");
    expect(tl(ed, "(buffer-text)")).not.toContain("gg.txt");
    expect(line(ed, Number(tl(ed, "(cursor-line)")))).toBe("  z.txt"); // still on z.txt
  });
});

describe("#360 coach round 7: identity, typed deletion, results, paths, links", () => {
  test("C7-1a: a spaced name deletes THE spaced file, not its last word", async () => {
    writeFileSync(join(vault, "my file"), "a");
    writeFileSync(join(vault, "file"), "b");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let mLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  my file") mLine = i;
    expect(mLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${mLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "my file"))).toBe(false);
    expect(existsSync(join(vault, "file"))).toBe(true);
  });

  test("C7-1b: l opens a file whose name contains spaces", async () => {
    writeFileSync(join(vault, "space name.txt"), "spaced\n");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let sLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  space name.txt") sLine = i;
    executeTlisp(ed, `(cursor-move ${sLine} 0)`);
    await ed.handleKey("l");
    expect(tl(ed, "(buffer-current)")).toBe(join(vault, "space name.txt"));
    expect(tl(ed, "(buffer-text)")).toContain("spaced");
  });

  test("C7-1c: a newline-named entry cannot inject an actionable row", async () => {
    writeFileSync(join(vault, "bad\nfake-row.txt"), "evil");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      const name = line(ed, i).slice(2);
      expect(name).not.toBe("fake-row.txt"); // no injected row parses as that name
    }
    expect(existsSync(join(vault, "bad\nfake-row.txt"))).toBe(true); // untouched on disk
  });

  test("C7-2a: a marked NON-EMPTY directory is deleted after confirm", async () => {
    const d = join(vault, "marked-dir");
    mkdirSync(join(d, "inner"), { recursive: true });
    writeFileSync(join(d, "inner", "x.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let dLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  marked-dir/") dLine = i;
    expect(dLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${dLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(d)).toBe(false);
  });

  test("C7-2b: a symlink-to-directory mark deletes the LINK, target intact", async () => {
    const target = join(vault, "link-target-dir");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "keep.txt"), "keep");
    symlinkSync(target, join(vault, "dir-link"));
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let lLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i).endsWith("dir-link/")) lLine = i;
    expect(lLine).toBeGreaterThan(0); // displayed with / (C7-5)
    executeTlisp(ed, `(cursor-move ${lLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "dir-link"))).toBe(false);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
  });

  test("C7-2c: mixed batch — deletable + protected link — both outcomes reported", async () => {
    writeFileSync(join(vault, "killme.txt"), "x");
    symlinkSync(process.env.HOME!, join(vault, "home-alias"));
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      const n = line(ed, i).slice(2).replace(/\/$/, "");
      if (n === "killme.txt" || n === "home-alias") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "killme.txt"))).toBe(false);
    expect(lstatSync(join(vault, "home-alias"), { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(ed.getState().statusMessage).toContain("refused");
    expect(ed.getState().statusMessage).toContain("Deleted");
  });

  test("C7-2d: cancelling the batch deletes nothing", async () => {
    writeFileSync(join(vault, "spared-batch.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2) === "spared-batch.txt") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "no")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "spared-batch.txt"))).toBe(true);
  });

  test("C7-3a: mkdir failure survives the refresh (status shows the failure)", async () => {
    writeFileSync(join(vault, "plain-file.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await ed.handleKey("+");
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "plain-file.txt", "sub")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(ed.getState().statusMessage).toContain("failed");
    expect(ed.getState().statusMessage).not.toContain("Dired: ");
  });

  test("C7-3b: refresh failure keeps the old listing and reports", async () => {
    const d = join(vault, "noread-refresh");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "inside.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${d}")`);
    const before = tl(ed, "(buffer-text)");
    chmodSync(d, 0o000);
    await ed.handleKey("g");
    expect(tl(ed, "(buffer-text)")).toBe(before); // old listing intact
    expect(ed.getState().statusMessage).toContain("cannot read");
    chmodSync(d, 0o755);
  });

  test("C7-4a: a relative visited file lists the cwd (not /); h reaches the parent", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(set-buffer-filename "notes.txt")');
    executeTlisp(ed, "(dired)");
    expect(tl(ed, "(buffer-filename)")).toBe(process.cwd());
    await ed.handleKey("h");
    expect(tl(ed, "(buffer-filename)")).toBe(join(process.cwd(), "..").replace(/\/$/, "") !== "/" ? dirnameSafe(process.cwd()) : "/");
    expect(tl(ed, "(buffer-filename)")).not.toBe("/");
  });

  test("C7-4b: explicit '.' and trailing-slash arguments normalize", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(dired ".")');
    expect(tl(ed, "(buffer-filename)")).toBe(process.cwd());
    executeTlisp(ed, `(dired "${vault}/")`);
    expect(tl(ed, "(buffer-filename)")).toBe(vault);
  });

  test("C7-5a: a directory SYMLINK row shows / and l enters it", async () => {
    const target = join(vault, "nav-target");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "seen.txt"), "x");
    symlinkSync(target, join(vault, "nav-link"));
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let nLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i).endsWith("nav-link/")) nLine = i;
    expect(nLine).toBeGreaterThan(0); // following stat gave it a trailing /
    executeTlisp(ed, `(cursor-move ${nLine} 0)`);
    await ed.handleKey("l");
    expect(tl(ed, "(buffer-filename)")).toBe(target);
    expect(tl(ed, "(buffer-text)")).toContain("seen.txt");
  });

  test("C7-5b: a dangling link is listed, does not crash, and deletes as an entry", async () => {
    symlinkSync(join(vault, "nowhere"), join(vault, "dangling-link"));
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let dLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i).slice(2).replace(/\/$/, "") === "dangling-link") dLine = i;
    expect(dLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${dLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(lstatSync(join(vault, "dangling-link"), { throwIfNoEntry: false })).toBeUndefined();
  });
});

const dirnameSafe = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
};

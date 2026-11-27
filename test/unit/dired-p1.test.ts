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

describe("#360 coach round 8: deletion plan, mark preservation, encoding, prefills", () => {
  test("C8-1a: the batch prompt names the recursive trees", async () => {
    const d = join(vault, "c8-tree");
    mkdirSync(join(d, "s"), { recursive: true });
    writeFileSync(join(vault, "c8-file.txt"), "x");
    writeFileSync(join(d, "s", "f"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      const n = line(ed, i).slice(2).replace(/\/$/, "");
      if (n === "c8-tree" || n === "c8-file.txt") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    // coach r10 supersedes the r8 wording: every entry + type, recursion explicit.
    expect(ed.getState().minibufferView?.prompt).toContain("RECURSIVELY");
    executeTlisp(ed, '(minibuffer-set-input "no")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
  });

  test("C8-1b: a confirmed FILE replaced by a nonempty directory before yes — tree survives, refusal visible", async () => {
    writeFileSync(join(vault, "c8-swap.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2) === "c8-swap.txt") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    // swap the confirmed file for a NONEMPTY directory while the prompt is open
    rmSync(join(vault, "c8-swap.txt"));
    mkdirSync(join(vault, "c8-swap.txt", "kept"), { recursive: true });
    writeFileSync(join(vault, "c8-swap.txt", "kept", "safe.txt"), "safe");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c8-swap.txt", "kept", "safe.txt"))).toBe(true);
    expect(ed.getState().statusMessage).toContain("refused");
  });

  test("C8-1c: a confirmed EMPTY directory that becomes nonempty before yes survives", async () => {
    const d = join(vault, "c8-latefill");
    mkdirSync(d, { recursive: true });
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2) === "c8-latefill/") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    writeFileSync(join(d, "appeared.txt"), "x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(d, "appeared.txt"))).toBe(true);
  });

  test("C8-1d: a confirmed directory that becomes a symlink before yes is refused", async () => {
    const target = join(vault, "c8-retarget-t");
    mkdirSync(target, { recursive: true });
    const d = join(vault, "c8-becomes-link");
    mkdirSync(d, { recursive: true });
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2) === "c8-becomes-link/") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    rmSync(d, { recursive: true });
    symlinkSync(target, join(vault, "c8-becomes-link"));
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(lstatSync(join(vault, "c8-becomes-link"), { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  test("C8-1e: an unreadable marked directory is refused, intact", async () => {
    const d = join(vault, "c8-noread");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "x"), "x");
    chmodSync(d, 0o000);
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2) === "c8-noread/") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    chmodSync(d, 0o755);
    expect(existsSync(join(d, "x"))).toBe(true);
    expect(ed.getState().statusMessage).toContain("refused");
  });

  test("C8-2a: marks survive g by identity — d, g, x deletes the intended file", async () => {
    writeFileSync(join(vault, "c8-keepmark.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let mLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  c8-keepmark.txt") mLine = i;
    executeTlisp(ed, `(cursor-move ${mLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("g");
    // the row still carries its mark after the rebuild
    const rows2 = Number(tl(ed, "(buffer-line-count)"));
    let still = false;
    for (let i = 0; i < rows2; i++) if (line(ed, i) === "D c8-keepmark.txt") still = true;
    expect(still).toBe(true);
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c8-keepmark.txt"))).toBe(false);
  });

  test("C8-2b: a failed refresh keeps the listing AND the marks", async () => {
    writeFileSync(join(vault, "c8-failmark.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i) === "  c8-failmark.txt") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    chmodSync(vault, 0o500); // readable+listable? make unreadable for readdir:
    chmodSync(vault, 0o000);
    await ed.handleKey("g");
    chmodSync(vault, 0o755);
    expect(tl(ed, "(buffer-text)")).toContain("D c8-failmark.txt");
    expect(ed.getState().statusMessage).toContain("cannot read");
  });

  test("C8-3a: a newline-named entry is ONE actionable row and deletes by identity", async () => {
    writeFileSync(join(vault, "c8\nweird.txt"), "x");
    writeFileSync(join(vault, "c8weird.txt"), "neighbor");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let wLine = -1;
    for (let i = 0; i < rows; i++) {
      const n = line(ed, i).slice(2).replace(/\/$/, "");
      if (n === "c8\\nweird.txt") wLine = i; // displayed escaped
    }
    expect(wLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${wLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c8\nweird.txt"))).toBe(false); // the real-newline entry is gone
    expect(existsSync(join(vault, "c8weird.txt"))).toBe(true); // the neighbor survives
  });

  test("C8-3b: a literal backslash-n name is distinct from a real newline name", async () => {
    writeFileSync(join(vault, "lit\\nname.txt"), "lit"); // three chars: lit \ n ...
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let litLine = -1;
    for (let i = 0; i < rows; i++) {
      const n = line(ed, i).slice(2).replace(/\/$/, "");
      if (n === "lit\\\\nname.txt") litLine = i; // backslash escaped in display
    }
    expect(litLine).toBeGreaterThan(0);
    executeTlisp(ed, `(cursor-move ${litLine} 0)`);
    await ed.handleKey("d");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "lit\\nname.txt"))).toBe(false);
  });

  test("C8-4a: R and C prefill the destination prompt with the SOURCE path", async () => {
    writeFileSync(join(vault, "c8-prefill.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let pLine = -1;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "  c8-prefill.txt") pLine = i;
    executeTlisp(ed, `(cursor-move ${pLine} 0)`);
    await ed.handleKey("R");
    expect(ed.getState().minibufferView?.input).toBe(join(vault, "c8-prefill.txt"));
    executeTlisp(ed, `(minibuffer-set-input "${join(vault, "c8-prefill-renamed.txt")}")`);
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c8-prefill-renamed.txt"))).toBe(true);
    const rows2 = Number(tl(ed, "(buffer-line-count)"));
    let p2 = -1;
    for (let i = 0; i < rows2; i++) if (line(ed, i) === "  c8-prefill-renamed.txt") p2 = i;
    executeTlisp(ed, `(cursor-move ${p2} 0)`);
    await ed.handleKey("C");
    expect(ed.getState().minibufferView?.input).toBe(join(vault, "c8-prefill-renamed.txt"));
    executeTlisp(ed, '(minibuffer-dispatch-key "Escape")');
  });
});

describe("Enter on an empty dired batch confirmation cancels", () => {
  test("dired x: empty input + Enter keeps the file AND the mark", async () => {
    writeFileSync(join(vault, "dired-enter-guard.txt"), "keep");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i) === "  dired-enter-guard.txt") {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
      }
    }
    await ed.handleKey("x");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, '(minibuffer-set-input "")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "dired-enter-guard.txt"))).toBe(true);
    // the mark survives the cancelled confirmation
    const rows2 = Number(tl(ed, "(buffer-line-count)"));
    let still = false;
    for (let i = 0; i < rows2; i++) if (line(ed, i) === "D dired-enter-guard.txt") still = true;
    expect(still).toBe(true);
  });
});

describe("#360 coach round 10: mark-time identity, plan prompt, literal input", () => {
  const markRow = async (ed: Awaited<ReturnType<typeof createStartedEditor>>, want: string): Promise<void> => {
    const rows = Number(tl(ed, "(buffer-line-count)"));
    for (let i = 0; i < rows; i++) {
      if (line(ed, i).slice(2).replace(/\/$/, "") === want || line(ed, i) === `  ${want}`) {
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        await ed.handleKey("d");
        executeTlisp(ed, `(cursor-move ${i} 0)`);
        return;
      }
    }
    throw new Error(`row not found: ${want}`);
  };

  test("C10-1a: a file replaced by a populated directory BEFORE x survives", async () => {
    writeFileSync(join(vault, "c10-swap.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "c10-swap.txt");
    rmSync(join(vault, "c10-swap.txt"));
    mkdirSync(join(vault, "c10-swap.txt", "kept"), { recursive: true });
    writeFileSync(join(vault, "c10-swap.txt", "kept", "f"), "safe");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c10-swap.txt", "kept", "f"))).toBe(true);
    expect(ed.getState().statusMessage).toContain("refused");
  });

  test("C10-1b: a marked file replaced DURING the confirmation survives", async () => {
    writeFileSync(join(vault, "c10-mid.txt"), "original");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "c10-mid.txt");
    await ed.handleKey("x");
    rmSync(join(vault, "c10-mid.txt"));
    writeFileSync(join(vault, "c10-mid.txt"), "replacement");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c10-mid.txt"))).toBe(true);
    expect(ed.getState().statusMessage).toContain("refused");
  });

  test("C10-1c: a replacement after g drops the mark (identity changed)", async () => {
    writeFileSync(join(vault, "c10-afterg.txt"), "one");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "c10-afterg.txt");
    rmSync(join(vault, "c10-afterg.txt"));
    writeFileSync(join(vault, "c10-afterg.txt"), "two");
    await ed.handleKey("g");
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let still = false;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "D c10-afterg.txt") still = true;
    expect(still).toBe(false); // the replacement did not inherit the mark
  });

  test("C10-2a: the confirmation enumerates every entry with its type; cancel keeps all", async () => {
    writeFileSync(join(vault, "my c10 file"), "x");
    writeFileSync(join(vault, "plain-c10.txt"), "x");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "my c10 file");
    await markRow(ed, "plain-c10.txt");
    await ed.handleKey("x");
    const prompt = ed.getState().minibufferView?.prompt ?? "";
    expect(prompt).toContain("my c10 file");
    expect(prompt).toContain("plain-c10.txt");
    executeTlisp(ed, '(minibuffer-set-input "")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "my c10 file"))).toBe(true);
    expect(existsSync(join(vault, "plain-c10.txt"))).toBe(true);
  });

  test("C10-3a: two marks survive g; a disappeared entry loses its mark; x deletes the survivor", async () => {
    writeFileSync(join(vault, "c10-a.txt"), "a");
    writeFileSync(join(vault, "c10-b.txt"), "b");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "c10-a.txt");
    await markRow(ed, "c10-b.txt");
    unlinkSync(join(vault, "c10-b.txt"));
    await ed.handleKey("g");
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let a = false;
    let b = false;
    for (let i = 0; i < rows; i++) {
      if (line(ed, i) === "D c10-a.txt") a = true;
      if (line(ed, i) === "D c10-b.txt") b = true;
    }
    expect(a).toBe(true);
    expect(b).toBe(false);
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "yes")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c10-a.txt"))).toBe(false);
  });

  test("C10-4a: dired x with literal y does not delete; marks kept", async () => {
    writeFileSync(join(vault, "c10-lity.txt"), "keep");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${vault}")`);
    await markRow(ed, "c10-lity.txt");
    await ed.handleKey("x");
    executeTlisp(ed, '(minibuffer-set-input "y")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "c10-lity.txt"))).toBe(true);
    const rows = Number(tl(ed, "(buffer-line-count)"));
    let still = false;
    for (let i = 0; i < rows; i++) if (line(ed, i) === "D c10-lity.txt") still = true;
    expect(still).toBe(true);
  });
});

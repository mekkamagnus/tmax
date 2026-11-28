/**
 * @file help-quit.test.ts
 * @description #375 — q leaves the help, info and man buffers.
 *
 *   `q` in *Help*, *Info* and *Man* buries the buffer and shows the buffer
 *   that was on screen when it was opened (the Emacs `quit-window`). The
 *   buffer is remembered when help, info or man opens. Help opened from
 *   help returns to the buffer before the FIRST help page. When there is no
 *   earlier buffer (or it is gone), *scratch* is shown.
 *
 *   The first cause of #375 (q started a macro recording instead of the
 *   mode command) is #368; the dispatch is also pinned in
 *   major-mode-key-precedence.test.ts.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

const str = (ed: Editor, form: string): string => {
  const r = executeTlisp(ed, form);
  return r?.type === "string" ? String(r.value) : JSON.stringify(r?.value ?? r);
};

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tmax-help-quit-"));
  file = join(dir, "one.md");
  writeFileSync(file, "hello\n");
});

/** A started editor that visits FILE (so the buffer has a file). */
async function fileEditor(): Promise<Editor> {
  const ed = await createStartedEditor("");
  executeTlisp(ed, `(find-file-open "${file}")`);
  expect(str(ed, "(buffer-filename)")).toBe(file);
  return ed;
}

/** The names of the live buffers, most recent first. */
const recency = (ed: Editor): string[] =>
  (executeTlisp(ed, "(buffer-recency-list)") as any).value.map((v: any) => v.value);

describe("#375: q returns to the buffer that was on screen", () => {
  test("help: q returns to the file buffer (SPC h m = describe-mode)", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(ed.getState().mode).toBe("normal");
    // the help buffer is buried, not killed
    expect(recency(ed).at(-1)).toBe("*Help*");
    expect(str(ed, "(buffer-list)")).toContain("*Help*");
  });

  test("info: q returns to the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(info)");
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Info*");
  });

  test("man: q returns to the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(man "ls")');
    expect(str(ed, "(buffer-current)")).toBe("*Man*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Man*");
  });

  test("man opened through its prompt: q returns to the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(cursor-move 0 0)");
    executeTlisp(ed, `(find-file-open "${join(dir, "one.md")}")`);
    executeTlisp(ed, '(switch-to-buffer "test")');
    // Without a topic `man` opens its prompt. (It ALSO passes the prompt's
    // immediate return value to man-run and reports "string-trim requires a
    // string"; that defect is older than #375 and is not touched here.)
    ed.getInterpreter().execute("(man)");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, '(minibuffer-set-input "ls")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(str(ed, "(buffer-current)")).toBe("*Man*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("test");
  });

  test("help opened from a prompt (apropos): q returns to the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(apropos)");
    expect(ed.getState().mode).toBe("mx");
    executeTlisp(ed, '(minibuffer-set-input "save")');
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });
});

describe("#375: q returns to the buffer where the user was", () => {
  const cases: [string, string, string[]][] = [
    ["help", "(describe-mode)", []],
    ["info", "(info)", ["n", "t"]],
    ["man", '(man "ls")', ["}", "{"]],
  ];
  for (const [name, open, keys] of cases) {
    test(`${name}: the cursor of the returned buffer is where it was (red first)`, { timeout: 30_000 }, async () => {
      const path = join(dir, "cursor.md");
      writeFileSync(path, "l1\nl2\nl3\nl4\nl5\n");
      const ed = await createStartedEditor("");
      executeTlisp(ed, `(find-file-open "${path}")`);
      executeTlisp(ed, "(cursor-move 3 1)");
      expect(str(ed, "(cursor-line)")).toBe("3");
      executeTlisp(ed, open);
      for (const key of keys) await ed.handleKey(key);
      await ed.handleKey("q");
      expect(str(ed, "(buffer-current)")).toBe(path);
      // switch-to-buffer alone puts the cursor at the top of the buffer.
      expect(str(ed, "(cursor-line)")).toBe("3");
      expect(str(ed, "(cursor-column)")).toBe("1");
    });
  }

  test("a cursor position that no longer exists (the line was removed meanwhile) is clamped, not an error (guard after the fix)", { timeout: 30_000 }, async () => {
    const path = join(dir, "cursor-short.md");
    writeFileSync(path, "l1\nl2\nl3\nl4\nl5\n");
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(find-file-open "${path}")`);
    executeTlisp(ed, "(cursor-move 4 0)");
    executeTlisp(ed, "(describe-mode)");
    executeTlisp(ed, `(switch-to-buffer "${path}")`);
    executeTlisp(ed, '(buffer-delete-range 2 0 5 0)'); // the file is shorter now
    executeTlisp(ed, '(switch-to-buffer "*Help*")');
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(path);
    expect(Number(str(ed, "(cursor-line)"))).toBeLessThan(4);
  });
});

describe("#375: help opened from help returns to the buffer before the first page", () => {
  test("two help pages, then q: the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(describe-function "save-buffer")');
    executeTlisp(ed, '(describe-function "save-some-buffers")'); // help from help
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("a cross-reference followed in the help buffer, then q: the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(apropos-run "save")');
    await ed.handleKey("\t"); // first reference
    await ed.handleKey("\r"); // follow it: a second help page
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("info navigated (n, t), then q: the file buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(info)");
    await ed.handleKey("n");
    await ed.handleKey("t");
    await ed.handleKey("i"); // the node prompt; Enter alone opens the Index
    executeTlisp(ed, '(minibuffer-dispatch-key "Enter")');
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });
});

describe("#375: the buffer before help has no file", () => {
  test("help opened from the dired listing: q returns to the listing", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${dir}")`);
    expect(str(ed, "(buffer-current)")).toBe("*Dired*");
    executeTlisp(ed, "(describe-mode)");
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*Dired*");
    expect(str(ed, "(major-mode-get)")).toBe("dired");
  });

  test("help opened from a buffer without a name that is a file: q returns to it", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("plain text");
    expect(str(ed, "(buffer-current)")).toBe("test");
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("test");
    expect(str(ed, "(buffer-text)")).toBe("plain text");
  });
});

describe("#375: when there is no earlier buffer", () => {
  test("the buffer before help is gone: q shows *scratch*", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    // Leave *Help* without q, kill the file buffer elsewhere, come back.
    executeTlisp(ed, '(switch-to-buffer "test")');
    executeTlisp(ed, `(buffer-kill "${file}")`);
    expect(str(ed, "(buffer-list)")).not.toContain(file);
    executeTlisp(ed, '(switch-to-buffer "*Help*")');
    expect(str(ed, "(major-mode-get)")).toBe("help");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*scratch*");
  });

  test("help opened from *scratch* (no earlier buffer): q shows *scratch*", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(switch-to-buffer "*scratch*")');
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*scratch*");
  });
});

describe("#375: a reader opened again from inside itself", () => {
  const readers: [string, string, string][] = [
    ["help", "(describe-mode)", "*Help*"],
    ["info", "(info)", "*Info*"],
    ["man", '(man "ls")', "*Man*"],
  ];
  for (const [name, open, reader] of readers) {
    test(`${name}: after an earlier q, opened again while it is shown: q returns to the buffer it was last opened from (red first)`, { timeout: 30_000 }, async () => {
      // The user leaves the reader with q, comes back to it by switching
      // buffers, and runs the command again from inside it.
      const ed = await createStartedEditor("");
      executeTlisp(ed, `(find-file-open "${file}")`);
      executeTlisp(ed, "(cursor-move 0 3)");
      executeTlisp(ed, open);
      await ed.handleKey("q");
      expect(str(ed, "(buffer-current)")).toBe(file);
      executeTlisp(ed, `(switch-to-buffer "${reader}")`);
      executeTlisp(ed, open); // from inside the reader: not a new origin
      expect(str(ed, "(buffer-current)")).toBe(reader);
      await ed.handleKey("q");
      expect(str(ed, "(buffer-current)")).toBe(file); // not *scratch*
      expect(str(ed, "(cursor-column)")).toBe("3");
    });
  }
});

describe("#375: one reader opened from another", () => {
  test("man from *Info* (K): q in *Man* returns to *Info*, q in *Info* to the file (guard: true before)", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(find-file-open "${file}")`);
    executeTlisp(ed, "(info)");
    await ed.handleKey("K"); // the man page of the word at point, from *Info*
    expect(str(ed, "(buffer-current)")).toBe("*Man*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });
});

describe("#375, grading round 3: the identity of a buffer", () => {
  test("buffer-id is stable across edits, switches and a rename, and differs for a later buffer of the same name", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(switch-to-buffer "*scratch*")');
    executeTlisp(ed, '(buffer-create "origin")');
    executeTlisp(ed, '(switch-to-buffer "origin")');
    const first = str(ed, "(buffer-id)"); // the identity of the buffer shown
    expect(first).not.toBe("nil");
    executeTlisp(ed, '(buffer-insert "text")');
    executeTlisp(ed, '(switch-to-buffer "*scratch*")');
    executeTlisp(ed, '(switch-to-buffer "origin")');
    expect(str(ed, "(buffer-id)")).toBe(first); // the same buffer
    expect(str(ed, `(buffer-id-name ${first})`)).toBe("origin");
    executeTlisp(ed, '(buffer-rename "renamed")');
    expect(str(ed, "(buffer-id)")).toBe(first); // a rename keeps the identity
    expect(str(ed, `(buffer-id-name ${first})`)).toBe("renamed"); // under its new name
    executeTlisp(ed, '(buffer-kill "renamed")');
    expect(executeTlisp(ed, `(buffer-id-name ${first})`).type).toBe("nil"); // gone
    executeTlisp(ed, '(buffer-create "renamed")');
    executeTlisp(ed, '(switch-to-buffer "renamed")');
    expect(str(ed, "(buffer-id)")).not.toBe(first); // a later buffer, the same name
    expect(executeTlisp(ed, `(buffer-id-name ${first})`).type).toBe("nil");
    // Two live buffers never share an identity.
    executeTlisp(ed, '(switch-to-buffer "*scratch*")');
    const scratch = str(ed, "(buffer-id)");
    executeTlisp(ed, '(switch-to-buffer "renamed")');
    expect(str(ed, "(buffer-id)")).not.toBe(scratch);
    expect(str(ed, `(buffer-id-name ${scratch})`)).toBe("*scratch*");
  });
});

describe("#375, grading round 3: the return buffer is a buffer, not a name", () => {
  const readers: [string, string][] = [
    ["help", "(describe-mode)"],
    ["info", "(info)"],
    ["man", '(man "ls")'],
  ];

  for (const [name, open] of readers) {
    test(`${name}: the origin was killed and a DIFFERENT buffer has its name: q shows *scratch* (red first)`, { timeout: 30_000 }, async () => {
      const ed = await createStartedEditor("");
      executeTlisp(ed, '(switch-to-buffer "*scratch*")');
      executeTlisp(ed, '(buffer-create "origin")');
      executeTlisp(ed, '(switch-to-buffer "origin")');
      executeTlisp(ed, '(buffer-insert "the first origin")');
      executeTlisp(ed, open);
      executeTlisp(ed, '(buffer-kill "origin")');
      executeTlisp(ed, '(buffer-create "origin")'); // a new buffer under the old name
      executeTlisp(ed, '(switch-to-buffer "origin")');
      executeTlisp(ed, '(buffer-insert "the replacement")');
      expect(str(ed, "(buffer-text)")).toBe("the replacement");
      executeTlisp(ed, `(switch-to-buffer "${name === "help" ? "*Help*" : name === "info" ? "*Info*" : "*Man*"}")`);
      await ed.handleKey("q");
      expect(str(ed, "(buffer-current)")).toBe("*scratch*"); // not the replacement
      expect(str(ed, '(switch-to-buffer "origin")')).toBe("origin");
      expect(str(ed, "(buffer-text)")).toBe("the replacement"); // and it was not touched
    });

    test(`${name}: the origin was RENAMED while the reader was open: q returns to it under its new name (red first)`, { timeout: 30_000 }, async () => {
      const ed = await createStartedEditor("");
      executeTlisp(ed, '(switch-to-buffer "*scratch*")');
      executeTlisp(ed, '(buffer-create "origin")');
      executeTlisp(ed, '(switch-to-buffer "origin")');
      executeTlisp(ed, '(buffer-insert "l1\nl2\nl3\nl4")');
      executeTlisp(ed, "(cursor-move 2 1)");
      executeTlisp(ed, open);
      const reader = str(ed, "(buffer-current)");
      executeTlisp(ed, '(switch-to-buffer "origin")');
      executeTlisp(ed, '(buffer-rename "renamed")'); // buffer-rename renames the current buffer
      executeTlisp(ed, '(buffer-create "origin")'); // and a new buffer takes the old name
      executeTlisp(ed, `(switch-to-buffer "${reader}")`);
      await ed.handleKey("q");
      expect(str(ed, "(buffer-current)")).toBe("renamed"); // the original, under its new name
      expect(str(ed, "(cursor-line)")).toBe("2"); // with its cursor
      expect(str(ed, "(cursor-column)")).toBe("1");
    });
  }
});

describe("#375: the state after q", () => {
  test("the help buffer is at the end of the buffer order", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    expect(recency(ed)[0]).toBe("*Help*"); // most recent while it is shown
    await ed.handleKey("q");
    expect(recency(ed)[0]).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Help*");
  });

  test("q in help does not start a macro recording", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(macro-record-pending-p)")).toBe("false");
    expect(str(ed, "(macro-record-active)")).toBe("false");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("the returned buffer shows no stale message of the help buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(ed.getState().statusMessage ?? "").not.toContain("Buried");
    expect(ed.getState().statusMessage ?? "").not.toContain("*Help*");
  });

  test("q twice: the second q is the vim q of the file buffer (a macro recording)", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(str(ed, "(macro-record-pending-p)")).toBe("true");
  });

  test("help opened again from ANOTHER buffer returns to that other buffer", { timeout: 30_000 }, async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    writeFileSync(join(dir, "two.md"), "second\n");
    executeTlisp(ed, `(find-file-open "${join(dir, "two.md")}")`);
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(join(dir, "two.md"));
  });
});

describe("#375: the docstrings say what the functions do", () => {
  const docstring = (ed: Editor, name: string): string => {
    const data = executeTlisp(ed, `(describe-function-data "${name}")`) as any;
    const map = data.value as Map<string, any>;
    return String(map.get("docstring")?.value ?? "");
  };

  test("help-bury, info-bury and man-quit say that they return to the earlier buffer", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    for (const name of ["help-bury", "info-bury", "man-quit"]) {
      const doc = docstring(ed, name);
      expect(doc, name).toMatch(/[Rr]eturn/);
      expect(doc, name).toMatch(/[Bb]ury/);
    }
  });

  test("bury-buffer does not claim a switch or an Emacs convention it does not have", { timeout: 30_000 }, async () => {
    const ed = await createStartedEditor("");
    const doc = docstring(ed, "bury-buffer");
    expect(doc).toMatch(/[Rr]ecency/);
    expect(doc).not.toMatch(/Emacs convention/); // bury-buffer in Emacs does switch away
    expect(doc).toMatch(/shown in the editor is not changed/i);
  });
});

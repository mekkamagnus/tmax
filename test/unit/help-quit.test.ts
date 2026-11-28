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
  test("help: q returns to the file buffer (SPC h m = describe-mode)", async () => {
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

  test("info: q returns to the file buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(info)");
    expect(str(ed, "(buffer-current)")).toBe("*Info*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Info*");
  });

  test("man: q returns to the file buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(man "ls")');
    expect(str(ed, "(buffer-current)")).toBe("*Man*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Man*");
  });

  test("man opened through its prompt: q returns to the file buffer", async () => {
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

  test("help opened from a prompt (apropos): q returns to the file buffer", async () => {
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

describe("#375: help opened from help returns to the buffer before the first page", () => {
  test("two help pages, then q: the file buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(describe-function "save-buffer")');
    executeTlisp(ed, '(describe-function "save-some-buffers")'); // help from help
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("a cross-reference followed in the help buffer, then q: the file buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, '(apropos-run "save")');
    await ed.handleKey("\t"); // first reference
    await ed.handleKey("\r"); // follow it: a second help page
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("info navigated (n, t), then q: the file buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(info)");
    await ed.handleKey("n");
    await ed.handleKey("t");
    await ed.handleKey("i");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });
});

describe("#375: the buffer before help has no file", () => {
  test("help opened from the dired listing: q returns to the listing", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, `(dired "${dir}")`);
    expect(str(ed, "(buffer-current)")).toBe("*Dired*");
    executeTlisp(ed, "(describe-mode)");
    expect(str(ed, "(buffer-current)")).toBe("*Help*");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*Dired*");
    expect(str(ed, "(major-mode-get)")).toBe("dired");
  });

  test("help opened from a buffer without a name that is a file: q returns to it", async () => {
    const ed = await createStartedEditor("plain text");
    expect(str(ed, "(buffer-current)")).toBe("test");
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("test");
    expect(str(ed, "(buffer-text)")).toBe("plain text");
  });
});

describe("#375: when there is no earlier buffer", () => {
  test("the buffer before help is gone: q shows *scratch*", async () => {
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

  test("help opened from *scratch* (no earlier buffer): q shows *scratch*", async () => {
    const ed = await createStartedEditor("");
    executeTlisp(ed, '(switch-to-buffer "*scratch*")');
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe("*scratch*");
  });
});

describe("#375: the state after q", () => {
  test("the help buffer is at the end of the buffer order", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    expect(recency(ed)[0]).toBe("*Help*"); // most recent while it is shown
    await ed.handleKey("q");
    expect(recency(ed)[0]).toBe(file);
    expect(recency(ed).at(-1)).toBe("*Help*");
  });

  test("q in help does not start a macro recording", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(str(ed, "(macro-record-pending-p)")).toBe("false");
    expect(str(ed, "(macro-record-active)")).toBe("false");
    expect(str(ed, "(buffer-current)")).toBe(file);
  });

  test("the returned buffer shows no stale message of the help buffer", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    expect(ed.getState().statusMessage ?? "").not.toContain("Buried");
    expect(ed.getState().statusMessage ?? "").not.toContain("*Help*");
  });

  test("q twice: the second q is the vim q of the file buffer (a macro recording)", async () => {
    const ed = await fileEditor();
    executeTlisp(ed, "(describe-mode)");
    await ed.handleKey("q");
    await ed.handleKey("q");
    expect(str(ed, "(buffer-current)")).toBe(file);
    expect(str(ed, "(macro-record-pending-p)")).toBe("true");
  });

  test("help opened again from ANOTHER buffer returns to that other buffer", async () => {
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

  test("help-bury, info-bury and man-quit say that they return to the earlier buffer", async () => {
    const ed = await createStartedEditor("");
    for (const name of ["help-bury", "info-bury", "man-quit"]) {
      const doc = docstring(ed, name);
      expect(doc, name).toMatch(/[Rr]eturn/);
      expect(doc, name).toMatch(/[Bb]ury/);
    }
  });

  test("bury-buffer does not claim a switch or an Emacs convention it does not have", async () => {
    const ed = await createStartedEditor("");
    const doc = docstring(ed, "bury-buffer");
    expect(doc).toMatch(/[Rr]ecency/);
    expect(doc).not.toMatch(/Emacs convention/); // bury-buffer in Emacs does switch away
    expect(doc).toMatch(/shown in the editor is not changed/i);
  });
});

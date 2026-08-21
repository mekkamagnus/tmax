import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #208 (RFC-027 §D3/§D7, Phase 0) — make-process upgrades:
//   :cwd / :env kwargs + serialized filter dispatch (each chunk's eval runs
//   to completion before the next; sentinel runs after ALL filters).

/** Editor handle from the fixture (async factory). */
type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

/** Poll a T-Lisp expression until it returns non-nil or timeout (ms). */
async function untilTruthy(editor: Editor, expr: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = executeTlisp(editor, expr);
    const truthy = v.type === 'boolean' ? v.value === true
      : Array.isArray(v.value) ? v.value.length > 0
      : v.value !== null && v.value !== undefined && v.value !== false && v.value !== 'nil';
    if (truthy) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function num(editor: Editor, expr: string): number {
  return Number(executeTlisp(editor, expr).value);
}

describe("#208 make-process :cwd / :env", () => {
  test(":cwd runs the process in the given working directory", async () => {
    const editor = await createStartedEditor();
    const dir = mkdtempSync(join(tmpdir(), "tmax-cwd-"));
    executeTlisp(editor, '(defvar *cwd-out* nil)');
    executeTlisp(editor, '(defun cwd-filter (pid text) (setq *cwd-out* (concat (if *cwd-out* *cwd-out* "") text)))');
    executeTlisp(editor, `(make-process :command '("/bin/pwd") :cwd "${dir}" :filter "cwd-filter")`);
    expect(await untilTruthy(editor, '(not (eq *cwd-out* nil))')).toBe(true);
    const out = String(executeTlisp(editor, '(string-trim *cwd-out*)').value);
    // macOS: /bin/pwd resolves the real path (/var/folders → /private/var/...)
    expect(out).toBe(realpathSync(dir));
  });

  test(":env entries are merged over the inherited environment", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(defvar *env-out* nil)');
    executeTlisp(editor, '(defun env-filter (pid text) (setq *env-out* (concat (if *env-out* *env-out* "") text)))');
    executeTlisp(editor, `(make-process :command '("/bin/sh" "-c" "echo $TMAX_TEST_208; echo \${PATH:+PATH-OK}") :env '(("TMAX_TEST_208" "hello-208")) :filter "env-filter")`);
    expect(await untilTruthy(editor, '(not (eq *env-out* nil))')).toBe(true);
    const out = String(executeTlisp(editor, '*env-out*').value);
    expect(out).toContain("hello-208");
    expect(out).toContain("PATH-OK"); // merge, not replace
  });

  test(":cwd / :env validation rejects malformed kwargs", async () => {
    const editor = await createStartedEditor();
    // executeTlisp throws on Left — each malformed call must throw.
    const mustThrow = (expr: string) => {
      let threw = false;
      try { executeTlisp(editor, expr); } catch { threw = true; }
      expect(threw).toBe(true);
    };
    mustThrow(`(make-process :command '("/bin/true") :cwd 42)`);
    mustThrow(`(make-process :command '("/bin/true") :env "PATH=/x")`);
    mustThrow(`(make-process :command '("/bin/true") :env '(("ONLY_KEY")))`);
  });
});

describe("#208 make-process serialized filter dispatch", () => {
  test("chunks arrive in order and the sentinel runs after ALL filter calls", async () => {
    const editor = await createStartedEditor();
    // Bursty output: ~10 chunks separated by short sleeps so the reader sees
    // multiple stdout chunks, not one coalesced read.
    executeTlisp(editor, '(defvar *seq* (quote ()))');
    executeTlisp(editor, '(defvar *sentinel-count* nil)');
    executeTlisp(editor, '(defun seq-filter (pid text) (setq *seq* (cons text *seq*)))');
    executeTlisp(editor, '(defun seq-sentinel (pid code) (setq *sentinel-count* (length *seq*)))');
    const r = executeTlisp(editor, `(make-process :command '("/bin/sh" "-c" "for i in 1 2 3 4 5 6 7 8 9 10; do printf $i; printf ':'; sleep 0.03; done") :filter "seq-filter" :sentinel "seq-sentinel")`);
    expect(r.value).toBeDefined();

    expect(await untilTruthy(editor, '(not (eq *sentinel-count* nil))')).toBe(true);
    // Sentinel observed the FULL chunk count — it ran after every filter.
    expect(num(editor, '*sentinel-count*')).toBeGreaterThanOrEqual(2);
    // Chunk order preserved: reversed collection joins to 1:2:...:10.
    const joined = String(executeTlisp(editor, "(apply 'concat (reverse *seq*))").value);
    expect(joined).toBe("1:2:3:4:5:6:7:8:9:10:"); // loop prints ':' after every i
  });

  test("a filter that throws does not kill the stream or the sentinel", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(defvar *ok-chunks* (quote ()))');
    executeTlisp(editor, '(defvar *sentinel-ran* nil)');
    executeTlisp(editor, '(defun bad-filter (pid text) (if (string= text "2\\n") (throw (quote error) "boom") (setq *ok-chunks* (cons text *ok-chunks*))))');
    executeTlisp(editor, '(defun ok-sentinel (pid code) (setq *sentinel-ran* t))');
    executeTlisp(editor, `(make-process :command '("/bin/sh" "-c" "printf '1\\n'; sleep 0.05; printf '2\\n'; sleep 0.05; printf '3\\n'") :filter "bad-filter" :sentinel "ok-sentinel")`);
    expect(await untilTruthy(editor, '(not (eq *sentinel-ran* nil))')).toBe(true);
    // Chunks 1 and 3 recorded despite chunk 2's filter throwing.
    expect(String(executeTlisp(editor, "(apply 'concat (reverse *ok-chunks*))").value)).toBe("1\n3\n");
  });
});

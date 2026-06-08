import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createStartedEditor, expectRight } from "../helpers/editor-fixture.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmax-tlisp-async-"));
  tempRoots.push(dir);
  return dir;
}

function escapePath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function executeEditorAsync(source: string) {
  const editor = await createStartedEditor();
  const result = await editor.getInterpreter().executeAsync!(source);
  return expectRight(result, `T-Lisp failed: ${source}`);
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("T-Lisp async primitives", () => {
  test("async-let awaits body I/O", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "body.txt");
    fs.writeFileSync(file, "abcdef", "utf-8");

    const value = await executeEditorAsync(`
      (async-let ()
        (read-file-content "${escapePath(file)}"))
    `);

    expect(value).toEqual({ type: "string", value: "abcdef" });
  });

  test("async-let propagates async context through indirect function calls", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "indirect.txt");
    fs.writeFileSync(file, "indirect", "utf-8");

    const value = await executeEditorAsync(`
      (progn
        (defun load-file-for-test (path)
          (read-file-content path))
        (async-let ((content (load-file-for-test "${escapePath(file)}")))
          content))
    `);

    expect(value).toEqual({ type: "string", value: "indirect" });
  });

  test("read-file-content remains synchronous outside async-let", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "sync.txt");
    fs.writeFileSync(file, "sync", "utf-8");

    const editor = await createStartedEditor();
    const value = expectRight(
      editor.getInterpreter().execute(`(read-file-content "${escapePath(file)}")`)
    );

    expect(value).toEqual({ type: "string", value: "sync" });
  });

  test("write-file-content can be awaited inside async-let", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "write.txt");

    const value = await executeEditorAsync(`
      (async-let ((_ (write-file-content "${escapePath(file)}" "written")))
        (read-file-content "${escapePath(file)}"))
    `);

    expect(value).toEqual({ type: "string", value: "written" });
  });

  test("promise-value errors in sync evaluation", () => {
    const interpreter = new TLispInterpreterImpl();
    const result = interpreter.execute("(promise-value nil)");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("promise-value requires async evaluation");
    }
  });

  test("promise-value also requires async-let under executeAsync", async () => {
    const interpreter = new TLispInterpreterImpl();
    const result = await interpreter.executeAsync!("(promise-value nil)");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("promise-value requires async evaluation");
    }
  });
});

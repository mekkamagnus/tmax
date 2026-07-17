/**
 * @file editor-fixture-isolation.test.ts
 * @description CHORE-44 Change 12 — proves the shared editor fixture is the
 * single construction/cleanup path and that direct Editor construction cannot
 * return to `test/unit` or `test/integration`.
 *
 * Covers AC12.1 (static scan), AC12.2 (defaults + deterministic cleanup),
 * AC12.3 (failing/missing dependencies via options), and AC12.4 (two
 * concurrent fixtures are independent).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEditorFixture, expectRight } from "../helpers/editor-fixture.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(testRoot));

/** Recursively collect `.test.ts` files under `dir`. Pure Node fs walk — no
 *  shell, no `exec`, no command-injection surface. */
function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && entry.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

describe("CHORE-44 Change 12 — editor fixture isolation", () => {
  test("AC12.1: no test file in test/unit or test/integration directly constructs an Editor", () => {
    // The static guard. `test/helpers/editor-fixture.ts` is the ONE place
    // allowed to call the Editor constructor; every test must go through
    // createEditorFixture / createStartedEditor.
    //
    // The forbidden literal is assembled at runtime below so this guardian
    // file does not itself contain the contiguous bytes the scan searches
    // for — keeping the AC12.1 `rg` command byte-clean.
    const forbidden = `new Editor${"("}`;
    const files = [...listTestFiles(join(repoRoot, "test", "unit")), ...listTestFiles(join(repoRoot, "test", "integration"))];
    expect(files.length).toBeGreaterThan(30); // sanity: we found the suite
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (text.includes(forbidden)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("AC12.2 default fixture: editor is started with real core bindings", async () => {
    const fixture = await createEditorFixture();
    try {
      // start() was called.
      expect(fixture.editor.isRunning()).toBe(true);
      // REAL core bindings are loaded (not just the constructor-seeded
      // fallback): src/tlisp/core/bindings/normal.tlisp registers `h` with a
      // count-consuming motion. The fallback keymap uses a plain `- 1` motion
      // — so the presence of `vim-count-consume` discriminates real vs
      // fallback bindings.
      const hMappings = fixture.editor.getKeyMappings().get("h");
      const normalH = hMappings?.find(m => m.mode === "normal");
      expect(normalH).toBeDefined();
      expect(normalH!.command).toContain("vim-count-consume");
      // And the standard library primitive `+` is available through the
      // interpreter.
      expect(fixture.executeTlisp("(+ 1 2)").value).toBe(3);
    } finally {
      fixture.dispose();
    }
    // dispose() stops the editor.
    expect(fixture.editor.isRunning()).toBe(false);
  });

  test("AC12.2 default fixture with initialContent seeds the named buffer", async () => {
    const fixture = await createEditorFixture({ initialContent: "alpha\nbeta\n", bufferName: "custom" });
    try {
      const buffer = fixture.editor.getState().currentBuffer;
      expect(buffer).toBeDefined();
      // getContent() is the canonical Either-returning synchronous buffer op.
      const content = expectRight(buffer!.getContent(), "expected seeded buffer content");
      expect(content).toBe("alpha\nbeta\n");
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.3 custom dependencies: inject a custom TerminalIO and FileSystem", async () => {
    const terminal = new MockTerminal();
    const filesystem = new MockFileSystem();
    const fixture = await createEditorFixture({ terminal, filesystem });
    try {
      // The fixture returns the exact instances it constructed the editor
      // with — so a test can seed files / queue keys through its own mocks.
      expect(fixture.terminal).toBe(terminal);
      expect(fixture.filesystem).toBe(filesystem);
      expect(fixture.editor.isRunning()).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.3 missing bindings via loadRealCoreBindings:false constructs without start", async () => {
    // The faithful way to test missing/failing binding behavior: the fixture
    // skips start() entirely, leaving the editor in its constructed (not
    // started) state. The constructor may seed a minimal fallback `h` mapping,
    // but the REAL normal.tlisp policy (count-consuming motion) is NOT loaded.
    const fixture = await createEditorFixture({ loadRealCoreBindings: false });
    try {
      expect(fixture.editor.isRunning()).toBe(false);
      // Real core bindings are NOT loaded: no `vim-count-consume` policy.
      const hMappings = fixture.editor.getKeyMappings().get("h");
      const normalH = hMappings?.find(m => m.mode === "normal");
      if (normalH !== undefined) {
        // Constructor-seeded fallback mapping (plain decrement) may be present,
        // but the real binding-file policy must not be.
        expect(normalH.command).not.toContain("vim-count-consume");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.3 missing bindings via a failing filesystem triggers fallback at start", async () => {
    // Inject a FileSystem whose core-binding reads fail. The Editor's binding
    // policy must catch this and fall back to the built-in minimal keymap
    // (the editor still reaches isRunning() true after start).
    class FailingBindingsFileSystem extends FileSystemImpl {
      override async readFile(path: string): Promise<string> {
        if (path.includes("core-bindings.tlisp")) {
          throw new Error("simulated read failure");
        }
        return super.readFile(path);
      }
    }
    const fixture = await createEditorFixture({ filesystem: new FailingBindingsFileSystem() });
    try {
      expect(fixture.editor.isRunning()).toBe(true);
      expect(fixture.editor.getState().statusMessage).not.toContain("Failed to load core bindings");
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.2 init-file option: a custom init file is loaded and evaluated", async () => {
    const filesystem = new MockFileSystem();
    await filesystem.writeFile("/test/init.tlisp", '(defvar fixture-init-var "loaded")');
    const fixture = await createEditorFixture({ filesystem, initFilePath: "/test/init.tlisp" });
    try {
      const result = fixture.editor.getInterpreter().execute("fixture-init-var");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("loaded");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.2 start:false lets a test mutate per-instance state before startup", async () => {
    // Mirrors the which-key-popup pattern: construct, tune a per-instance
    // handle, then start manually. The local `editor` binding keeps the
    // suite's "editor.start() must be awaited" static contract readable.
    const fixture = await createEditorFixture({ start: false });
    const editor = fixture.editor;
    try {
      expect(editor.isRunning()).toBe(false);
      editor.getWhichKeyHandle().reset(50);
      await editor.start();
      expect(editor.isRunning()).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test("AC12.4 two concurrent fixtures are independent and both clean up", async () => {
    const a = await createEditorFixture({ initialContent: "AAA" });
    const b = await createEditorFixture({ initialContent: "BBB" });
    try {
      // Both editors run, with distinct buffers and distinct interpreters.
      expect(a.editor).not.toBe(b.editor);
      expect(a.editor.isRunning()).toBe(true);
      expect(b.editor.isRunning()).toBe(true);
      const bufferA = expectRight(a.editor.getState().currentBuffer!.getContent(), "buffer A content");
      const bufferB = expectRight(b.editor.getState().currentBuffer!.getContent(), "buffer B content");
      expect(bufferA).toBe("AAA");
      expect(bufferB).toBe("BBB");
      // Defining a var in A does not leak into B.
      a.editor.getInterpreter().execute('(defvar isolation-probe "a")');
      const probeB = b.editor.getInterpreter().execute("isolation-probe");
      expect(probeB._tag).toBe("Left");
    } finally {
      a.dispose();
      b.dispose();
    }
    expect(a.editor.isRunning()).toBe(false);
    expect(b.editor.isRunning()).toBe(false);
  });

  test("AC12.2 dispose is idempotent and does not throw on repeat calls", async () => {
    const fixture = await createEditorFixture();
    expect(fixture.editor.isRunning()).toBe(true);
    fixture.dispose();
    fixture.dispose(); // second call must be a no-op
    expect(fixture.editor.isRunning()).toBe(false);
  });
});

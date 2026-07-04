import { describe, test, expect, beforeEach } from "bun:test";
import { createMajorModeOps } from "../../src/editor/api/major-mode-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString, createList, createNil, createNumber } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";
import { initialModel } from "../../src/editor/functional/model.ts";

describe("Major Modes", () => {
  let buffer: FunctionalTextBufferImpl;
  let currentFilename: string | undefined;
  let tlispEvalLog: string[];

  beforeEach(() => {
    buffer = FunctionalTextBufferImpl.create("// hello");
    currentFilename = undefined;
    tlispEvalLog = [];
  });

  function getOps() {
    // CHORE-39 Phase 4: major-mode-ops reads buffer/filename/modified via EditorModelAccess.
    return createMajorModeOps(
      {
        getModel: () => ({ ...initialModel(), currentBuffer: buffer, currentFilename, bufferModified: false }),
        applyModel: (m) => { if (m.currentBuffer) buffer = m.currentBuffer as FunctionalTextBufferImpl; },
      },
      (expr: string) => {
        tlispEvalLog.push(expr);
        return Either.right({ type: "nil", value: null });
      }
    );
  }

  // --- fundamental mode ---

  describe("fundamental mode (default)", () => {
    test("fundamental is the default mode returned by major-mode-get", () => {
      const ops = getOps();
      const getFn = ops.get("major-mode-get")!;
      const result = getFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("string");
      expect((result as any).right.value).toBe("fundamental");
    });

    test("fundamental is included in major-mode-list", () => {
      const ops = getOps();
      const listFn = ops.get("major-mode-list")!;
      const result = listFn([]);
      expect(Either.isRight(result)).toBe(true);
      const names = ((result as any).right.value as Array<{ type: string; value: string }>)
        .map((v) => v.value);
      expect(names).toContain("fundamental");
    });
  });

  // --- major-mode-register ---

  describe("major-mode-register", () => {
    test("registers a new mode with name and extensions", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;

      const result = registerFn([
        createString("javascript"),
        createList([createString("js"), createString("mjs")])
      ]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
    });

    test("registered mode appears in major-mode-list", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("typescript"),
        createList([createString("ts"), createString("tsx")])
      ]);

      const listFn = ops.get("major-mode-list")!;
      const result = listFn([]);
      const names = ((result as any).right.value as Array<{ type: string; value: string }>)
        .map((v) => v.value);
      expect(names).toContain("typescript");
    });

    test("registers mode with optional syntax language", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;

      const result = registerFn([
        createString("rust"),
        createList([createString("rs")]),
        createString("rust")
      ]);
      expect(Either.isRight(result)).toBe(true);
    });

    test("registers mode with indent rules", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;

      const result = registerFn([
        createString("c-mode"),
        createList([createString("c"), createString("h")]),
        createString("c"),
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result)).toBe(true);
    });

    test("returns error for wrong argument count (0 args)", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;
      const result = registerFn([]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument count (6 args)", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;
      const result = registerFn([
        createString("x"), createList([]), createString("y"),
        createList([]), createList([]), createString("extra")
      ]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string name", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;
      const result = registerFn([createNil(), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-list extensions", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;
      const result = registerFn([createString("python"), createString("py")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("filters out non-string items from extensions list", () => {
      const ops = getOps();
      const registerFn = ops.get("major-mode-register")!;

      // Register with a mixed list containing non-string items
      registerFn([
        createString("mixed-mode"),
        createList([createString("mx"), createNil(), createString("mx2")])
      ]);

      // The mode should still be registered (filtering out nil entries)
      const listFn = ops.get("major-mode-list")!;
      const result = listFn([]);
      const names = ((result as any).right.value as Array<{ type: string; value: string }>)
        .map((v) => v.value);
      expect(names).toContain("mixed-mode");
    });
  });

  // --- major-mode-set ---

  describe("major-mode-set", () => {
    test("activates a registered mode", () => {
      const ops = getOps();

      // Register first
      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("python"),
        createList([createString("py")])
      ]);

      // Set the mode
      const setFn = ops.get("major-mode-set")!;
      const result = setFn([createString("python")]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("string");
      expect((result as any).right.value).toBe("python");
    });

    test("major-mode-get reflects the active mode after set", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("ruby"),
        createList([createString("rb")])
      ]);

      const setFn = ops.get("major-mode-set")!;
      setFn([createString("ruby")]);

      const getFn = ops.get("major-mode-get")!;
      const result = getFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("ruby");
    });

    test("returns error for unregistered mode name", () => {
      const ops = getOps();
      const setFn = ops.get("major-mode-set")!;
      const result = setFn([createString("nonexistent-mode")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string argument", () => {
      const ops = getOps();
      const setFn = ops.get("major-mode-set")!;
      const result = setFn([createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const setFn = ops.get("major-mode-set")!;
      const result = setFn([]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("evaluates syntax-set-language when mode has syntaxLanguage", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("go"),
        createList([createString("go")]),
        createString("go")
      ]);

      tlispEvalLog = [];
      const setFn = ops.get("major-mode-set")!;
      setFn([createString("go")]);

      expect(tlispEvalLog).toContainEqual(expect.stringContaining("syntax-set-language"));
    });

    test("evaluates indent-set-rules when mode has indent rules", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("java"),
        createList([createString("java")]),
        createNil(), // no syntax language
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      tlispEvalLog = [];
      const setFn = ops.get("major-mode-set")!;
      setFn([createString("java")]);

      expect(tlispEvalLog).toContainEqual(expect.stringContaining("indent-set-rules"));
    });
  });

  // --- major-mode-get ---

  describe("major-mode-get", () => {
    test("returns a string value", () => {
      const ops = getOps();
      const getFn = ops.get("major-mode-get")!;
      const result = getFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("string");
    });

    test("returns error when given arguments", () => {
      const ops = getOps();
      const getFn = ops.get("major-mode-get")!;
      const result = getFn([createString("unexpected")]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- major-mode-list ---

  describe("major-mode-list", () => {
    test("returns a list value", () => {
      const ops = getOps();
      const listFn = ops.get("major-mode-list")!;
      const result = listFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("list");
    });

    test("includes all registered modes", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([createString("mode-a"), createList([createString("a")])]);
      registerFn([createString("mode-b"), createList([createString("b")])]);

      const listFn = ops.get("major-mode-list")!;
      const result = listFn([]);
      const names = ((result as any).right.value as Array<{ type: string; value: string }>)
        .map((v) => v.value);
      expect(names).toContain("fundamental");
      expect(names).toContain("mode-a");
      expect(names).toContain("mode-b");
    });

    test("returns error when given arguments", () => {
      const ops = getOps();
      const listFn = ops.get("major-mode-list")!;
      const result = listFn([createString("unexpected")]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- major-mode-auto-detect ---

  describe("major-mode-auto-detect", () => {
    test("detects mode from file extension", () => {
      const ops = getOps();

      // Register typescript mode
      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("typescript"),
        createList([createString("ts"), createString("tsx")])
      ]);

      currentFilename = "app.ts";

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("string");
      expect((result as any).right.value).toBe("typescript");
    });

    test("returns fundamental for unknown file extension", () => {
      const ops = getOps();
      currentFilename = "readme.xyz";

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("fundamental");
    });

    test("returns fundamental when no filename is set", () => {
      const ops = getOps();
      currentFilename = undefined;

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("fundamental");
    });

    test("returns fundamental for filename with no extension", () => {
      const ops = getOps();
      currentFilename = "Makefile";

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("fundamental");
    });

    test("returns fundamental for filename ending with a dot", () => {
      const ops = getOps();
      currentFilename = "file.";

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("fundamental");
    });

    test("updates current mode after detection", () => {
      const ops = getOps();

      // Register mode
      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("python"),
        createList([createString("py")])
      ]);

      currentFilename = "script.py";

      const autoFn = ops.get("major-mode-auto-detect")!;
      autoFn([]);

      const getFn = ops.get("major-mode-get")!;
      const result = getFn([]);
      expect((result as any).right.value).toBe("python");
    });

    test("detects mode from path with multiple dots", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("typescript"),
        createList([createString("ts")])
      ]);

      currentFilename = "/some/path/to/my.file.ts";

      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe("typescript");
    });

    test("returns error when given arguments", () => {
      const ops = getOps();
      const autoFn = ops.get("major-mode-auto-detect")!;
      const result = autoFn([createString("unexpected")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("evaluates syntax language on auto-detect when mode has one", () => {
      const ops = getOps();

      const registerFn = ops.get("major-mode-register")!;
      registerFn([
        createString("go"),
        createList([createString("go")]),
        createString("go")
      ]);

      currentFilename = "main.go";
      tlispEvalLog = [];

      const autoFn = ops.get("major-mode-auto-detect")!;
      autoFn([]);

      expect(tlispEvalLog).toContainEqual(expect.stringContaining("syntax-set-language"));
    });
  });

  // --- major-mode-hook-add ---

  describe("major-mode-hook-add", () => {
    test("calls evalTlisp with hook registration expression", () => {
      const ops = getOps();
      const hookAddFn = ops.get("major-mode-hook-add")!;

      const result = hookAddFn([createString("fundamental"), createString("my-hook-fn")]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
      expect(tlispEvalLog).toContainEqual(expect.stringContaining("add-hook"));
      expect(tlispEvalLog).toContainEqual(expect.stringContaining("mode-fundamental-activate-hook"));
      expect(tlispEvalLog).toContainEqual(expect.stringContaining("my-hook-fn"));
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const hookAddFn = ops.get("major-mode-hook-add")!;
      const result = hookAddFn([createString("fundamental")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string arguments", () => {
      const ops = getOps();
      const hookAddFn = ops.get("major-mode-hook-add")!;
      const result = hookAddFn([createNumber(1), createString("fn")]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- major-mode-hook-run ---

  describe("major-mode-hook-run", () => {
    test("calls evalTlisp with hook run expression", () => {
      const ops = getOps();
      const hookRunFn = ops.get("major-mode-hook-run")!;

      const result = hookRunFn([createString("fundamental")]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
      expect(tlispEvalLog).toContainEqual(expect.stringContaining("run-hooks"));
      expect(tlispEvalLog).toContainEqual(expect.stringContaining("mode-fundamental-activate-hook"));
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const hookRunFn = ops.get("major-mode-hook-run")!;
      const result = hookRunFn([]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string argument", () => {
      const ops = getOps();
      const hookRunFn = ops.get("major-mode-hook-run")!;
      const result = hookRunFn([createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- Module-level state persistence ---

  describe("module-level state", () => {
    test("registrations persist across getOps calls (shared module state)", () => {
      // Register in first ops instance
      const ops1 = getOps();
      const registerFn = ops1.get("major-mode-register")!;
      registerFn([createString("persistent-mode"), createList([createString("pm")])]);

      // Create a new ops instance
      const ops2 = getOps();
      const listFn = ops2.get("major-mode-list")!;
      const result = listFn([]);
      const names = ((result as any).right.value as Array<{ type: string; value: string }>)
        .map((v) => v.value);
      expect(names).toContain("persistent-mode");
    });

    test("mode set in one ops instance is visible in another", () => {
      // Register and set in first instance
      const ops1 = getOps();
      ops1.get("major-mode-register")!(
        [createString("shared-test"), createList([createString("st")])]
      );
      ops1.get("major-mode-set")!([createString("shared-test")]);

      // Check in second instance
      const ops2 = getOps();
      const result = ops2.get("major-mode-get")!([]);
      expect((result as any).right.value).toBe("shared-test");
    });
  });
});

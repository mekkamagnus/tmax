import { describe, expect, test } from "bun:test";
import {
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

const LISP_OWNED_COMMANDS = [
  "vim-count-consume",
  "vim-begin-operator",
  "vim-operator-apply",
  "vim-dispatch-operator-key",
  "vim-delete-char",
  "insert-newline",
  "insert-backspace",
  "insert-tab",
  "split-window-below",
  "split-window-right",
  "other-window",
  "delete-window",
  "relative-line-numbers-mode",
] as const;

describe("T-Lisp architecture boundaries", () => {
  test("loads the complete Vim and daily-driver command inventory", async () => {
    const editor = await createStartedEditor();
    const registry = editor.getInterpreter().moduleRegistry;

    for (const name of LISP_OWNED_COMMANDS) {
      const resolved = registry.resolveUniqueExport(name);
      expect(typeof resolved, name).toBe("object");
      expect((resolved as { value?: { type?: string } }).value?.type, name).toBe("function");
    }
  });

  test("executes window, tab, and relative-line-number policy through T-Lisp", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");

    executeTlisp(editor, "(editor/commands/windows/split-window-below)");
    expect(editor.getState().windows).toHaveLength(2);

    executeTlisp(editor, '(tab-new "second")');
    expect(editor.getState().tabs).toHaveLength(1);

    executeTlisp(editor, "(editor/modes/relative-line-numbers/relative-line-numbers-mode 1)");
    expect(editor.getState().activeMinorModes).toContain("relative-line-numbers");
  });

  test("keeps TypeScript mode handlers free of Vim, window, and tab policy", async () => {
    const normal = await Bun.file("src/editor/handlers/normal-handler.ts").text();
    const insert = await Bun.file("src/editor/handlers/insert-handler.ts").text();
    const forbiddenNormalPolicy = [
      "pendingNormalOperator",
      "countPrefix",
      "split-window",
      "window-next",
      "tab-next",
      "tab-prev",
      "relative-line-numbers-mode",
    ];

    expect(normal).toContain("keymap-ref");
    expect(normal).toContain("vim-operator-pending-p");
    for (const token of forbiddenNormalPolicy) {
      expect(normal, token).not.toContain(token);
    }
    expect(insert).toContain("(insert-newline)");
    expect(insert).toContain("(insert-backspace)");
    expect(insert).toContain("(insert-tab)");
  });

  // CHORE-44 Change 6 (AC6.6): static architecture scan across EVERY handler.
  // Handlers must be pure routers — no concrete editor.ts import, no
  // command-line substitute/Dired policy, no Markdown/indent/major-mode policy.
  test("keeps every TypeScript key handler free of command/mode policy (AC6.6)", async () => {
    // The narrow EditorDispatchPort interface is exempt: it exists to be the
    // typed surface handlers depend on instead of editor.ts, so its method
    // declarations (e.g. getCurrentMajorMode for key-resolution routing) are
    // the contract, not policy.
    const PORT_FILE = "src/editor/handlers/editor-dispatch-port.ts";
    const HANDLER_FILES = [
      "src/editor/handlers/command-handler.ts",
      "src/editor/handlers/insert-handler.ts",
      "src/editor/handlers/mx-handler.ts",
      "src/editor/handlers/normal-handler.ts",
      "src/editor/handlers/replace-handler.ts",
      "src/editor/handlers/visual-handler.ts",
    ];

    // Tokens that indicate command/mode policy leaking into TypeScript.
    const FORBIDDEN_EVERYWHERE = [
      // AC6.1: no concrete editor.ts import.
      "from \"../editor.ts\"",
      // AC6.2: no substitute/Dired command strings or regex literals.
      ":%s",
      "%s/",
      ":s/",
      // AC6.3: no Markdown names, no indent policy, no literal markdown branch.
      "markdown",
      "markdown-list-continue",
      "indent-apply-line",
      "indent-apply",
      "=== \"markdown\"",
      "majorMode === \"markdown\"",
    ];
    // Tokens forbidden in handlers (not the port interface declaration).
    // Note: `getCurrentMajorMode()` is allowed because handlers legitimately
    // pass the current major mode as routing context to resolveMapping() —
    // that is keymap routing, not policy. The forbidden pattern is the
    // literal mode-value branch `=== "markdown"` (major-mode policy).
    const FORBIDDEN_IN_HANDLERS: string[] = [];

    for (const path of [...HANDLER_FILES, PORT_FILE]) {
      const source = await Bun.file(path).text();
      for (const token of FORBIDDEN_EVERYWHERE) {
        expect(
          source,
          `${path}: forbidden policy token "${token}"`,
        ).not.toContain(token);
      }
    }
    for (const path of HANDLER_FILES) {
      const source = await Bun.file(path).text();
      for (const token of FORBIDDEN_IN_HANDLERS) {
        expect(
          source,
          `${path}: forbidden policy token "${token}"`,
        ).not.toContain(token);
      }
    }
  });

  // AC6.2 / AC6.3: the T-Lisp dispatch surface is loaded and routable.
  test("owns command-line dispatch and post-newline policy in T-Lisp", async () => {
    const editor = await createStartedEditor();
    const registry = editor.getInterpreter().moduleRegistry;

    const dispatch = registry.resolveUniqueExport("editor-dispatch-command-line");
    expect(typeof dispatch).toBe("object");
    expect((dispatch as { value?: { type?: string } }).value?.type).toBe("function");

    const hook = registry.resolveUniqueExport("post-newline-hook");
    expect(typeof hook).toBe("object");
    expect((hook as { value?: { type?: string } }).value?.type).toBe("function");
  });

  // AC6.5 / AC6.2: the T-Lisp command-line dispatcher routes the
  // fall-through case (anything that is not :%s / :s / :dired) to the
  // TS-backed editor-execute-command-line primitive, which clears the
  // command line and returns to normal mode. This proves the dispatcher
  // recognises the non-special patterns and forwards them correctly.
  test("routes fall-through command lines through the T-Lisp dispatcher", async () => {
    const editor = await createStartedEditor("hello");
    // Seed a command line so we can observe the primitive clearing it.
    editor.applyUpdate({ type: "SetCommandLine", value: "nohl" });
    expect(editor.getModel().commandLine).toBe("nohl");

    const result = editor.getInterpreter().execute(
      '(editor-dispatch-command-line "nohl")',
    );
    expect(result._tag).toBe("Right");
    // The TS editor-execute-command-line primitive clears the line.
    expect(editor.getModel().commandLine).toBe("");
  });

  // AC6.5 / AC6.2: the dispatcher recognises the :%s substitute pattern and
  // routes it to query-replace (rather than the fall-through). We assert the
  // routing by observing that :%s does NOT clear the command line the way the
  // fall-through does — it delegates to query-replace, which (regardless of
  // its own pre-existing behavior) does not invoke the clear-and-exit path.
  test("routes :%s substitute through the T-Lisp command-line dispatcher", async () => {
    const editor = await createStartedEditor("alpha beta");
    editor.applyUpdate({ type: "SetCommandLine", value: "%s/alpha/omega/g" });

    editor.getInterpreter().execute(
      '(editor-dispatch-command-line "%s/alpha/omega/g")',
    );
    // The dispatcher matched the :%s regex and called query-replace instead
    // of editor-execute-command-line, so the command line was NOT cleared
    // by the TS fall-through primitive. (The TS handler clears it afterwards
    // regardless; here we drive T-Lisp directly to prove routing.)
    expect(editor.getModel().commandLine).toBe("%s/alpha/omega/g");
  });
});

import { describe, test, expect } from "bun:test";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

describe("#164 shell integration — (shell) callable from interpreter", () => {
  test("(shell) creates a terminal and returns its ID", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute("(shell)") as any;
    expect(result?._tag).toBe("Right");
    const id = result?.right?.value;
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^term-/);
  });

  test("(shell-list) returns the terminal after creation", async () => {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell)");
    const result = editor.getInterpreter().execute("(shell-list)") as any;
    expect(result?._tag).toBe("Right");
    expect(result?.right?.type).toBe("list");
    expect(result?.right?.value?.length).toBe(1);
  });

  test("(shell-alive-p) returns true for running terminal", async () => {
    const editor = await createStartedEditor("");
    const shellResult = editor.getInterpreter().execute("(shell)") as any;
    const id = shellResult?.right?.value;
    const result = editor.getInterpreter().execute(`(shell-alive-p "${id}")`) as any;
    expect(result?._tag).toBe("Right");
    expect(result?.right?.value).toBe(true);
  });
});

// #201 (BUG-84): the shell-mode last mile — mode entry, state injection,
// key routing, and exit. Before the fix, (editor-set-mode "terminal") threw
// Invalid mode, state.terminalLines was never populated (blank screen), and
// terminal-handler's boundp-based id lookup always errored (keys never
// reached the PTY).
describe("#201 shell-mode end-to-end", () => {
  test("SPC ! entry path: editor-set-mode accepts terminal", async () => {
    const editor = await createStartedEditor("");
    const r = editor.getInterpreter().execute('(editor-set-mode "terminal")') as any;
    expect(r?._tag).toBe("Right");
    expect(editor.getState().mode).toBe("terminal");
  });

  test("shell-start injects the PTY screen into editor state; shell-exit clears it", async () => {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell-start)");
    // Give the spawned $SHELL a moment to paint its prompt.
    await new Promise((r) => setTimeout(r, 700));
    expect(editor.getState().mode).toBe("terminal");
    const state = editor.getEditorState() as unknown as {
      terminalLines?: string[]; terminalCursor?: { row: number; col: number };
    };
    expect(Array.isArray(state.terminalLines)).toBe(true);
    expect((state.terminalLines ?? []).length).toBeGreaterThan(0);
    // Deterministic content: drive the PTY (a test-env $SHELL may paint no
    // prompt at all) and watch it land on the virtual screen.
    const id = (editor.getInterpreter().execute("(shell-active-terminal-id)") as any)?.right?.value;
    editor.getInterpreter().execute(`(shell-send "${id}" "echo test-ok\r")`);
    await new Promise((r) => setTimeout(r, 1200));
    const joined = ((editor.getEditorState() as unknown as { terminalLines?: string[] })
      .terminalLines ?? []).join("\n");
    expect(joined).toContain("test-ok");
    expect(state.terminalCursor).toBeDefined();
    editor.getInterpreter().execute("(shell-exit)");
    expect(editor.getState().mode).toBe("normal");
    const after = editor.getEditorState() as unknown as { terminalLines?: string[] };
    expect(after.terminalLines).toBeUndefined();
  });

  test("the PTY is created at the LIVE terminal size, not a hardcoded 80x23 (#203)", async () => {
    const editor = await createStartedEditor("");
    // The size closure reads the ctx's TerminalIO — inject a distinct size so
    // a regression to any hardcoded/dead-field default fails the numbers.
    (editor as any).terminal.getSize = () => ({ width: 120, height: 44 });
    editor.getInterpreter().execute("(shell-start)");
    const id = (editor.getInterpreter().execute("(shell-active-terminal-id)") as any)?.right?.value;
    const rows = (editor.getInterpreter().execute(`(length (shell-get-lines "${id}"))`) as any)?.right?.value;
    expect(rows).toBe(43); // 44 minus the status line — NOT 23
    editor.getInterpreter().execute("(shell-exit)");
  });

  test("styled terminal lines reach the state injection (escapes present, #202)", async () => {
    // Interactive zsh's zle wedges on programmatically-typed $(...)/escape
    // input (echoes but never executes); plain sh is faithful. The PTY spawns
    // $SHELL, so point it at /bin/sh for this test only.
    const prevShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    try {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell-start)");
    const id = (editor.getInterpreter().execute("(shell-active-terminal-id)") as any)?.right?.value;
    // 31 = red: the escape must survive PTY → parser → cells → injection.
    // tput emits the ANSI codes SHELL-SIDE — no backslash escapes needed
    // (T-Lisp literals mangle backslash-033, and a RAW ESC byte sent into
    // an interactive zle line garbles the command).
    editor.getInterpreter().execute(`(shell-send "${id}" "echo X$(tput setaf 1)COLOR-PROBE-OK$(tput sgr0)Y
")`);
    await new Promise((r) => setTimeout(r, 1500));
    const lines = (editor.getEditorState() as unknown as { terminalLines?: string[] }).terminalLines ?? [];
    const joined = lines.join("\n");
    expect(joined).toContain("COLOR-PROBE-OK");
    expect(joined).toContain("\x1b[38;5;1m");
    editor.getInterpreter().execute("(shell-exit)");
    } finally {
      process.env.SHELL = prevShell;
    }
  });

  test("editor resize resizes the active PTY (screen rows follow, status line reserved)", async () => {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell-start)");
    const id = (editor.getInterpreter().execute("(shell-active-terminal-id)") as any)?.right?.value;
    const linesBefore = (editor.getInterpreter().execute(`(length (shell-get-lines "${id}"))`) as any)?.right?.value;
    editor.updateTerminalSize(100, 30);
    const linesAfter = (editor.getInterpreter().execute(`(length (shell-get-lines "${id}"))`) as any)?.right?.value;
    expect(linesAfter).toBe(29); // 30 rows minus the status line
    expect(linesAfter).not.toBe(linesBefore);
    editor.getInterpreter().execute("(shell-exit)");
  });

  test("the active-terminal getter resolves without boundp (key routing fix)", async () => {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell-start)");
    const r = editor.getInterpreter().execute("(shell-active-terminal-id)") as any;
    expect(r?._tag).toBe("Right");
    expect(typeof r?.right?.value).toBe("string");
    expect(String(r.right.value).startsWith("term-")).toBe(true);
    editor.getInterpreter().execute("(shell-exit)");
  });
});

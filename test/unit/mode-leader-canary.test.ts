import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

/**
 * @file mode-leader-canary.test.ts
 * @description #299 — the mode-leader canary. The live 2026-11-20 report: in a
 * [typescript] buffer the SPC leader died (`SPC a` → "Unbound key: a") and
 * command mode errored `Undefined symbol: editor-dispatch-command-line`.
 * Triage named a STALE BINARY (the symptom vanished on the clean rebuild
 * with zero module-load errors; learnings: rapid successive build:tmax
 * runs can poison the binary). This canary pins the BEHAVIOR across every
 * shipped major mode so both failure classes — keymap shadowing AND the
 * loadCoreBindings swallow (a module that fails to load leaves commands
 * undefined while the daemon starts normally) — turn tests red.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

const MODES: { file: string; content: string; expectMode: RegExp }[] = [
  { file: "a.ts", content: "const x: number = 1;\n", expectMode: /typescript/ },
  { file: "a.md", content: "# Title\n\nbody\n", expectMode: /markdown/ },
  { file: "a.lisp", content: "(defun f () 1)\n", expectMode: /lisp/ },
  { file: "a.txt", content: "plain text\n", expectMode: /fundamental|text/ },
];

const status = (editor: Editor): string => editor.getEditorState().statusMessage ?? "";

async function openInMode(file: string, content: string): Promise<{ editor: Editor; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "i299-canary-"));
  const path = join(dir, file);
  writeFileSync(path, content);
  const editor = await createStartedEditor("");
  executeTlisp(editor, `(find-file-open "${path}")`);
  return { editor, dir };
}

describe("#299 mode-leader canary (stale-binary closure regression)", () => {
  for (const { file, content, expectMode } of MODES) {
    test(`[${expectMode.source}] SPC leader arms and consumes; : dispatches; the symbol resolves`, async () => {
      const { editor } = await openInMode(file, content);
      const mode = editor.getEditorState().currentMajorMode ?? "";
      expect(mode).toMatch(expectMode);

      // 1. The SPC leader ARMS in this mode (the reported death: the press
      //    fell through to "Unbound key").
      await editor.handleKey(" ");
      expect(status(editor)).toBe("SPC-");

      // 2. The leader's `a` subtree is CONSUMED (a recognized prefix — not
      //    "Unbound key: a").
      await editor.handleKey("a");
      expect(status(editor)).not.toContain("Unbound key: a");
      expect(status(editor)).not.toContain("Unbound key");

      // Clear the pending prefix so the command-mode probe starts clean.
      await editor.handleKey("Escape");
      expect(editor.getEditorState().mode).toBe("normal");

      // 3. Command mode: ':' enters, Enter dispatches through
      //    editor-dispatch-command-line (the reported "Undefined symbol").
      await editor.handleKey(":");
      expect(editor.getEditorState().mode).toBe("command");
      await editor.handleKey("1");
      await editor.handleKey("\n");
      expect(editor.getEditorState().mode).toBe("normal");
      expect(status(editor)).not.toContain("Undefined symbol");
      expect(status(editor)).not.toContain("Unbound key");

      // 4. The dispatch SYMBOL itself resolves in this session's module
      //    chain (the loadCoreBindings-swallow canary).
      const probe = executeTlisp(editor, '(condition-case nil (progn (editor-dispatch-command-line "1") "ok") (error (e) (concat "ERR:" (error-message e))))');
      const probeText = String(probe.value ?? "");
      expect(probeText).not.toContain("ERR");
      expect(probeText).not.toBe("");
    });
  }
});

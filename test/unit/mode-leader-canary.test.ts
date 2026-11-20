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
 * undefined while the daemon starts normally) — turn tests red. The MODES
 * table below is a representative spread of the registered file-backed
 * major modes, not an exhaustive enumeration.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

// A representative spread of the registered file-backed major modes
// (typescript/markdown/lisp/fundamental + go/python/json/yaml/rust/html/
// css/sql/shell); not an exhaustive enumeration of all 22+ registrations.
const MODES: { file: string; content: string; expectMode: RegExp }[] = [
  { file: "a.ts", content: "const x: number = 1;\n", expectMode: /typescript/ },
  { file: "a.md", content: "# Title\n\nbody\n", expectMode: /markdown/ },
  { file: "a.lisp", content: "(defun f () 1)\n", expectMode: /lisp/ },
  { file: "a.txt", content: "plain text\n", expectMode: /fundamental|text/ },
  { file: "a.go", content: "package main\n", expectMode: /go/ },
  { file: "a.py", content: "x = 1\n", expectMode: /python/ },
  { file: "a.json", content: "{\"k\": 1}\n", expectMode: /json/ },
  { file: "a.yaml", content: "k: 1\n", expectMode: /yaml/ },
  { file: "a.rs", content: "fn main() {}\n", expectMode: /rust/ },
  { file: "a.html", content: "<html></html>\n", expectMode: /html/ },
  { file: "a.css", content: "a { color: red; }\n", expectMode: /css/ },
  { file: "a.sql", content: "SELECT 1;\n", expectMode: /sql/ },
  { file: "a.sh", content: "echo hi\n", expectMode: /shell|bash/ },
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
      //    chain (the loadCoreBindings-swallow canary): executeTlisp throws
      //    on a Left (undefined symbol), so a clean "ok" return is the
      //    resolution proof.
      const probeText = String(executeTlisp(editor, '(progn (editor-dispatch-command-line "1") "ok")').value ?? "");
      expect(probeText).toBe("ok");
    });
  }
});

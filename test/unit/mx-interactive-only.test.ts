/**
 * @file mx-interactive-only.test.ts
 * @description #249 — M-x lists ONLY commands: functions that declared
 *   `(interactive)` (SPEC-115) or are TS-declared commands (TS_COMMAND_NAMES).
 *   The SPEC-115 OR key-bound arm is gone: being bound to a key does not put
 *   a function in M-x. Internal key plumbing (pending-state entries, visual
 *   operators, mode-entry handlers) must be absent; genuine commands that
 *   reached M-x via the key-bound arm were migrated to declare
 *   `(interactive)` and stay. Key dispatch itself is unaffected.
 */

import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

/** Names in the interactive-only table (`callable-command-details t`). */
function filteredNames(editor: Editor): Set<string> {
  const r = executeTlisp(editor, "(callable-command-details t)");
  return new Set(
    (r.value as any[]).map((h: any) => (h.value as Map<string, any>).get("name")?.value as string),
  );
}

/** Names in the full table (describe-function parity). */
function fullNames(editor: Editor): Set<string> {
  const r = executeTlisp(editor, "(callable-command-details)");
  return new Set(
    (r.value as any[]).map((h: any) => (h.value as Map<string, any>).get("name")?.value as string),
  );
}

// The 27 internal-plumbing names that leaked into M-x via the key-bound arm
// and must NOT be commands (#249's report).
const INTERNAL_PLUMBING = [
  "editor-handle-space",
  "editor-enter-command-mode",
  "editor-exit-command-mode",
  "editor-execute-command-line",
  "insert-delete-to-bol",
  "macro-handle-at",
  "macro-handle-q",
  "vim-begin-register-prefix",
  "vim-mark-begin-set",
  "vim-mark-begin-jump-line",
  "vim-mark-begin-jump-exact",
  "vim-replace-begin",
  "vim-replace-mode-enter",
  "vim-visual-delete-flash",
  "vim-visual-yank-flash",
  "vim-visual-indent",
  "vim-visual-outdent",
  "vim-visual-lowercase",
  "vim-visual-uppercase",
  "vim-visual-toggle-case",
  "vim-visual-paste",
  "visual-change",
  "visual-enter-block-mode",
  "visual-enter-char-mode",
  "visual-enter-line-mode",
  "visual-exit",
  "visual-swap-anchor",
];

describe("#249: M-x lists only interactive commands", () => {
  it("no internal key plumbing appears in the M-x source table", async () => {
    const editor = await createStartedEditor("");
    const names = filteredNames(editor);
    for (const name of INTERNAL_PLUMBING) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("genuine commands that arrived via the key-bound arm are still present", async () => {
    const editor = await createStartedEditor("");
    const names = filteredNames(editor);
    for (const name of [
      "find-file", "quick-save", "undo", "redo", "switch-buffer", "editor-quit",
      "paragraph-next", "execute-extended-command", "isearch-forward", "apropos",
      "yank-pop", "tab-next", "tab-prev", "split-window-below", "cheatsheet",
      "describe-mode",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("every entry in the interactive-only table carries interactive=true", async () => {
    const editor = await createStartedEditor("");
    const r = executeTlisp(editor, "(callable-command-details t)");
    const entries = r.value as any[];
    expect(entries.length).toBeGreaterThan(0);
    for (const h of entries) {
      const m = h.value as Map<string, any>;
      expect(m.get("interactive")?.value).toBe(true); // #249: flag exposed
    }
  });

  it("the T-Lisp M-x guard agrees with the table (flag + trt/should exclusion)", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(command-completion-refresh)");
    // command-completion-candidates is module-scoped; read it via the
    // exported table function (non-"metadata" action → the candidate list).
    const cands = executeTlisp(editor, '(length (command-completion-table "" ""))');
    const table = filteredNames(editor).size;
    expect(Number(cands.value)).toBe(table); // no trt-/should- in the table today
    // The predicate is real defense in depth: it REQUIRES the exposed flag —
    // an interactive=false entry is rejected even with a clean name.
    const reject = executeTlisp(
      editor,
      '(command-detail-interactive-p (hashmap "name" "plain-name" "interactive" nil))',
    );
    expect(reject.type === "nil" || reject.value === false).toBe(true);
    const reject2 = executeTlisp(
      editor,
      '(command-detail-interactive-p (hashmap "name" "trt-evil"))',
    );
    expect(reject2.type === "nil" || reject2.value === false).toBe(true);
    const accept = executeTlisp(
      editor,
      '(command-detail-interactive-p (hashmap "name" "plain-name" "interactive" t))',
    );
    expect(accept.type !== "nil" && !!accept.value).toBe(true);
  });

  it("internal plumbing stays callable and the full table keeps describe-function parity", async () => {
    const editor = await createStartedEditor("");
    const full = fullNames(editor);
    // Still visible to describe-function (full table), just not M-x commands.
    for (const name of ["editor-handle-space", "visual-exit", "car", "string-join"]) {
      expect(full.has(name)).toBe(true);
    }
    expect(full.size).toBeGreaterThan(filteredNames(editor).size);
  });

  it("key dispatch is unaffected: dropped internals still work via their keys", async () => {
    const editor = await createStartedEditor("");
    // `v` enters visual char mode (visual-enter-char-mode is NOT an M-x command).
    await editor.handleKey("v");
    expect(editor.getEditorState().mode).toBe("visual");
    await editor.handleKey("Escape");
    // `:` enters command mode (editor-enter-command-mode is NOT a command).
    await editor.handleKey(":");
    expect(editor.getEditorState().mode).toBe("command");
    await editor.handleKey("Escape");
    // `m` starts mark pending (vim-mark-begin-set is NOT a command).
    await editor.handleKey("m");
    const pending = executeTlisp(editor, "(vim-mark-pending-p)");
    expect(pending.type === "boolean" ? pending.value : pending).toBeTruthy();
  });
});

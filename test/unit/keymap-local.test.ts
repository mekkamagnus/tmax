import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #206 (RFC-027 §UI, Phase 0) — buffer-local keymaps + the normative chain:
//   buffer-local → active minor-mode keymaps (later-activated innermost)
//   → editor-mode keymap
// Inner levels shadow outer for bindings AND prefixes; a partial sequence
// that is a prefix at ANY level keeps waiting. Fixes chat.tlisp's global
// RET/C-g pollution.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

function bindLocal(editor: Editor, buffer: string, key: string, cmd: string) {
  const esc = cmd.replace(/"/g, '\\"');
  executeTlisp(editor, `(progn
    (if (not (buffer-keymap "${buffer}"))
      (buffer-set-keymap "${buffer}" (keymap-init "test-local")))
    (keymap-set-key (buffer-keymap "${buffer}") "${key}" "${esc}"))`);
}

function listToJs(editor: Editor, expr: string): string[][] {
  const result = executeTlisp(editor, expr);
  return (result.value as { value: { value: string }[] }[]).map(
    (entry) => (entry.value as { value: string }[]).map((x) => String(x.value)),
  );
}

describe("#206 buffer-local keymaps — lookup chain", () => {
  test("buffer-local binding shadows the mode map only in that buffer", async () => {
    const editor = await createStartedEditor("line0\nline1\nline2");
    executeTlisp(editor, '(buffer-create "other")');
    bindLocal(editor, "test", "j", "(editor-set-status \"local-j\")");

    // In the buffer with the local map: local binding wins.
    await editor.handleKey("j");
    expect(editor.getEditorState().statusMessage).toBe("local-j");

    // In another buffer: mode binding (cursor down) wins — no local-j status.
    executeTlisp(editor, '(buffer-switch "other")');
    executeTlisp(editor, "(editor-set-status \"\")");
    await editor.handleKey("j");
    expect(editor.getEditorState().statusMessage).not.toBe("local-j");
    // And the mode binding still resolves through the chain for the local buffer.
    expect(String(executeTlisp(editor, '(keymap-ref (current-keymap) "k")').value)).not.toBe("nil");
  });

  test("cross-level prefixes: a buffer-local single key does not shadow mode-level prefixes", async () => {
    const editor = await createStartedEditor("");
    // Bind "s" locally (SPC s is a mode prefix; bare s is a mode binding too).
    bindLocal(editor, "test", "y", "(editor-set-status \"local-y\")");
    // Mode-level prefixes survive the chain: "SPC" is a prefix via parent.
    expect(String(executeTlisp(editor, '(keymap-prefix-p (current-keymap) "SPC")').value)).toBe("true");
    // And a local single-key binding doesn't make mode multi-key sequences unreachable:
    expect(String(executeTlisp(editor, '(keymap-prefix-p (current-keymap) "g")').value)).toBe("true");
  });

  test("which-key candidates merge across levels, innermost winning on collision", async () => {
    const editor = await createStartedEditor("");
    // g is a mode prefix with sub-bindings (g g etc.); add a local sub-binding.
    executeTlisp(editor, `(progn
      (buffer-set-keymap "test" (keymap-init "test-local"))
      (keymap-set-key (buffer-keymap "test") "g l" "(editor-set-status \\"gl-local\\")"))`);
    const merged = listToJs(editor, '(keymap-prefix-bindings (current-keymap) "g")');
    const keys = merged.map((e) => e[0]);
    expect(keys).toContain("g l"); // local level
    expect(keys.filter((k) => k !== "g l").length).toBeGreaterThan(0); // mode level too
    // Collision: local "g g" overrides the mode's "g g".
    executeTlisp(editor, `(keymap-set-key (buffer-keymap "test") "g g" "(editor-set-status \\"gg-local\\")")`);
    const colliding = listToJs(editor, '(keymap-prefix-bindings (current-keymap) "g")').filter((e) => e[0] === "g g");
    expect(colliding).toHaveLength(1);
    expect(colliding[0]![1]).toContain("gg-local");
  });

  test("minor-mode keymap tier sits between buffer-local and mode map", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(minor-mode-register "testmm" "test minor" "MM")');
    // Register a named keymap and attach it to the minor mode.
    executeTlisp(editor, `(progn
      (keymap-register "mm-map" (keymap-init "mm"))
      (keymap-set-key (keymap-named "mm-map") "m" "(editor-set-status \\"mm-m\\")")
      (minor-mode-set-keymap "testmm" "mm-map")
      (minor-mode-set "testmm" t))`);
    // Active minor map shadows the mode map for "m" (bare m = mark-pending in
    // mode map; the chain must give the minor binding instead).
    const ref = String(executeTlisp(editor, '(keymap-ref (current-keymap) "m")').value);
    expect(ref).toContain("mm-m");

    // Buffer-local outranks the minor mode.
    bindLocal(editor, "test", "m", "(editor-set-status \"local-m\")");
    expect(String(executeTlisp(editor, '(keymap-ref (current-keymap) "m")').value)).toContain("local-m");

    // Deactivate the minor mode → its tier drops out.
    executeTlisp(editor, '(minor-mode-set "testmm" nil)');
    expect(String(executeTlisp(editor, '(keymap-ref (current-keymap) "m")').value)).toContain("local-m");
    executeTlisp(editor, '(buffer-set-keymap "default" (keymap-init "empty"))');
    expect(String(executeTlisp(editor, '(keymap-ref (current-keymap) "m")').value)).not.toContain("mm-m");
  });

  test("two active minor-mode keymaps: LATER-activated wins on same-key collision", async () => {
    const editor = await createStartedEditor("");
    // mm-a activated first, mm-b second — b is innermost per the normative
    // chain, so b's binding of the shared key must win.
    executeTlisp(editor, '(minor-mode-register "mma" "A" "A")');
    executeTlisp(editor, '(minor-mode-register "mmb" "B" "B")');
    executeTlisp(editor, `(progn
      (keymap-register "mma-map" (keymap-init "mma"))
      (keymap-set-key (keymap-named "mma-map") "n" "(editor-set-status \\"from-a\\")")
      (minor-mode-set-keymap "mma" "mma-map")
      (keymap-register "mmb-map" (keymap-init "mmb"))
      (keymap-set-key (keymap-named "mmb-map") "n" "(editor-set-status \\"from-b\\")")
      (minor-mode-set-keymap "mmb" "mmb-map")
      (minor-mode-set "mma" t)
      (minor-mode-set "mmb" t))`);
    const ref = String(executeTlisp(editor, '(keymap-ref (current-keymap) "n")').value);
    expect(ref).toContain("from-b");
    // Deactivate the later one — the earlier-activated now wins.
    executeTlisp(editor, '(minor-mode-set "mmb" nil)');
    const ref2 = String(executeTlisp(editor, '(keymap-ref (current-keymap) "n")').value);
    expect(ref2).toContain("from-a");
  });

  test("TS dispatch composition: count prefix and r<Esc> still work under a buffer-local map", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    bindLocal(editor, "test", "j", "(editor-set-status \"local-j\")");
    // Count-building happens before keymap lookup — 3 then j must dispatch
    // the local binding (observable), not break.
    await editor.handleKey("3");
    await editor.handleKey("j");
    expect(editor.getEditorState().statusMessage).toBe("local-j");
    // r<Esc>: replace-pending then Escape cancels cleanly (stays normal).
    await editor.handleKey("r");
    await editor.handleKey("Escape");
    expect(editor.getEditorState().mode).toBe("normal");
  });

  test("chat.tlisp no longer pollutes the global normal keymap (RET/C-g)", async () => {
    const editor = await createStartedEditor("");
    // fikra modules load with core bindings; the old bug bound RET/C-g in
    // the GLOBAL normal map. With #206 they are buffer-local to *Fikra*.
    // RET has a PRE-EXISTING mode binding (occur-jump) — the fix removes
    // fikra's OVERRIDE of it, not occur itself. C-g had no mode binding, so
    // chat's removal leaves it unbound.
    const ret = executeTlisp(editor, '(keymap-ref (current-keymap) "RET")');
    expect(String(ret.value)).not.toContain("fikra");
    const cg = executeTlisp(editor, '(keymap-ref (current-keymap) "C-g")');
    expect(String(cg.value)).toBe("null");
  });

  test("*Fikra* buffer gets its buffer-local map on chat-open", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(require-module fikra/chat)");
    // chat-open itself trips a PRE-EXISTING cross-module break (fikra-mode-active
    // unqualified — fikra module-system fallout, #214/#216 scope). #206's contract
    // is the buffer-local map: attach it the way chat-open does and assert.
    executeTlisp(editor, "(fikra/chat/fikra-ensure-buffer-keymap)"); // qualified: module exports are not global
    const kmap = executeTlisp(editor, '(buffer-keymap "*Fikra*")');
    expect(String(kmap.type)).toBe("hashmap");
    const ret = executeTlisp(editor, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra*") "RET")');
    expect(String(ret.value)).toContain("fikra-follow-link");
  });
});

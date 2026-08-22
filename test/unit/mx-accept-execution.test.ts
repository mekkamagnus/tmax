import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";

// BUG-83 (#226) — M-x accepted commands did not execute: the accept chain's
// failure was silently swallowed. Root cause: executeCommandAsync RE-EVALUATED
// already-parenthesized forms in the callable's module env after a failed
// eval — for the M-x Enter path the first eval ran the accept chain (closing
// the minibuffer + signaling), the retry re-ran dispatch on the CLEARED
// session, returned a harmless nil, and the quit signal/error died with no
// status, no log. The module-env retry is now bare-name-only; failures
// surface on the status line + *Messages*.

describe("BUG-83: M-x accepted commands execute", () => {
  test("M-x editor-quit Enter propagates EDITOR_QUIT_SIGNAL (no swallow)", async () => {
    const fixture = await createEditorFixture();
    const ed = fixture.editor;
    await ed.handleKey(" ");
    await ed.handleKey(";");
    expect(ed.getMode()).toBe("mx");
    for (const ch of "editor-quit") await ed.handleKey(ch);
    // Before the fix: resolved normally, mode → normal, signal LOST.
    await expect(ed.handleKey("Enter")).rejects.toThrow("EDITOR_QUIT_SIGNAL");
  });

  test("an accepted command's effect is observable (status set by the command)", async () => {
    const fixture = await createEditorFixture();
    const ed = fixture.editor;
    fixture.executeTlisp('(defun mx-regression-marker () (interactive) (editor-set-status "MX-RAN"))');
    await ed.handleKey(" ");
    await ed.handleKey(";");
    for (const ch of "mx-regression-marker") await ed.handleKey(ch);
    await ed.handleKey("Enter");
    expect(ed.getMode()).toBe("normal"); // minibuffer closed
    // THE regression: before the fix the accept never ran the command.
    expect(fixture.executeTlisp("(editor-status)").value).toBe("MX-RAN");
  });

  test("symptom 3: M-x switch-to-buffer Enter opens the FOLLOW-UP minibuffer prompt", async () => {
    const fixture = await createEditorFixture();
    const ed = fixture.editor;
    await ed.handleKey(" ");
    await ed.handleKey(";");
    for (const ch of "switch-buffer") await ed.handleKey(ch);
    await ed.handleKey("Tab"); // complete the candidate (require-match)
    await ed.handleKey("Enter");
    // The accepted command RAN — and switch-to-buffer opens its own
    // completing-read: the editor is back in mx with a live session
    // (before the fix: mode normal, no follow-up prompt).
    expect(ed.getMode()).toBe("mx");
    const session = fixture.executeTlisp('(hashmap-get (minibuffer-state-get) "prompt")');
    expect(String(session.value)).toContain("Switch to buffer");
  });

  test("command FAILURES surface on the status line + *Messages* (not silent)", async () => {
    const fixture = await createEditorFixture();
    const ed = fixture.editor;
    const messagesBefore = ed.getMessageLog().getEntries().length;
    // A form that fails evaluation (type error) goes through the SAME
    // executeCommandAsync path the minibuffer accept uses.
    await ed.executeCommandAsync("(car 5)").catch(() => undefined);
    expect(String(fixture.executeTlisp("(editor-status)").value)).toContain("car");
    const msgs = ed.getMessageLog().getEntries().slice(messagesBefore);
    expect(msgs.some((m) => m.text.includes("car"))).toBe(true);
  });

  test("bare-name module-env retry still resolves; unknown names surface their error", async () => {
    const fixture = await createEditorFixture();
    const ed = fixture.editor;
    // A module-scoped command that is NOT a global symbol fails the first
    // (global-env) eval and legitimately needs the module-env retry — the
    // fix must not have broken that path.
    await ed.executeCommandAsync("minibuffer-accept"); // resolves (no session → nil), no undefined-symbol error
    // An unknown bare name: retry can't resolve it either — the ERROR now
    // surfaces (status line), not silence.
    await ed.executeCommandAsync("totally-not-a-command").catch(() => undefined);
    expect(String(fixture.executeTlisp("(editor-status)").value)).toContain("totally-not-a-command");
  });
});

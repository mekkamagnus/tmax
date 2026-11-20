import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// RFC-029 §8.2 (mockup round): the compose frame — the To/Context header
// rides the capture buffer's top; submit reads only the BODY; the history
// hints + M-p/M-n are wired.

let repoDir = "";
const dirs: string[] = [];
const originalCwd = process.cwd();
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-cap-"));
  dirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  process.chdir(repoDir);
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const e = (ed: unknown, expr: string) => executeTlisp(ed as never, expr);

describe("#8.2 capture frame", () => {
  test("the compose buffer opens with the To/Context header + separator", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(fikra/capture/fikra-capture)");
    expect(String(e(ed, "(buffer-name)").value)).toBe("*Fikra-Capture*");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("To: thread ");
    expect(text).toContain("Context: ");
    expect(text.split("\n")[1]).toContain("--");
  });

  test("the To line names the thread and the backend", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/adapter)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(fikra/adapter/fikra-set-backend "replay")');
    e(ed, "(require-module fikra/capture)");
    const to = String(e(ed, "(fikra/capture/fikra-capture-to-line)").value);
    expect(to).toMatch(/^To: thread \S+ \(replay\)\s+Context: /);
  });

  test("submit sends only the BODY (the header never leaks into the turn)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(fikra/capture/fikra-capture)");
    // Type into the body region.
    e(ed, '(fikra/capture/fikra-capture-set-body "hello from the body")');
    // Read what submit WOULD send.
    const body = String(e(ed, "(fikra/capture/fikra-capture-body)").value);
    expect(body).toBe("hello from the body");
    expect(body).not.toContain("To:");
  });

  test("history navigation preserves the header and reports the count", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(require-module fikra/chat)");
    e(ed, "(fikra/chat/fikra-chat-open)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, '(fikra/capture/fikra-capture-set-body "first message")');
    e(ed, "(fikra/capture/fikra-capture-submit)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, "(fikra/capture/fikra-history-prev)");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("To: thread ");
    expect(text).toContain("first message");
    const kmap = e(ed, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra-Capture*") "M-p")');
    expect(JSON.stringify(kmap.value)).toContain("history-prev");
    const kmapN = e(ed, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra-Capture*") "M-n")');
    expect(JSON.stringify(kmapN.value)).toContain("history-next");
  });

  test("the Context label reads the CALLING buffer, not the capture buffer (r53)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(require-module fikra/thread)");
    e(ed, "(fikra-thread-set-field \"root\" \"/tmp\")");
    e(ed, "(fikra/capture/fikra-capture)");
    // The ctx was captured at OPEN time (the *scratch* fixture buffer).
    const text = String(e(ed, "(buffer-text)").value);
    const toLine = text.split("\n")[0] ?? "";
    expect(toLine).toMatch(/Context: \S+@\d+/);
    // It is NOT the capture buffer's own name.
    expect(toLine).not.toContain("Fikra-Capture@");
  });

  test("history recall REPLACES a single-line body exactly (r53)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(require-module fikra/chat)");
    e(ed, "(fikra/chat/fikra-chat-open)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, '(fikra/capture/fikra-capture-set-body "first message")');
    e(ed, "(fikra/capture/fikra-capture-submit)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, '(fikra/capture/fikra-capture-set-body "typed draft")');
    e(ed, "(fikra/capture/fikra-history-prev)");
    const body = String(e(ed, "(fikra/capture/fikra-capture-body)").value);
    expect(body.trim()).toBe("first message");
    // M-n returns to empty (the draft is replaced, not stacked).
    e(ed, "(fikra/capture/fikra-history-next)");
    const body2 = String(e(ed, "(fikra/capture/fikra-capture-body)").value);
    expect(body2.trim()).toBe("");
  });

  test("multi-line history recall REPLACES exactly (the end-exclusive catch, r54)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(require-module fikra/chat)");
    e(ed, "(fikra/chat/fikra-chat-open)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, '(fikra/capture/fikra-capture-set-body "first message")');
    e(ed, "(fikra/capture/fikra-capture-submit)");
    e(ed, "(fikra/capture/fikra-capture)");
    // A MULTI-line draft body.
    e(ed, '(fikra/capture/fikra-capture-set-body "draft one\ndraft two")');
    e(ed, "(fikra/capture/fikra-history-prev)");
    const body = String(e(ed, "(fikra/capture/fikra-capture-body)").value);
    expect(body).toBe("first message"); // NOT "first messagedraft two"
  });

  test("cancel discards a MULTI-LINE draft completely (the reopen leak, r55)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, "(require-module fikra/capture)");
    e(ed, "(require-module fikra/thread)");
    e(ed, '(fikra-thread-set-field "root" "/tmp")');
    e(ed, "(require-module fikra/chat)");
    e(ed, "(fikra/chat/fikra-chat-open)");
    e(ed, "(fikra/capture/fikra-capture)");
    e(ed, '(fikra/capture/fikra-capture-set-body "draft one\ndraft two")');
    e(ed, "(fikra/capture/fikra-capture-cancel)");
    e(ed, "(fikra/capture/fikra-capture)");
    const body = String(e(ed, "(fikra/capture/fikra-capture-body)").value);
    expect(body).toBe("");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).not.toContain("draft two");
    expect(text).not.toContain("draft one");
  });
});

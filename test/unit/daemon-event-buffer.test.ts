/**
 * @file daemon-event-buffer.test.ts
 * @description SPEC-047 — *daemon* event buffer. Verifies logDaemonEvent records
 * events with timestamps in a capped ring rendered into the *daemon* virtual
 * buffer, and that *Messages* is never polluted by daemon lifecycle events.
 */
import { describe, test, expect } from "bun:test";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

describe("SPEC-047: *daemon* event buffer", () => {
  test("logDaemonEvent appends a timestamped line containing the event + detail", async () => {
    const editor = await createStartedEditor();
    editor.logDaemonEvent("client-connected", "c-1");
    const rendered = editor.getDaemonLog().render();
    expect(rendered).toContain("client-connected");
    expect(rendered).toContain("c-1");
    // MessageLog renders entries as [HH:MM:SS] [level] text
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
  });

  test("*daemon* buffer is created at startup (alongside *Messages*)", async () => {
    const editor = await createStartedEditor();
    // The daemon ring exists and is initially empty (renders to empty string).
    expect(editor.getDaemonLog().render()).toBe("");
    // The daemon ring is independent of the message ring (the sibling buffer).
    expect(editor.getMessageLog()).not.toBe(editor.getDaemonLog());
  });

  test("multiple events render in order as separate lines", async () => {
    const editor = await createStartedEditor();
    editor.logDaemonEvent("client-connected", "c-1");
    editor.logDaemonEvent("client-disconnected", "c-1");
    editor.logDaemonEvent("client-connected", "c-2");
    const rendered = editor.getDaemonLog().render();
    const lines = rendered.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("client-connected c-1");
    expect(lines[1]).toContain("client-disconnected c-1");
    expect(lines[2]).toContain("client-connected c-2");
  });

  test("ring respects maxSize (oldest entries dropped under pressure)", async () => {
    const editor = await createStartedEditor();
    const log = editor.getDaemonLog();
    const cap = log.maxSize;
    // Push well beyond the cap.
    for (let i = 0; i < cap + 50; i++) {
      editor.logDaemonEvent("client-connected", `c-${i}`);
    }
    const entries = log.getEntries();
    expect(entries.length).toBeLessThanOrEqual(cap);
    // The oldest entries (c-0 .. ) should be gone; the tail should be present.
    expect(entries.some(e => e.text.includes(`c-0`))).toBe(false);
    expect(entries.some(e => e.text.includes(`c-${cap + 49}`))).toBe(true);
  });

  test("daemon events do NOT pollute the *Messages* buffer", async () => {
    const editor = await createStartedEditor();
    // Capture *Messages* baseline before daemon events (it may contain a
    // welcome message); we only assert daemon event text never appears.
    editor.logDaemonEvent("client-connected", "c-1");
    editor.logDaemonEvent("client-disconnected", "c-1");
    const messagesRendered = editor.getMessageLog().render();
    // *Messages* must contain no daemon event text.
    expect(messagesRendered).not.toContain("client-connected");
    expect(messagesRendered).not.toContain("client-disconnected");
  });

  test("getDaemonLog returns the same ring that logDaemonEvent writes to", async () => {
    const editor = await createStartedEditor();
    editor.logDaemonEvent("client-connected", "c-solo");
    const entries = editor.getDaemonLog().getEntries();
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.text).toBe("client-connected c-solo");
    expect(entry.level).toBe("info");
  });

  test("event without detail renders the event name alone", async () => {
    const editor = await createStartedEditor();
    editor.logDaemonEvent("daemon-started");
    const rendered = editor.getDaemonLog().render();
    expect(rendered).toContain("daemon-started");
    expect(rendered).not.toContain("undefined");
  });
});

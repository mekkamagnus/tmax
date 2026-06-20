import { describe, expect, it } from "bun:test";
import {
  type LogEntry,
  LEVEL_ORDER,
  capTail,
  formatTimeCompact,
  formatTimeFull,
  renderEntry,
  isInMessagesView,
  entryToJsonl,
  jsonlToEntry,
  OUTPUT_TAIL_MAX,
} from "../../src/editor/log-entry.ts";

describe("log-entry · LEVEL_ORDER", () => {
  it("orders debug < info < warn < error", () => {
    expect(LEVEL_ORDER.debug).toBeLessThan(LEVEL_ORDER.info);
    expect(LEVEL_ORDER.info).toBeLessThan(LEVEL_ORDER.warn);
    expect(LEVEL_ORDER.warn).toBeLessThan(LEVEL_ORDER.error);
  });
});

describe("log-entry · capTail", () => {
  it("returns short strings unchanged", () => {
    expect(capTail("short")).toBe("short");
  });
  it("caps to the last OUTPUT_TAIL_MAX chars", () => {
    const big = "x".repeat(OUTPUT_TAIL_MAX + 100);
    const out = capTail(big);
    expect(out.length).toBe(OUTPUT_TAIL_MAX);
    expect(out).toBe(big.slice(-OUTPUT_TAIL_MAX));
  });
  it("keeps the most recent output (tail), not the head", () => {
    const out = capTail("HEAD" + "x".repeat(OUTPUT_TAIL_MAX) + "TAIL");
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out.startsWith("HEAD")).toBe(false);
  });
});

describe("log-entry · time formatters", () => {
  it("formatTimeCompact produces HH:MM:SS", () => {
    const ts = new Date(2026, 5, 17, 14, 32, 7).getTime();
    expect(formatTimeCompact(ts)).toBe("14:32:07");
  });
  it("formatTimeFull produces YYYY-MM-DD HH:MM:SS", () => {
    const ts = new Date(2026, 5, 17, 14, 32, 7).getTime();
    expect(formatTimeFull(ts)).toBe("2026-06-17 14:32:07");
  });
});

describe("log-entry · renderEntry", () => {
  const base: LogEntry = {
    ts: new Date(2026, 5, 17, 14, 32, 7).getTime(),
    level: "info",
    category: "editor",
    text: "Opened file.ts",
  };

  it("renders the compact backward-compatible shape", () => {
    expect(renderEntry(base)).toBe("[14:32:07] [info] Opened file.ts");
  });
  it("includes command context when present", () => {
    expect(renderEntry({ ...base, level: "error", command: "save-buffer" }))
      .toBe("[14:32:07] [error] [save-buffer] Opened file.ts");
  });
  it("appends exit/duration enrichment for program runs", () => {
    const out = renderEntry({ ...base, category: "shell", exitCode: 1, durationMs: 340 });
    expect(out).toBe("[14:32:07] [info] Opened file.ts [exit 1] [340ms]");
  });
  it("appends an indented output-tail block when present", () => {
    const out = renderEntry({ ...base, outputTail: "line1\nline2" });
    expect(out).toBe("[14:32:07] [info] Opened file.ts\n  line1\n  line2");
  });
  it("fullDate option uses the full timestamp", () => {
    expect(renderEntry(base, { fullDate: true }))
      .toBe("[2026-06-17 14:32:07] [info] Opened file.ts");
  });
});

describe("log-entry · isInMessagesView (mirror rule)", () => {
  it("includes editor and autosave of any level", () => {
    expect(isInMessagesView({ ts: 0, level: "info", category: "editor", text: "" })).toBe(true);
    expect(isInMessagesView({ ts: 0, level: "debug", category: "autosave", text: "" })).toBe(true);
  });
  it("mirrors warn and error from any category", () => {
    expect(isInMessagesView({ ts: 0, level: "warn", category: "shell", text: "" })).toBe(true);
    expect(isInMessagesView({ ts: 0, level: "error", category: "process", text: "" })).toBe(true);
    expect(isInMessagesView({ ts: 0, level: "error", category: "daemon", text: "" })).toBe(true);
  });
  it("does NOT mirror info from non-editor categories", () => {
    expect(isInMessagesView({ ts: 0, level: "info", category: "shell", text: "" })).toBe(false);
    expect(isInMessagesView({ ts: 0, level: "info", category: "daemon", text: "" })).toBe(false);
    expect(isInMessagesView({ ts: 0, level: "debug", category: "test", text: "" })).toBe(false);
  });
});

describe("log-entry · JSONL round-trip", () => {
  it("round-trips a full entry preserving all fields", () => {
    const e: LogEntry = {
      ts: 1718608341000, level: "error", category: "shell", text: "bun test",
      exitCode: 1, durationMs: 340, outputTail: "fail\n", frameId: "c-3", command: "run",
    };
    const line = entryToJsonl(e);
    const back = jsonlToEntry(line);
    expect(back).toEqual(e);
  });
  it("round-trips a minimal entry", () => {
    const e: LogEntry = { ts: 1, level: "info", category: "editor", text: "hi" };
    expect(jsonlToEntry(entryToJsonl(e))).toEqual(e);
  });
  it("returns null on malformed JSON", () => {
    expect(jsonlToEntry("{not json")).toBeNull();
  });
  it("returns null when required fields are missing", () => {
    expect(jsonlToEntry(JSON.stringify({ ts: 1, level: "info" }))).toBeNull();
  });
});

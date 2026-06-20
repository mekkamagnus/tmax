import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  tailLoad,
  _writeRaw,
  MAX_BYTES,
} from "../../src/editor/log-persist.ts";
import type { LogEntry } from "../../src/editor/log-entry.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tmax-log-"));
  path = join(dir, "messages.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = (over: Partial<LogEntry> & { text: string }): LogEntry => ({
  ts: 1000, level: "info", category: "editor", ...over,
});

describe("log-persist · appendEntry", () => {
  it("appends one JSONL line per entry", () => {
    appendEntry(path, entry({ ts: 1, text: "a" }));
    appendEntry(path, entry({ ts: 2, text: "b" }));
    const back = tailLoad(path, 100);
    expect(back.map(e => e.text)).toEqual(["a", "b"]);
    expect(back.map(e => e.ts)).toEqual([1, 2]);
  });
  it("preserves all optional fields round-trip", () => {
    appendEntry(path, entry({
      ts: 5, level: "error", category: "shell", text: "bun test",
      exitCode: 1, durationMs: 340, outputTail: "fail\n", frameId: "c-3", command: "run",
    }));
    const back = tailLoad(path, 100)[0]!;
    expect(back.exitCode).toBe(1);
    expect(back.durationMs).toBe(340);
    expect(back.frameId).toBe("c-3");
    expect(back.command).toBe("run");
  });
  it("creates the parent directory if missing", () => {
    const nested = join(dir, "deep", "subdir", "messages.log");
    appendEntry(nested, entry({ text: "x" }));
    expect(existsSync(nested)).toBe(true);
  });
});

describe("log-persist · tailLoad", () => {
  it("returns at most `max` entries (most recent)", () => {
    for (let i = 0; i < 10; i++) appendEntry(path, entry({ ts: i, text: `n${i}` }));
    const back = tailLoad(path, 3);
    expect(back.map(e => e.text)).toEqual(["n7", "n8", "n9"]);
  });
  it("skips a corrupt/truncated final line without failing", () => {
    _writeRaw(path, '{"ts":1,"level":"info","category":"editor","text":"ok"}\n{broken\n');
    const back = tailLoad(path, 100);
    expect(back.map(e => e.text)).toEqual(["ok"]);
  });
  it("tops up from the rotated .1 file when the active file is short", () => {
    _writeRaw(`${path}.1`, '{"ts":1,"level":"info","category":"editor","text":"old1"}\n{"ts":2,"level":"info","category":"editor","text":"old2"}\n');
    appendEntry(path, entry({ ts: 3, text: "fresh" }));
    const back = tailLoad(path, 100);
    expect(back.map(e => e.text)).toEqual(["old1", "old2", "fresh"]);
  });
  it("returns empty array when no log exists", () => {
    expect(tailLoad(join(dir, "nonexistent.log"), 100)).toEqual([]);
  });
});

describe("log-persist · rotation", () => {
  it("rotates to .1 when MAX_BYTES is exceeded", () => {
    // Write one entry that brings the file close to MAX_BYTES, then another
    // that should trigger rotation.
    const big = "x".repeat(MAX_BYTES);
    _writeRaw(path, `{"ts":1,"level":"info","category":"editor","text":"${big}"}\n`);
    const sizeBefore = statSync(path).size;
    expect(sizeBefore).toBeGreaterThan(MAX_BYTES - 100);
    appendEntry(path, entry({ ts: 2, text: "trigger" }));
    // The rotated .1 file should now hold the big entry.
    expect(existsSync(`${path}.1`)).toBe(true);
    const back = tailLoad(path, 100);
    expect(back.map(e => e.text)).toContain("trigger");
  });
});

import { describe, expect, it } from "bun:test";
import { Log, parseJsonl } from "../../src/editor/log-store.ts";
import type { LogEntry } from "../../src/editor/log-entry.ts";

const e = (over: Partial<LogEntry> & { text: string }): LogEntry => ({
  ts: over.ts ?? 1000,
  level: over.level ?? "info",
  category: over.category ?? "editor",
  ...over,
});

describe("Log · ring eviction", () => {
  it("evicts oldest when over max", () => {
    const log = new Log();
    log.maxSize = 3;
    log.log(e({ ts: 1, text: "a" }));
    log.log(e({ ts: 2, text: "b" }));
    log.log(e({ ts: 3, text: "c" }));
    log.log(e({ ts: 4, text: "d" }));
    expect(log.all().map(x => x.text)).toEqual(["b", "c", "d"]);
  });
  it("at exactly max capacity does not evict", () => {
    const log = new Log();
    log.maxSize = 3;
    log.log(e({ ts: 1, text: "a" }));
    log.log(e({ ts: 2, text: "b" }));
    log.log(e({ ts: 3, text: "c" }));
    expect(log.all().length).toBe(3);
  });
  it("maxSize = 0 disables logging", () => {
    const log = new Log();
    log.maxSize = 0;
    expect(log.log(e({ text: "x" }))).toBeNull();
    expect(log.all().length).toBe(0);
  });
});

describe("Log · level filter", () => {
  it("suppresses entries below minLevel", () => {
    const log = new Log();
    log.minLevel = "warn";
    expect(log.log(e({ level: "debug", text: "d" }))).toBeNull();
    expect(log.log(e({ level: "info", text: "i" }))).toBeNull();
    expect(log.log(e({ level: "warn", text: "w" }))).not.toBeNull();
    expect(log.log(e({ level: "error", text: "e" }))).not.toBeNull();
    expect(log.all().map(x => x.text)).toEqual(["w", "e"]);
  });
});

describe("Log · getEntries filters", () => {
  it("filters by view (messages mirror rule)", () => {
    const log = new Log();
    log.log(e({ category: "editor", level: "info", text: "ed" }));
    log.log(e({ category: "shell", level: "info", text: "sh-ok" }));
    log.log(e({ category: "shell", level: "error", text: "sh-fail" }));
    log.log(e({ category: "daemon", level: "warn", text: "dm-warn" }));
    log.log(e({ category: "daemon", level: "info", text: "dm-info" }));

    const msgs = log.getEntries({ view: "messages" }).map(x => x.text);
    expect(msgs).toContain("ed");       // editor category always in messages
    expect(msgs).toContain("sh-fail");  // error mirrors
    expect(msgs).toContain("dm-warn");  // warn mirrors
    expect(msgs).not.toContain("sh-ok"); // info shell does not mirror
    expect(msgs).not.toContain("dm-info"); // info daemon does not mirror
  });
  it("filters by raw category", () => {
    const log = new Log();
    log.log(e({ category: "shell", text: "s1" }));
    log.log(e({ category: "editor", text: "e1" }));
    expect(log.getEntries({ category: "shell" }).map(x => x.text)).toEqual(["s1"]);
  });
  it("level filter applies on top of view", () => {
    const log = new Log();
    log.log(e({ category: "editor", level: "info", text: "i" }));
    log.log(e({ category: "editor", level: "error", text: "e" }));
    expect(log.getEntries({ view: "messages", level: "error" }).map(x => x.text)).toEqual(["e"]);
  });
  it("last N returns the most recent", () => {
    const log = new Log();
    for (let i = 0; i < 10; i++) log.log(e({ ts: i, text: `n${i}` }));
    const out = log.getEntries({ last: 3 }).map(x => x.text);
    expect(out).toEqual(["n7", "n8", "n9"]);
  });
});

describe("Log · lazy render (the RFC-017 blocker fix)", () => {
  it("returns the same string on a cache hit (no recompute)", () => {
    const log = new Log();
    log.log(e({ text: "hello" }));
    const a = log.render("messages");
    const b = log.render("messages");
    expect(b).toBe(a);
    expect(b).toContain("hello");
  });
  it("recomputes after a write invalidates the view", () => {
    const log = new Log();
    log.log(e({ text: "first" }));
    const before = log.render("messages");
    log.log(e({ text: "second" }));
    const after = log.render("messages");
    expect(after).not.toBe(before);
    expect(after).toContain("second");
    expect(after).toContain("first");
  });
  it("a shell error write invalidates the messages view (mirror correctness)", () => {
    const log = new Log();
    log.log(e({ text: "ed" }));
    const before = log.render("messages");
    expect(before).toContain("ed");
    expect(before).not.toContain("sh-err");
    log.log(e({ category: "shell", level: "error", text: "sh-err" }));
    const after = log.render("messages");
    expect(after).toContain("sh-err"); // mirrored even though category is shell
  });
  it("category views are independent", () => {
    const log = new Log();
    log.log(e({ category: "shell", text: "s" }));
    log.log(e({ category: "daemon", text: "d" }));
    expect(log.render("shell")).toContain("s");
    expect(log.render("shell")).not.toContain("d");
    expect(log.render("daemon")).toContain("d");
    expect(log.render("daemon")).not.toContain("s");
  });
});

describe("Log · clear / setters", () => {
  it("clear() empties everything", () => {
    const log = new Log();
    log.log(e({ text: "a" }));
    log.clear();
    expect(log.all().length).toBe(0);
    expect(log.render("messages")).toBe("");
  });
  it("clear(category) drops only that category", () => {
    const log = new Log();
    log.log(e({ category: "shell", text: "s" }));
    log.log(e({ category: "editor", text: "e" }));
    log.clear("shell");
    expect(log.all().map(x => x.text)).toEqual(["e"]);
  });
  it("shrinks when maxSize is reduced", () => {
    const log = new Log();
    for (let i = 0; i < 10; i++) log.log(e({ ts: i, text: `n${i}` }));
    log.maxSize = 3;
    expect(log.all().length).toBe(3);
    expect(log.all().map(x => x.text)).toEqual(["n7", "n8", "n9"]);
  });
});

describe("Log · JSONL serialize/parse", () => {
  it("serializes all entries one per line", () => {
    const log = new Log();
    log.log(e({ ts: 1, text: "a" }));
    log.log(e({ ts: 2, text: "b" }));
    const out = log.serializeJsonl();
    const lines = out.split("\n").filter(l => l.length > 0);
    expect(lines.length).toBe(2);
  });
  it("parseJsonl round-trips and tail-caps", () => {
    const log = new Log();
    for (let i = 0; i < 10; i++) log.log(e({ ts: i, text: `n${i}`, category: "editor" }));
    const text = log.serializeJsonl();
    const back = parseJsonl(text, 3);
    expect(back.length).toBe(3);
    expect(back.map(x => x.text)).toEqual(["n7", "n8", "n9"]);
  });
  it("parseJsonl skips corrupt lines", () => {
    const text = '{"ts":1,"level":"info","category":"editor","text":"ok"}\n{broken\n{"ts":2,"level":"info","category":"editor","text":"ok2"}\n';
    const back = parseJsonl(text, 100);
    expect(back.map(x => x.text)).toEqual(["ok", "ok2"]);
  });
});

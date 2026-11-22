import { describe, test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

/**
 * @file grep-rg.test.ts
 * @description #308 — the rg-event->hit protocol matrix + the exec-lookup
 * primitive: plain/colon/Unicode paths, multi-submatch single events,
 * empty submatches, base64 path (excluded) vs lines (decoded/replacement),
 * malformed lines, byte→char columns, invalid-offset fallback.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i308-"));
  dirs.push(dir);
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/commands/grep)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
import { beforeEach, afterAll } from "bun:test";

/** Run rg --json for REAL; return ONLY the match events. */
const rgMatches = (pattern: string, scope: string): string[] =>
  execFileSync("rg", ["--json", "--smart-case", "--", pattern, scope], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes('"type":"match"'));

/** Evaluate through the interpreter (the primitives are global ops). */
const q = (expr: string) => e(editor, expr);
/** Hex-encode a payload for a T-Lisp string literal (the reader
 *  strips backslash escapes — raw JSON quotes break). */
const hx = (s: string) => Buffer.from(s, "utf8").toString("hex");

// Field extractors (the result is a HASHMAP: hit/flag; the hit is a
// hashmap: file/line/col/text). Payloads ride hex-decode (the T-Lisp
// reader strips backslash escapes — raw JSON quotes break).
const flagOf = (ev: string) => q(`(hashmap-get (rg-event->hit (hex-decode "${hx(ev)}")) "flag")`);
const field = (ev: string, k: string) => q(`(hashmap-get (hashmap-get (rg-event->hit (hex-decode "${hx(ev)}")) "hit") "${k}")`);
const hitNil = (ev: string) => q(`(null (hashmap-get (rg-event->hit (hex-decode "${hx(ev)}")) "hit"))`);

describe("#308 — rg-event->hit (the output protocol)", () => {
  test("PLAIN match: file/line/col/text from a real rg event", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello world\n");
    const [ev] = rgMatches("hello", ".");
    expect(String(field(ev, "file").value)).toContain("a.txt");
    expect(String(field(ev, "text").value)).toContain("hello world");
    expect(String(field(ev, "col").value)).toBe("1"); // byte 0 → col 1
  });

  test("COLON-PATH and UNICODE content", () => {
    writeFileSync(join(process.cwd(), "we:ird.txt"), "ünïcødé needle here\n");
    const [ev] = rgMatches("needle", ".");
    expect(String(field(ev, "file").value)).toContain("we:ird.txt");
    expect(String(field(ev, "text").value)).toContain("ünïcødé needle here");
  });

  test("BYTE→CHAR column: a multi-submatch event reports the FIRST submatch", () => {
    writeFileSync(join(process.cwd(), "m.txt"), "xx needle zz needle\n");
    const [ev] = rgMatches("needle", ".");
    // "xx needle": byte start 3 → 3 code points → col 4 (the FIRST
    // submatch — one event, two matches).
    expect(String(field(ev, "col").value)).toBe("4");
  });

  test("UNICODE column: code points counted, not bytes", () => {
    writeFileSync(join(process.cwd(), "u.txt"), "ünïcødé needle\n");
    const [ev] = rgMatches("needle", ".");
    // 8 code points precede the match (ünïcødé + space) → col 9
    // (a BYTE column would say 13).
    expect(String(field(ev, "col").value)).toBe("9");
  });

  test("a NON-MATCH event (summary/begin) → hit nil, flag nil", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello\n");
    const evs = execFileSync("rg", ["--json", "--", "hello", "."], { encoding: "utf8" })
      .split("\n").filter((l) => l.includes('"type":"begin"'));
    const r = hitNil(evs[0]);
    expect(["t", "true"]).toContain(String(r.value)); // hit nil
    const f = flagOf(evs[0]);
    expect(["nil", "null", "false"]).toContain(String(f.value)); // flag nil
  });

  test("MALFORMED JSON line → flag malformed", () => {
    const f = q('(hashmap-get (rg-event->hit "not json at all") "flag")');
    expect(String(f.value)).toContain("malformed");
  });

  test("BASE64 path (undecodable) → EXCLUDED + flagged", () => {
    // Hand-build an event whose path.bytes is invalid UTF-8.
    const ev = JSON.stringify({
      type: "match",
      data: {
        path: { bytes: Buffer.from([0xff, 0xfe, 0x00]).toString("base64") },
        lines: { text: "content\n" },
        line_number: 1,
        submatches: [{ start: 0, end: 7, match: { text: "content" } }],
      },
    });
    const f = flagOf(ev);
    expect(String(f.value)).toContain("undecodable-path");
    const h = hitNil(ev);
    expect(["t", "true"]).toContain(String(h.value)); // no hit
  });

  test("BASE64 lines (valid UTF-8) → decoded text; (invalid) → degraded + appended", () => {
    const okEv = JSON.stringify({
      type: "match",
      data: {
        path: { text: "ok.txt" },
        lines: { bytes: Buffer.from("decoded\n", "utf8").toString("base64") },
        line_number: 1,
        submatches: [{ start: 0, end: 8, match: { text: "decoded" } }],
      },
    });
    expect(String(field(okEv, "text").value)).toContain("decoded");

    const badEv = JSON.stringify({
      type: "match",
      data: {
        path: { text: "bad.txt" },
        lines: { bytes: Buffer.from([0x41, 0xff, 0x42]).toString("base64") },
        line_number: 1,
        submatches: [{ start: 0, end: 2, match: { text: "A" } }],
      },
    });
    const f2 = flagOf(badEv);
    expect(String(f2.value)).toContain("degraded-text"); // flagged
    expect(String(field(badEv, "file").value)).toContain("bad.txt"); // appended
  });

  test("EMPTY submatches array → column 1", () => {
    const ev = JSON.stringify({
      type: "match",
      data: {
        path: { text: "e.txt" },
        lines: { text: "somewhere\n" },
        line_number: 2,
        submatches: [],
      },
    });
    expect(String(field(ev, "file").value)).toContain("e.txt");
    expect(String(field(ev, "col").value)).toBe("1"); // the fallback
    const f = flagOf(ev);
    expect(["nil", "null", "false"]).toContain(String(f.value)); // NOT degraded
  });
});

describe("#308 — exec-lookup", () => {
  test("rg found; a bogus name not", () => {
    expect(String(q('(exec-lookup "rg")').value)).toContain("t");
    expect(String(q('(exec-lookup "definitely-not-a-real-binary-xyz")').value)).toContain("false");
  });
});

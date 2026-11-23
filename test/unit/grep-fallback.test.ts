import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-fallback.test.ts
 * @description #309 — the standard-grep fallback backend: the
 * one-grep-per-file transport (linenum:text parsing, colons in text,
 * NUL truncation, newline paths), exit aggregation (mixed 0/1 → done
 * + K-of-N; all-1 → no-matches; empty → no-spawn; ≥2 stops),
 * cancellation, ASCII smart-case, -I both branches, ignore exposure.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);
const dump = (ed: Editor) => String(e(ed, "(editor/commands/grep/grep-fallback-dump)").value);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

/** Record which grep flavor answered (BSD/GNU — the spec's portability note). */
const grepFlavor = execFileSync("grep", ["--version"], { encoding: "utf8" }).split("\n")[0] ?? "unknown";

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i309-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, '(editor/commands/grep/grep-backend-set! "grep")');
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function waitStatus(needles: string[], tries = 200, ms = 25): Promise<string> {
  let last = st(editor);
  for (let i = 0; i < tries; i++) {
    last = st(editor);
    if (needles.some((n) => last.includes(n))) return last;
    await sleep(ms);
  }
  return last;
}

describe("#309 — the fallback transport", () => {
  test("linenum:text parsing; col=1; DEFAULT_IGNORES applies (node_modules skipped)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello world\nbye\n");
    writeFileSync(join(process.cwd(), "b.md"), "nothing here\n");
    mkdirSync(join(process.cwd(), "node_modules"));
    writeFileSync(join(process.cwd(), "node_modules", "junk.txt"), "hello junk\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(dump(editor)).toContain("done=2/2");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("a.txt:1:1:hello world");
    expect(v).not.toContain("junk");
    expect(v).toContain("1 of 2 files matched");
  });

  test("match text containing COLONS survives (the FIRST colon terminates the number)", async () => {
    writeFileSync(join(process.cwd(), "c.txt"), "key: value: more\n");
    e(editor, '(editor/commands/grep/grep-search "key")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("key: value: more");
  });

  test("a NEWLINE-IN-PATH filename is argv-safe (enumerated + searched)", async () => {
    const weird = join(process.cwd(), "we\nird.txt");
    writeFileSync(weird, "hello newline path\n");
    e(editor, '(editor/commands/grep/grep-search "newline")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("hello newline path");
  });

  test("NUL LEAKAGE truncates at the NUL and counts binary-skipped (parser-level pin)", async () => {
    // This host's BSD grep suppresses binary-file output even
    // without -I, so live leakage can't be staged here; the rule
    // covers greps that DO emit the line. Pin the PARSER against a
    // fabricated leaked line on a live generation.
    writeFileSync(join(process.cwd(), "a.txt"), "anchor\n");
    e(editor, '(editor/commands/grep/grep-search "anchor")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    const r = e(editor, '(condition-case nil (editor/commands/grep/grep-fallback-handle (concat "7:leak" (hex-decode "00") "tail")) (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).not.toContain("THREW");
    // A COMPLETED generation refuses new hits (the stale drop) —
    // the observable truncation signal is the counter.
    expect(dump(editor)).toContain("binskip=1");
  });

  test("with -I SUPPORTED, a NUL-bearing file is skipped whole (no hit, no crash)", async () => {
    writeFileSync(join(process.cwd(), "n.txt"), "before\0after\n");
    e(editor, "(editor/commands/grep/grep-fallback-state! t t)");
    e(editor, '(editor/commands/grep/grep-search "before")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("no matches");
    expect(dump(editor)).toContain("binskip=0");
  });
});

describe("#309 — exit aggregation", () => {
  test("mixed 0/1 exits → done with the K-of-N diagnostic", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello\n");
    writeFileSync(join(process.cwd(), "b.txt"), "nothing\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(dump(editor)).toContain("matched=1");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("1 of 2 files matched");
  });

  test("all exit-1 → no-matches", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "nothing\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("no matches");
    expect(dump(editor)).toContain("matched=0");
  });

  test("EMPTY enumeration → no-matches WITHOUT spawning", async () => {
    // An empty scope dir: walk yields nothing.
    const empty = join(process.cwd(), "empty-dir");
    mkdirSync(empty);
    e(editor, '(editor/commands/grep/grep-search "hello" "' + empty + '")');
    const s = await waitStatus(["no matches", "hits", "error"]);
    expect(s).toContain("no matches");
    expect(dump(editor)).toContain("pid=nil");
    expect(dump(editor)).toContain("/0");
  });

  test("exit ≥2 STOPS enumeration → error naming the file", async () => {
    // A directory masquerading... use a stub grep that exits 2.
    const stub = join(process.cwd(), "grep-exit2.sh");
    writeFileSync(stub, "#!/bin/sh\nexit 2\n");
    execFileSync("chmod", ["+x", stub]);
    e(editor, `(editor/commands/grep/grep-fallback-executable-set! "${stub}")`);
    writeFileSync(join(process.cwd(), "a.txt"), "hello\n");
    writeFileSync(join(process.cwd(), "b.txt"), "hello\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["error", "hits", "no matches"]);
    expect(s).toContain("error");
    // Stopped after the FIRST file (the stub script itself is also
    // enumerated — the total is 3 here; only the stop matters).
    expect(dump(editor)).toContain("done=1/");
    expect(dump(editor)).toContain("matched=0");
  });

  test("CANCELLATION: a new search kills the running sequence (guards drop the rest)", async () => {
    // A slow stub grep: the sequence hangs mid-file.
    const stub = join(process.cwd(), "grep-slow.sh");
    writeFileSync(stub, "#!/bin/sh\nsleep 30\nexit 0\n");
    execFileSync("chmod", ["+x", stub]);
    e(editor, `(editor/commands/grep/grep-fallback-executable-set! "${stub}")`);
    // Pre-seed the -I probe (the state seam): the synchronous probe
    // would RUN the slow stub and block the editor for its 30s.
    e(editor, "(editor/commands/grep/grep-fallback-state! t t)");
    writeFileSync(join(process.cwd(), "a.txt"), "hello\n");
    writeFileSync(join(process.cwd(), "b.txt"), "hello\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    await sleep(300);
    expect(dump(editor)).toContain("pid=");
    expect(dump(editor)).not.toContain("pid=nil");
    // A NEW search (real grep) supersedes: the old sequence's
    // sentinel drops (stranger pid), the new one runs to done.
    e(editor, '(editor/commands/grep/grep-fallback-executable-set! "grep")');
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("2 hits");
    expect(dump(editor)).toContain("matched=2");
  });
});

describe("#309 — case semantics + -I + exposure", () => {
  test("ASCII smart-case: lowercase pattern matches CASE-INSENSITIVELY (rg parity)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "Hello World\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
  });

  test("ASCII smart-case: uppercase in pattern → case-SENSITIVE", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello world\nHello World\n");
    e(editor, '(editor/commands/grep/grep-search "Hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("Hello World");
    expect(v).not.toContain("hello world\n");
  });

  test("-I both branches: forced-supported runs with -I; forced-unsupported drops it (state seam)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "plain text\n");
    e(editor, "(editor/commands/grep/grep-fallback-state! t t)");
    e(editor, '(editor/commands/grep/grep-search "plain")');
    let s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(dump(editor)).toContain("i-ok=t");
    e(editor, "(editor/commands/grep/grep-fallback-state! t nil)");
    e(editor, '(editor/commands/grep/grep-search "plain")');
    s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(dump(editor)).toContain("i-ok=nil");
  });

  test("project-ignore-dirs EXPOSES the walk's DEFAULT_IGNORES (read-only)", () => {
    const n = Number(e(editor, "(length (project-ignore-dirs))").value);
    expect(n).toBeGreaterThan(5);
    const has = String(e(editor, '(member "node_modules" (project-ignore-dirs))').value);
    expect(["nil", "null", "false"].includes(has)).toBe(false);
  });

  test(`portability record: this host's grep answered (${grepFlavor})`, async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "hello\n");
    e(editor, '(editor/commands/grep/grep-search "hello")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    // Recorded in the ADR: CI = GNU, dev = BSD.
    expect(grepFlavor.length).toBeGreaterThan(0);
  });
});
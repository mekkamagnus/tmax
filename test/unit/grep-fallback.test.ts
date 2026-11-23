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
describe("#309 — gate r1 coverage additions", () => {
  test("AUTO dispatch: rg MISSING (PATH-stubbed) → the fallback answers on the FIRST search", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "autopath needle\n");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-missing-309")');
    // The FIRST search on a fresh auto session must run the FALLBACK
    // (the detection side effect precedes dispatch — gate r1's
    // first-search-went-to-fallback bug).
    e(editor, '(editor/commands/grep/grep-search "autopath")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(dump(editor)).toContain("matched=1");
    // gate r2: DISCRIMINATING — the registered generation's backend
    // field is "grep" (both backends find the needle; the shared
    // gen counter moves either way — only this pins the dispatch).
    expect(String(e(editor, "(editor/commands/grep/grep-backend-used-get)").value)).toBe("grep");
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "rg")');
  });

  test("AUTO dispatch: rg PRESENT → rg on the FIRST search (the inverse)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "rgfirst needle\n");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "rg")');
    e(editor, '(editor/commands/grep/grep-search "rgfirst")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    // gate r2: DISCRIMINATING — the backend field is "rg".
    expect(String(e(editor, "(editor/commands/grep/grep-backend-used-get)").value)).toBe("rg");
  });

  test("SPAWN FAILURE mid-sequence → #308 rollback (prior content restored)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "keepme needle\n");
    e(editor, '(editor/commands/grep/grep-search "keepme")');
    let s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    const prior = strip(bufferText(editor));
    // A BAD-SHEBANG stub: exec-lookup passes (exists + exec bit)
    // but the spawn itself throws ENOENT → rollback restores the
    // prior generation's content.
    const bad = join(process.cwd(), "grep-badshebang-309.sh");
    writeFileSync(bad, "#!/nonexistent/interpreter-309\nexit 0\n");
    execFileSync("chmod", ["+x", bad]);
    e(editor, `(editor/commands/grep/grep-fallback-executable-set! "${bad}")`);
    e(editor, '(editor/commands/grep/grep-search "anything")');
    s = await waitStatus(["hits", "no matches", "error", "failed"]);
    expect(st(editor)).toContain("spawn failed");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toBe(prior);
    e(editor, '(editor/commands/grep/grep-fallback-executable-set! "grep")');
  });

  test("STRANGER-PID sentinel drops silently (no state change)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "stranger needle\n");
    e(editor, '(editor/commands/grep/grep-search "stranger")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    const d0 = dump(editor);
    e(editor, "(editor/commands/grep/grep-fallback-sentinel 999999 0)");
    expect(dump(editor)).toBe(d0);
  });

  test("g-RERUN mid-availability: the fallback's rerun closure re-runs it", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "rerun needle\n");
    e(editor, '(editor/commands/grep/grep-search "rerun")');
    let s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    const gen1 = Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value);
    e(editor, "(editor/commands/grep/grep-rerun)");
    s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    expect(Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBeGreaterThan(gen1);
  });

  test("MISSING SCOPE errors honestly (no silent no-matches — gate r1)", async () => {
    e(editor, '(editor/commands/grep/grep-search "x" "/nonexistent/scope-309")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("error");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("no such directory");
    expect(dump(editor)).toContain("/0");
  });
});

describe("#309 — gate r3", () => {
  test("FILE-as-scope errors honestly (rg searches single files; the walk's ENOTDIR was swallowed)", async () => {
    writeFileSync(join(process.cwd(), "afile.txt"), "x\n");
    e(editor, '(editor/commands/grep/grep-search "x" "' + join(process.cwd(), "afile.txt") + '")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("error");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("not a directory");
  });

  test("unreadable DIRECTORY errors honestly (chmod 000; skipped if the host auto-heals perms)", async () => {
    const locked = join(process.cwd(), "locked-dir");
    mkdirSync(locked);
    writeFileSync(join(locked, "inside.txt"), "x\n");
    execFileSync("chmod", ["000", locked]);
    try {
      e(editor, '(editor/commands/grep/grep-search "x" "' + locked + '")');
      const s = await waitStatus(["hits", "no matches", "error"]);
      expect(s).toContain("error");
      e(editor, '(buffer-switch "*grep*")');
      expect(strip(bufferText(editor))).toContain("unreadable directory");
    } finally {
      execFileSync("chmod", ["755", locked]);
    }
  });

  test("the stderr-pending stash RESETS per run (no stale-splice)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "resetcheck\n");
    e(editor, '(editor/commands/grep/grep-search "resetcheck")');
    const s = await waitStatus(["hits", "no matches", "error"]);
    expect(s).toContain("1 hits");
    // The seam: the stderr stash is empty after a completed run (a
    // stale stranger entry would survive otherwise).
    const r = e(editor, '(condition-case nil (progn (editor/commands/grep/grep-fallback-replay-pending) "ok") (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).toBe("ok");
  });
});

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-backend.test.ts
 * @description #308 — the T-Lisp rg BACKEND: the selection matrix, the
 * provisional protocol (spawn-failure rollback), streaming through the
 * #307 producer interface, exit-code mapping + diagnostics, generation
 * guards (late output after kill), dash-prefixed patterns vs REAL rg.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i308b-"));
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

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};

/** Wait for the run to complete (status leaves the searching state). */
const waitDone = async (ed: Editor, ms = 8000) => {
  for (let i = 0; i < ms / 25; i++) {
    const s = st(ed);
    if (s.includes("hits") || s.includes("no matches") || s.includes("error") || s.includes("spawn failed") || s.includes("not on PATH") || s.includes("pending")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  return "TIMEOUT:" + st(ed);
};

describe("#308 — the backend", () => {
  test("STREAMING search: hits land in *grep* through the producer interface", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "alpha needle\nbeta\n");
    writeFileSync(join(process.cwd(), "b.txt"), "gamma\nneedle two\n");
    e(editor, '(grep-search "needle" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("2 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("a.txt:1");
    expect(v).toContain("b.txt:2");
    expect(v).toContain("alpha needle");
  });

  test("NO MATCHES: exit 1 → the no-matches state", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "nothing here\n");
    e(editor, '(grep-search "zzz-absent" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("no matches");
  });

  test("DASH-PREFIXED pattern + dir vs REAL rg (structural, no flags)", async () => {
    writeFileSync(join(process.cwd(), "-weird.txt"), "-pattern-found\n");
    e(editor, '(grep-search "-pattern-found" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("-weird.txt");
  });

  test("SPAWN FAILURE → rollback (the prior generation's content restored)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "first needle\n");
    e(editor, '(grep-search "first" ".")');
    await waitDone(editor);
    e(editor, '(buffer-switch "*grep*")');
    const prior = strip(bufferText(editor));
    // Force spawn failure: a bogus backend binary via the rg path.
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    // Simulate: register a generation, then a failed spawn (make-process
    // with a nonexistent executable returns an error string).
    e(editor, '(editor/commands/grep/grep-rg-rollback-after-register)');
    e(editor, '(buffer-switch "*grep*")');
    // The rollback of the only post-completion generation restores the
    // pre-REGISTER content — which was the completed search's buffer.
    expect(strip(bufferText(editor))).toContain(prior.slice(0, 20));
  });

  test("THE MATRIX rows exercisable with rg PRESENT: rg-explicit t; grep → #309 pending; garbage → auto", async () => {
    // rg-explicit with rg ON PATH → available (the missing-rg row's
    // named error is the same branch — unreachable while rg exists).
    e(editor, '(editor/commands/grep/grep-backend-set! "rg")');
    const r1 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r1.value)).toContain("t");
    e(editor, '(editor/commands/grep/grep-backend-set! "grep")');
    e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(st(editor)).toContain("pending");
    // An unrecognized value falls through to AUTO (detected → t).
    e(editor, '(editor/commands/grep/grep-backend-set! "nonexistent-binary-xyz")');
    const r3 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r3.value)).toContain("t");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
  });

  test("LATE OUTPUT after kill: superseded callbacks drop", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "live needle\n");
    e(editor, '(grep-search "live" ".")');
    // Immediately re-run (kills the first).
    e(editor, '(grep-search "live" ".")');
    const s = await waitDone(editor);
    // Only ONE generation's hits — no duplication from the killed run.
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect((v.match(/live needle/g) || []).length).toBe(1);
  });

  // ── gate r1 fixes ───────────────────────────────────────────────────

  test("REAL spawn failure (vanished executable) → rollback + prior content restored", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "first needle\n");
    e(editor, '(grep-search "first" ".")');
    await waitDone(editor);
    e(editor, '(buffer-switch "*grep*")');
    const prior = strip(bufferText(editor));
    expect(prior).toContain("first needle");
    // A vanished executable: detection already cached true (rg WAS
    // there), the spawn itself throws ENOENT — condition-case must
    // catch it (the evaluator throws Either.left; the cond's rollback
    // branch was dead code before).
    e(editor, '(editor/commands/grep/grep-rg-detected-set! t)');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-xyz-308")');
    e(editor, '(grep-search "zzz" ".")');
    expect(st(editor)).toContain("spawn failed");
    const dump = String(e(editor, "(editor/commands/grep/grep-rg-dump)").value);
    expect(dump).toContain("gen=nil");
    // The per-run reset RAN (and the failed spawn made zero filter
    // calls) — deterministic proof the counters restart per run.
    expect(dump).toContain("fcalls=0");
    expect(dump).toContain("exit=-99");
    expect(dump).toContain("lastflag=??");
    e(editor, '(buffer-switch "*grep*")');
    // The prior completed search's content is restored — nothing
    // half-registered on 'searching…'.
    expect(strip(bufferText(editor))).toContain("first needle");
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "rg")');
  });

  test("STDERR ROUTED: a bad scope dir → rg's real stderr in the error (not '(no stderr)')", async () => {
    e(editor, '(grep-search "needle" "./definitely-missing-scope-308")');
    const s = await waitDone(editor);
    expect(s).toContain("error");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("grep error:");
    expect(v).toContain("No such file");
    expect(v).not.toContain("(no stderr)");
  });

  test("SENTINEL UNIT: exit ≥2 with NO stderr → 'rg exited N (no stderr)'", () => {
    const gen = Number(e(editor,
      '(grep-test-producer (list (list "register" (hashmap "backend" "rg" "pattern" "x" "scope" "." "rerun" (lambda () nil)))))').value);
    e(editor, `(editor/commands/grep/grep-rg-test-state! ${gen} 424242 "" 0 0)`);
    e(editor, '(editor/commands/grep/grep-rg-sentinel 424242 2)');
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("rg exited 2 (no stderr)");
  });

  test("DIAGNOSTICS AGGREGATE on the DONE path (not just error)", () => {
    const gen = Number(e(editor,
      '(grep-test-producer (list (list "register" (hashmap "backend" "rg" "pattern" "x" "scope" "." "rerun" (lambda () nil)))))').value);
    e(editor, `(editor/commands/grep/grep-rg-test-state! ${gen} 424243 "" 1 2)`);
    e(editor, '(editor/commands/grep/grep-rg-sentinel 424243 0)');
    e(editor, '(buffer-switch "*grep*")');
    // done + diagnostics + zero hits → the no-matches state CARRIES
    // the aggregation (all hits were undecodable ⇒ truthful).
    expect(strip(bufferText(editor)))
      .toContain("(1 undecodable paths, 2 unparseable lines)");
  });

  test("DASH-PREFIXED dir as the SCOPE vs REAL rg", async () => {
    mkdirSync(join(process.cwd(), "-dashdir"));
    writeFileSync(join(process.cwd(), "-dashdir", "inner.txt"), "dashdir needle\n");
    e(editor, '(grep-search "dashdir" "-dashdir")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("inner.txt");
  });

  test("UNICODE PATH: a non-ASCII filename round-trips through rg --json", async () => {
    writeFileSync(join(process.cwd(), "ünïcødé-308.txt"), "unicode path needle\n");
    e(editor, '(grep-search "unicode path" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("ünïcødé-308.txt");
  });

  test("NIL backend coalesces to auto (the string= hazard) — no throw", () => {
    e(editor, '(editor/commands/grep/grep-backend-set! nil)');
    const r = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r.value)).toContain("t"); // rg present → auto detects
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
  });

  // ── gate r2: the two unasserted matrix ERROR rows ──────────────────

  test("MATRIX auto + rg MISSING → the named no-backend error", () => {
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-missing-308")');
    const r = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r.value)).not.toContain("true"); // unavailable
    expect(st(editor)).toContain("rg missing (grep fallback pending #309)");
  });

  test("MATRIX rg-explicit + rg MISSING → the named not-on-PATH error", () => {
    e(editor, '(editor/commands/grep/grep-backend-set! "rg")');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-missing-308")');
    const r = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r.value)).not.toContain("true"); // unavailable
    expect(st(editor)).toContain("grep-backend is rg but rg is not on PATH");
  });

  test("ERROR + stderr + DIAGNOSTICS: the aggregation FOLLOWS the stderr message", () => {
    const gen = Number(e(editor,
      '(grep-test-producer (list (list "register" (hashmap "backend" "rg" "pattern" "x" "scope" "." "rerun" (lambda () nil)))))').value);
    e(editor, `(editor/commands/grep/grep-rg-test-state! ${gen} 424244 "boom: bad regex\n" 1 2)`);
    e(editor, '(editor/commands/grep/grep-rg-sentinel 424244 2)');
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    const i = v.indexOf("boom: bad regex");
    const j = v.indexOf("(1 undecodable paths, 2 unparseable lines)");
    expect(i).toBeGreaterThanOrEqual(0); // stderr text present
    expect(j).toBeGreaterThan(i); // diagnostics FOLLOW it
  });

  // ── valve r1 fixes ──────────────────────────────────────────────────

  test("EARLY STDERR (the spawn→setq race) stashes and replays with the pid", async () => {
    e(editor, '(editor/commands/grep/grep-rg-test-state! nil nil "" 0 0)');
    e(editor, '(editor/commands/grep/grep-rg-stderr-filter 424245 (hex-decode "' +
      Buffer.from("early stderr line\n", "utf8").toString("hex") + '"))');
    const gen = Number(e(editor,
      '(grep-test-producer (list (list "register" (hashmap "backend" "rg" "pattern" "x" "scope" "." "rerun" (lambda () nil)))))').value);
    e(editor, `(editor/commands/grep/grep-rg-test-state! ${gen} 424245 "" 0 0)`);
    e(editor, '(editor/commands/grep/grep-rg-replay-pending)');
    e(editor, '(editor/commands/grep/grep-rg-sentinel 424245 2)');
    e(editor, '(buffer-switch "*grep*")');
    // The stashed early stderr reached the completion message (valve
    // r1: it used to be DROPPED — '(no stderr)').
    expect(strip(bufferText(editor))).toContain("early stderr line");
  });

  test("MULTI-LINE stderr is preserved COMPLETE (one trailing newline chomped)", () => {
    const gen = Number(e(editor,
      '(grep-test-producer (list (list "register" (hashmap "backend" "rg" "pattern" "x" "scope" "." "rerun" (lambda () nil)))))').value);
    e(editor, `(editor/commands/grep/grep-rg-test-state! ${gen} 424246 "line one\nline two\n" 0 0)`);
    e(editor, '(editor/commands/grep/grep-rg-sentinel 424246 2)');
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("line one");
    expect(v).toContain("line two"); // not first-line-truncated
  });
});

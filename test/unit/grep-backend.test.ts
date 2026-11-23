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

  test("THE MATRIX rows exercisable with rg PRESENT: rg-explicit t; grep (#309 LANDED) t; garbage → auto", async () => {
    // rg-explicit with rg ON PATH → available (the missing-rg row's
    // named error is the same branch — unreachable while rg exists).
    e(editor, '(editor/commands/grep/grep-backend-set! "rg")');
    const r1 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r1.value)).toContain("t");
    // #309 landed: grep-explicit with grep ON PATH → available (the
    // old 'pending #309' refusal is the new backend).
    e(editor, '(editor/commands/grep/grep-backend-set! "grep")');
    const r2 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r2.value)).toContain("t");
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

  test("MATRIX auto + rg MISSING → FALLS THROUGH to grep (#309); both missing → the named error", () => {
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-missing-308")');
    // rg missing but grep PRESENT → the fallback answers (#309).
    const r = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r.value)).toContain("t");
    // BOTH missing → the named no-backend error.
    e(editor, '(editor/commands/grep/grep-fallback-executable-set! "/nonexistent/grep-missing-309")');
    const r2 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r2.value)).not.toContain("true");
    expect(st(editor)).toContain("no search backend: rg and grep both missing");
    e(editor, '(editor/commands/grep/grep-fallback-executable-set! "grep")');
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

  // ── valve r2 fixes ──────────────────────────────────────────────────

  test("DECODER EOF FLUSH: an incomplete final UTF-8 sequence becomes replacement text", async () => {
    // A child that emits a lone 0xC3 (an incomplete UTF-8 lead byte)
    // and exits — the streaming decoder holds the partial; the EOF
    // flush must deliver it as U+FFFD, not silence (valve r2). The
    // filter/sentinel are GLOBAL defuns (the TS filter evals
    // globally — module fns are invisible there).
    e(editor, '(defvar mp308-out "")');
    e(editor, '(defvar mp308-done nil)');
    e(editor, '(setq mp308-out "")');
    e(editor, '(setq mp308-done nil)');
    e(editor, '(defun mp308-filter (pid out) (setq mp308-out (concat mp308-out out)))');
    e(editor, '(defun mp308-sentinel (pid code) (setq mp308-done t))');
    const r = e(editor, `(make-process :command (list "sh" "-c" (hex-decode "${Buffer.from("printf '\\303'", "utf8").toString("hex")}")) :filter "mp308-filter" :sentinel "mp308-sentinel")`);
    expect(String(r.value)).toMatch(/^\d+$/);
    for (let i = 0; i < 80; i++) {
      if (String(e(editor, '(if mp308-done "t" "nil")').value).includes("t")) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    expect(String(e(editor, '(if mp308-done "t" "nil")').value)).toContain("t");
    const out = String(e(editor, "mp308-out").value);
    expect(out).toContain("�");
  });

  test("SIGNAL-KILLED sentinel exit: SIGTERM through make-process reports 128+15=143", async () => {
    // The platform-correct 128+N synthesis (valve r2 fix 1) — a REAL
    // signal kill through the make-process path, not a synthetic
    // exit-code argument.
    e(editor, '(defvar mp308k-exit nil)');
    e(editor, '(defun mp308k-sentinel (pid code) (setq mp308k-exit code))');
    const r = e(editor, '(make-process :command (list "sleep" "30") :sentinel "mp308k-sentinel")');
    const pid = Number(r.value);
    expect(Number.isFinite(pid)).toBe(true);
    e(editor, `(signal ${pid} "SIGTERM")`);
    for (let i = 0; i < 120; i++) {
      if (!String(e(editor, '(if mp308k-exit "t" "nil")').value).includes("nil")) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    // SIGTERM is 15 on every platform → 143 (not 0, not the adw
    // supervisor's own mapping — THIS is the make-process synthesis).
    expect(Number(e(editor, "mp308k-exit").value)).toBe(143);
  });

  test("STREAMING COMPLETENESS (real workload): a 400-hit rg search lands every hit", async () => {
    // End-to-end completeness over a realistic multi-hit search (a
    // plain streaming check — NOT the decoupling guard; grep's own
    // per-event eval is cheaper than rg's per-file emission, so
    // re-coupling cannot starve GREP reads — the decoupling guard
    // below prices the filter directly at the make-process layer).
    mkdirSync(join(process.cwd(), "bl"));
    for (let i = 0; i < 400; i++) {
      writeFileSync(join(process.cwd(), "bl", `f${i}.txt`), `hit-${i} backlogneedle\n`);
    }
    e(editor, '(grep-search "backlogneedle" "bl")');
    const s = await waitDone(editor);
    expect(s).toContain("400 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("f0.txt");
    expect(v).toContain("f399.txt");
  });

  test("BACKLOG GUARD (priced filter): the sentinel observes the COMPLETE output when evals far outlast the grace", async () => {
    // Invariant: completion NEVER observes a partial stream, even
    // when per-chunk evals (~250ms × 2 measured chunks for 200KB)
    // far outlast the 150ms drain-grace. Mutation-verified depth
    // (three layers, each experimentally probed): (1) pipe
    // backpressure + the `await proc.exited` gate serialize the
    // producer's exit behind reader progress; (2) evalTlisp is
    // SYNCHRONOUS — a running filter eval owns the single thread, so
    // the sentinel callback cannot interleave mid-eval; (3) the
    // post-grace `await filterChain` settles every enqueued eval
    // before the sentinel regardless. Re-coupling reads to evals is
    // therefore UNOBSERVABLE through any pipe-bounded producer —
    // this guard pins the invariant against future async-eval
    // refactors (where the chain-awaits become load-bearing) and
    // against grace/chain regressions in observable combination.
    e(editor, '(defvar mp308b-out "")');
    e(editor, '(defvar mp308b-len-at-done nil)');
    e(editor, '(defvar mp308b-done nil)');
    e(editor, '(defun mp308-burn (n) (if (= n 0) nil (mp308-burn (- n 1))))');
    e(editor, '(defun mp308b-filter (pid out) (mp308-burn 40000) (setq mp308b-out (concat mp308b-out out)))');
    e(editor, '(defun mp308b-sentinel (pid code) (setq mp308b-done t) (setq mp308b-len-at-done (length mp308b-out)))');
    const script = "tr '\\\\0' x < /dev/zero | head -c 200000";
    const r = e(editor, `(make-process :command (list "sh" "-c" (hex-decode "${Buffer.from(script, "utf8").toString("hex")}")) :filter "mp308b-filter" :sentinel "mp308b-sentinel")`);
    expect(Number.isFinite(Number(r.value))).toBe(true);
    for (let i = 0; i < 240; i++) {
      if (String(e(editor, '(if mp308b-done "t" "nil")').value).includes("t")) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    expect(String(e(editor, '(if mp308b-done "t" "nil")').value)).toContain("t");
    // The COMPLETE 200KB was delivered before the sentinel observed
    // the buffer.
    expect(Number(e(editor, "mp308b-len-at-done").value)).toBe(200000);
  });

  test("SIGNAL-KILLED rg END-TO-END: *grep* reports 'rg exited 143 (no stderr)'", async () => {
    // The composed story (gate r6 gap 2): kill rg MID-SEARCH (not
    // the make-process-layer unit) → the sentinel maps SIGTERM to
    // 128+15 → the error completion carries the named exit.
    mkdirSync(join(process.cwd(), "sig"));
    for (let i = 0; i < 3000; i++) {
      writeFileSync(join(process.cwd(), "sig", `s${i}.txt`), "filler content line\n");
    }
    e(editor, '(grep-search "zzz-never-matches-308" "sig")');
    const dump = String(e(editor, "(editor/commands/grep/grep-rg-dump)").value);
    const m = /pid=(\d+)/.exec(dump);
    expect(m).not.toBeNull();
    e(editor, `(signal ${m![1]} "SIGTERM")`);
    const s = await waitDone(editor);
    expect(s).toContain("error");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("rg exited 143 (no stderr)");
  });

  // ── valve r3 fixes ──────────────────────────────────────────────────

  test("SCOPED SEARCH → RET: a relative-scope hit OPENS (no sub/sub doubling)", async () => {
    // rg --json paths are cwd-relative and CARRY the scope prefix;
    // resolve-path used to join the scope AGAIN → sub/sub/a.txt →
    // 'file gone' (valve r3's reproduced finding).
    mkdirSync(join(process.cwd(), "sub"));
    writeFileSync(join(process.cwd(), "sub", "inner308.txt"), "scoped needle here\n");
    e(editor, '(grep-search "scoped needle" "sub")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("sub/inner308.txt");
    e(editor, '(cursor-move 0 0)');
    e(editor, '(editor/commands/grep/grep-ret)');
    // The file OPENED (not 'file gone').
    expect(String(st(editor))).not.toContain("file gone");
    expect(String(e(editor, "(buffer-current)").value)).toContain("inner308.txt");
    expect(strip(bufferText(editor))).toContain("scoped needle here");
  });

  test("SCOPED SEARCH (trailing-slash spelling) → RET still opens (gate r8)", async () => {
    // rg NORMALIZES its emitted paths: scope "sub/" emits
    // "sub/inner.txt" — the prefix check must use the normalized
    // scope or the join doubles the path.
    mkdirSync(join(process.cwd(), "ts"));
    writeFileSync(join(process.cwd(), "ts", "trailing308.txt"), "trailing slash needle\n");
    e(editor, '(grep-search "trailing slash" "ts/")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("trailing308.txt");
    e(editor, '(cursor-move 0 0)');
    e(editor, '(editor/commands/grep/grep-ret)');
    expect(String(st(editor))).not.toContain("file gone");
    expect(String(e(editor, "(buffer-current)").value)).toContain("trailing308.txt");
    expect(strip(bufferText(editor))).toContain("trailing slash needle");
  });
});

/**
 * @file adw-test.test.ts
 * @description Unit tests for the adw-test stage (SPEC-063):
 *   - parseArgs (adw-test.ts)
 *   - resolveInputFrom (adw-test.ts)
 *   - parseBunTestOutput, parseTmaxUseExitCode (tester.ts)
 *   - buildTestStageResult (tester.ts)
 *   - runUnitTrack / runE2eTrack with mocked TesterDeps
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { parseArgs, resolveInputFrom, runTestWithDeps } from "../../adws/adw-test.ts";
import {
  MAX_UNIT_ITERATIONS,
  MAX_E2E_ITERATIONS,
  type RawRunResult,
  type TrackResult,
  type TesterDeps,
  parseBunTestOutput,
  parseTmaxUseExitCode,
  buildTestStageResult,
  ensureAvailable,
  runUnitTrack,
  runE2eTrack,
} from "../../adws/adws-modules/tester.ts";

const okRaw: RawRunResult = { ok: true, exitCode: 0, stdout: "5 pass\n0 fail", stderr: "" };
const failedRaw: RawRunResult = {
  ok: false,
  exitCode: 1,
  stdout: "(test/unit/foo.test.ts)\n✗ fails\n\n1 pass\n1 fail",
  stderr: "",
};
const emptyRaw: RawRunResult = { ok: true, exitCode: 0, stdout: "", stderr: "" };

/** A deps object whose every call is a deterministic Right; tests override per-call. */
function makeDeps(opts: {
  raw?: RawRunResult | (() => RawRunResult);
  onRaw?: (calls: number) => void;
  onCapture?: (calls: number) => void;
}): TesterDeps {
  let rawCalls = 0;
  let captureCalls = 0;
  return {
    run: () => TaskEither.right<string>(""),
    runRaw: () => {
      rawCalls++;
      opts.onRaw?.(rawCalls);
      const value = typeof opts.raw === "function" ? opts.raw() : (opts.raw ?? okRaw);
      return TaskEither.from(async () => Either.right<RawRunResult, string>(value));
    },
    runCapture: () => {
      captureCalls++;
      opts.onCapture?.(captureCalls);
      return TaskEither.right<string>("");
    },
  };
}

function failingSpawnDeps(): TesterDeps {
  return {
    run: () => TaskEither.right<string>(""),
    runRaw: () =>
      TaskEither.from(async () => Either.left<string, RawRunResult>("spawn failed")),
    runCapture: () => TaskEither.right<string>(""),
  };
}

/** Deps whose runCapture always returns Left — verifies the resolve loop survives. */
function failingCaptureDeps(raw: RawRunResult): TesterDeps {
  return {
    run: () => TaskEither.right<string>(""),
    runRaw: () => TaskEither.from(async () => Either.right<RawRunResult, string>(raw)),
    runCapture: () =>
      TaskEither.from(async () => Either.left<string, string>("claude spawn failed")),
  };
}

// ────────────────────────── parseArgs ──────────────────────────────

describe("adw-test parseArgs", () => {
  test("spec path only → Right({ input })", () => {
    const r = parseArgs(["docs/specs/SPEC-063-adw-test.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.input).toBe("docs/specs/SPEC-063-adw-test.md");
      expect(r.right.model).toBeUndefined();
      expect(r.right.id).toBeUndefined();
    }
  });

  test("--model <id> before spec → Right", () => {
    const r = parseArgs(["--model", "glm-5.2", "docs/specs/SPEC-001.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.model).toBe("glm-5.2");
      expect(r.right.input).toBe("docs/specs/SPEC-001.md");
    }
  });

  test("--id <10-char> → Right", () => {
    const r = parseArgs(["--id", "01KVCMJ0QR", "docs/specs/SPEC-001.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.id).toBe("01KVCMJ0QR");
  });

  test("--id with invalid value → Left", () => {
    const r = parseArgs(["--id", "too-short", "docs/specs/SPEC-001.md"]);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("--model without value → Left", () => {
    const r = parseArgs(["--model"]);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("no args → Left (usage)", () => {
    const r = parseArgs([]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__usage__:")).toBe(true);
  });

  test("--help → Left (__help__)", () => {
    const r = parseArgs(["--help"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__help__:")).toBe(true);
  });

  test("extra positional arg → Left", () => {
    const r = parseArgs(["docs/specs/SPEC-001.md", "extra"]);
    expect(Either.isLeft(r)).toBe(true);
  });
});

// ─────────────────────── resolveInputFrom ──────────────────────────

describe("adw-test resolveInputFrom", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "adw-test-"));
  });
  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("SPEC-*.md path that exists → Right({ source: 'path' })", () => {
    const specsDir = join(tmpRoot, "specs");
    mkdirSync(specsDir, { recursive: true });
    const specPath = join(specsDir, "SPEC-001-foo.md");
    writeFileSync(specPath, "# SPEC-001\n");
    const r = resolveInputFrom("SPEC-001-foo.md", join(tmpRoot, "agents"), specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("path");
      expect(r.right.specPath).toBe(specPath);
    }
  });

  test("10-char adw-id with valid state → Right({ source: 'adw-id' })", () => {
    const agentsDir = join(tmpRoot, "agents");
    const id = "01KVCMJ0QR";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ spec_path: "/docs/specs/SPEC-042.md" }),
    );
    const r = resolveInputFrom(id, agentsDir, join(tmpRoot, "specs"));
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("adw-id");
      expect(r.right.specPath).toBe("/docs/specs/SPEC-042.md");
    }
  });

  test("10-char adw-id without state file → Left", () => {
    const r = resolveInputFrom("01KVCMJ0QR", join(tmpRoot, "agents"), join(tmpRoot, "specs"));
    expect(Either.isLeft(r)).toBe(true);
  });

  test("garbage input → Left", () => {
    const r = resolveInputFrom("not-a-spec-nor-id", join(tmpRoot, "agents"), join(tmpRoot, "specs"));
    expect(Either.isLeft(r)).toBe(true);
  });
});

// ─────────────────────── parseBunTestOutput ────────────────────────

describe("parseBunTestOutput", () => {
  test("explicit '5 pass' / '0 fail' summary", () => {
    const stdout = "(bun test output)\n5 pass\n0 fail\n8 expect() calls";
    const r = parseBunTestOutput(stdout, "");
    expect(r.passed).toBe(5);
    expect(r.failed).toBe(0);
    expect(r.failures).toEqual([]);
  });

  test("summary with one parsed failure", () => {
    const stdout = `(test/unit/foo.test.ts)
✗ should do the thing

error: expected 2 got 1
  at test/unit/foo.test.ts:12:3

2 pass
1 fail`;
    const r = parseBunTestOutput(stdout, "");
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]!.name).toContain("should do the thing");
    expect(r.failures[0]!.name).toContain("foo.test.ts");
    expect(r.failures[0]!.message).toContain("expected 2 got 1");
  });

  test("falls back to ✓/✗ counts when no summary", () => {
    const stdout = "✓ test one\n✓ test two\n✗ test three";
    const r = parseBunTestOutput(stdout, "");
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(1);
  });

  test("empty output → zeros", () => {
    const r = parseBunTestOutput("", "");
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.failures).toEqual([]);
  });
});

// ───────────────────── parseTmaxUseExitCode ────────────────────────

describe("parseTmaxUseExitCode", () => {
  test("ok=true without reportDir → ok:true, zeros", () => {
    const r = parseTmaxUseExitCode({ ok: true, exitCode: 0, stdout: "", stderr: "" }, undefined);
    expect(r.ok).toBe(true);
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
  });

  test("ok=false with missing reportDir → ok:false, zeros", () => {
    const r = parseTmaxUseExitCode({ ok: false, exitCode: 1, stdout: "", stderr: "" }, "/does/not/exist");
    expect(r.ok).toBe(false);
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
  });

  test("root <testsuites> aggregate is preferred", () => {
    const tmp = mkdtempSync(join(tmpdir(), "junit-"));
    const xml = `<?xml version="1.0"?>
<testsuites tests="10" failures="2" errors="1">
  <testsuite name="a" tests="5" failures="1" errors="0"></testsuite>
  <testsuite name="b" tests="5" failures="1" errors="1"></testsuite>
</testsuites>`;
    writeFileSync(join(tmp, "junit.xml"), xml);
    const r = parseTmaxUseExitCode({ ok: false, exitCode: 1, stdout: "", stderr: "" }, tmp);
    expect(r.failed).toBe(3); // 2 failures + 1 error
    expect(r.passed).toBe(7); // 10 - 3
    rmSync(tmp, { recursive: true, force: true });
  });

  test("sums <testsuite> elements when no root aggregate", () => {
    const tmp = mkdtempSync(join(tmpdir(), "junit-"));
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="a" tests="3" failures="1" errors="0"></testsuite>
  <testsuite name="b" tests="4" failures="0" errors="1"></testsuite>
</testsuites>`;
    writeFileSync(join(tmp, "junit.xml"), xml);
    const r = parseTmaxUseExitCode({ ok: false, exitCode: 1, stdout: "", stderr: "" }, tmp);
    expect(r.failed).toBe(2);
    expect(r.passed).toBe(5); // (3-1) + (4-1)
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ─────────────────────── buildTestStageResult ──────────────────────

describe("buildTestStageResult", () => {
  function mkTrack(ok: boolean): TrackResult {
    return {
      ok,
      exitCode: ok ? 0 : 1,
      passed: ok ? 5 : 3,
      failed: ok ? 0 : 2,
      durationMs: 100,
      iterations: 1,
      failures: [],
      output: "",
    };
  }

  test("unit ok + e2e ok → pass", () => {
    const r = buildTestStageResult(mkTrack(true), mkTrack(true), false);
    expect(r.verdict).toBe("pass");
    expect(r.e2eSkipped).toBe(false);
  });

  test("unit ok + e2e fail → gaps", () => {
    const r = buildTestStageResult(mkTrack(true), mkTrack(false), false);
    expect(r.verdict).toBe("gaps");
  });

  test("unit fail + e2e undefined + skipped=true → gaps", () => {
    const r = buildTestStageResult(mkTrack(false), undefined, true);
    expect(r.verdict).toBe("gaps");
    expect(r.e2eSkipped).toBe(true);
    expect(r.e2e).toBeUndefined();
  });

  test("unit ok + e2e undefined + skipped=true (no targets) → pass", () => {
    const r = buildTestStageResult(mkTrack(true), undefined, true);
    expect(r.verdict).toBe("pass");
    expect(r.e2eSkipped).toBe(true);
  });
});

// ─────────────────────── runUnitTrack (mocked) ─────────────────────

describe("runUnitTrack", () => {
  test("first-iteration pass → iterations=1, ok=true, no resolve spawn", async () => {
    let rawCalls = 0;
    let captureCalls = 0;
    const deps = makeDeps({
      raw: okRaw,
      onRaw: (n) => { rawCalls = n; },
      onCapture: (n) => { captureCalls = n; },
    });
    const r = await runUnitTrack(deps, "/tmp", "/tmp/agents", "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(true);
      expect(r.right.iterations).toBe(1);
      expect(r.right.passed).toBe(5);
      expect(r.right.failed).toBe(0);
    }
    expect(rawCalls).toBe(1);
    expect(captureCalls).toBe(0); // no resolve dispatched on first-iter pass
  });

  test("exhausted after 1 + MAX_UNIT_ITERATIONS runs → ok=false", async () => {
    let rawCalls = 0;
    let captureCalls = 0;
    const deps = makeDeps({
      raw: failedRaw,
      onRaw: (n) => { rawCalls = n; },
      onCapture: (n) => { captureCalls = n; },
    });
    const r = await runUnitTrack(deps, "/tmp", "/tmp/agents", "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(false);
      expect(r.right.iterations).toBe(1 + MAX_UNIT_ITERATIONS);
      expect(r.right.failed).toBe(1);
    }
    expect(rawCalls).toBe(1 + MAX_UNIT_ITERATIONS);
    expect(captureCalls).toBeGreaterThan(0); // at least one resolve attempt
  });

  test("spawn failure → Left (propagates as stage error)", async () => {
    const deps = failingSpawnDeps();
    const r = await runUnitTrack(deps, "/tmp", "/tmp/agents", "TEST", "m", {}).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test("resolve-then-rerun-pass: initial fail → resolve → rerun pass → iterations=2, ok=true", async () => {
    let rawCalls = 0;
    let captureCalls = 0;
    // First raw call returns failure, second returns pass.
    // makeDeps increments rawCalls before invoking opts.raw(), so index by rawCalls-1.
    const rawSequence: RawRunResult[] = [failedRaw, okRaw];
    const deps = makeDeps({
      raw: () => rawSequence[Math.min(rawCalls - 1, rawSequence.length - 1)]!,
      onRaw: (n) => { rawCalls = n; },
      onCapture: (n) => { captureCalls = n; },
    });
    const r = await runUnitTrack(deps, "/tmp", "/tmp/agents", "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(true);
      expect(r.right.iterations).toBe(2); // failed → resolved → passed
      expect(r.right.failed).toBe(0);
      expect(r.right.passed).toBe(5);
    }
    expect(rawCalls).toBe(2);
    expect(captureCalls).toBe(1); // one resolve dispatched for the parsed failure
  });

  test("runCapture Left does not abort the resolve loop (try/catch keeps it alive)", async () => {
    let rawCalls = 0;
    const deps = failingCaptureDeps(failedRaw);
    // Wrap to count raw calls (failingCaptureDeps uses a fixed raw value).
    const trackingDeps: TesterDeps = {
      run: deps.run,
      runRaw: (cmd, args, opts) => {
        rawCalls++;
        return deps.runRaw(cmd, args, opts);
      },
      runCapture: deps.runCapture,
    };
    const r = await runUnitTrack(trackingDeps, "/tmp", "/tmp/agents", "TEST", "m", {}).run();
    // Loop runs all 1 + MAX_UNIT_ITERATIONS cycles despite runCapture returning Left.
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(false);
      expect(r.right.iterations).toBe(1 + MAX_UNIT_ITERATIONS);
    }
    expect(rawCalls).toBe(1 + MAX_UNIT_ITERATIONS);
  });
});

// ───────────────────────── ensureAvailable ────────────────────────

describe("ensureAvailable", () => {
  test("deps.run returns Right → Right(undefined) (claude on PATH)", async () => {
    const deps: TesterDeps = {
      run: () => TaskEither.right<string>("claude 1.0"),
      runRaw: () => TaskEither.right<string>(""),
      runCapture: () => TaskEither.right<string>(""),
    } as unknown as TesterDeps;
    const r = await ensureAvailable(deps, "/tmp").run();
    expect(Either.isRight(r)).toBe(true);
  });

  test("deps.run returns Left → Left with install hint (claude missing)", async () => {
    const deps: TesterDeps = {
      run: () =>
        TaskEither.from(async () => Either.left<string, string>("spawn ENOENT")),
      runRaw: () => TaskEither.right<string>(""),
      runCapture: () => TaskEither.right<string>(""),
    } as unknown as TesterDeps;
    const r = await ensureAvailable(deps, "/tmp").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("claude");
      expect(r.left).toContain("PATH");
    }
  });
});

// ─────────────────────── runE2eTrack (mocked) ──────────────────────

describe("runE2eTrack", () => {
  test("no tmax-use targets → sentinel pass (ok=true, iterations=0, no spawn)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "no-targets-"));
    let rawCalls = 0;
    const deps = makeDeps({
      raw: () => { throw new Error("should not spawn"); },
      onRaw: (n) => { rawCalls = n; },
    });
    const r = await runE2eTrack(deps, tmp, join(tmp, "agents"), "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(true);
      expect(r.right.iterations).toBe(0);
      expect(r.right.output).toContain("no tmax-use targets");
    }
    expect(rawCalls).toBe(0);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("first-iteration pass when targets exist", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "targets-"));
    mkdirSync(join(tmp, "tmax-use/playbooks"), { recursive: true });
    writeFileSync(join(tmp, "tmax-use/playbooks/_smoke.yaml"), "name: smoke\n");
    let rawCalls = 0;
    const deps = makeDeps({
      raw: emptyRaw,
      onRaw: (n) => { rawCalls = n; },
    });
    const r = await runE2eTrack(deps, tmp, join(tmp, "agents"), "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(true);
      expect(r.right.iterations).toBe(1);
    }
    expect(rawCalls).toBe(1);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("exhausted after 1 + MAX_E2E_ITERATIONS failed runs", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "targets-fail-"));
    mkdirSync(join(tmp, "tmax-use/playbooks"), { recursive: true });
    writeFileSync(join(tmp, "tmax-use/playbooks/_smoke.yaml"), "name: smoke\n");
    let rawCalls = 0;
    const deps = makeDeps({
      raw: () => ({ ok: false, exitCode: 1, stdout: "boom", stderr: "" }),
      onRaw: (n) => { rawCalls = n; },
    });
    const r = await runE2eTrack(deps, tmp, join(tmp, "agents"), "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(false);
      expect(r.right.iterations).toBe(1 + MAX_E2E_ITERATIONS);
    }
    expect(rawCalls).toBe(1 + MAX_E2E_ITERATIONS);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("runCapture Left does not abort the e2e resolve loop", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "targets-capfail-"));
    mkdirSync(join(tmp, "tmax-use/playbooks"), { recursive: true });
    writeFileSync(join(tmp, "tmax-use/playbooks/_smoke.yaml"), "name: smoke\n");
    let rawCalls = 0;
    const failing: RawRunResult = { ok: false, exitCode: 1, stdout: "boom", stderr: "" };
    const base = failingCaptureDeps(failing);
    const trackingDeps: TesterDeps = {
      run: base.run,
      runRaw: (cmd, args, opts) => {
        rawCalls++;
        return base.runRaw(cmd, args, opts);
      },
      runCapture: base.runCapture,
    };
    const r = await runE2eTrack(trackingDeps, tmp, join(tmp, "agents"), "TEST", "m", {}).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.ok).toBe(false);
      expect(r.right.iterations).toBe(1 + MAX_E2E_ITERATIONS);
    }
    expect(rawCalls).toBe(1 + MAX_E2E_ITERATIONS);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ──────────────────── runTestWithDeps (integration) ──────────────────
//
// Exercises the dispatcher's pipeline (ensureAvailable → state writes → unit
// track → e2e track → results.json write) with all subprocess deps mocked. The
// dispatcher's resolveInput + state/event/results writers hit the real fs, so we
// create a throwaway spec file in docs/specs/ and a unique adw-id, then clean up.

describe("runTestWithDeps (end-to-end, mocked deps)", () => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // resolveInputFrom only accepts SPEC|BUG|CHORE- prefix. Use BUG- with a unique
  // suffix so we never collide with a real spec; clean up in afterEach.
  const specName = `BUG-adwtest-${uniqueSuffix}.md`;
  // docs/specs/ is the dispatcher's SPECS_DIR; resolveInput looks there.
  const projectRoot = process.cwd();
  const specPath = join(projectRoot, "docs", "specs", specName);
  const specInput = `docs/specs/${specName}`;
  // ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$. Use a 10-char uppercase ID that
  // matches the regex (no I/L/U).
  const testId = `ADWTEST${uniqueSuffix.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 3).padEnd(3, "X")}`;
  const agentsIdDir = join(projectRoot, "agents", testId);

  beforeEach(() => {
    writeFileSync(specPath, "# Test spec for adw-test.test.ts\n");
  });
  afterEach(() => {
    try { rmSync(specPath, { force: true }); } catch { /* best-effort */ }
    try { rmSync(agentsIdDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  function passTracksDeps(): TesterDeps {
    return {
      run: () => TaskEither.right<string>("claude 1.0"),
      runRaw: (cmd) => {
        if (cmd === "bun" ) {
          return TaskEither.from(async () => Either.right<RawRunResult, string>({
            ok: true,
            exitCode: 0,
            stdout: "5 pass\n0 fail",
            stderr: "",
          }));
        }
        return TaskEither.from(async () => Either.right<RawRunResult, string>({
          ok: true, exitCode: 0, stdout: "", stderr: "",
        }));
      },
      runCapture: () => TaskEither.right<string>(""),
    };
  }

  function failUnitDeps(): TesterDeps {
    return {
      run: () => TaskEither.right<string>("claude 1.0"),
      runRaw: (cmd) => {
        if (cmd === "bun") {
          return TaskEither.from(async () => Either.right<RawRunResult, string>(failedRaw));
        }
        return TaskEither.from(async () => Either.right<RawRunResult, string>({
          ok: true, exitCode: 0, stdout: "", stderr: "",
        }));
      },
      runCapture: () => TaskEither.right<string>(""),
    };
  }

  /** Deps where unit passes but e2e fails — exercises the unit-pass + e2e-fail path. */
  function passUnitFailE2eDeps(): TesterDeps {
    return {
      run: () => TaskEither.right<string>("claude 1.0"),
      runRaw: (cmd, args) => {
        // Differentiate by the command: tester.ts dispatches
        // `bun test --timeout 30000 test/unit/` for the unit track and
        // `bin/tmax-use test` for the e2e track.
        if (cmd === "bin/tmax-use" || (cmd === "bun" && args?.[1] === "test:tmax-use")) {
          return TaskEither.from(async () => Either.right<RawRunResult, string>({
            ok: false,
            exitCode: 1,
            stdout: "e2e: 1 playbook failed",
            stderr: "",
          }));
        }
        if (cmd === "bun") {
          // unit track
          return TaskEither.from(async () => Either.right<RawRunResult, string>(okRaw));
        }
        return TaskEither.from(async () => Either.right<RawRunResult, string>({
          ok: true, exitCode: 0, stdout: "", stderr: "",
        }));
      },
      runCapture: () => TaskEither.right<string>(""),
    };
  }

  test("unit pass + (no tmax-use targets in cwd) → verdict pass, results.json written", async () => {
    // cwd here is the real project root, which DOES have tmax-use/playbooks/. To
    // exercise the pass-without-e2e path, the test relies on tmax-use being
    // available — both tracks pass and the verdict is 'pass'.
    const r = await runTestWithDeps(specInput, {
      modelOverride: "m",
      id: testId,
      deps: passTracksDeps(),
    });
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.verdict).toBe("pass");
      expect(r.right.id).toBe(testId);
      expect(r.right.specPath).toBe(specPath);
    }
    // results.json was written.
    const resultsJson = join(agentsIdDir, "tester", "results.json");
    expect(existsSync(resultsJson)).toBe(true);
  }, 30_000);

  test("unit fail → e2e skipped, verdict gaps, results.json records e2eSkipped", async () => {
    const r = await runTestWithDeps(specInput, {
      modelOverride: "m",
      id: testId,
      deps: failUnitDeps(),
    });
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.verdict).toBe("gaps");
    }
    const resultsJson = join(agentsIdDir, "tester", "results.json");
    expect(existsSync(resultsJson)).toBe(true);
    const parsed = JSON.parse(readFileSync(resultsJson, "utf8")) as {
      verdict: string;
      e2eSkipped: boolean;
      unit: { ok: boolean };
    };
    expect(parsed.verdict).toBe("gaps");
    expect(parsed.e2eSkipped).toBe(true);
    expect(parsed.unit.ok).toBe(false);
  }, 30_000);

  test("unit pass + e2e fail → verdict gaps, both tracks recorded, e2e not skipped", async () => {
    // The "both tracks fail → verdict gaps, both TrackResults in results.json,
    // e2e not skipped (it ran and failed)" edge case from the spec.
    // The cwd has real tmax-use/playbooks/ so hasTmaxUseTargets returns true
    // and the e2e track actually runs (and fails, per passUnitFailE2eDeps).
    const r = await runTestWithDeps(specInput, {
      modelOverride: "m",
      id: testId,
      deps: passUnitFailE2eDeps(),
    });
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.verdict).toBe("gaps");
    }
    const resultsJson = join(agentsIdDir, "tester", "results.json");
    expect(existsSync(resultsJson)).toBe(true);
    const parsed = JSON.parse(readFileSync(resultsJson, "utf8")) as {
      verdict: string;
      e2eSkipped: boolean;
      unit: { ok: boolean; iterations: number };
      e2e?: { ok: boolean; iterations: number };
    };
    expect(parsed.verdict).toBe("gaps");
    expect(parsed.e2eSkipped).toBe(false);      // e2e RAN (and failed)
    expect(parsed.unit.ok).toBe(true);           // unit passed
    expect(parsed.unit.iterations).toBe(1);      // unit passed first try
    expect(parsed.e2e).toBeDefined();            // both tracks present
    expect(parsed.e2e!.ok).toBe(false);          // e2e failed
    expect(parsed.e2e!.iterations).toBe(1 + MAX_E2E_ITERATIONS); // exhausted
  }, 30_000);

  test("ensureAvailable Left → dispatcher returns Left (no tracks run)", async () => {
    const deps: TesterDeps = {
      run: () =>
        TaskEither.from(async () => Either.left<string, string>("spawn ENOENT")),
      runRaw: () => TaskEither.right<RawRunResult, string>({
        ok: true, exitCode: 0, stdout: "", stderr: "",
      }),
      runCapture: () => TaskEither.right<string>(""),
    };
    const r = await runTestWithDeps(specInput, {
      modelOverride: "m",
      id: testId,
      deps,
    });
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("claude");
  }, 30_000);
});

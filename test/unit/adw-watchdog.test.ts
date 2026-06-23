/**
 * @file adw-watchdog.test.ts
 * @description Deterministic unit tests for SPEC-066 (adw watchdog).
 *
 * Layer 1 — stall-detector.ts (withStallWatch): fake clock + fake statSize +
 * fake killTree. No real files, no real processes. Tests drive the interval
 * callback manually rather than relying on real setTimeout.
 *
 * Layer 2 — adw-watchdog.ts:
 *   - parseArgs: every flag, defaults, errors.
 *   - makeClassifier + classifyWorkspace: healthy / stale-dead / stale-alive /
 *     not-running / resumable failed / non-resumable failed using a temp
 *     agents/ dir with controlled adw-state.json + events/raw-output mtimes
 *     and an injected pid identity probe.
 *   - resume counter under limit → resume fires; at limit → alarm fires.
 *   - notify: argv construction for darwin/linux/unknown.
 *   - detectWatchdog + buildResumeCommand: pure over injected probes / pure
 *     path construction.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either } from "../../src/utils/task-either.ts";
import {
  withStallWatch,
  DEFAULT_STALL_MS,
  DEFAULT_MIN_GROWTH_BYTES,
  DEFAULT_POLL_MS,
  type StallDetectorDeps,
  type StallWatchOptions,
} from "../../adws/adws-modules/stall-detector.ts";
import {
  parseArgs,
  makeClassifier,
  notifyArgv,
  buildResumeCommand,
  takeAction,
  type WorkspaceStatus,
  type ClassifierDeps,
  type TakeActionDeps,
} from "../../adws/adw-watchdog.ts";
import { detectWatchdog } from "../../adws/adw-launch.ts";
import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Layer 1: withStallWatch
// ---------------------------------------------------------------------------

/**
 * Minimal fake deps. `setInterval` stashes its callback so the test can fire
 * it manually; `statSize` reads from a `currentSize` getter so the test
 * controls growth; `killTree` records calls. The fake clock is just a mutable
 * `now` ref the test advances.
 */
interface FakeHandle {
  cb: () => void;
  ms: number;
}
function makeFakeDeps(opts: {
  nowRef: { now: number };
  sizeRef: { size: number | null };
  killCalls: Array<{ pid: number; signal?: string }>;
  cleared: number[];
}): { deps: StallDetectorDeps; handleRef: { h: FakeHandle | null } } {
  const handleRef: { h: FakeHandle | null } = { h: null };
  const deps: StallDetectorDeps = {
    now: () => opts.nowRef.now,
    setInterval: (cb, ms) => {
      handleRef.h = { cb, ms };
      return 1;
    },
    clearInterval: (h) => { opts.cleared.push(typeof h === "number" ? h : -1); },
    statSize: () => opts.sizeRef.size,
    killTree: (pid, signal) => opts.killCalls.push({ pid, signal }),
  };
  return { deps, handleRef };
}

describe("withStallWatch", () => {
  test("No stall, steady growth — completes normally, killTree never called", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 0 };
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const { deps, handleRef } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    const result = await withStallWatch(
      {
        childPid: 42,
        teeFile: "/fake",
        stallMs: 60_000,
        minGrowthBytes: 64,
        pollMs: 30_000,
        deps,
      },
      async () => "ok",
    );

    // fn resolved immediately — interval fired zero times.
    expect(result).toBe("ok");
    expect(killCalls.length).toBe(0);
    expect(handleRef.h).not.toBeNull();
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });

  test("Stall triggers kill — file stops growing; killTree called after stallMs", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 100 }; // never grows past 100
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const stallCalls: Array<{ pid: number; stalledForMs: number; lastGrowthMs: number }> = [];
    const { deps, handleRef } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    let resolveFn: (v: string) => void = () => {};
    const fnPromise = new Promise<string>((r) => { resolveFn = r; });

    const stallWatchPromise = withStallWatch(
      {
        childPid: 99,
        teeFile: "/fake",
        stallMs: 60_000,
        minGrowthBytes: 64,
        pollMs: 30_000,
        deps,
        onStall: (info) => stallCalls.push(info),
      },
      () => fnPromise,
    );

    // First poll at +30s: 30s < 60s stallMs → no kill.
    nowRef.now += 30_000;
    handleRef.h!.cb();
    expect(killCalls.length).toBe(0);

    // Second poll at +60s: stalledForMs == 60_000 >= stallMs → kill.
    nowRef.now += 30_000;
    handleRef.h!.cb();
    expect(killCalls.length).toBe(1);
    expect(killCalls[0]!.pid).toBe(99);
    expect(killCalls[0]!.signal).toBe("SIGKILL");
    expect(stallCalls.length).toBe(1);
    expect(stallCalls[0]!.pid).toBe(99);
    expect(stallCalls[0]!.stalledForMs).toBeGreaterThanOrEqual(60_000);

    // Killing surfaces as the close handler resolving fn.
    resolveFn("killed");
    expect(await stallWatchPromise).toBe("killed");
  });

  test("Sub-threshold jitter ignored — 10B/poll below minGrowthBytes treated as no growth", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 0 };
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const { deps, handleRef } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    let resolveFn: (v: string) => void = () => {};
    const fnPromise = new Promise<string>((r) => { resolveFn = r; });

    const stallWatchPromise = withStallWatch(
      {
        childPid: 7,
        teeFile: "/fake",
        stallMs: 30_000,
        minGrowthBytes: 64,
        pollMs: 10_000,
        deps,
      },
      () => fnPromise,
    );

    // Each poll: bump size by 10 (below 64 threshold).
    for (let i = 1; i <= 4; i++) {
      nowRef.now += 10_000;
      sizeRef.size = i * 10;
      handleRef.h!.cb();
    }
    // 40s elapsed, last "growth" was below threshold → treated as no growth.
    expect(killCalls.length).toBe(1);
    resolveFn("killed");
    expect(await stallWatchPromise).toBe("killed");
  });

  test("Growth resets the stall timer — grow, plateau under stallMs, grow again → no kill", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 0 };
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const { deps, handleRef } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    let resolveFn: (v: string) => void = () => {};
    const fnPromise = new Promise<string>((r) => { resolveFn = r; });

    const stallWatchPromise = withStallWatch(
      {
        childPid: 55,
        teeFile: "/fake",
        stallMs: 300_000, // 5 min
        minGrowthBytes: 64,
        pollMs: 30_000,
        deps,
      },
      () => fnPromise,
    );

    // Poll 1 (+30s): grow 0 → 1024. Real growth → resets timer.
    nowRef.now += 30_000;
    sizeRef.size = 1024;
    handleRef.h!.cb();
    expect(killCalls.length).toBe(0);

    // Polls 2-9 (+60s..+240s after first poll): plateau at 1024 (no growth).
    // Each subsequent poll sees 0 delta from lastSize (1024). After stallMs
    // (300s) since lastGrowthTime, kill fires. We stop just before.
    for (let i = 2; i <= 9; i++) {
      nowRef.now += 30_000;
      // size stays at 1024
      handleRef.h!.cb();
      if (killCalls.length > 0) break; // safety
    }

    // Resume growth before the kill threshold.
    if (killCalls.length === 0) {
      nowRef.now += 30_000; // +270s total since last real growth — under 300s
      sizeRef.size = 2048;
      handleRef.h!.cb();
    }

    // Should not have fired because growth happened before stallMs elapsed.
    expect(killCalls.length).toBe(0);
    resolveFn("ok");
    expect(await stallWatchPromise).toBe("ok");
  });

  test("Interval cleared on resolve — fn resolves naturally → clearInterval called", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 0 };
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const { deps } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    await withStallWatch(
      {
        childPid: 1,
        teeFile: "/fake",
        stallMs: DEFAULT_STALL_MS,
        pollMs: DEFAULT_POLL_MS,
        deps,
      },
      async () => "resolved-quickly",
    );

    // clearInterval always fires in the finally block (whether fn resolved or
    // stall killed). At least one clear for the finally.
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });

  test("onStall callback receives accurate lastGrowthMs — lastGrowthMs is the timestamp of last real growth", async () => {
    const nowRef = { now: 1_000_000 };
    const sizeRef = { size: 100 };
    const killCalls: Array<{ pid: number; signal?: string }> = [];
    const cleared: number[] = [];
    const stallCalls: Array<{ pid: number; stalledForMs: number; lastGrowthMs: number }> = [];
    const { deps, handleRef } = makeFakeDeps({ nowRef, sizeRef, killCalls, cleared });

    let resolveFn: (v: string) => void = () => {};
    const fnPromise = new Promise<string>((r) => { resolveFn = r; });

    const startMs = nowRef.now;
    const stallWatchPromise = withStallWatch(
      {
        childPid: 321,
        teeFile: "/fake",
        stallMs: 60_000,
        minGrowthBytes: 64,
        pollMs: 30_000,
        deps,
        onStall: (info) => stallCalls.push(info),
      },
      () => fnPromise,
    );

    // First poll: grow 100 → 200. lastGrowthTime updates to current now.
    nowRef.now += 30_000;
    sizeRef.size = 200;
    const growthMs = nowRef.now;
    handleRef.h!.cb();

    // Subsequent polls: no growth; stall fires after 60s since growth.
    nowRef.now += 30_000;
    handleRef.h!.cb();
    expect(killCalls.length).toBe(0);
    nowRef.now += 30_000; // 60s since growth
    handleRef.h!.cb();

    expect(stallCalls.length).toBe(1);
    expect(stallCalls[0]!.pid).toBe(321);
    expect(stallCalls[0]!.lastGrowthMs).toBe(growthMs);
    expect(stallCalls[0]!.stalledForMs).toBeGreaterThanOrEqual(60_000);
    expect(growthMs).toBeGreaterThan(startMs);

    resolveFn("killed");
    await stallWatchPromise;
  });
});

// ---------------------------------------------------------------------------
// Layer 2: parseArgs
// ---------------------------------------------------------------------------

describe("adw-watchdog parseArgs", () => {
  test("defaults: poll=60s, stale=10min, max-resumes=3, once=false", () => {
    const r = parseArgs([]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.pollMs).toBe(60_000);
      expect(r.right.staleMs).toBe(600_000);
      expect(r.right.maxResumes).toBe(3);
      expect(r.right.once).toBe(false);
      expect(r.right.stageStaleMs).toEqual({});
    }
  });

  test("--poll-ms overrides default", () => {
    const r = parseArgs(["--poll-ms", "30000"]);
    if (Either.isRight(r)) expect(r.right.pollMs).toBe(30_000);
  });

  test("--stale-ms overrides default", () => {
    const r = parseArgs(["--stale-ms", "300000"]);
    if (Either.isRight(r)) expect(r.right.staleMs).toBe(300_000);
  });

  test("--stage-stale-ms is repeatable and overrides per-stage defaults", () => {
    const r = parseArgs(["--stage-stale-ms", "build=7200000", "--stage-stale-ms", "plan=900000"]);
    if (Either.isRight(r)) {
      expect(r.right.stageStaleMs.build).toBe(7_200_000);
      expect(r.right.stageStaleMs.plan).toBe(900_000);
    }
  });

  test("--once sets dry-run mode", () => {
    const r = parseArgs(["--once"]);
    if (Either.isRight(r)) expect(r.right.once).toBe(true);
  });

  test("--max-resumes overrides default", () => {
    const r = parseArgs(["--max-resumes", "5"]);
    if (Either.isRight(r)) expect(r.right.maxResumes).toBe(5);
  });

  test("--agents-root overrides default", () => {
    const r = parseArgs(["--agents-root", "/tmp/foo"]);
    if (Either.isRight(r)) expect(r.right.agentsRoot).toBe("/tmp/foo");
  });

  test("-h/--help → help sentinel", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseArgs([flag]);
      expect(Either.isLeft(r)).toBe(true);
      if (Either.isLeft(r)) expect(r.left.startsWith("__help__:")).toBe(true);
    }
  });

  test("invalid --poll-ms value → Left", () => {
    for (const v of ["0", "-1", "abc"]) {
      const r = parseArgs(["--poll-ms", v]);
      expect(Either.isLeft(r)).toBe(true);
    }
  });

  test("invalid --stage-stale-ms stage → Left", () => {
    const r = parseArgs(["--stage-stale-ms", "bogus=1000"]);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("invalid --stage-stale-ms format (no =) → Left", () => {
    const r = parseArgs(["--stage-stale-ms", "build"]);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("unexpected argument → Left", () => {
    const r = parseArgs(["--bogus"]);
    expect(Either.isLeft(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: makeClassifier + classifyWorkspace
// ---------------------------------------------------------------------------

let tmpAgents: string;

beforeEach(() => {
  tmpAgents = mkdtempSync(join(tmpdir(), "adw-watchdog-test-"));
});

afterEach(() => {
  if (existsSync(tmpAgents)) rmSync(tmpAgents, { recursive: true, force: true });
});

const VALID_ID = "01TESTTEST";

/** Write a workspace state file under tmpAgents. Pass mtimeMs to control the
 *  state file's mtime (the "newest activity" signal). */
function writeState(id: string, state: Record<string, unknown>, mtimeMs?: number): void {
  const dir = join(tmpAgents, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "adw-state.json");
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
  if (mtimeMs !== undefined) {
    const secs = Math.floor(mtimeMs / 1000);
    utimesSync(path, secs, secs);
  }
}

/** Append a stage event to the workspace's orchestrator events.jsonl. */
function appendEvent(id: string, event: Record<string, unknown>): void {
  const dir = join(tmpAgents, id, "orchestrator");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "events.jsonl"), JSON.stringify({ ts: new Date(0).toISOString(), ...event }) + "\n");
}

/** Write a raw-output.jsonl for a given agent dir, controlling mtime. */
function writeRaw(id: string, agent: string, content: string, mtimeMs: number): void {
  const dir = join(tmpAgents, id, agent);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "raw-output.jsonl");
  writeFileSync(path, content);
  // ms → seconds for utimes (fs API uses seconds).
  utimesSync(path, Math.floor(mtimeMs / 1000), Math.floor(mtimeMs / 1000));
}

const NOW = 5_000_000_000; // arbitrary stable "now" for tests

function makeTestClassifier(
  isSameProcess: (pid: number, startedAtMs: number) => boolean = () => false,
  overrides: Partial<ClassifierDeps> = {},
): (statePath: string, now: number, staleMs: number) => WorkspaceStatus {
  return makeClassifier({
    agentsRoot: tmpAgents,
    stageStaleMs: {},
    maxResumes: 3,
    isSameProcess,
    ...overrides,
  });
}

describe("classifyWorkspace", () => {
  test("not-running: status=completed → not-running", () => {
    writeState(VALID_ID, { adw_id: VALID_ID, status: "completed" });
    const classify = makeTestClassifier();
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("not-running");
    if (r.kind === "not-running") expect(r.status).toBe("completed");
  });

  test("healthy: running workspace with recent activity → healthy", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 60_000);
    // Raw-output mtime is very recent (1 min ago).
    writeRaw(VALID_ID, "builder", "...", NOW - 60_000);
    const classify = makeTestClassifier();
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("healthy");
  });

  test("stale-dead: running, no activity for >10min, pid not alive → stale-dead", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 20 * 60_000);
    // Last activity 20 min ago — beyond staleMs.
    writeRaw(VALID_ID, "builder", "...", NOW - 20 * 60_000);
    const classify = makeTestClassifier(() => false); // pid not alive
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("stale-dead");
    if (r.kind === "stale-dead") expect(r.orchestratorPid).toBe(1234);
  });

  test("stale-alive: running, no activity for >10min, pid IS alive → stale-alive", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 20 * 60_000);
    writeRaw(VALID_ID, "builder", "...", NOW - 20 * 60_000);
    const classify = makeTestClassifier(() => true); // pid IS alive
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("stale-alive");
    if (r.kind === "stale-alive") expect(r.orchestratorPid).toBe(1234);
  });

  test("running workspace with active build stage uses per-stage threshold (90 min default)", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 30 * 60_000);
    // Recent event: loop-retry to build → active stage is build.
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "loop-retry", to: "build" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 30 * 60_000) / 1000), Math.floor((NOW - 30 * 60_000) / 1000));
    // Last activity 30 min ago — under 90 min build threshold → healthy.
    writeRaw(VALID_ID, "builder", "...", NOW - 30 * 60_000);
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("healthy");
  });

  test("resumable failed: stage-error + recent activity under staleMs → healthy (recently failed)", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "failed",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 60_000);
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "stage-error", stage: "build", detail: "boom" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 60_000) / 1000), Math.floor((NOW - 60_000) / 1000));
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    // 1 min ago is under 10 min staleMs → healthy.
    expect(r.kind).toBe("healthy");
  });

  test("resumable failed + stale + dead → stale-dead (would auto-resume)", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "failed",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 20 * 60_000);
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "stage-error", stage: "build" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 20 * 60_000) / 1000), Math.floor((NOW - 20 * 60_000) / 1000));
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("stale-dead");
  });

  test("non-resumable failed: terminal event has no stage field → not-resumable-failed", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "failed",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 60_000);
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "stage-error", detail: "no stage" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 60_000) / 1000), Math.floor((NOW - 60_000) / 1000));
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("not-resumable-failed");
  });

  test("non-resumable failed: last terminal event is not stage-error/pipeline-failed → not-resumable-failed", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "failed",
    }, NOW - 60_000);
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "stage-complete", stage: "build" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 60_000) / 1000), Math.floor((NOW - 60_000) / 1000));
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("not-resumable-failed");
  });

  test("non-resumable failed: resume counter exhausted → not-resumable-failed", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "failed",
      orchestrator_pid: 1234,
      orchestrator_started_at_ms: 1000,
    }, NOW - 20 * 60_000);
    const evDir = join(tmpAgents, VALID_ID, "orchestrator");
    mkdirSync(evDir, { recursive: true });
    const evPath = join(evDir, "events.jsonl");
    writeFileSync(evPath, JSON.stringify({ event: "stage-error", stage: "build" }) + "\n");
    utimesSync(evPath, Math.floor((NOW - 20 * 60_000) / 1000), Math.floor((NOW - 20 * 60_000) / 1000));
    // Counter at limit.
    const counterDir = join(tmpAgents, VALID_ID, "watchdog");
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      join(counterDir, "resume-count.json"),
      JSON.stringify({ count: 3, window_start: NOW - 1000 }) + "\n",
    );
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("not-resumable-failed");
  });

  test("unparseable state → not-running (status=unparseable)", () => {
    const dir = join(tmpAgents, VALID_ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "adw-state.json"), "{not valid json");
    const classify = makeTestClassifier();
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("not-running");
    if (r.kind === "not-running") expect(r.status).toBe("unparseable");
  });

  test("missing orchestrator_pid in state → stale-dead (treat as foreign/dead)", () => {
    writeState(VALID_ID, { adw_id: VALID_ID, status: "running" }, NOW - 20 * 60_000);
    writeRaw(VALID_ID, "builder", "...", NOW - 20 * 60_000);
    const classify = makeTestClassifier(() => false);
    const r = classify(join(tmpAgents, VALID_ID, "adw-state.json"), NOW, 600_000);
    expect(r.kind).toBe("stale-dead");
    if (r.kind === "stale-dead") expect(r.orchestratorPid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// notify: argv construction per platform
// ---------------------------------------------------------------------------

describe("notifyArgv", () => {
  test("darwin → osascript display notification", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      const r = notifyArgv("stuck-alive", "workspace X stuck");
      expect(r).not.toBeNull();
      if (r) {
        expect(r[0]).toBe("osascript");
        expect(r[1][0]).toBe("-e");
        expect(r[1][1]).toContain("display notification");
        expect(r[1][1]).toContain("workspace X stuck");
      }
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  test("linux → notify-send", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const r = notifyArgv("resume-limit", "cap hit");
      expect(r).not.toBeNull();
      if (r) {
        expect(r[0]).toBe("notify-send");
        expect(r[1]).toEqual(["adw-watchdog resume-limit", "cap hit"]);
      }
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  test("other platform → null (caller falls back to stderr)", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "freebsd", configurable: true });
    try {
      const r = notifyArgv("kind", "msg");
      expect(r).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});

// ---------------------------------------------------------------------------
// detectWatchdog: pure over injected probes
// ---------------------------------------------------------------------------

describe("detectWatchdog", () => {
  test("window present → returns 'window'", () => {
    const r = detectWatchdog(() => true, () => true, "tmax");
    expect(r).toBe("window");
  });

  test("window absent but process alive → returns 'process'", () => {
    const r = detectWatchdog(() => false, () => true, "tmax");
    expect(r).toBe("process");
  });

  test("neither → null", () => {
    const r = detectWatchdog(() => false, () => false, "tmax");
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildResumeCommand: argv construction
// ---------------------------------------------------------------------------

describe("buildResumeCommand", () => {
  test("builds a tmux resume spec for the workspace id", () => {
    const r = buildResumeCommand(tmpAgents, "01ABC12345");
    expect(r.session).toBe("tmax");
    expect(r.window).toBe("adw-resume-01ABC12345");
    expect(r.cmd).toContain("adw-plan-review-build-patch.ts");
    expect(r.cmd).toContain("'--resume' '01ABC12345'");
    expect(r.cmd).toContain("cd '");
  });
});

// ---------------------------------------------------------------------------
// takeAction: resume-fire + alarm branches (Gap #2 + Gap #3 coverage)
// ---------------------------------------------------------------------------

/** Read watchdog events.jsonl as an array of parsed records. */
function readWatchdogEvents(id: string): Array<Record<string, unknown>> {
  const path = join(tmpAgents, id, "watchdog", "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Read the resume counter file. */
function readResumeCount(id: string): { count: number; window_start: number } | null {
  const path = join(tmpAgents, id, "watchdog", "resume-count.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as { count: number; window_start: number };
}

/** Spawn that simulates a successful tmux-install + tmax-session + new-window. */
function okSpawn(_cmd: string, _args: string[]): { status: number | null; error?: Error } {
  return { status: 0 };
}

/** Spawn that simulates tmux missing (any tmux command fails). */
function noTmuxSpawn(cmd: string): (cmd: string, args: string[]) => { status: number | null; error?: Error } {
  return (c, a) => {
    if (c === "tmux") return { status: 1 };
    return { status: 0 };
  };
}

/** Spawn that simulates tmux present but `new-window` failing. */
function tmuxSpawnFailsNewWindow(cmd: string, args: string[]): { status: number | null; error?: Error } {
  if (cmd === "tmux" && args[0] === "new-window") return { status: 1 };
  return { status: 0 };
}

describe("takeAction", () => {
  test("stale-dead under limit → fires resume: spawns tmux + increments counter + writes resume event", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const deps: TakeActionDeps = {
      spawn: (cmd, args) => { spawnCalls.push({ cmd, args }); return { status: 0 }; },
      isSameProcess: () => false, // orchestrator still dead
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("resume");
    // Tmux new-window was called with a `--resume VALID_ID` argv.
    const newWindow = spawnCalls.find((c) => c.args[0] === "new-window");
    expect(newWindow).toBeDefined();
    expect(newWindow!.args.join(" ")).toContain(VALID_ID);
    // Counter incremented to 1.
    const cnt = readResumeCount(VALID_ID);
    expect(cnt).not.toBeNull();
    expect(cnt!.count).toBe(1);
    // Resume event written.
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs.length).toBe(1);
    expect(evs[0]!.action).toBe("resume");
    expect(evs[0]!.count).toBe(1);
  });

  test("stale-dead at limit → alarm kind='resume-limit', no resume spawn", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    // Pre-populate counter at limit.
    const counterDir = join(tmpAgents, VALID_ID, "watchdog");
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      join(counterDir, "resume-count.json"),
      JSON.stringify({ count: 3, window_start: NOW - 1000 }) + "\n",
    );
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    let spawnFired = false;
    const deps: TakeActionDeps = {
      spawn: () => { spawnFired = true; return { status: 0 }; },
      isSameProcess: () => false,
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("alarm");
    expect(r.detail).toBe("resume-limit");
    expect(spawnFired).toBe(false); // no tmux call at all
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs[0]!.action).toBe("alarm");
    expect(evs[0]!.kind).toBe("resume-limit");
  });

  test("stale-dead with pid revived post-classify → alarm kind='pid-revived', no resume (Gap #3)", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    let spawnFired = false;
    const deps: TakeActionDeps = {
      spawn: () => { spawnFired = true; return { status: 0 }; },
      isSameProcess: () => true, // orchestrator revived between classify and action
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("alarm");
    expect(r.detail).toBe("pid-revived");
    expect(spawnFired).toBe(false); // no tmux call
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs[0]!.kind).toBe("pid-revived");
    // Counter NOT incremented.
    expect(readResumeCount(VALID_ID)).toBeNull();
  });

  test("stale-dead with tmux missing → alarm kind='tmux-missing', no resume spawn", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    const deps: TakeActionDeps = {
      spawn: noTmuxSpawn("tmux"),
      isSameProcess: () => false,
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("alarm");
    expect(r.detail).toBe("tmux-missing");
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs[0]!.kind).toBe("tmux-missing");
    // Counter NOT incremented.
    expect(readResumeCount(VALID_ID)).toBeNull();
  });

  test("stale-dead with tmux new-window failure → alarm kind='tmux-spawn-failed', no counter increment", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    const deps: TakeActionDeps = {
      spawn: tmuxSpawnFailsNewWindow,
      isSameProcess: () => false,
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("alarm");
    expect(r.detail).toBe("tmux-spawn-failed");
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs[0]!.kind).toBe("tmux-spawn-failed");
    expect(readResumeCount(VALID_ID)).toBeNull();
  });

  test("stale-alive → alarm kind='stuck-alive', no spawn, no counter change", () => {
    writeState(VALID_ID, { adw_id: VALID_ID, status: "running", orchestrator_pid: 999 });
    const status: WorkspaceStatus = {
      kind: "stale-alive",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    let spawnFired = false;
    const deps: TakeActionDeps = {
      spawn: () => { spawnFired = true; return { status: 0 }; },
      isSameProcess: () => true,
    };
    const r = takeAction(status, tmpAgents, 3, NOW, deps);
    expect(r.action).toBe("alarm");
    expect(r.detail).toBe("stuck-alive");
    expect(spawnFired).toBe(false);
    const evs = readWatchdogEvents(VALID_ID);
    expect(evs[0]!.kind).toBe("stuck-alive");
  });

  test("healthy / not-running / not-resumable-failed → noop (no events, no spawn)", () => {
    const healthy: WorkspaceStatus = { kind: "healthy", id: VALID_ID, lastActivityMs: NOW };
    const notRunning: WorkspaceStatus = { kind: "not-running", id: VALID_ID, status: "completed" };
    const notResumable: WorkspaceStatus = { kind: "not-resumable-failed", id: VALID_ID };
    let spawnFired = false;
    const deps: TakeActionDeps = {
      spawn: () => { spawnFired = true; return { status: 0 }; },
      isSameProcess: () => false,
    };
    for (const s of [healthy, notRunning, notResumable]) {
      spawnFired = false;
      writeState(VALID_ID, { adw_id: VALID_ID, status: "completed" });
      const r = takeAction(s, tmpAgents, 3, NOW, deps);
      expect(r.action).toBe("noop");
      expect(spawnFired).toBe(false);
    }
  });

  test("default deps fallback: production spawn/isSameProcess used when deps omitted", () => {
    writeState(VALID_ID, {
      adw_id: VALID_ID,
      status: "running",
      orchestrator_pid: 999,
      orchestrator_started_at_ms: 1000,
    });
    const status: WorkspaceStatus = {
      kind: "stale-dead",
      id: VALID_ID,
      lastActivityMs: NOW - 20 * 60_000,
      orchestratorPid: 999,
    };
    // No deps passed → defaults used. Production isSameProcess will probe the
    // (almost certainly dead) pid 999 and return false; production spawn will
    // hit real tmux. To avoid environment coupling we only assert the call
    // doesn't throw and produces one of the documented action outcomes.
    const r = takeAction(status, tmpAgents, 3, NOW);
    expect(["resume", "alarm", "noop"]).toContain(r.action);
  });
});

/**
 * stall-detector.ts — Layer 1 of the adw watchdog (SPEC-066).
 *
 * Act-uative counterpart to heartbeat.ts: monitors a stage subprocess's raw
 * tee-file (`raw-output.jsonl`) byte growth and kills the spawned child's
 * process group when the file hasn't grown by `minGrowthBytes` in `stallMs`.
 *
 * Heartbeat-only status lines written by the orchestrator must not be appended
 * to the monitored tee file — the watcher treats zero growth as a stall, so any
 * dispatcher combining heartbeat text into the raw-output stream would mask
 * real stalls.
 *
 * Pure + dependency-injected: takes `childPid` (does not spawn it) and an
 * injected `killTree` (no `child_process` import). Fully unit-testable with a
 * fake clock.
 */
import { statSync } from "fs";

export { fmtElapsed, fmtBytes, tryStatSize } from "./heartbeat.ts";

/** A healthy claude -p writes to its tee file on every tool call — multiple per
 *  minute. The longest legitimate pause is one tool call that itself takes
 *  ~1-2 min. 5 min is >2x that ceiling, so a 5-min stall is a real stall. */
export const DEFAULT_STALL_MS = 300_000;
/** Ignore sub-64B jitter; a real tool call writes KB. */
export const DEFAULT_MIN_GROWTH_BYTES = 64;
/** Check every 30s — aligns with heartbeat cadence. */
export const DEFAULT_POLL_MS = 30_000;

/** Injectable dependencies — production wraps node primitives; tests pass fakes. */
export interface StallDetectorDeps {
  now(): number;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  statSize(path: string): number | null;
  killTree(pid: number, signal?: string): void;
}

export interface StallWatchOptions {
  /** Detached process-group leader pid (spawnStage spawns with `detached: true`). */
  childPid: number;
  /** Raw child-output tee file (`agents/<id>/<stage>/raw-output.jsonl`). */
  teeFile: string;
  /** Stall threshold in ms (default 5 min). */
  stallMs?: number;
  /** Minimum byte growth considered "real progress" (default 64). */
  minGrowthBytes?: number;
  /** Polling interval in ms (default 30s). */
  pollMs?: number;
  /** Defaults to production impl. Tests pass a fake clock + fake killTree. */
  deps?: StallDetectorDeps;
  /** Alarm callback fired once when the stall triggers, before killTree. */
  onStall?: (info: { pid: number; stalledForMs: number; lastGrowthMs: number }) => void;
}

const productionDeps: StallDetectorDeps = {
  now: () => Date.now(),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (handle) => { globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>); },
  statSize: (path) => { try { return statSync(path).size; } catch { return null; } },
  killTree: (pid, signal = "SIGKILL") => {
    try { process.kill(-pid, signal as NodeJS.Signals); } catch { /* already dead */ }
  },
};

/**
 * Run `fn` while watching `teeFile` for byte growth. If the file grows by
 * ≥ `minGrowthBytes` between polls, the stall timer resets. If it does not grow
 * for `stallMs`, `onStall` fires once and the watched child's process group is
 * SIGKILLed. The kill is one-shot; after it fires the watch stops and `fn` is
 * left to reject/resolve naturally (the killed child surfaces as a non-zero
 * exit through `spawnStage`'s close handler).
 *
 * The interval is always cleared in a `finally` — same pattern as `withHeartbeat`.
 */
export async function withStallWatch<T>(opts: StallWatchOptions, fn: () => Promise<T>): Promise<T> {
  const deps = opts.deps ?? productionDeps;
  const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
  const minGrowthBytes = opts.minGrowthBytes ?? DEFAULT_MIN_GROWTH_BYTES;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;

  const startMs = deps.now();
  let lastGrowthTime = startMs;
  let lastSize = deps.statSize(opts.teeFile); // null if file doesn't exist yet
  let killed = false;

  const handle = deps.setInterval(() => {
    if (killed) return; // one-shot — ignore stragglers after kill
    const now = deps.now();
    const currentSize = deps.statSize(opts.teeFile);
    if (currentSize !== null && lastSize !== null && currentSize - lastSize >= minGrowthBytes) {
      lastGrowthTime = now;
      lastSize = currentSize;
      return;
    }
    // Tee file freshly created mid-watch: treat first appearance as growth so
    // we don't immediately fire a stall just because statSync flipped null→number.
    if (currentSize !== null && lastSize === null) {
      lastGrowthTime = now;
      lastSize = currentSize;
      return;
    }
    // No qualifying growth since last poll — check the stall bound.
    if (currentSize !== null) lastSize = currentSize; // keep size fresh even on tiny jitter
    const stalledForMs = now - lastGrowthTime;
    if (stalledForMs >= stallMs) {
      killed = true;
      try {
        opts.onStall?.({ pid: opts.childPid, stalledForMs, lastGrowthMs: lastGrowthTime });
      } catch { /* best-effort — never crash on alarm callback */ }
      try { deps.killTree(opts.childPid, "SIGKILL"); } catch { /* already dead */ }
      deps.clearInterval(handle);
    }
  }, pollMs);

  try {
    return await fn();
  } finally {
    deps.clearInterval(handle);
  }
}

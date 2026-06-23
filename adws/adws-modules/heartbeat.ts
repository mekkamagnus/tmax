/**
 * heartbeat.ts — §B heartbeat helper for adw pipeline orchestration.
 *
 * Wraps an async operation with a periodic heartbeat line printed to stderr.
 * The heartbeat answers: "is this stage still alive?" by reporting elapsed
 * time and, when a tee file is known, the byte-growth delta since the last beat.
 *
 * All I/O is best-effort: a closed/unwritable stderr never crashes the pipeline.
 * The `write` callback and `clock` are injectable for deterministic unit testing.
 */
import { statSync } from "fs";
import { basename } from "path";

/** Default heartbeat interval (RFC-020 Open Question #1 — tunable constant). */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/** Injectable clock for deterministic testing. */
export interface HeartbeatClock {
  now(): number;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const productionClock: HeartbeatClock = {
  now: () => Date.now(),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (handle) => { globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>); },
};

export interface HeartbeatOptions {
  stage: string;
  teeFile?: string;
  intervalMs?: number;
  write?: (s: string) => void;
  clock?: HeartbeatClock;
}

/**
 * Run `fn` while periodically emitting heartbeat lines. The interval is cleared
 * on both resolve and reject (via try/finally). Returns `fn`'s result.
 */
export async function withHeartbeat<T>(
  opts: HeartbeatOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_MS;
  const write = opts.write ?? ((s: string) => process.stderr.write(s));
  const clock = opts.clock ?? productionClock;

  const startMs = clock.now();
  let lastSize = opts.teeFile ? tryStatSize(opts.teeFile) : null;

  const handle = clock.setInterval(() => {
    const elapsedMs = clock.now() - startMs;
    let line: string;
    const nowSize = opts.teeFile ? tryStatSize(opts.teeFile) : null;
    if (nowSize !== null) {
      const prevSize = lastSize ?? nowSize;
      const delta = nowSize - prevSize;
      lastSize = nowSize;
      line = `[adw] ${opts.stage} running — ${fmtElapsed(elapsedMs)} elapsed, ${basename(opts.teeFile!)} +${fmtBytes(delta)} since last beat\n`;
    } else {
      line = `[adw] ${opts.stage} running — ${fmtElapsed(elapsedMs)} elapsed\n`;
    }
    try { write(line); } catch { /* best-effort — never crash on heartbeat */ }
  }, intervalMs);

  try {
    return await fn();
  } finally {
    clock.clearInterval(handle);
  }
}

/** Read file size in bytes, or `null` if absent/unreadable. */
export function tryStatSize(path: string): number | null {
  try { return statSync(path).size; } catch { return null; }
}

/**
 * Format milliseconds as a compact "Xm Ys" / "Xs" / "Xh Ym" string.
 */
export function fmtElapsed(ms: number): string {
  if (ms < 0) ms = 0; // guard against clock skew
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a byte count as a compact "NKB" / "NMB" string.
 * Handles 0 and negative values (e.g. file truncated mid-run).
 */
export function fmtBytes(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_048_576) return `${sign}${(abs / 1_048_576).toFixed(0)}MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(0)}KB`;
  return `${sign}${abs}B`;
}

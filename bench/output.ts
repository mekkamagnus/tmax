/**
 * @file output.ts
 * @description Shared result types + formatting helpers for the bench harness.
 *
 * Kept dependency-free (only `Bun.nanoseconds()` indirectly, via callers) so
 * the unit test can import it without spinning up a daemon. Floors are
 * recorded per (microbenchmark, size); a result `passed` iff `wallMs <= floorMs`.
 */

/** The three fixture sizes used by the harness. Small/medium/large. */
export type BenchSize = "small" | "medium" | "large";

/**
 * A single benchmark row. One of these is produced per (microbenchmark, size).
 * `bytesPerOp` is an *estimate* (serialized request/response size or input
 * content size) — not a measured heap allocation. The chore spec explicitly
 * forbids claiming real heap allocation without a Bun-compatible allocator
 * measurement; this estimate is what the formatter reports.
 */
export interface BenchResult {
  readonly name: string;
  readonly size: BenchSize;
  readonly opsPerSec: number;
  readonly bytesPerOp: number;
  readonly wallMs: number;
  readonly floorMs: number;
  readonly passed: boolean;
}

/** Input shape for `assertFloor` — everything except the computed `passed`. */
export type BenchResultInput = Omit<BenchResult, "passed">;

/**
 * Compute `passed` from `wallMs <= floorMs`. Exposed so tests can verify the
 * floor logic without timing real workloads — pass an injected slow input and
 * check `passed === false`.
 */
export function assertFloor(input: BenchResultInput): BenchResult {
  return { ...input, passed: input.wallMs <= input.floorMs };
}

/** Tally pass/fail counts across a result set. */
export function summarize(results: readonly BenchResult[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.passed) passed += 1;
    else failed += 1;
  }
  return { passed, failed };
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "k";
  return n.toFixed(2);
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + "MB";
  if (n >= 1024) return (n / 1024).toFixed(2) + "KB";
  return n.toFixed(0) + "B";
}

/**
 * Render the result table with fixed-width columns. Stable across runs so
 * `diff` between two bench invocations is meaningful.
 *
 * Columns: name | size | ops/sec | bytes/op | wall_ms | floor_ms | result
 */
export function formatResults(results: readonly BenchResult[]): string {
  const cols = [
    { label: "name", width: 10 },
    { label: "size", width: 8 },
    { label: "ops/sec", width: 12 },
    { label: "bytes/op", width: 10 },
    { label: "wall_ms", width: 10 },
    { label: "floor_ms", width: 10 },
    { label: "result", width: 8 },
  ];
  const header = cols.map((c) => pad(c.label, c.width)).join(" | ").trimEnd();
  const sep = cols.map((c) => "-".repeat(c.width)).join("-|-");
  const rows = results.map((r) =>
    [
      pad(r.name, cols[0]!.width),
      pad(r.size, cols[1]!.width),
      pad(fmtNum(r.opsPerSec), cols[2]!.width),
      pad(fmtBytes(r.bytesPerOp), cols[3]!.width),
      pad(r.wallMs.toFixed(2), cols[4]!.width),
      pad(r.floorMs.toFixed(2), cols[5]!.width),
      pad(r.passed ? "PASS" : "FAIL", cols[6]!.width),
    ].join(" | ").trimEnd(),
  );
  return [header, sep, ...rows].join("\n");
}

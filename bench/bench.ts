/**
 * @file bench.ts
 * @description Runner entry point for the bench harness.
 *
 * Usage:
 *   bench                  → run all 7 microbenchmarks × 3 sizes (21 rows)
 *   bench all              → same as above
 *   bench all medium       → all microbenchmarks, medium size only
 *   bench buffer           → buffer microbenchmark across all 3 sizes
 *   bench buffer medium    → one specific row
 *   bench minibuffer       → M-x candidate-build (enumerate + filter + map)
 *   bench render           → captureFrame render path across all sizes
 *   bench startup          → startEditor() wall time (measured once, size ignored)
 *   bench keynorm          → in-process handleKey per-key dispatch
 *   bench --help           → usage to stdout, exit 0
 *
 * Exits non-zero if any row fails its floor assertion or if usage is invalid.
 */

import { runBufferBench } from "./micro-buffer.ts";
import { runTLispBench } from "./micro-tlisp.ts";
import { runE2EBench } from "./micro-e2e.ts";
import { runMinibufferBench } from "./micro-minibuffer.ts";
import { runRenderBench } from "./micro-render.ts";
import { runStartupBench } from "./micro-startup.ts";
import { runKeynormBench } from "./micro-keynorm.ts";
import { formatResults, summarize, type BenchResult, type BenchSize } from "./output.ts";

const ALL_SIZES: readonly BenchSize[] = ["small", "medium", "large"];

type BenchName = "buffer" | "tlisp" | "e2e" | "minibuffer" | "render" | "startup" | "keynorm";

const KNOWN_BENCHES: readonly string[] = [
  "buffer", "tlisp", "e2e", "minibuffer", "render", "startup", "keynorm", "all", "--help",
];

function usage(): string {
  return [
    "Usage: bench <name> [size]",
    "",
    "  name   one of: buffer | tlisp | e2e | minibuffer | render | startup | keynorm | all | --help   (default: all)",
    "  size   one of: small | medium | large               (default: all sizes)",
    "",
    "Examples:",
    "  bench                        run all 7 microbenchmarks × 3 sizes",
    "  bench all medium             all microbenchmarks, medium size only",
    "  bench buffer medium          single row: buffer microbenchmark, medium fixture",
    "  bench minibuffer             M-x candidate-table enumeration across all sizes",
    "  bench render large           frame render path, large fixture",
    "  bench startup                startEditor() wall time (measured once, size ignored)",
    "  bench --help                 print this message and exit 0",
  ].join("\n");
}

function isSize(s: string | undefined): s is BenchSize | undefined {
  return s === undefined || s === "small" || s === "medium" || s === "large";
}

async function dispatch(name: BenchName, size: BenchSize | undefined): Promise<BenchResult[]> {
  const sizes: readonly BenchSize[] = size ? [size] : ALL_SIZES;
  const results: BenchResult[] = [];
  for (const s of sizes) {
    switch (name) {
      case "buffer":    results.push(await runBufferBench(s)); break;
      case "tlisp":     results.push(runTLispBench(s)); break;
      case "e2e":       results.push(await runE2EBench(s)); break;
      case "minibuffer": results.push(await runMinibufferBench(s)); break;
      case "render":    results.push(await runRenderBench(s)); break;
      case "startup":   results.push(await runStartupBench(s)); break;
      case "keynorm":   results.push(await runKeynormBench(s)); break;
    }
  }
  return results;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const nameRaw = argv[0] ?? "all";
  const sizeRaw = argv[1];

  if (nameRaw === "--help" || nameRaw === "-h") {
    process.stdout.write(usage() + "\n");
    return 0;
  }

  if (!KNOWN_BENCHES.includes(nameRaw)) {
    process.stderr.write(`bench: unknown benchmark name "${nameRaw}"\n\n${usage()}\n`);
    return 2;
  }
  if (!isSize(sizeRaw)) {
    process.stderr.write(`bench: invalid size "${sizeRaw}" (expected small | medium | large)\n\n${usage()}\n`);
    return 2;
  }

  const results: BenchResult[] = [];
  if (nameRaw === "all") {
    const sizes: readonly BenchSize[] = sizeRaw ? [sizeRaw] : ALL_SIZES;
    for (const s of sizes) {
      results.push(...(await dispatch("buffer", s)));
      results.push(...(await dispatch("tlisp", s)));
      results.push(...(await dispatch("e2e", s)));
      results.push(...(await dispatch("minibuffer", s)));
      results.push(...(await dispatch("render", s)));
      results.push(...(await dispatch("startup", s)));
      results.push(...(await dispatch("keynorm", s)));
    }
  } else {
    results.push(...(await dispatch(nameRaw as BenchName, sizeRaw)));
  }

  const table = formatResults(results);
  const { passed, failed } = summarize(results);
  process.stdout.write(table + "\n");
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  process.stderr.write(`bench: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});

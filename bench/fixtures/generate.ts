/**
 * @file generate.ts
 * @description Deterministic fixture generator for the bench harness.
 *
 * Three plain-ASCII fixed-width fixtures, written under bench/fixtures/:
 *   - small.txt:  500 lines × ~40 bytes/line  (~20 KB)
 *   - medium.txt: 5000 lines × ~40 bytes/line (~200 KB)
 *   - large.txt:  10000 lines × ~100 bytes/line (~1 MB)
 *
 * Each line is `Line <padded-index> <filler>\n` — no escapes, no tabs, no
 * non-ASCII. Idempotent: if the file's line count already matches, it is left
 * untouched so re-running the generator is a no-op.
 */

import { promises as fs, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

interface FixtureSpec {
  readonly name: string;
  readonly lines: number;
  readonly fillerWidth: number;
}

const SPECS: readonly FixtureSpec[] = [
  { name: "small.txt", lines: 500, fillerWidth: 30 },
  { name: "medium.txt", lines: 5000, fillerWidth: 30 },
  { name: "large.txt", lines: 10000, fillerWidth: 90 },
];

function zeroPadded(i: number, width: number): string {
  return i.toString().padStart(width, "0");
}

/** Build one deterministic ASCII line of the form `Line <idx> <filler>\n`. */
function buildLine(index: number, fillerWidth: number): string {
  const prefix = `Line ${zeroPadded(index, 6)}`;
  const filler = "x".repeat(fillerWidth);
  return `${prefix} ${filler}\n`;
}

function generateContent(spec: FixtureSpec): string {
  const parts: string[] = new Array(spec.lines);
  for (let i = 0; i < spec.lines; i++) {
    parts[i] = buildLine(i, spec.fillerWidth);
  }
  return parts.join("");
}

async function countLines(path: string): Promise<number> {
  try {
    const text = await fs.readFile(path, "utf-8");
    if (text.length === 0) return 0;
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
    if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) n += 1;
    return n;
  } catch {
    return -1;
  }
}

async function ensureFixture(spec: FixtureSpec): Promise<{ path: string; wrote: boolean }> {
  const path = join(FIXTURES_DIR, spec.name);
  const existing = await countLines(path);
  if (existing === spec.lines) {
    return { path, wrote: false };
  }
  await fs.writeFile(path, generateContent(spec), "utf-8");
  return { path, wrote: true };
}

/**
 * Materialize all three fixtures. Idempotent — re-running is a no-op once the
 * files exist at the target line count. Returns the absolute paths.
 */
export async function generateFixtures(): Promise<{
  readonly small: string;
  readonly medium: string;
  readonly large: string;
}> {
  if (!existsSync(FIXTURES_DIR)) {
    await fs.mkdir(FIXTURES_DIR, { recursive: true });
  }
  const results = await Promise.all(SPECS.map((s) => ensureFixture(s)));
  for (const r of results) {
    if (r.wrote) process.stderr.write(`bench: wrote ${r.path}\n`);
  }
  return {
    small: results[0]!.path,
    medium: results[1]!.path,
    large: results[2]!.path,
  };
}

/** Resolve the absolute path to a fixture by size label. Materializes first. */
export async function fixturePath(size: "small" | "medium" | "large"): Promise<string> {
  const all = await generateFixtures();
  return all[size];
}

// When executed directly (`bun run bench/fixtures/generate.ts`), write the
// fixtures and exit. When imported, only the exported helpers run.
if (import.meta.url === `file://${process.argv[1]}`) {
  generateFixtures()
    .then((p) => {
      process.stderr.write(`bench: fixtures ready\n  small:  ${p.small}\n  medium: ${p.medium}\n  large:  ${p.large}\n`);
    })
    .catch((err) => {
      console.error(`bench: fixture generation failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}

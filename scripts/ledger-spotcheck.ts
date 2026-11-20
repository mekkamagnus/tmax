#!/usr/bin/env bun
/**
 * @file ledger-spotcheck.ts
 * @description RFC-036 / issue #325 — the claim spot-checker: turns pasted
 *   landings into verified ones. Samples N landing events (seeded random,
 *   reproducible), re-runs each landing's tests-run commands in a clean
 *   `git worktree` checkout of the landing's last sha, compares the pass/fail
 *   counts to the pasted output, and appends `spotcheck` events back into the
 *   ledger (append-only — the result is history).
 *
 *   Usage: bun scripts/ledger-spotcheck.ts <ledger.jsonl> [--sample N] [--seed S]
 *
 *   Exit codes: 0 = sampled claims verified; 1 = at least one MISMATCH
 *   (a claimed result did not reproduce); 2 = a landing could not be re-run
 *   (checkout/spawn failure — unverified, not disproven).
 */
import { appendFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateLedgerLine } from './ledger-schema.ts';
import { readLedgerFile, type LedgerEvent } from './ledger-report.ts';

export type Counts = { pass: number | null; fail: number | null };

export type SpotcheckOutcome = {
  unit: string;
  sha: string;
  command: string;
  verdict: 'match' | 'mismatch' | 'error';
  expected: string;
  actual: string;
};

const decoder = new TextDecoder();

/**
 * Extract bun-style pass/fail counts from runner output. Takes the LAST
 * match when counts appear repeatedly (the trailing summary is
 * authoritative). Null when nothing parses — comparison then reports
 * `error`, never a guess.
 */
export const extractCounts = (output: string): Counts => {
  const passes = [...output.matchAll(/(\d+)\s+pass(?:ed|es)?\b/g)].map((m) => Number(m[1]));
  const fails = [...output.matchAll(/(\d+)\s+fail(?:ed|ures?)?\b/g)].map((m) => Number(m[1]));
  return {
    pass: passes.length > 0 ? (passes[passes.length - 1] as number) : null,
    fail: fails.length > 0 ? (fails[fails.length - 1] as number) : null,
  };
};

const countsStr = (c: Counts): string => `${c.pass ?? '?'} pass / ${c.fail ?? '?'} fail`;

/**
 * Compare a landing's pasted output against the re-run output. The claim
 * under test is the PASTED COUNTS (honest reds compare fine — this verifies
 * what was recorded, not that it was green). Either side unparseable →
 * `error` (cannot compare), never a silent match.
 */
export const compareClaim = (
  pastedOutput: string,
  rerunOutput: string,
): { verdict: 'match' | 'mismatch' | 'error'; expected: string; actual: string } => {
  const expected = extractCounts(pastedOutput);
  const actual = extractCounts(rerunOutput);
  if (expected.pass === null && expected.fail === null) {
    return { verdict: 'error', expected: countsStr(expected), actual: countsStr(actual) };
  }
  if (actual.pass === null && actual.fail === null) {
    return { verdict: 'error', expected: countsStr(expected), actual: countsStr(actual) };
  }
  const verdict = expected.pass === actual.pass && expected.fail === actual.fail ? 'match' : 'mismatch';
  return { verdict, expected: countsStr(expected), actual: countsStr(actual) };
};

/** Deterministic PRNG (mulberry32) — the same seed always samples the same landings. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Seeded sample without replacement, result in original (chronological)
 * order. n <= 0 or n >= items.length selects everything.
 */
export const sampleLandings = <T>(items: T[], n: number, seed: number): T[] => {
  if (n <= 0 || n >= items.length) return items;
  const rng = mulberry32(seed);
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i] as number;
    idx[i] = idx[j] as number;
    idx[j] = tmp;
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => items[i] as T);
};

const gitOk = (cwd: string, args: string[]): boolean => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0;
};

const runCommand = (command: string, cwd: string, timeoutMs: number): { output: string; exitCode: number | null } => {
  try {
    const r = Bun.spawnSync(['sh', '-c', command], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
    const out = `${decoder.decode(r.stdout)}\n${decoder.decode(r.stderr)}`;
    return { output: out, exitCode: r.exitCode };
  } catch (e) {
    return { output: `spawn failed: ${(e as Error).message}`, exitCode: null };
  }
};

/** Re-run one landing's tests-run commands at its last sha; append spotcheck events. */
export const runSpotcheck = (
  ledgerPath: string,
  opts?: { sample?: number; seed?: number; cwd?: string; timeoutMs?: number },
): { ok: true; outcomes: SpotcheckOutcome[]; appended: number } | { ok: false; error: string } => {
  const read = readLedgerFile(ledgerPath);
  if (!read.ok) return { ok: false, error: read.error };
  const landings = read.events.filter((e) => e['event'] === 'landing');
  if (landings.length === 0) return { ok: false, error: 'ledger has no landing events to spot-check' };
  const sample = opts?.sample ?? 3;
  const seed = opts?.seed ?? 1337;
  const cwd = opts?.cwd ?? process.cwd();
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const selected = sampleLandings(landings, sample, seed);

  const outcomes: SpotcheckOutcome[] = [];
  for (const landing of selected) {
    const unit = typeof landing['unit'] === 'string' ? landing['unit'] : '(no unit)';
    const shas = Array.isArray(landing['shas']) ? (landing['shas'] as unknown[]) : [];
    const sha = typeof shas[shas.length - 1] === 'string' ? (shas[shas.length - 1] as string) : null;
    const testsRun = Array.isArray(landing['tests-run']) ? (landing['tests-run'] as Record<string, unknown>[]) : [];
    if (!sha || testsRun.length === 0) {
      outcomes.push({
        unit, sha: sha ?? '?', command: '(none)',
        verdict: 'error', expected: '?', actual: 'landing has no sha or no tests-run entries',
      });
      continue;
    }
    // clean checkout of the recorded sha — the state the pasted output describes
    const wt = mkdtempSync(join(tmpdir(), 'tmax-spotcheck-'));
    try {
      const add = Bun.spawnSync(['git', 'worktree', 'add', '--detach', wt, sha], {
        cwd, stdout: 'pipe', stderr: 'pipe',
      });
      if (add.exitCode !== 0) {
        outcomes.push({
          unit, sha, command: '(checkout)',
          verdict: 'error', expected: '?', actual: `git worktree add failed: ${decoder.decode(add.stderr).trim()}`,
        });
        continue;
      }
      for (const entry of testsRun) {
        const command = typeof entry['name'] === 'string' ? entry['name'] : String(entry['name'] ?? '');
        const pasted = typeof entry['output'] === 'string' ? entry['output'] : '';
        const rerun = runCommand(command, wt, timeoutMs);
        const cmp = compareClaim(pasted, rerun.output);
        outcomes.push({ unit, sha, command, ...cmp });
      }
    } finally {
      gitOk(cwd, ['worktree', 'remove', '--force', wt]);
      rmSync(wt, { recursive: true, force: true });
    }
  }

  // append-only write-back: the results are history
  let appended = 0;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const o of outcomes) {
    const event = { event: 'spotcheck', ts: now, ...o };
    appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
    appended++;
  }
  return { ok: true, outcomes, appended };
};

const main = (): void => {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const sampleIdx = args.indexOf('--sample');
  const seedIdx = args.indexOf('--seed');
  if (!path) {
    console.error('usage: bun scripts/ledger-spotcheck.ts <ledger.jsonl> [--sample N] [--seed S]');
    process.exit(1);
  }
  const sample = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : 3;
  const seed = seedIdx >= 0 ? Number(args[seedIdx + 1]) : 1337;
  const result = runSpotcheck(path, { sample, seed });
  if (!result.ok) {
    console.error(result.error);
    process.exit(2);
  }
  console.log(`spot-check: sampled ${result.outcomes.length} command(s) (seed ${seed}) from ${path}`);
  let mismatch = 0;
  let error = 0;
  for (const o of result.outcomes) {
    const mark = o.verdict === 'match' ? '✓' : o.verdict === 'mismatch' ? '✗ MISMATCH' : '⚠ error';
    if (o.verdict === 'mismatch') mismatch++;
    if (o.verdict === 'error') error++;
    console.log(`  ${mark} [${o.unit} @ ${o.sha.slice(0, 7)}] ${o.command}`);
    console.log(`      expected: ${o.expected} | actual: ${o.actual}`);
  }
  console.log(`appended ${result.appended} spotcheck event(s) to ${path}`);
  if (mismatch > 0) process.exit(1);
  if (error > 0) process.exit(2);
};

if (import.meta.main) main();

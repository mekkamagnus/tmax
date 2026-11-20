#!/usr/bin/env bun
/**
 * @file ledger-scrape.ts
 * @description RFC-036 / issue #326 — the herdr footer-scraper: replaces
 *   agent-self-reported telemetry with scraped truth where possible.
 *   Polls `herdr pane read <pane> --source visible` every 30 minutes and at
 *   ledger unit boundaries, parses the agent CLI footer (ctx %, cumulative
 *   tokens, turn deltas, turn elapsed) into `telemetry` events marked
 *   `source:"scraped"`. Unreadable footer → nulls, never estimates
 *   (RFC-036 §3.1 telemetry honesty). A mismatch between self-reported and
 *   scraped telemetry is itself an alarm (RFC-036 §6) — computed by
 *   ledger-report.ts.
 *
 *   Usage: bun scripts/ledger-scrape.ts <pane-id> <ledger.jsonl>
 *                [--once] [--interval-ms N] [--check-ms N] [--max-minutes N]
 *
 *   herdr pane read is non-destructive (a read, not a consume); the poller
 *   exits when the ledger gains a run-end event or --max-minutes elapses.
 */
import { appendFileSync, readFileSync } from 'fs';

export type FooterSignals = {
  /** remaining context percent from `ctx:NN%`, null when absent */
  ctxPct: number | null;
  /** cumulative session tokens from `/clear to save NkN tokens`, null when absent */
  cumulativeTokens: number | null;
  /** current-turn token delta from `↓ 105.8k tokens` (informational extra) */
  turnTokens: number | null;
  /** current-turn elapsed from `(1h 1m 52s · …)` (informational extra) */
  turnElapsed: string | null;
};

const parseTokenCount = (num: string, suffix: string | undefined): number => {
  const n = Number(num);
  if (suffix === 'k' || suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'm' || suffix === 'M') return Math.round(n * 1_000_000);
  return Math.round(n);
};

/**
 * Parse the agent-CLI footer signals from a pane's visible text. All real
 * captures below come from live panes (working spinner, idle /clear hint,
 * the ❯ prompt border case with no footer at all). Absent signal → null;
 * nothing is ever inferred or estimated. When several ctx readings are
 * visible (a redraw), the LAST one is the current frame.
 */
export const parseFooter = (visibleText: string): FooterSignals => {
  const ctxMatches = [...visibleText.matchAll(/ctx:\s*(\d+)%/g)];
  const ctxPct =
    ctxMatches.length > 0 ? Number(ctxMatches[ctxMatches.length - 1]?.[1] as string) : null;

  const saveMatch = visibleText.match(/\/clear to save ([\d.]+)\s*([kKmM])?\s*tokens/);
  const cumulativeTokens = saveMatch
    ? parseTokenCount(saveMatch[1] as string, saveMatch[2])
    : null;

  const downMatch = visibleText.match(/↓\s*([\d.]+)\s*([kKmM])?\s*tokens/);
  const turnTokens = downMatch ? parseTokenCount(downMatch[1] as string, downMatch[2]) : null;

  const elapsedMatch = visibleText.match(/\((\d+h)?\s*(\d+m)?\s*(\d+(?:\.\d+)?)s\s*·/);
  const turnElapsed = elapsedMatch
    ? `${elapsedMatch[1] ?? ''} ${elapsedMatch[2] ?? ''} ${elapsedMatch[3] ?? ''}s`.replace(/\s+/g, ' ').trim()
    : null;

  return { ctxPct, cumulativeTokens, turnTokens, turnElapsed };
};

/** The timestamp now, as a schema-valid ISO-8601 Z string. */
const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export type ScrapeResult = {
  event: Record<string, unknown> | null; // null when the pane read itself failed
  readOk: boolean;
};

/**
 * One scrape: read the pane, parse, append a telemetry event. in-tokens is
 * the cumulative `/clear to save` figure only (a per-turn ↓ delta is NOT
 * cumulative and is never claimed as one); wall-minutes is exact arithmetic
 * from the ledger's run-start; everything invisible is null.
 */
export const scrapeOnce = (
  paneId: string,
  ledgerPath: string,
  opts?: {
    readPane?: (pane: string) => string | null;
    now?: () => string;
  },
): ScrapeResult => {
  const readPane =
    opts?.readPane ??
    ((pane: string): string | null => {
      const r = Bun.spawnSync(
        ['herdr', 'pane', 'read', pane, '--source', 'visible', '--lines', '8', '--format', 'text'],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      if (r.exitCode !== 0) return null;
      return new TextDecoder().decode(r.stdout);
    });
  const now = opts?.now ?? nowIso;

  const text = readPane(paneId);
  if (text === null) {
    // graceful absence: the read failed — log the attempt with nulls, never estimated
    const event = {
      event: 'telemetry', ts: now(), 'wall-minutes': null, 'active-minutes': null,
      'in-tokens': null, 'out-tokens': null, 'ctx-remaining-pct': null,
      source: 'scraped', pane: paneId, note: 'pane read failed',
    };
    appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
    return { event, readOk: false };
  }
  const f = parseFooter(text);
  // wall-minutes from the ledger's own run-start (exact, not scraped)
  let wallMinutes: number | null = null;
  try {
    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e['event'] === 'run-start' && typeof e['ts'] === 'string') {
          wallMinutes = Math.max(0, Math.round((Date.parse(now()) - Date.parse(e['ts'] as string)) / 60_000));
          break;
        }
      } catch { /* skip malformed lines — the report flags them */ }
    }
  } catch { /* no ledger yet — wall stays null */ }
  const event = {
    event: 'telemetry', ts: now(), 'wall-minutes': wallMinutes, 'active-minutes': null,
    'in-tokens': f.cumulativeTokens, 'out-tokens': null,
    'ctx-remaining-pct': f.ctxPct,
    source: 'scraped', pane: paneId,
    ...(f.turnTokens !== null || f.turnElapsed !== null
      ? { 'turn-tokens': f.turnTokens, 'turn-elapsed': f.turnElapsed }
      : {}),
  };
  appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
  return { event, readOk: true };
};

const lineCount = (path: string): number => {
  try {
    return readFileSync(path, 'utf8').trim().split('\n').length;
  } catch {
    return 0;
  }
};

const hasRunEnd = (path: string): boolean => {
  try {
    return readFileSync(path, 'utf8').includes('"event":"run-end"');
  } catch {
    return false;
  }
};

export type PollerOpts = {
  intervalMs?: number; // default 30 minutes
  checkMs?: number; // ledger-growth check granularity, default 15s
  maxMinutes?: number; // hard exit cap, default none
  maxIterations?: number; // hard loop cap (test safety), default none
  readPane?: (pane: string) => string | null;
  now?: () => string;
  nowMs?: () => number;
  sleep?: (ms: number) => void;
};

/**
 * The poll loop: scrape immediately, then again every intervalMs OR when the
 * ledger gains a line (a unit boundary), whichever comes first. Exits on the
 * ledger's run-end event or the maxMinutes cap. herdr pane read is a read —
 * the pane is never consumed or leaked by polling. Returns the scrape count.
 */
export const runPoller = (paneId: string, ledgerPath: string, opts?: PollerOpts): number => {
  const intervalMs = opts?.intervalMs ?? 30 * 60_000;
  const checkMs = opts?.checkMs ?? 15_000;
  const maxMinutes = opts?.maxMinutes ?? 0;
  const maxIterations = opts?.maxIterations ?? Infinity;
  const sleep = opts?.sleep ?? ((ms: number): void => { Bun.sleepSync(ms); });
  const nowMs = opts?.nowMs ?? ((): number => Date.now());
  const startMs = nowMs();
  let lastScrapeMs = -Infinity;
  let knownLines = lineCount(ledgerPath);
  let scrapes = 0;
  for (let i = 0; i < maxIterations; i++) {
    const t = nowMs();
    if (maxMinutes > 0 && t - startMs >= maxMinutes * 60_000) break;
    if (hasRunEnd(ledgerPath)) break;
    const lines = lineCount(ledgerPath);
    const due = t - lastScrapeMs >= intervalMs;
    const boundary = lines > knownLines;
    if (due || boundary) {
      scrapeOnce(paneId, ledgerPath, { readPane: opts?.readPane, now: opts?.now });
      scrapes++;
      lastScrapeMs = t;
      knownLines = lineCount(ledgerPath);
    } else {
      knownLines = Math.max(knownLines, lines);
      sleep(checkMs);
    }
  }
  return scrapes;
};

const main = (): void => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flag = (name: string): number | null => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) : null;
  };
  if (args.length < 2) {
    console.error('usage: bun scripts/ledger-scrape.ts <pane-id> <ledger.jsonl> [--once] [--interval-ms N] [--check-ms N] [--max-minutes N]');
    process.exit(1);
  }
  const [paneId, ledgerPath] = args as [string, string];
  if (process.argv.includes('--once')) {
    const r = scrapeOnce(paneId, ledgerPath);
    if (!r.readOk) {
      console.error('pane read failed — appended a null telemetry event (graceful absence)');
      process.exit(2);
    }
    console.log(`scraped 1 telemetry event -> ${ledgerPath}`);
    return;
  }
  const scrapes = runPoller(paneId, ledgerPath, {
    intervalMs: flag('--interval-ms') ?? undefined,
    checkMs: flag('--check-ms') ?? undefined,
    maxMinutes: flag('--max-minutes') ?? undefined,
  });
  console.log(`poller finished after ${scrapes} scrape(s) -> ${ledgerPath}`);
};

if (import.meta.main) main();

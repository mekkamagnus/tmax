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
 *   Usage: bun scripts/ledger-scrape.ts <pane-id|-> <ledger.jsonl>
 *                [--workspace WS --tab-label LABEL]
 *                [--once] [--interval-ms N] [--check-ms N] [--max-minutes N]
 *
 *   A long-lived poller MUST pass --workspace + --tab-label: herdr pane ids
 *   compact when tabs close, so an id captured at launch can later name a
 *   DIFFERENT tab (silent wrong-pane data). With the label the pane is
 *   re-resolved before every scrape; the positional id is then unused.
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

const runCmd = (cmd: string[]): { exitCode: number | null; stdout: string } => {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: r.exitCode, stdout: new TextDecoder().decode(r.stdout) };
};

/**
 * The pane currently showing the tab labelled TAB_LABEL in WORKSPACE, or
 * null when the tab (or herdr itself) cannot be found. herdr pane ids
 * COMPACT when tabs close — an id captured at launch can later name a
 * different tab — so a long-lived poller re-resolves per scrape instead of
 * trusting one id.
 */
export const resolvePaneForTab = (
  workspace: string,
  tabLabel: string,
  run: (cmd: string[]) => { exitCode: number | null; stdout: string } = runCmd,
): string | null => {
  const tabs = run(['herdr', 'tab', 'list', '--workspace', workspace]);
  if (tabs.exitCode !== 0) return null;
  let tabId: string | null = null;
  try {
    const list = (JSON.parse(tabs.stdout) as { result?: { tabs?: { tab_id?: string; label?: string }[] } })
      .result?.tabs;
    tabId = list?.find((t) => t.label === tabLabel)?.tab_id ?? null;
  } catch {
    return null;
  }
  if (!tabId) return null;
  const panes = run(['herdr', 'pane', 'list']);
  if (panes.exitCode !== 0) return null;
  try {
    const list = (JSON.parse(panes.stdout) as { result?: { panes?: { pane_id?: string; tab_id?: string }[] } })
      .result?.panes;
    return list?.find((p) => p.tab_id === tabId)?.pane_id ?? null;
  } catch {
    return null;
  }
};

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

/** Consecutive unresolved-tab checks tolerated before the poller gives up (≈45s). */
const MAX_UNRESOLVED = 3;

export type PollerOpts = {
  intervalMs?: number; // default 30 minutes
  checkMs?: number; // ledger-growth check granularity, default 15s
  maxMinutes?: number; // hard exit cap, default none
  maxIterations?: number; // hard loop cap (test safety), default none
  readPane?: (pane: string) => string | null;
  now?: () => string;
  nowMs?: () => number;
  sleep?: (ms: number) => void;
  /** Resolves the pane to scrape (null = tab gone). Default: the launch paneId. */
  resolvePane?: () => string | null;
  /** Labels the absence event when resolvePane keeps returning null. */
  tabLabel?: string;
};

/**
 * The poll loop: scrape immediately, then again every intervalMs OR when the
 * ledger gains a line (a unit boundary), whichever comes first. Exits on the
 * ledger's run-end event or the maxMinutes cap. herdr pane read is a read —
 * the pane is never consumed or leaked by polling. Returns the scrape count.
 *
 * With resolvePane the pane is re-resolved per scrape; a null (tab gone or
 * herdr unreachable) is retried on the next check, and after MAX_UNRESOLVED
 * consecutive misses ONE graceful-absence event is recorded and the poller
 * stops — it never falls back to a stale id.
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
  let unresolved = 0;
  for (let i = 0; i < maxIterations; i++) {
    const t = nowMs();
    if (maxMinutes > 0 && t - startMs >= maxMinutes * 60_000) break;
    if (hasRunEnd(ledgerPath)) break;
    const lines = lineCount(ledgerPath);
    const due = t - lastScrapeMs >= intervalMs;
    const boundary = lines > knownLines;
    if (due || boundary) {
      const pane = opts?.resolvePane ? opts.resolvePane() : paneId;
      if (pane === null) {
        if (++unresolved >= MAX_UNRESOLVED) {
          // Graceful absence through the failing-read path: an unresolvable
          // synthetic id, so the event names the tab that could not be found.
          scrapeOnce(`tab-not-found:${opts?.tabLabel ?? paneId}`, ledgerPath, {
            readPane: opts?.readPane,
            now: opts?.now,
          });
          break;
        }
        sleep(checkMs);
      } else {
        unresolved = 0;
        scrapeOnce(pane, ledgerPath, { readPane: opts?.readPane, now: opts?.now });
        scrapes++;
        lastScrapeMs = t;
        knownLines = lineCount(ledgerPath);
      }
    } else {
      knownLines = Math.max(knownLines, lines);
      sleep(checkMs);
    }
  }
  return scrapes;
};

/** CLI flags that take a value — the value is never a positional argument. */
const VALUE_FLAGS = ['--interval-ms', '--check-ms', '--max-minutes', '--workspace', '--tab-label'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

const main = (): void => {
  const positional: string[] = [];
  const flags: Partial<Record<ValueFlag, string>> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i] as string;
    if ((VALUE_FLAGS as readonly string[]).includes(a)) flags[a as ValueFlag] = process.argv[++i] ?? '';
    else if (!a.startsWith('--')) positional.push(a);
  }
  const flag = (name: ValueFlag): number | null => {
    const v = flags[name];
    return v === undefined ? null : Number(v);
  };
  if (positional.length < 2) {
    console.error('usage: bun scripts/ledger-scrape.ts <pane-id|-> <ledger.jsonl> [--workspace WS --tab-label LABEL] [--once] [--interval-ms N] [--check-ms N] [--max-minutes N]');
    process.exit(1);
  }
  const [paneId, ledgerPath] = positional as [string, string];
  // --tab-label: re-resolve the pane before every scrape (ids compact on tab close)
  const tabLabel = flags['--tab-label'];
  const workspace = flags['--workspace'];
  const resolvePane = tabLabel
    ? (): string | null => resolvePaneForTab(workspace ?? '', tabLabel)
    : undefined;
  if (process.argv.includes('--once')) {
    const pane = resolvePane ? resolvePane() : paneId;
    if (pane === null) {
      console.error(`tab not found: ${tabLabel} — nothing scraped`);
      process.exit(2);
    }
    const r = scrapeOnce(pane, ledgerPath);
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
    resolvePane,
    tabLabel,
  });
  console.log(`poller finished after ${scrapes} scrape(s) -> ${ledgerPath}`);
};

if (import.meta.main) main();

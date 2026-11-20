/**
 * @file ledger-trailers.ts
 * @description RFC-036 / issue #323 — the Agent-Run commit-trailer convention's
 *   reader-side check. Every agent-run commit carries `Agent-Run: <ledger-id>`
 *   (the ledger file's stem); attribution becomes structural instead of
 *   scope-guessed. This module extracts trailers from commit messages and
 *   audits a commit window for unattributed commits. It is an AUDIT, not a
 *   gate: agents run with bypassed hooks, so the convention is enforced by
 *   the report reader flagging gaps (ADR-0293), never by a git hook.
 */
import type { Validation } from './ledger-schema.ts';

/** One commit as the reader sees it. */
export type CommitInfo = {
  /** full sha */
  sha: string;
  /** ISO-8601 author date (git %aI) */
  authorDate: string;
  /** subject line */
  subject: string;
  /** full raw message below the subject (trailer block lives here) */
  body: string;
};

export type TrailerAudit = {
  /** shas grouped by the ledger id their trailer names */
  attributed: Map<string, string[]>;
  /** commits in the window with no Agent-Run trailer — humans, or protocol violations */
  unattributed: CommitInfo[];
  /** commits in the window (chronological order) */
  window: CommitInfo[];
};

const AGENT_RUN_RE = /^[ \t]*Agent-Run:[ \t]*(\S+)[ \t]*$/;

/**
 * Extract every `Agent-Run: <id>` trailer value from a commit message
 * (subject + body). A trailer line must be exactly `Agent-Run: <token>` —
 * ledger ids are filename stems. A malformed line (e.g. trailing prose)
 * matches nothing, so the commit surfaces as unattributed in the audit
 * rather than being silently attributed to a truncated id.
 */
export const parseAgentRunTrailers = (message: string): string[] => {
  const found: string[] = [];
  for (const line of message.split('\n')) {
    const m = line.match(AGENT_RUN_RE);
    if (m?.[1]) found.push(m[1]);
  }
  return found;
};

/**
 * Audit a run window: partition commits into per-ledger attribution and the
 * unattributed list. Pure — callers supply the commits (readCommitsSince
 * gathers them from git).
 */
export const auditCommitTrailers = (commits: CommitInfo[]): TrailerAudit => {
  const attributed = new Map<string, string[]>();
  const unattributed: CommitInfo[] = [];
  for (const c of commits) {
    const ids = parseAgentRunTrailers(`${c.subject}\n${c.body}`);
    if (ids.length === 0) {
      unattributed.push(c);
      continue;
    }
    for (const id of ids) {
      const bucket = attributed.get(id) ?? [];
      bucket.push(c.sha);
      attributed.set(id, bucket);
    }
  }
  return { attributed, unattributed, window: commits };
};

const RECORD_SEP = '\x1e';
const UNIT_SEP = '\x1f';

/**
 * Read every commit on HEAD with author date >= sinceTs (ISO-8601), oldest
 * first. Uses unit/record separators so subjects and bodies survive intact.
 * Returns { ok: false, error } instead of throwing — the report renders the
 * error rather than crashing.
 */
export const readCommitsSince = (
  sinceTs: string,
  opts?: { cwd?: string; until?: string },
): { ok: true; commits: CommitInfo[] } | { ok: false; error: string } => {
  const format = `%H${UNIT_SEP}%aI${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`;
  const args = ['log', `--since=${sinceTs}`, `--pretty=format:${format}`];
  if (opts?.until) args.push(`--until=${opts.until}`);
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(['git', ...args], {
      cwd: opts?.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (e) {
    return { ok: false, error: `git log failed to spawn (bad cwd?): ${(e as Error).message}` };
  }
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    return { ok: false, error: `git log failed (exit ${result.exitCode}): ${stderr.trim()}` };
  }
  const raw = new TextDecoder().decode(result.stdout);
  const commits: CommitInfo[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    const parts = record.split(UNIT_SEP);
    if (parts.length !== 4) continue; // empty / malformed record — skip
    const [sha, authorDate, subject, body] = parts as [string, string, string, string];
    if (!sha.trim()) continue;
    commits.push({ sha: sha.trim(), authorDate, subject, body });
  }
  // git log emits newest-first; audits read oldest-first
  commits.reverse();
  return { ok: true, commits };
};

/**
 * The run-window audit the report renders: commits since a ledger's
 * run-start ts, checked for trailers. The ledger's own events (already
 * schema-validated lines) supply run-start.
 */
export type RunWindow = {
  runStartTs: string | null;
  audit: TrailerAudit | null;
  gitError: string | null;
};

/** Find the run-start ts among already-validated ledger lines (decoded JSON). */
export const runStartTsOf = (events: unknown[]): string | null => {
  for (const e of events) {
    if (
      typeof e === 'object' && e !== null && (e as Record<string, unknown>)['event'] === 'run-start'
    ) {
      const ts = (e as Record<string, unknown>)['ts'];
      return typeof ts === 'string' ? ts : null;
    }
  }
  return null;
};

/**
 * Audit a ledger's commit window: reads commits since the ledger's run-start
 * and partitions them by trailer. Both git failures and missing run-start are
 * reported in-band ({ gitError }) — the reader flags them, it does not crash.
 */
export const auditLedgerRunWindow = (
  validatedLines: { line: string; validation: Validation }[],
  opts?: { cwd?: string },
): RunWindow => {
  const decoded: unknown[] = [];
  for (const { line, validation } of validatedLines) {
    if (!validation.ok) continue;
    try {
      decoded.push(JSON.parse(line));
    } catch {
      // validateLedgerLine guaranteed parseability; defensive skip
    }
  }
  const runStartTs = runStartTsOf(decoded);
  if (!runStartTs) {
    return { runStartTs: null, audit: null, gitError: 'ledger has no run-start event' };
  }
  const read = readCommitsSince(runStartTs, opts);
  if (!read.ok) {
    return { runStartTs, audit: null, gitError: read.error };
  }
  return { runStartTs, audit: auditCommitTrailers(read.commits), gitError: null };
};

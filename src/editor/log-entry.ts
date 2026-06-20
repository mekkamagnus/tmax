/**
 * @file log-entry.ts
 * @description Unified observability schema (SPEC-055).
 *
 * Every editor event, shell command, subprocess, test run, and auto-save is
 * represented as a single `LogEntry`. Optional fields are absent on entries
 * where they don't apply, so the schema scales from a one-line editor message
 * to a full program-run record without overloading.
 *
 * The five virtual buffers (`*Messages*`, `*daemon*`, `*Shell Output*`,
 * `*Async Output*`, `*Tests*`) are filtered renders of a single store of these
 * entries — see `log-store.ts`.
 */

import type { LogLevel } from "./message-log.ts";

/** Event source. Determines which buffer an entry renders into. */
export type LogCategory = 'editor' | 'daemon' | 'shell' | 'process' | 'test' | 'autosave';

/**
 * A single observability entry. `ts` is epoch ms (full date, unambiguous across
 * sessions); optional fields are present only when meaningful for the category.
 */
export interface LogEntry {
  /** Epoch milliseconds — full date, unambiguous across sessions. */
  ts: number;
  /** Severity. `warn`/`error` trigger the mirror into `*Messages*`. */
  level: LogLevel;
  /** Event source — determines the primary buffer. */
  category: LogCategory;
  /** Human-readable summary line. */
  text: string;
  /** T-Lisp command name (attached to errors for forensics). */
  command?: string;
  /** Which client/frame caused the entry — multi-client attribution. */
  frameId?: string;
  /** shell / process / test only. */
  exitCode?: number;
  /** shell / process / test only. */
  durationMs?: number;
  /** Last ~4 KB of stdout+stderr, capped. */
  outputTail?: string;
  /** make-process only. */
  pid?: number;
}

/** Numeric severity ordering for level filtering. debug < info < warn < error. */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Names of the views rendered from the store. A view maps to a predicate over
 * entries; the five virtual buffers each draw from one view. The `messages`
 * view is the union of editor/autosave with every warn/error from any category
 * (the SPEC-055 mirror rule).
 */
export type LogView = 'messages' | 'daemon' | 'shell' | 'process' | 'test';

/** Max bytes stored in an entry's `outputTail` (stdout+stderr combined tail). */
export const OUTPUT_TAIL_MAX = 4096;

/** Cap an output string to the last OUTPUT_TAIL_MAX bytes (UTF-8 safe via spread). */
export function capTail(text: string): string {
  if (text.length <= OUTPUT_TAIL_MAX) return text;
  return text.slice(-OUTPUT_TAIL_MAX);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Compact `HH:MM:SS` (used on the status line / compact renders). */
export function formatTimeCompact(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Full `YYYY-MM-DD HH:MM:SS` (used in buffers / persisted log). */
export function formatTimeFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${formatTimeCompact(ts)}`;
}

/**
 * Render a single entry to its display line. The compact form
 * `[HH:MM:SS] [level] [command?] text` matches the existing `*Messages*`
 * rendering for backward compatibility; program-run entries additionally
 * append `[exit N] [Dms]` and a trailing output-tail block when present.
 */
export function renderEntry(e: LogEntry, opts: { fullDate?: boolean } = {}): string {
  const ts = opts.fullDate ? formatTimeFull(e.ts) : formatTimeCompact(e.ts);
  const cmd = e.command ? ` [${e.command}]` : '';
  const frame = e.frameId ? ` [frame:${e.frameId}]` : '';
  let line = `[${ts}] [${e.level}]${cmd}${frame} ${e.text}`;

  // Program-run enrichment (shell/process/test).
  const parts: string[] = [];
  if (e.exitCode !== undefined) parts.push(`[exit ${e.exitCode}]`);
  if (e.durationMs !== undefined) parts.push(`[${e.durationMs}ms]`);
  if (parts.length > 0) line += ` ${parts.join(' ')}`;

  if (e.outputTail && e.outputTail.trim().length > 0) {
    // Indent each tail line so it reads as attached output under the summary.
    const indented = e.outputTail.replace(/\n$/, '').split('\n').map(l => `  ${l}`).join('\n');
    line += `\n${indented}`;
  }
  return line;
}

/** Does this entry belong in the `messages` view (editor/autosave or mirror)? */
export function isInMessagesView(e: LogEntry): boolean {
  if (e.category === 'editor' || e.category === 'autosave') return true;
  // Mirror rule: every warn/error from any category mirrors into *Messages*.
  return e.level === 'warn' || e.level === 'error';
}

/** Serialize an entry to one JSONL line (for `~/.config/tmax/messages.log`). */
export function entryToJsonl(e: LogEntry): string {
  return JSON.stringify(e);
}

/** Parse one JSONL line back into a LogEntry, or null if malformed. */
export function jsonlToEntry(line: string): LogEntry | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj.ts !== 'number' || typeof obj.level !== 'string' ||
        typeof obj.category !== 'string' || typeof obj.text !== 'string') {
      return null;
    }
    return obj as LogEntry;
  } catch {
    return null; // corrupt/truncated line — skip, don't crash.
  }
}

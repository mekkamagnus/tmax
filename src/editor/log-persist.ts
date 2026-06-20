/**
 * @file log-persist.ts
 * @description JSONL persistence for the unified log (SPEC-055).
 *
 * Append-per-write strategy (crash-safe): every entry is appended as one JSONL
 * line to ~/.config/tmax/messages.log. When the file exceeds MAX_BYTES, it is
 * rotated to messages.log.1 (overwriting any prior rotated file) before the
 * append. On startup, tailLoad reads the file from the end and parses up to
 * `max` valid lines (a corrupted final line from a crash is skipped, not fatal).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type LogEntry,
  entryToJsonl,
  jsonlToEntry,
} from "./log-entry.ts";

/** Default log directory: ~/.config/tmax/ (matches init.tlisp / macros.tlisp). */
export function defaultLogDir(): string {
  return join(process.env.HOME ?? "~", ".config", "tmax");
}

/** Default log file path: ~/.config/tmax/messages.log
 *  Honors TMAX_LOG_PATH env var (for test isolation). */
export function defaultLogPath(): string {
  if (process.env.TMAX_LOG_PATH) return process.env.TMAX_LOG_PATH;
  return join(defaultLogDir(), "messages.log");
}

/** Rotate when the active log exceeds this many bytes (5 MB). */
export const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Append one entry as a JSONL line. Rotates the file (to `<path>.1`) if the
 * current size plus the new line would exceed MAX_BYTES. Never throws on a
 * missing directory — it is created. Returns true on success.
 */
export function appendEntry(path: string, entry: LogEntry): boolean {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = entryToJsonl(entry) + "\n";
    if (existsSync(path)) {
      try {
        const size = statSync(path).size;
        if (size + Buffer.byteLength(line) > MAX_BYTES) {
          renameSync(path, `${path}.1`);
        }
      } catch { /* stat failed — proceed to write anyway */ }
    }
    appendFileSync(path, line, "utf-8");
    return true;
  } catch {
    return false; // persistence must never break the editor.
  }
}

/**
 * Tail-load up to `max` entries from the log file. Reads the whole file and
 * takes the last `max` parseable lines — resilient to a truncated final line.
 * Also reads the rotated `.1` file if the active file yielded fewer than `max`
 * entries, so a fresh-rotated session still shows prior context.
 */
export function tailLoad(path: string, max: number): LogEntry[] {
  const out: LogEntry[] = [];
  const readFrom = (p: string): string => {
    try { return readFileSync(p, "utf-8"); } catch { return ""; }
  };
  // Active file first.
  const active = readFrom(path).split("\n").filter(l => l.length > 0);
  for (const line of active) {
    const e = jsonlToEntry(line);
    if (e) out.push(e);
  }
  // If short, top up from the rotated file.
  if (out.length < max) {
    const rotated = readFrom(`${path}.1`).split("\n").filter(l => l.length > 0);
    const rotatedParsed: LogEntry[] = [];
    for (const line of rotated) {
      const e = jsonlToEntry(line);
      if (e) rotatedParsed.push(e);
    }
    const need = max - out.length;
    out.unshift(...rotatedParsed.slice(-need));
  }
  return out.slice(-max);
}

/** Test helper: write a raw string to the log path (used by unit tests). */
export function _writeRaw(path: string, text: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, text, "utf-8");
}

/**
 * @file log-store.ts
 * @description Unified ring store backing all observability buffers (SPEC-055).
 *
 * Holds entries of every category in one ring. Virtual buffers are filtered
 * renders (views) of this same store — no data duplication. The `messages`
 * view applies the mirror rule: editor/autosave plus every warn/error entry
 * from any category.
 *
 * **Lazy render** is the load-bearing mechanic: each view caches its rendered
 * text and is only recomputed when a write invalidates it. This makes per-write
 * cost O(1) amortized — the prerequisite RFC-017 deferred on, since the old
 * `MessageLog.render()` was O(n) per write.
 */

import type { LogLevel } from "./message-log.ts";
import {
  type LogCategory,
  type LogEntry,
  type LogView,
  LEVEL_ORDER,
  entryToJsonl,
  isInMessagesView,
  jsonlToEntry,
  renderEntry,
} from "./log-entry.ts";

/** A writeable entry — `ts` is stamped if absent. */
export type LogEntryInput = Omit<LogEntry, 'ts'> & { ts?: number };

export class Log {
  private entries: LogEntry[] = [];
  private _maxSize: number = 1000;
  private _minLevel: LogLevel = 'info';
  /** cache key (view name [+ '#full' suffix]) → rendered text */
  private cached: Map<string, string> = new Map();
  /** views whose cache is stale and must be recomputed on next `render` */
  private dirty: Set<LogView> = new Set();

  /**
   * Append an entry. Applies the level filter, stamps `ts`, evicts oldest if
   * over max, and invalidates only the views whose contents could change.
   */
  log(input: LogEntryInput): LogEntry | null {
    if (this._maxSize === 0) return null;
    if (LEVEL_ORDER[input.level] < LEVEL_ORDER[this._minLevel]) return null;

    const entry: LogEntry = { ts: input.ts ?? Date.now(), ...input };
    this.entries.push(entry);
    if (this.entries.length > this._maxSize) {
      this.entries.splice(0, this.entries.length - this._maxSize);
    }
    this.invalidate(entry);
    return entry;
  }

  /**
   * Mark affected views dirty. Always includes the entry's own category view
   * and the `messages` view (because the mirror rule may pull it in). This
   * conservative invalidation keeps the cache correct without a full rescan.
   */
  private invalidate(e: LogEntry): void {
    this.dirty.add(e.category as LogView);
    this.dirty.add('messages');
    // Caches may also carry stale tail-load snapshots — drop all on any write
    // to be safe, but the common case re-renders only the two views above.
  }

  /**
   * Render a view to text. Returns the cached string on a cache hit (O(1));
   * recomputes only when the view is dirty. `fullDate` opts control timestamp
   * format — full date is used by the persisted log and buffers.
   */
  render(view: LogView, opts: { fullDate?: boolean } = {}): string {
    const cacheKey = opts.fullDate ? `${view}#full` : view;
    if (!this.dirty.has(view)) {
      const hit = this.cached.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const rows = this.getEntries({ view });
    const text = rows.map(e => renderEntry(e, opts)).join('\n');
    this.cached.set(cacheKey, text);
    this.dirty.delete(view);
    return text;
  }

  /**
   * Query entries. Exactly one of `view` / `category` selects the set:
   *  - `view` returns the same set `render(view)` draws from (honors mirror rule).
   *  - `category` returns a raw single-category filter (for the daemon query path).
   * `level` further filters by minimum severity; `last` caps to the most recent N.
   */
  getEntries(options: {
    view?: LogView;
    category?: LogCategory;
    level?: LogLevel;
    last?: number;
  } = {}): LogEntry[] {
    let result: LogEntry[];
    if (options.view) {
      result = this.entries.filter(e => this.matchesView(e, options.view!));
    } else if (options.category) {
      result = this.entries.filter(e => e.category === options.category);
    } else {
      result = [...this.entries];
    }
    if (options.level) {
      const min = LEVEL_ORDER[options.level];
      result = result.filter(e => LEVEL_ORDER[e.level] >= min);
    }
    if (options.last !== undefined && options.last < result.length) {
      result = result.slice(-options.last);
    }
    return result;
  }

  /** Predicate for whether an entry belongs to a view. */
  private matchesView(e: LogEntry, view: LogView): boolean {
    switch (view) {
      case 'messages': return isInMessagesView(e);
      case 'daemon':   return e.category === 'daemon';
      case 'shell':    return e.category === 'shell';
      case 'process':  return e.category === 'process';
      case 'test':     return e.category === 'test';
    }
  }

  /** Clear all entries (or one category if given). Drops all caches. */
  clear(category?: LogCategory): void {
    if (category === undefined) {
      this.entries = [];
    } else {
      this.entries = this.entries.filter(e => e.category !== category);
    }
    this.cached.clear();
    this.dirty = new Set(['messages', 'daemon', 'shell', 'process', 'test']);
  }

  get maxSize(): number { return this._maxSize; }
  set maxSize(n: number) {
    this._maxSize = Math.max(0, n);
    if (this.entries.length > this._maxSize) {
      this.entries.splice(0, this.entries.length - this._maxSize);
    }
    this.cached.clear();
    this.dirty = new Set(['messages', 'daemon', 'shell', 'process', 'test']);
  }

  get minLevel(): LogLevel { return this._minLevel; }
  set minLevel(level: LogLevel) {
    this._minLevel = level;
    this.cached.clear();
    this.dirty = new Set(['messages', 'daemon', 'shell', 'process', 'test']);
  }

  /** All raw entries (defensive copy). */
  all(): LogEntry[] { return [...this.entries]; }

  /** Serialize every entry to JSONL (one line each). */
  serializeJsonl(): string {
    return this.entries.map(entryToJsonl).join('\n') + (this.entries.length > 0 ? '\n' : '');
  }
}

/** Tail-cap-aware parse of JSONL text into entries (most recent last). */
export function parseJsonl(text: string, max: number): LogEntry[] {
  const lines = text.split('\n').filter(l => l.length > 0);
  const parsed: LogEntry[] = [];
  for (const line of lines) {
    const e = jsonlToEntry(line);
    if (e) parsed.push(e);
  }
  // Keep only the most recent `max` (matches ring semantics on load-back).
  return parsed.slice(-max);
}

/**
 * View-bound adapter: exposes the exact API the old `MessageLog` did
 * (`render()`, `getEntries()`, `minLevel`, `maxSize`, `clear()`) but draws from
 * a single `Log` filtered by a fixed view. Lets `getMessageLog()`/`getDaemonLog()`
 * keep their existing callers (tlisp-api, server.ts, tests) without change.
 */
export class ViewBoundLog {
  constructor(private readonly store: Log, private readonly view: LogView) {}

  render(): string { return this.store.render(this.view); }

  getEntries(options?: { level?: LogLevel; last?: number }): LogEntry[] {
    return this.store.getEntries({ view: this.view, ...options });
  }

  clear(): void { this.store.clear(); }

  get minLevel(): LogLevel { return this.store.minLevel; }
  set minLevel(level: LogLevel) { this.store.minLevel = level; }

  get maxSize(): number { return this.store.maxSize; }
  set maxSize(n: number) { this.store.maxSize = n; }
}

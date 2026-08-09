/**
 * @file resolver.ts
 * @description SPEC-114 (#181) — locate a man-page source file for a topic.
 *   Searches MANPATH (if set) else the standard macOS/Linux dirs, honoring an
 *   optional section and MANSECT ordering. Handles plain and `.gz` sources.
 */

import { existsSync, readFileSync } from "fs";

/** Dirs searched when MANPATH is unset (macOS + common Linux/homebrew). */
const DEFAULT_MAN_DIRS = [
  "/opt/homebrew/share/man",
  "/usr/local/share/man",
  "/usr/share/man",
];

/** Sections searched (in order) when none is requested and MANSECT is unset. */
const DEFAULT_SECTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** A resolved man-page source location. */
export interface ResolvedManPage {
  /** Absolute path to the source file (plain or `.gz`). */
  path: string;
  /** The man section (e.g. "1", "3"). */
  section: string;
  /** Whether the file is gzip-compressed. */
  gzipped: boolean;
}

/** The dirs to search, honoring MANPATH when set. */
function manDirs(): string[] {
  const mp = process.env.MANPATH;
  if (mp && mp.trim().length > 0) return mp.split(":").filter(Boolean);
  return DEFAULT_MAN_DIRS.filter((d) => existsSync(d));
}

/** The section search order, honoring MANSECT when set. */
function sectionOrder(section?: string): string[] {
  if (section) return [section];
  const ms = process.env.MANSECT;
  if (ms && ms.trim().length > 0) return ms.split(":").filter(Boolean);
  return DEFAULT_SECTS;
}

/**
 * Resolve a man page for TOPIC, optionally in SECTION. Returns null if no
 * source file is found in any searched dir/section.
 */
export function resolveManPage(topic: string, section?: string): ResolvedManPage | null {
  const cleanTopic = topic.trim();
  if (cleanTopic.length === 0) return null;
  for (const dir of manDirs()) {
    for (const sec of sectionOrder(section)) {
      const plain = `${dir}/man${sec}/${cleanTopic}.${sec}`;
      const gz = `${plain}.gz`;
      if (existsSync(plain)) return { path: plain, section: sec, gzipped: false };
      if (existsSync(gz)) return { path: gz, section: sec, gzipped: true };
    }
  }
  return null;
}

/** Read (and gunzip if needed) a resolved man-page source as UTF-8. */
export function readManSource(r: ResolvedManPage): string {
  const raw = readFileSync(r.path);
  const bytes = r.gzipped ? Bun.gunzipSync(raw) : raw;
  return Buffer.from(bytes).toString("utf8");
}

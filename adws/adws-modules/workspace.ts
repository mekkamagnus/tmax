/**
 * workspace.ts — spec-anchored workspace discovery.
 *
 * When a user runs a dispatcher with a spec path but no --id, this helper
 * finds the most recent existing workspace whose adw-state.json records that
 * spec_path. This lets multiple stages run against the same spec collect their
 * logs in one agents/{id}/ dir — instead of minting a fresh random workspace
 * per invocation.
 *
 * Pure, synchronous, no deps except fs + path. Imported by the three
 * spec-anchored dispatchers (adw-build, adw-spec-review, adw-patch-review).
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Find the most recent workspace whose adw-state.json has a matching spec_path.
 *
 * ULID ids sort chronologically (lexicographic = temporal), so sorting entries
 * descending and returning the first match gives the newest workspace.
 * Returns the workspace id, or null if none found.
 *
 * Scans agents/{id}/adw-state.json. Reads only the spec_path field - cheap.
 * Skips dirs that don't match the 10-char ULID shape (e.g. test artifacts).
 * Skips corrupt/unparseable state files gracefully.
 */
export function findWorkspaceBySpecPath(agentsDir: string, specPath: string): string | null {
  if (!existsSync(agentsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ADW_ID_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return null;
  }
  // Sort descending (newest first) — ULID timestamps are lexicographically ordered.
  entries.sort((a, b) => b.localeCompare(a));
  for (const id of entries) {
    const stateFile = join(agentsDir, id, "adw-state.json");
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { spec_path?: string };
      if (state.spec_path === specPath) return id;
    } catch {
      continue; // corrupt state file — skip
    }
  }
  return null;
}

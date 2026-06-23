/**
 * workspace.ts — spec-anchored workspace discovery + spec-path normalization.
 *
 * When a user runs a dispatcher with a spec path but no --id, this helper
 * finds the most recent existing workspace whose adw-state.json records that
 * spec_path. This lets multiple stages run against the same spec collect their
 * logs in one agents/{id}/ dir — instead of minting a fresh random workspace
 * per invocation.
 *
 * Pure, synchronous, no deps except fs + path. Imported by the three
 * spec-anchored dispatchers (adw-build, adw-spec-review, adw-patch-review)
 * and the orchestrator (for spec-path normalization across main/worktree roots).
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { isAbsolute, join, relative } from "path";

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
 *
 * SPEC-065: normalizes the spec_path via normalizeSpecPath before comparing,
 * so a workspace that recorded `docs/specs/SPEC-065.md` matches an input
 * `/<abs-project-root>/docs/specs/SPEC-065.md` or
 * `/<abs-worktree>/docs/specs/SPEC-065.md`.
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
  const inputRel = normalizeSpecPath(specPath).relative;
  for (const id of entries) {
    const stateFile = join(agentsDir, id, "adw-state.json");
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { spec_path?: string };
      if (!state.spec_path) continue;
      const stateRel = normalizeSpecPath(state.spec_path).relative;
      if (stateRel === inputRel) return id;
    } catch {
      continue; // corrupt state file — skip
    }
  }
  return null;
}

/**
 * Result of normalizing a spec path. `relative` is the repo-relative form
 * (e.g. `docs/specs/SPEC-065.md`) — used for state/event persistence so paths
 * compare equal regardless of which worktree root they were recorded from.
 * `absolute` is the path to use for THIS process's filesystem access (under
 * the worktree root when ADW_WORKTREE is set, else under projectRoot).
 */
export interface NormalizedSpecPath {
  /** Repo-relative path (e.g. `docs/specs/SPEC-065.md`). */
  relative: string;
  /** Absolute path under the requested root. */
  absolute: string;
}

/**
 * Normalize a spec path to its repo-relative form plus an absolute path for
 * the current process. Accepts:
 *
 *   - Repo-relative paths (`docs/specs/SPEC-065.md`) → unchanged.
 *   - Main-checkout absolute paths (`/<projectRoot>/docs/specs/SPEC-065.md`).
 *   - Worktree-absolute paths (`/<worktreeRoot>/docs/specs/SPEC-065.md`).
 *
 * Rejects (throws) paths outside both roots, or paths that don't begin with
 * `docs/specs/`. The worktree root is taken from env `ADW_WORKTREE` when set;
 * otherwise falls back to `projectRoot`.
 *
 * Used by the orchestrator to record a stable `spec_path` in adw-state.json
 * and pass the correct worktree-local absolute path to child subprocesses.
 */
export function normalizeSpecPath(
  input: string,
  opts: { projectRoot: string; worktreeRoot?: string } = { projectRoot: process.cwd() },
): NormalizedSpecPath {
  const worktreeRoot = opts.worktreeRoot ?? process.env.ADW_WORKTREE ?? opts.projectRoot;
  if (!isAbsolute(input)) {
    // Already relative — resolve against the active root.
    return { relative: input, absolute: join(worktreeRoot, input) };
  }
  // Absolute path — try worktree root first, then project root.
  const relToWorktree = relative(worktreeRoot, input);
  const relToProject = relative(opts.projectRoot, input);
  // Pick whichever relative path doesn't escape its root.
  if (relToWorktree && !relToWorktree.startsWith("..") && !isAbsolute(relToWorktree)) {
    return { relative: relToWorktree, absolute: input };
  }
  if (relToProject && !relToProject.startsWith("..") && !isAbsolute(relToProject)) {
    return { relative: relToProject, absolute: join(worktreeRoot, relToProject) };
  }
  throw new Error(
    `normalizeSpecPath: "${input}" is outside both projectRoot (${opts.projectRoot}) and worktreeRoot (${worktreeRoot})`,
  );
}

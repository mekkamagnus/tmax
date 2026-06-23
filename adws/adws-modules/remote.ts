/**
 * remote.ts — SSH-based remote dispatch for adw pipeline offload.
 *
 * Pure functions over an injected `run` (TaskEither shape matching the
 * launcher's spawn helper). No CLI, no argv — mirrors worktree.ts and
 * builder.ts conventions.
 *
 * Exports:
 *   - listSshHosts(configPath?)                          — parse ~/.ssh/config
 *   - remoteNameForHost(host)                            — deterministic "adw-<host>"
 *   - ensureGitRemote(deps, host, remoteRepoPath, rootPath) — local git remote add/verify
 *   - pushToRemote(deps, remoteName, branch, rootPath)   — git push <remoteName> <branch>
 *   - dispatchToRemote(deps, host, id, repoPath)         — ssh host 'cd <repoPath> && bun adws/adw-launch.ts --resume <id>'
 *   - fetchFromRemote(deps, remoteName, branch, rootPath) — git fetch <remoteName> <branch>
 *   - queryRemoteStatus(deps, host, id, repoPath)        — ssh + cat adw-state.json + tail -n1 events.jsonl
 *   - listRemoteStatuses(deps, host, repoPath)           — ssh find + fetch each state file
 *
 * Used by adw-launch.ts (--remote flag) and adw-status.ts (--remote mode).
 *
 * The remote repo path defaults to ~/tmax (ADW_REMOTE_REPO_PATH env). The user
 * configures this once per host. Git sync uses a local remote named adw-<host>
 * with URL <host>:<ADW_REMOTE_REPO_PATH>, while agents/ state is copied and
 * queried explicitly over SSH because it is gitignored.
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";

/** Injectable subprocess runner — same shape as worktree.ts GitRun. */
export type RemoteRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> },
) => TaskEither<string, string>;

export interface RemoteDeps {
  run: RemoteRun;
}

/** One parsed SSH config entry: a Host alias + its HostName (if any). */
export interface SshHost {
  alias: string;
  hostname?: string;
}

/**
 * Parse ~/.ssh/config (or the given path) for Host aliases + HostName values.
 * Returns one entry per Host line, with `hostname` set only when a HostName
 * directive follows. Skips wildcard hosts (`Host *`). Pure — best-effort
 * parsing; malformed lines are ignored.
 *
 * Examples from the user's config:
 *   Host mekkapi
 *     HostName mekkapi.local
 *     User pi
 *
 * → { alias: "mekkapi", hostname: "mekkapi.local" }
 */
export function listSshHosts(configPath?: string): SshHost[] {
  const path = configPath ?? defaultSshConfigPath();
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const hosts: SshHost[] = [];
  let current: SshHost | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "host") {
      if (current) hosts.push(current);
      // Multiple hosts on one line (`Host a b c`) — take the first non-wildcard.
      const aliases = val.split(/\s+/).filter((a) => a.length > 0 && !a.includes("*"));
      current = aliases.length > 0 ? { alias: aliases[0]! } : null;
    } else if (current && key === "hostname") {
      current.hostname = val;
    }
  }
  if (current) hosts.push(current);
  return hosts;
}

/** Default ssh config path: ~/.ssh/config. */
export function defaultSshConfigPath(): string {
  return join(homedir(), ".ssh", "config");
}

/**
 * Deterministic local git remote name for a host: `adw-<host>`.
 * Never pass a plain SSH config alias to `git push` unless a git remote by
 * that exact name already exists (use ensureGitRemote to create one).
 */
export function remoteNameForHost(host: string): string {
  return `adw-${host}`;
}

/**
 * Default remote repo path: $ADW_REMOTE_REPO_PATH or ~/tmax.
 * Per-host overrides via $ADW_REMOTE_REPO_PATH_<HOST> (uppercase, non-alnum → _).
 */
export function defaultRemoteRepoPath(host: string): string {
  const perHostVar = `ADW_REMOTE_REPO_PATH_${host.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const perHost = process.env[perHostVar];
  if (perHost) return perHost;
  return process.env.ADW_REMOTE_REPO_PATH ?? `${homedir()}/tmax`;
}

/**
 * Ensure the local git remote `adw-<host>` exists with URL `<host>:<remoteRepoPath>`.
 *
 * - If absent, runs `git remote add adw-<host> <host>:<remoteRepoPath>`.
 * - If present with the matching URL, no-op.
 * - If present with a different URL, returns Left with instructions rather
 *   than silently changing it.
 */
export function ensureGitRemote(
  deps: RemoteDeps,
  host: string,
  remoteRepoPath: string,
  rootPath: string,
): TaskEither<string, { remote: string; url: string; created: boolean }> {
  const remote = remoteNameForHost(host);
  const url = `${host}:${remoteRepoPath}`;
  return deps.run("git", ["remote"], { cwd: rootPath }).flatMap((out) => {
    const remotes = out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    if (!remotes.includes(remote)) {
      return deps.run("git", ["remote", "add", remote, url], { cwd: rootPath })
        .mapLeft((e) => `ensureGitRemote: git remote add ${remote} ${url} failed: ${e}`)
        .map(() => ({ remote, url, created: true }));
    }
    // Remote exists — verify URL.
    return deps.run("git", ["remote", "get-url", remote], { cwd: rootPath }).flatMap((existing) => {
      if (existing.trim() !== url) {
        return TaskEither.left(
          `ensureGitRemote: git remote '${remote}' already exists with URL '${existing.trim()}' (expected '${url}'). Update with \`git remote set-url ${remote} ${url}\` if intentional.`,
        );
      }
      return TaskEither.right({ remote, url, created: false });
    });
  });
}

/**
 * `git push <remoteName> <branch>` run with cwd=rootPath.
 * The remote must already exist (call ensureGitRemote first).
 */
export function pushToRemote(
  deps: RemoteDeps,
  remoteName: string,
  branch: string,
  rootPath: string,
): TaskEither<string, string> {
  return deps.run("git", ["push", remoteName, branch], { cwd: rootPath })
    .mapLeft((e) => `pushToRemote(${remoteName} ${branch}): ${e}`)
    .map((out) => out);
}

/**
 * `git fetch <remoteName> <branch>` run with cwd=rootPath.
 * Used to pull the result back after a remote run.
 */
export function fetchFromRemote(
  deps: RemoteDeps,
  remoteName: string,
  branch: string,
  rootPath: string,
): TaskEither<string, string> {
  return deps.run("git", ["fetch", remoteName, branch], { cwd: rootPath })
    .mapLeft((e) => `fetchFromRemote(${remoteName} ${branch}): ${e}`)
    .map((out) => out);
}

/** Default remote repo path for dispatch: $ADW_REMOTE_REPO_PATH or ~/tmax. */
export function dispatchCommand(id: string, repoPath: string): string {
  return `cd ${repoPath} && bun adws/adw-launch.ts --resume ${id}`;
}

/**
 * SSH the resumed adw-launch.ts command to the remote host. Runs inside the
 * remote's own tmux (the remote's adw-launch.ts handles that).
 *
 *   ssh <host> 'cd <repoPath> && bun adws/adw-launch.ts --resume <id>'
 *
 * Returns the remote command's stdout. The remote tmux window id (if reported
 * on stderr) is best-effort and not parsed here — the caller prints whatever
 * the remote emits.
 */
export function dispatchToRemote(
  deps: RemoteDeps,
  host: string,
  id: string,
  repoPath: string,
): TaskEither<string, string> {
  const cmd = dispatchCommand(id, repoPath);
  return deps.run("ssh", [host, cmd], {})
    .mapLeft((e) => `dispatchToRemote(${host}): ${e}`)
    .map((out) => out);
}

/**
 * Query one remote workspace's state file + latest orchestrator event over SSH.
 * Returns the combined output: state JSON, then a separator, then the latest
 * event line. The caller parses the two sections.
 */
export function queryRemoteStatus(
  deps: RemoteDeps,
  host: string,
  id: string,
  repoPath: string,
): TaskEither<string, { state: string; latestEvent: string }> {
  const cmd =
    `cat ${repoPath}/agents/${id}/adw-state.json 2>/dev/null ` +
    `&& echo '---EVENT---' ` +
    `&& tail -n 1 ${repoPath}/agents/${id}/orchestrator/events.jsonl 2>/dev/null`;
  return deps.run("ssh", [host, cmd], {})
    .mapLeft((e) => `queryRemoteStatus(${host}, ${id}): ${e}`)
    .map((out) => splitStateAndEvent(out));
}

function splitStateAndEvent(out: string): { state: string; latestEvent: string } {
  const sep = out.indexOf("---EVENT---");
  if (sep < 0) return { state: out.trim(), latestEvent: "" };
  return {
    state: out.slice(0, sep).trim(),
    latestEvent: out.slice(sep + "---EVENT---".length).trim(),
  };
}

/**
 * List all remote workspace ids (by finding adw-state.json files) and fetch
 * each state + latest event. Required because agents/ is gitignored and branch
 * push/fetch cannot sync runtime state.
 *
 * Best-effort: if `find` returns nothing (e.g. no agents/ dir on the remote),
 * returns Right([]).
 */
export function listRemoteStatuses(
  deps: RemoteDeps,
  host: string,
  repoPath: string,
): TaskEither<string, { id: string; state: string; latestEvent: string }[]> {
  const cmd = `find ${repoPath}/agents -maxdepth 2 -name adw-state.json -print 2>/dev/null`;
  return deps.run("ssh", [host, cmd], {})
    .mapLeft((e) => `listRemoteStatuses(${host}): ${e}`)
    .flatMap((out) => {
      const ids = out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0)
        .map((p) => {
          // /<repoPath>/agents/<id>/adw-state.json → <id>
          const parts = p.split("/");
          return parts[parts.length - 2] ?? "";
        })
        .filter((id) => id.length > 0);
      if (ids.length === 0) return TaskEither.right<({ id: string; state: string; latestEvent: string })[], string>([]);
      // Fetch each one in parallel.
      const queries = ids.map((id) =>
        queryRemoteStatus(deps, host, id, repoPath).map((r) => ({ id, state: r.state, latestEvent: r.latestEvent }))
      );
      return TaskEither.parallel(queries).mapLeft((e) => `listRemoteStatuses(${host}): ${e}`);
    });
}

/**
 * Construct the local "fetch the result back" instruction string the launcher
 * prints after dispatch. Pure — used by --dry-run for the deterministic
 * ADW_REMOTE_DRY_RUN output.
 */
export function fetchBackInstruction(remoteName: string, branch: string, id: string): string {
  return `git fetch ${remoteName} ${branch} && git worktree add .worktrees/${id}-result FETCH_HEAD`;
}

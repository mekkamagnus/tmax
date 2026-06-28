/**
 * github.ts — GitHub API module via `gh` CLI for adw GitHub integration.
 *
 * Pure functions over an injected `run` (TaskEither shape matching the
 * launcher's spawn helper and worktree.ts's gitRun). Zero external
 * dependencies — `gh` is already installed on the system (AGENTS.md).
 *
 * Exports:
 *   - LABEL_TRIAGE / LABEL_READY_FOR_REVIEW / LABEL_APPROVED /
 *     LABEL_BUILDING / LABEL_DONE / LABEL_FAILED + ADW_LABELS
 *   - listLabels(deps, owner, repo)                       — gh label list --json
 *   - ensureLabels(deps, owner, repo)                     — create any missing ADW labels
 *   - listIssuesByLabel(deps, owner, repo, label, state?) — gh issue list --label
 *   - listOpenIssues(deps, owner, repo)                   — gh issue list --state open (caller filters labels)
 *   - getIssue(deps, owner, repo, number)                 — gh issue view --json
 *   - addLabel(deps, owner, repo, number, label)          — gh issue edit --add-label
 *   - removeLabel(deps, owner, repo, number, label)       — gh issue edit --remove-label
 *   - commentOnIssue(deps, owner, repo, number, body)     — gh issue comment
 *   - createPR(deps, owner, repo, head, base, title, body) — gh pr create + gh pr view --json
 *   - closeIssue(deps, owner, repo, number)               — gh issue close
 *   - createIssue(deps, owner, repo, title, body, labels?) — gh issue create + gh issue view --json
 *
 * Used by adw-triggers/trigger-cron.ts (GitHub→pipeline daemon) and
 * adws/adw-create-tracking-issue.ts (skills→GitHub tracking issue).
 *
 * Creation helpers (createIssue / createPR) parse the URL printed by
 * `gh issue create` / `gh pr create`, then call `gh issue view` / `gh pr view`
 * with `--json` to return normalized objects — `gh create` does not share the
 * `--json` contract of `view`/`list`.
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";

/** Injectable subprocess runner — same shape as remote.ts RemoteRun. */
export type GithubRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> },
) => TaskEither<string, string>;

export interface GithubDeps {
  run: GithubRun;
}

// ---------------------------------------------------------------------------
// ADW label constants — the state machine vocabulary
// ---------------------------------------------------------------------------

export const LABEL_TRIAGE = "adw:triage";
export const LABEL_READY_FOR_REVIEW = "adw:ready-for-review";
export const LABEL_APPROVED = "adw:approved";
export const LABEL_BUILDING = "adw:building";
export const LABEL_DONE = "adw:done";
export const LABEL_FAILED = "adw:failed";

export const ADW_LABELS: readonly string[] = [
  LABEL_TRIAGE,
  LABEL_READY_FOR_REVIEW,
  LABEL_APPROVED,
  LABEL_BUILDING,
  LABEL_DONE,
  LABEL_FAILED,
] as const;

/** Deterministic color + description per ADW label (gh label create --color/--description). */
const LABEL_PROVISIONING: Record<string, { color: string; description: string }> = {
  [LABEL_TRIAGE]: { color: "BFD4F2", description: "ADW: triage in progress (classifying + drafting spec)" },
  [LABEL_READY_FOR_REVIEW]: { color: "FBCA04", description: "ADW: spec drafted, awaiting human approval" },
  [LABEL_APPROVED]: { color: "0E8A16", description: "ADW: human approved — pipeline will launch on next scan" },
  [LABEL_BUILDING]: { color: "5319E7", description: "ADW: pipeline build in progress" },
  [LABEL_DONE]: { color: "0E8A16", description: "ADW: build complete — PR linked or no implementation changes" },
  [LABEL_FAILED]: { color: "B60205", description: "ADW: build failed or state-corruption — human recovery needed" },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  url: string;
}

export interface GithubPR {
  number: number;
  url: string;
  state: "open" | "closed";
}

export interface GithubLabel {
  name: string;
  color?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

function parseJson<T>(raw: string): Either<string, T> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return Either.left("gh returned empty output");
  const parsed = Either.tryCatch(() => JSON.parse(trimmed) as T);
  return Either.mapLeft(parsed, (e) =>
    `gh returned non-JSON: ${(e as Error).message} (raw: ${trimmed.slice(0, 300)})`,
  );
}

/** Normalize a raw gh issue JSON record into a GithubIssue. */
function normalizeIssue(raw: {
  number: number;
  title: string;
  body?: string | null;
  state?: string;
  labels?: Array<string | { name: string }>;
  url: string;
}): GithubIssue {
  const labels: string[] = (raw.labels ?? []).map((l) =>
    typeof l === "string" ? l : l.name,
  );
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    labels,
    url: raw.url,
  };
}

// ---------------------------------------------------------------------------
// Issue list + view
// ---------------------------------------------------------------------------

/**
 * `gh issue list --repo <owner>/<repo> --label <label> [--state <state>] --json ...`.
 * Returns GithubIssue[] parsed from gh's --json output. Empty list on no matches.
 *
 * `--state` defaults to "open" when omitted to match the trigger's most common
 * query (open issues awaiting action). Pass "all" or "closed" for other queries.
 */
export function listIssuesByLabel(
  deps: GithubDeps,
  owner: string,
  repo: string,
  label: string,
  state?: "open" | "closed" | "all",
): TaskEither<string, GithubIssue[]> {
  const args = [
    "issue", "list",
    "--repo", `${owner}/${repo}`,
    "--label", label,
    "--json", "number,title,body,labels,state,url",
    "--state", state ?? "open",
  ];
  return deps.run("gh", args, {}).flatMap((raw) => {
    const parsed = parseJson<Array<Parameters<typeof normalizeIssue>[0]>>(raw);
    if (Either.isLeft(parsed)) return TaskEither.left(parsed.left);
    return TaskEither.right(parsed.right.map(normalizeIssue));
  });
}

/**
 * `gh issue list --repo <owner>/<repo> --state open --json ... --limit 100`.
 * Returns ALL open issues — the caller filters locally for issues with none of
 * the ADW_LABELS, since `gh issue list` does not support negative-label filters.
 */
export function listOpenIssues(
  deps: GithubDeps,
  owner: string,
  repo: string,
  limit = 100,
): TaskEither<string, GithubIssue[]> {
  const args = [
    "issue", "list",
    "--repo", `${owner}/${repo}`,
    "--state", "open",
    "--json", "number,title,body,labels,state,url",
    "--limit", String(limit),
  ];
  return deps.run("gh", args, {}).flatMap((raw) => {
    const parsed = parseJson<Array<Parameters<typeof normalizeIssue>[0]>>(raw);
    if (Either.isLeft(parsed)) return TaskEither.left(parsed.left);
    return TaskEither.right(parsed.right.map(normalizeIssue));
  });
}

/**
 * `gh issue view <number> --repo <owner>/<repo> --json ...`. Returns the issue
 * or Left (e.g. 404, no permission).
 */
export function getIssue(
  deps: GithubDeps,
  owner: string,
  repo: string,
  number: number,
): TaskEither<string, GithubIssue> {
  const args = [
    "issue", "view", String(number),
    "--repo", `${owner}/${repo}`,
    "--json", "number,title,body,labels,state,url",
  ];
  return deps.run("gh", args, {}).flatMap((raw) => {
    const parsed = parseJson<Parameters<typeof normalizeIssue>[0]>(raw);
    if (Either.isLeft(parsed)) return TaskEither.left(parsed.left);
    return TaskEither.right(normalizeIssue(parsed.right));
  });
}

// ---------------------------------------------------------------------------
// Label mutations
// ---------------------------------------------------------------------------

/** `gh issue edit <number> --repo <owner>/<repo> --add-label <label>`. */
export function addLabel(
  deps: GithubDeps,
  owner: string,
  repo: string,
  number: number,
  label: string,
): TaskEither<string, void> {
  return deps.run("gh", [
    "issue", "edit", String(number),
    "--repo", `${owner}/${repo}`,
    "--add-label", label,
  ], {})
    .mapLeft((e) => `addLabel(${number}, ${label}): ${e}`)
    .map(() => undefined);
}

/** `gh issue edit <number> --repo <owner>/<repo> --remove-label <label>`. */
export function removeLabel(
  deps: GithubDeps,
  owner: string,
  repo: string,
  number: number,
  label: string,
): TaskEither<string, void> {
  return deps.run("gh", [
    "issue", "edit", String(number),
    "--repo", `${owner}/${repo}`,
    "--remove-label", label,
  ], {})
    .mapLeft((e) => `removeLabel(${number}, ${label}): ${e}`)
    .map(() => undefined);
}

// ---------------------------------------------------------------------------
// Comment / close
// ---------------------------------------------------------------------------

/** `gh issue comment <number> --repo <owner>/<repo> --body <body>`. */
export function commentOnIssue(
  deps: GithubDeps,
  owner: string,
  repo: string,
  number: number,
  body: string,
): TaskEither<string, void> {
  return deps.run("gh", [
    "issue", "comment", String(number),
    "--repo", `${owner}/${repo}`,
    "--body", body,
  ], {})
    .mapLeft((e) => `commentOnIssue(${number}): ${e}`)
    .map(() => undefined);
}

/** `gh issue close <number> --repo <owner>/<repo>`. */
export function closeIssue(
  deps: GithubDeps,
  owner: string,
  repo: string,
  number: number,
): TaskEither<string, void> {
  return deps.run("gh", [
    "issue", "close", String(number),
    "--repo", `${owner}/${repo}`,
  ], {})
    .mapLeft((e) => `closeIssue(${number}): ${e}`)
    .map(() => undefined);
}

// ---------------------------------------------------------------------------
// Issue + PR creation
//
// `gh issue create` and `gh pr create` print the new resource's URL to stdout
// (they do NOT support --json). We parse the URL, then call `gh issue view` /
// `gh pr view --json` for the normalized object.
// ---------------------------------------------------------------------------

/** Match the GitHub URL form printed by `gh issue create` / `gh pr create`. */
const GH_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+)/im;

/**
 * Extract the issue/PR number from a `gh create` stdout URL.
 *
 * `gh issue create` stdout example:
 *   https://github.com/mekael/tmax/issues/42
 *
 * Returns null when no URL form is found (caller surfaces a Left).
 */
export function parseNumberFromCreateUrl(raw: string, kind: "issues" | "pull"): number | null {
  // First line that matches — gh may emit additional advisory text.
  for (const line of raw.split("\n")) {
    const m = GH_URL_RE.exec(line);
    if (m && m[1] === kind) {
      const n = parseInt(m[2] ?? "", 10);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Create a GitHub issue with optional labels. Resolves to the normalized issue
 * via a follow-up `gh issue view --json ...` call.
 */
export function createIssue(
  deps: GithubDeps,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): TaskEither<string, GithubIssue> {
  const args = [
    "issue", "create",
    "--repo", `${owner}/${repo}`,
    "--title", title,
    "--body", body,
  ];
  for (const label of labels ?? []) {
    args.push("--label", label);
  }
  return deps.run("gh", args, {})
    .mapLeft((e) => `createIssue(${owner}/${repo}, "${title}"): ${e}`)
    .flatMap((rawUrl) => {
      const number = parseNumberFromCreateUrl(rawUrl, "issues");
      if (number === null) {
        return TaskEither.left(
          `createIssue: gh issue create did not print an issues URL (stdout: ${rawUrl.slice(0, 300)})`,
        );
      }
      return getIssue(deps, owner, repo, number);
    });
}

/**
 * Create a PR. Resolves to the normalized PR via a follow-up
 * `gh pr view --json ...` call.
 */
export function createPR(
  deps: GithubDeps,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
): TaskEither<string, GithubPR> {
  const createArgs = [
    "pr", "create",
    "--repo", `${owner}/${repo}`,
    "--head", head,
    "--base", base,
    "--title", title,
    "--body", body,
  ];
  return deps.run("gh", createArgs, {})
    .mapLeft((e) => `createPR(${head} → ${base}): ${e}`)
    .flatMap((rawUrl) => {
      const number = parseNumberFromCreateUrl(rawUrl, "pull");
      if (number === null) {
        return TaskEither.left(
          `createPR: gh pr create did not print a pull URL (stdout: ${rawUrl.slice(0, 300)})`,
        );
      }
      const viewArgs = [
        "pr", "view", String(number),
        "--repo", `${owner}/${repo}`,
        "--json", "number,url,state",
      ];
      return deps.run("gh", viewArgs, {})
        .mapLeft((e) => `createPR: gh pr view ${number} failed: ${e}`)
        .flatMap((viewRaw) => {
          const parsed = parseJson<{ number: number; url: string; state: string }>(viewRaw);
          if (Either.isLeft(parsed)) return TaskEither.left(parsed.left);
          return TaskEither.right({
            number: parsed.right.number,
            url: parsed.right.url,
            state: parsed.right.state === "closed" ? "closed" : "open",
          });
        });
    });
}

// ---------------------------------------------------------------------------
// Label provisioning (startup)
// ---------------------------------------------------------------------------

/**
 * `gh label list --repo <owner>/<repo> --json name,color,description --limit 200`.
 * Returns the set of existing labels.
 */
export function listLabels(
  deps: GithubDeps,
  owner: string,
  repo: string,
): TaskEither<string, GithubLabel[]> {
  return deps.run("gh", [
    "label", "list",
    "--repo", `${owner}/${repo}`,
    "--json", "name,color,description",
    "--limit", "200",
  ], {})
    .flatMap((raw) => {
      const parsed = parseJson<Array<{ name: string; color?: string; description?: string }>>(raw);
      if (Either.isLeft(parsed)) return TaskEither.left(parsed.left);
      return TaskEither.right(parsed.right.map((l) => ({
        name: l.name,
        color: l.color,
        description: l.description,
      })));
    });
}

/**
 * Ensure every ADW label exists in the repo. Lists labels once; for each
 * missing ADW label, runs `gh label create` with the deterministic color +
 * description. Treats "already exists" as success. Returns Right(void) when
 * all labels are present (created or pre-existing), Left with the failed-label
 * name when any creation fails.
 *
 * The trigger calls this once at startup before applying labels to issues;
 * the tracking-issue wrapper calls it before creating the labeled issue.
 */
export function ensureLabels(
  deps: GithubDeps,
  owner: string,
  repo: string,
): TaskEither<string, void> {
  return listLabels(deps, owner, repo).flatMap((existing) => {
    const present = new Set(existing.map((l) => l.name));
    const missing = ADW_LABELS.filter((l) => !present.has(l));
    if (missing.length === 0) return TaskEither.right(undefined);
    // Sequentially create missing labels — short-circuit on the first failure.
    // `gh label create` returns non-zero (with a clear stderr) when the label
    // already exists. Treat that as success — the existence is what we want.
    // Race between listLabels and create is rare but tolerated.
    const createOne = (label: string): TaskEither<string, void> => {
      const prov = LABEL_PROVISIONING[label];
      if (!prov) return TaskEither.left(`ensureLabels: no provisioning entry for ${label}`);
      return TaskEither.from(async () => {
        const r = await deps.run("gh", [
          "label", "create", label,
          "--repo", `${owner}/${repo}`,
          "--color", prov.color,
          "--description", prov.description,
        ], {}).run();
        if (Either.isLeft(r)) {
          // Match both "already exists" (gh CLI text) and "already_exists"
          // (raw GitHub API field name when surfaced in a 422 error envelope).
          if (/already[ _]exist/i.test(r.left)) return Either.right<undefined, string>(undefined);
          return Either.left<string, undefined>(`ensureLabels: failed to create "${label}": ${r.left}`);
        }
        return Either.right<undefined, string>(undefined);
      });
    };
    let acc: TaskEither<string, void> = TaskEither.right(undefined);
    for (const label of missing) {
      acc = acc.flatMap(() => createOne(label));
    }
    return acc;
  });
}

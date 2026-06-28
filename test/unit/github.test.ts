/**
 * @file github.test.ts
 * @description Unit tests for adws/adws-modules/github.ts against a fake `run`
 * (no real `gh` calls). Covers issue/PR parsing, label mutations, comment
 * formatting, creation helpers (createIssue/createPR URL parsing + view
 * follow-up), and ensureLabels provisioning.
 */
import { describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  ADW_LABELS,
  LABEL_APPROVED,
  LABEL_BUILDING,
  LABEL_DONE,
  LABEL_FAILED,
  LABEL_READY_FOR_REVIEW,
  LABEL_TRIAGE,
  type GithubDeps,
  type GithubIssue,
  type GithubLabel,
  type GithubRun,
  addLabel,
  closeIssue,
  commentOnIssue,
  createIssue,
  createPR,
  ensureLabels,
  getIssue,
  listIssuesByLabel,
  listLabels,
  listOpenIssues,
  parseNumberFromCreateUrl,
  removeLabel,
} from "../../adws/adws-modules/github.ts";

// ---------------------------------------------------------------------------
// Fake runner helper
// ---------------------------------------------------------------------------

interface RecordedCall { cmd: string; args: string[]; opts: { cwd?: string; env?: Record<string, string> } }

/**
 * Build a fake `run` that dispatches based on a function of the argv. The
 * factory returns the runner plus the recorded call list for assertion.
 *
 * The handler returns either a string (success) or an Error-shaped Left
 * payload (string error message).
 */
function makeFakeRun(handler: (cmd: string, args: string[]) => string | { error: string }): {
  deps: GithubDeps;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const run: GithubRun = (cmd, args, opts) =>
    TaskEither.from(async () => {
      calls.push({ cmd, args, opts });
      try {
        const r = handler(cmd, args);
        if (typeof r === "string") return Either.right(r);
        return Either.left(r.error);
      } catch (e) {
        return Either.left((e as Error).message);
      }
    });
  return { deps: { run }, calls };
}

const sampleIssue = (over: Partial<GithubIssue> = {}): GithubIssue => ({
  number: 42,
  title: "Add better search",
  body: "Search needs to be better",
  state: "open",
  labels: [],
  url: "https://github.com/mekael/tmax/issues/42",
  ...over,
});

// ---------------------------------------------------------------------------
// parseNumberFromCreateUrl
// ---------------------------------------------------------------------------

describe("parseNumberFromCreateUrl", () => {
  test("parses issues URL", () => {
    expect(parseNumberFromCreateUrl("https://github.com/mekael/tmax/issues/42\n", "issues")).toBe(42);
  });
  test("parses pull URL", () => {
    expect(parseNumberFromCreateUrl("https://github.com/mekael/tmax/pull/7\n", "pull")).toBe(7);
  });
  test("returns null on mismatched kind", () => {
    expect(parseNumberFromCreateUrl("https://github.com/mekael/tmax/issues/42\n", "pull")).toBe(null);
  });
  test("returns null when no URL line is present", () => {
    expect(parseNumberFromCreateUrl("some advisory text\nnothing here", "issues")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// listIssuesByLabel
// ---------------------------------------------------------------------------

describe("listIssuesByLabel", () => {
  test("parses --json output, returns normalized issues", async () => {
    const { deps, calls } = makeFakeRun(() => JSON.stringify([
      {
        number: 42,
        title: "Add search",
        body: "body text",
        state: "open",
        labels: [{ name: LABEL_APPROVED }, { name: LABEL_READY_FOR_REVIEW }],
        url: "https://github.com/mekael/tmax/issues/42",
      },
    ]));
    const r = await listIssuesByLabel(deps, "mekael", "tmax", LABEL_APPROVED).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toHaveLength(1);
      expect(r.right[0]!.number).toBe(42);
      expect(r.right[0]!.labels).toEqual([LABEL_APPROVED, LABEL_READY_FOR_REVIEW]);
    }
    // Verify argv shape.
    expect(calls[0]!.cmd).toBe("gh");
    expect(calls[0]!.args).toContain("--label");
    expect(calls[0]!.args).toContain(LABEL_APPROVED);
    expect(calls[0]!.args).toContain("--repo");
    expect(calls[0]!.args).toContain("mekael/tmax");
    expect(calls[0]!.args).toContain("--state");
    expect(calls[0]!.args).toContain("open"); // default
  });

  test("handles empty result list", async () => {
    const { deps } = makeFakeRun(() => "[]");
    const r = await listIssuesByLabel(deps, "mekael", "tmax", LABEL_BUILDING).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toEqual([]);
  });

  test("accepts string-label form in JSON", async () => {
    const { deps } = makeFakeRun(() => JSON.stringify([
      { number: 1, title: "t", body: "b", state: "open", labels: ["foo", "bar"], url: "https://github.com/o/r/issues/1" },
    ]));
    const r = await listIssuesByLabel(deps, "o", "r", "foo").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right[0]!.labels).toEqual(["foo", "bar"]);
  });

  test("errors on non-zero exit", async () => {
    const { deps } = makeFakeRun(() => ({ error: "gh auth required" }));
    const r = await listIssuesByLabel(deps, "mekael", "tmax", LABEL_APPROVED).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test("errors on non-JSON output", async () => {
    const { deps } = makeFakeRun(() => "not json");
    const r = await listIssuesByLabel(deps, "mekael", "tmax", LABEL_APPROVED).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test("passes through state override", async () => {
    const { deps, calls } = makeFakeRun(() => "[]");
    await listIssuesByLabel(deps, "o", "r", "x", "all").run();
    const stateIdx = calls[0]!.args.indexOf("--state");
    expect(calls[0]!.args[stateIdx + 1]).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// listOpenIssues
// ---------------------------------------------------------------------------

describe("listOpenIssues", () => {
  test("parses open issues with default limit", async () => {
    const { deps, calls } = makeFakeRun(() => JSON.stringify([
      { number: 1, title: "a", body: "", state: "open", labels: [], url: "https://github.com/o/r/issues/1" },
      { number: 2, title: "b", body: "", state: "open", labels: [LABEL_BUILDING], url: "https://github.com/o/r/issues/2" },
    ]));
    const r = await listOpenIssues(deps, "o", "r").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toHaveLength(2);
    // Caller filters — listOpenIssues does not exclude ADW labels itself.
    expect(calls[0]!.args).toContain("--state");
    expect(calls[0]!.args[calls[0]!.args.indexOf("--state") + 1]).toBe("open");
    expect(calls[0]!.args).toContain("--limit");
    expect(calls[0]!.args[calls[0]!.args.indexOf("--limit") + 1]).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// getIssue
// ---------------------------------------------------------------------------

describe("getIssue", () => {
  test("parses issue fields", async () => {
    const { deps } = makeFakeRun(() => JSON.stringify({
      number: 7,
      title: "Bug",
      body: "crash on save",
      state: "open",
      labels: [{ name: LABEL_TRIAGE }],
      url: "https://github.com/o/r/issues/7",
    }));
    const r = await getIssue(deps, "o", "r", 7).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.number).toBe(7);
      expect(r.right.body).toBe("crash on save");
      expect(r.right.labels).toEqual([LABEL_TRIAGE]);
    }
  });

  test("errors on 404 (non-zero exit)", async () => {
    const { deps } = makeFakeRun(() => ({ error: "issue not found" }));
    const r = await getIssue(deps, "o", "r", 9999).run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addLabel / removeLabel
// ---------------------------------------------------------------------------

describe("addLabel", () => {
  test("verifies correct gh issue edit --add-label argv", async () => {
    const { deps, calls } = makeFakeRun(() => "");
    await addLabel(deps, "o", "r", 42, LABEL_TRIAGE).run();
    expect(calls[0]!.args).toEqual([
      "issue", "edit", "42",
      "--repo", "o/r",
      "--add-label", LABEL_TRIAGE,
    ]);
  });

  test("propagates gh error", async () => {
    const { deps } = makeFakeRun(() => ({ error: "label does not exist" }));
    const r = await addLabel(deps, "o", "r", 42, "missing").run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe("removeLabel", () => {
  test("verifies correct gh issue edit --remove-label argv", async () => {
    const { deps, calls } = makeFakeRun(() => "");
    await removeLabel(deps, "o", "r", 42, LABEL_TRIAGE).run();
    expect(calls[0]!.args).toEqual([
      "issue", "edit", "42",
      "--repo", "o/r",
      "--remove-label", LABEL_TRIAGE,
    ]);
  });
});

// ---------------------------------------------------------------------------
// commentOnIssue
// ---------------------------------------------------------------------------

describe("commentOnIssue", () => {
  test("verifies correct gh issue comment argv, handles special chars", async () => {
    const { deps, calls } = makeFakeRun(() => "https://github.com/o/r/issues/42#issuecomment-1");
    const body = "🤖 **[ADW]** Build failed — 'oops'\n\n```\ntrace\n```";
    await commentOnIssue(deps, "o", "r", 42, body).run();
    expect(calls[0]!.args).toEqual([
      "issue", "comment", "42",
      "--repo", "o/r",
      "--body", body,
    ]);
  });
});

// ---------------------------------------------------------------------------
// closeIssue
// ---------------------------------------------------------------------------

describe("closeIssue", () => {
  test("verifies correct gh issue close argv", async () => {
    const { deps, calls } = makeFakeRun(() => "");
    await closeIssue(deps, "o", "r", 42).run();
    expect(calls[0]!.args).toEqual([
      "issue", "close", "42",
      "--repo", "o/r",
    ]);
  });
});

// ---------------------------------------------------------------------------
// createIssue
// ---------------------------------------------------------------------------

describe("createIssue", () => {
  test("parses URL from gh issue create, follows with gh issue view --json", async () => {
    let callCount = 0;
    const { deps, calls } = makeFakeRun((_cmd, args) => {
      callCount++;
      if (args[1] === "create") {
        // First call: gh issue create prints the new issue URL.
        return "https://github.com/mekael/tmax/issues/77\n";
      }
      // Second call: gh issue view --json returns normalized object.
      return JSON.stringify({
        number: 77,
        title: "adw: smoke",
        body: "pipeline=plan",
        state: "open",
        labels: [{ name: LABEL_BUILDING }],
        url: "https://github.com/mekael/tmax/issues/77",
      });
    });
    const r = await createIssue(deps, "mekael", "tmax", "adw: smoke", "pipeline=plan", [LABEL_BUILDING]).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.number).toBe(77);
      expect(r.right.labels).toEqual([LABEL_BUILDING]);
    }
    expect(callCount).toBe(2);
    // Verify create argv.
    const createArgs = calls[0]!.args;
    expect(createArgs).toContain("--title");
    expect(createArgs).toContain("adw: smoke");
    expect(createArgs).toContain("--body");
    expect(createArgs).toContain("pipeline=plan");
    // Labels forwarded.
    const labelIdx = createArgs.indexOf("--label");
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(createArgs[labelIdx + 1]).toBe(LABEL_BUILDING);
    // Verify view argv.
    const viewArgs = calls[1]!.args;
    expect(viewArgs[1]).toBe("view");
    expect(viewArgs).toContain("77");
    expect(viewArgs).toContain("--json");
  });

  test("omits --label when no labels passed", async () => {
    const { deps, calls } = makeFakeRun((_cmd, args) => {
      if (args[1] === "create") return "https://github.com/o/r/issues/5\n";
      return JSON.stringify({ number: 5, title: "t", body: "b", state: "open", labels: [], url: "https://github.com/o/r/issues/5" });
    });
    await createIssue(deps, "o", "r", "t", "b").run();
    expect(calls[0]!.args).not.toContain("--label");
  });

  test("errors when gh issue create prints no URL", async () => {
    const { deps } = makeFakeRun(() => "some advisory text without a URL");
    const r = await createIssue(deps, "o", "r", "t", "b").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toMatch(/did not print an issues URL/);
  });
});

// ---------------------------------------------------------------------------
// createPR
// ---------------------------------------------------------------------------

describe("createPR", () => {
  test("parses PR URL, verifies correct gh pr create + view argv", async () => {
    const { deps, calls } = makeFakeRun((_cmd, args) => {
      if (args[1] === "create") return "https://github.com/mekael/tmax/pull/9\n";
      return JSON.stringify({ number: 9, url: "https://github.com/mekael/tmax/pull/9", state: "open" });
    });
    const r = await createPR(deps, "mekael", "tmax", "adw/01KVE7TEST", "main", "Implement X", "Closes #42").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.number).toBe(9);
      expect(r.right.state).toBe("open");
    }
    const createArgs = calls[0]!.args;
    expect(createArgs).toEqual([
      "pr", "create",
      "--repo", "mekael/tmax",
      "--head", "adw/01KVE7TEST",
      "--base", "main",
      "--title", "Implement X",
      "--body", "Closes #42",
    ]);
    const viewArgs = calls[1]!.args;
    expect(viewArgs[1]).toBe("view");
    expect(viewArgs).toContain("9");
  });

  test("errors when gh pr create prints no pull URL", async () => {
    const { deps } = makeFakeRun(() => "");
    const r = await createPR(deps, "o", "r", "h", "b", "t", "body").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toMatch(/did not print a pull URL/);
  });
});

// ---------------------------------------------------------------------------
// listLabels / ensureLabels
// ---------------------------------------------------------------------------

describe("listLabels", () => {
  test("parses gh label list --json output", async () => {
    const { deps } = makeFakeRun(() => JSON.stringify([
      { name: "bug", color: "d73a4a", description: "something is wrong" },
      { name: LABEL_TRIAGE },
    ]));
    const r = await listLabels(deps, "o", "r").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toHaveLength(2);
      expect(r.right[0]!.name).toBe("bug");
      expect(r.right[0]!.color).toBe("d73a4a");
    }
  });
});

describe("ensureLabels", () => {
  test("creates missing ADW labels, skips existing", async () => {
    const created: string[] = [];
    const { deps, calls } = makeFakeRun((_cmd, args) => {
      if (args[1] === "list") {
        // Two ADW labels already present — the other four are missing.
        return JSON.stringify([{ name: LABEL_TRIAGE }, { name: LABEL_DONE }]);
      }
      if (args[1] === "create") {
        created.push(args[2]!);
        return "";
      }
      return "";
    });
    const r = await ensureLabels(deps, "o", "r").run();
    expect(Either.isRight(r)).toBe(true);
    // Created exactly the four missing labels.
    expect(created.sort()).toEqual([LABEL_APPROVED, LABEL_BUILDING, LABEL_FAILED, LABEL_READY_FOR_REVIEW].sort());
    // Verify create argv shape (one example).
    const createCall = calls.find((c) => c.args[1] === "create")!;
    expect(createCall.args).toContain("--color");
    expect(createCall.args).toContain("--description");
  });

  test("no-op when all labels present", async () => {
    let createCalled = false;
    const { deps } = makeFakeRun((_cmd, args) => {
      if (args[1] === "list") {
        return JSON.stringify(ADW_LABELS.map((n) => ({ name: n })));
      }
      if (args[1] === "create") createCalled = true;
      return "";
    });
    const r = await ensureLabels(deps, "o", "r").run();
    expect(Either.isRight(r)).toBe(true);
    expect(createCalled).toBe(false);
  });

  test("treats 'already exists' as success", async () => {
    const { deps } = makeFakeRun((_cmd, args) => {
      if (args[1] === "list") return JSON.stringify([{ name: LABEL_TRIAGE }, { name: LABEL_DONE }]);
      if (args[1] === "create") {
        // Race: list missed one but it actually exists.
        return { error: `HTTP 422: Validation Failed (https://developer.github.com/v3/issues/labels/#create-a-label): "already_exists"` };
      }
      return "";
    });
    const r = await ensureLabels(deps, "o", "r").run();
    expect(Either.isRight(r)).toBe(true);
  });

  test("reports clear error when label creation fails", async () => {
    const { deps } = makeFakeRun((_cmd, args) => {
      if (args[1] === "list") return JSON.stringify([{ name: LABEL_TRIAGE }, { name: LABEL_DONE }]);
      if (args[1] === "create") return { error: "forbidden: insufficient permission" };
      return "";
    });
    const r = await ensureLabels(deps, "o", "r").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toMatch(/failed to create/);
      expect(r.left).toMatch(/forbidden/);
    }
  });
});

// ---------------------------------------------------------------------------
// Sanity: ADW_LABELS contains all the named constants
// ---------------------------------------------------------------------------

describe("ADW_LABELS", () => {
  test("contains all six label constants", () => {
    expect(ADW_LABELS).toEqual([
      LABEL_TRIAGE, LABEL_READY_FOR_REVIEW, LABEL_APPROVED,
      LABEL_BUILDING, LABEL_DONE, LABEL_FAILED,
    ]);
    expect(ADW_LABELS).toHaveLength(6);
  });
});

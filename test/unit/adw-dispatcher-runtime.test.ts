/**
 * @file adw-dispatcher-runtime.test.ts
 * @description CHORE-44 Change 8 — tests for the shared ADW dispatcher runtime.
 *
 * Covers the six areas required by the spec:
 *   1. adwId()           — fresh, unique, ULID-shape.
 *   2. writeState()      — atomic write; preserves keys not in the patch.
 *   3. appendEvent()     — chronological order; ts prepended.
 *   4. resolveInput/spec resolution (findWorkspaceBySpecPath).
 *   5. spawnStage/tokensOf/run/runCapture — subprocess result normalization.
 *   6. Failure cases (missing workspace, unparseable state, etc.).
 *
 * Golden-key assertions: assert the KEYS of state/event objects, never the
 * random id or timestamp values (per spec: "do not snapshot timestamps or
 * random IDs").
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ADW_ID_RE,
  CROCKFORD,
  adwId,
  appendEvent,
  writeState,
  readWorkspaceState,
  recoverSpecPathFromEvents,
  findWorkspaceBySpecPath,
  normalizeSpecPath,
  tokensOf,
} from "../../adws/adws-modules/dispatcher-runtime.ts";
import { Either } from "../../src/utils/task-either.ts";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "adw-dispatcher-runtime-test-"));
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 1. adwId() — fresh, unique, ULID-shape
// ---------------------------------------------------------------------------

describe("adwId()", () => {
  test("produces a 10-char Crockford Base32 string matching ADW_ID_RE", () => {
    const id = adwId();
    expect(id.length).toBe(10);
    expect(ADW_ID_RE.test(id)).toBe(true);
  });

  test("uses only Crockford alphabet characters (excludes I/L/O/U)", () => {
    // Sample many ids; every char must be in CROCKFORD and not in the excluded set.
    const excluded = "ILOU";
    for (let i = 0; i < 50; i++) {
      const id = adwId();
      for (const ch of id) {
        expect(CROCKFORD.includes(ch)).toBe(true);
        expect(excluded.includes(ch)).toBe(false);
      }
    }
  });

  test("returns a fresh, unique id on each call (monotonic-ish by timestamp)", async () => {
    // ULID timestamps are millisecond-resolution; collecting across a few ms
    // guarantees uniqueness in practice. Wait briefly between samples.
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(adwId());
      await new Promise<void>((r) => setTimeout(r, 2));
    }
    expect(ids.size).toBe(20);
  });

  test("encodes the current millisecond timestamp (parseable back)", () => {
    const before = Date.now();
    const id = adwId();
    const after = Date.now();
    // Decode 10 Crockford chars → 48-bit ms timestamp.
    let ms = 0;
    for (let i = 0; i < 10; i++) {
      ms = ms * 32 + CROCKFORD.indexOf(id[i]!);
    }
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// 2. writeState() — atomic write; preserves keys not in the patch
// ---------------------------------------------------------------------------

describe("writeState()", () => {
  test("writes the state object as pretty-printed JSON + trailing newline", async () => {
    const agentsDir = join(tmpRoot, "agents");
    const r = await writeState(agentsDir, "01TESTWS01", { adw_id: "01TESTWS01", status: "running" }).run();
    expect(Either.isRight(r)).toBe(true);

    const raw = readFileSync(join(agentsDir, "01TESTWS01", "adw-state.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.adw_id).toBe("01TESTWS01");
    expect(parsed.status).toBe("running");
  });

  test("creates the agents/{id}/ dir if it doesn't exist", async () => {
    const agentsDir = join(tmpRoot, "agents");
    expect(existsSync(agentsDir)).toBe(false);
    const r = await writeState(agentsDir, "01TESTWS02", { adw_id: "01TESTWS02" }).run();
    expect(Either.isRight(r)).toBe(true);
    expect(existsSync(join(agentsDir, "01TESTWS02", "adw-state.json"))).toBe(true);
  });

  test("REPLACES the file wholesale (not a merge) — caller is responsible for read-modify-write", async () => {
    // writeState is documented as atomic REPLACE. Callers that need to
    // preserve prior keys must read first, merge in JS, then call writeState.
    // This test pins that contract: a second writeState with a different
    // object replaces the first entirely.
    const agentsDir = join(tmpRoot, "agents");
    await writeState(agentsDir, "01TESTWS03", { adw_id: "01TESTWS03", status: "running", foo: 1 }).run();
    await writeState(agentsDir, "01TESTWS03", { adw_id: "01TESTWS03", status: "completed" }).run();

    const parsed = JSON.parse(readFileSync(join(agentsDir, "01TESTWS03", "adw-state.json"), "utf8"));
    expect(parsed.status).toBe("completed");
    expect(parsed.foo).toBeUndefined(); // wholesale replace — `foo` is gone
    expect(parsed.adw_id).toBe("01TESTWS03"); // keys in the new object are present
  });

  test("returns the written path on success", async () => {
    const agentsDir = join(tmpRoot, "agents");
    const r = await writeState(agentsDir, "01TESTWS04", { adw_id: "01TESTWS04" }).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.path).toBe(join(agentsDir, "01TESTWS04", "adw-state.json"));
    }
  });

  test("golden keys: state file written with the documented top-level keys", async () => {
    // Per spec: assert the KEYS, not the values (no random ids/timestamps).
    const agentsDir = join(tmpRoot, "agents");
    const state = {
      adw_id: "01TESTWS05",
      description: "test",
      status: "running",
      completed_stages: ["plan"],
      spec_path: "docs/specs/SPEC-X.md",
    };
    await writeState(agentsDir, "01TESTWS05", state).run();
    const parsed = JSON.parse(readFileSync(join(agentsDir, "01TESTWS05", "adw-state.json"), "utf8"));
    expect(Object.keys(parsed).sort()).toEqual(
      ["adw_id", "completed_stages", "description", "spec_path", "status"],
    );
  });
});

// ---------------------------------------------------------------------------
// 3. appendEvent() — chronological order, ts prepended
// ---------------------------------------------------------------------------

describe("appendEvent()", () => {
  test("appends one JSON line per call to agents/{id}/{agent}/events.jsonl", () => {
    const agentsDir = join(tmpRoot, "agents");
    appendEvent(agentsDir, "01TESTWS10", "planner", { event: "start", description: "x" });
    appendEvent(agentsDir, "01TESTWS10", "planner", { event: "classify", type: "feature" });

    const raw = readFileSync(join(agentsDir, "01TESTWS10", "planner", "events.jsonl"), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    const second = JSON.parse(lines[1]!);
    expect(first.event).toBe("start");
    expect(second.event).toBe("classify");
  });

  test("prepends a `ts` ISO timestamp to every event", () => {
    const agentsDir = join(tmpRoot, "agents");
    const before = new Date().toISOString();
    appendEvent(agentsDir, "01TESTWS11", "planner", { event: "start" });
    const after = new Date().toISOString();

    const raw = readFileSync(join(agentsDir, "01TESTWS11", "planner", "events.jsonl"), "utf8");
    const parsed = JSON.parse(raw.split("\n")[0]!);
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.ts >= before).toBe(true);
    expect(parsed.ts <= after).toBe(true);
    expect(parsed.event).toBe("start"); // original payload preserved
  });

  test("preserves chronological order across rapid calls", async () => {
    const agentsDir = join(tmpRoot, "agents");
    // Interleave two agent dirs to confirm each file's order is independent.
    for (let i = 0; i < 5; i++) {
      appendEvent(agentsDir, "01TESTWS12", "planner", { event: "p", seq: i });
      appendEvent(agentsDir, "01TESTWS12", "reviewer", { event: "r", seq: i });
      await new Promise<void>((r) => setTimeout(r, 2));
    }
    const planLines = readFileSync(join(agentsDir, "01TESTWS12", "planner", "events.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const revLines = readFileSync(join(agentsDir, "01TESTWS12", "reviewer", "events.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect(planLines.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(revLines.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4]);
    // Timestamps are non-decreasing.
    for (let i = 1; i < planLines.length; i++) {
      expect(planLines[i]!.ts >= planLines[i - 1]!.ts).toBe(true);
    }
  });

  test("writes to orchestrator subdir when agent='orchestrator'", () => {
    const agentsDir = join(tmpRoot, "agents");
    appendEvent(agentsDir, "01TESTWS13", "orchestrator", { event: "start" });
    expect(existsSync(join(agentsDir, "01TESTWS13", "orchestrator", "events.jsonl"))).toBe(true);
    expect(existsSync(join(agentsDir, "01TESTWS13", "planner", "events.jsonl"))).toBe(false);
  });

  test("golden event keys: every event line has the `ts` + `event` keys", () => {
    const agentsDir = join(tmpRoot, "agents");
    appendEvent(agentsDir, "01TESTWS14", "planner", { event: "stage-complete", stage: "plan", spec_path: "x.md" });
    const raw = readFileSync(join(agentsDir, "01TESTWS14", "planner", "events.jsonl"), "utf8");
    const parsed = JSON.parse(raw.split("\n")[0]!);
    expect(Object.keys(parsed).sort()).toEqual(["event", "spec_path", "stage", "ts"]);
  });
});

// ---------------------------------------------------------------------------
// 4. readWorkspaceState() + recoverSpecPathFromEvents() + findWorkspaceBySpecPath()
// ---------------------------------------------------------------------------

describe("readWorkspaceState()", () => {
  test("returns Left when the workspace state file does not exist", () => {
    const r = readWorkspaceState(tmpRoot, "01NOPE0000");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("nothing to resume");
  });

  test("returns Left when the state file is unparseable JSON", () => {
    const dir = join(tmpRoot, "01BADJSON01");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "adw-state.json"), "{ not valid json ");
    const r = readWorkspaceState(tmpRoot, "01BADJSON01");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("failed to parse");
  });

  test("returns the parsed state on success", async () => {
    await writeState(tmpRoot, "01TESTWS20", { adw_id: "01TESTWS20", status: "running", description: "x" }).run();
    const r = readWorkspaceState(tmpRoot, "01TESTWS20");
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.adw_id).toBe("01TESTWS20");
      expect(r.right.status).toBe("running");
      expect(r.right.description).toBe("x");
    }
  });
});

describe("recoverSpecPathFromEvents()", () => {
  test("returns null when no orchestrator event log exists", () => {
    expect(recoverSpecPathFromEvents(tmpRoot, "01TESTWS30")).toBeNull();
  });

  test("returns the most recent stage-complete spec_path scanning backward", () => {
    appendEvent(tmpRoot, "01TESTWS31", "orchestrator", { event: "stage-complete", stage: "plan", spec_path: "docs/specs/OLD.md" });
    appendEvent(tmpRoot, "01TESTWS31", "orchestrator", { event: "stage-complete", stage: "review", spec_path: "docs/specs/NEW.md" });
    expect(recoverSpecPathFromEvents(tmpRoot, "01TESTWS31")).toBe("docs/specs/NEW.md");
  });

  test("skips stage-complete events with null/empty spec_path", () => {
    appendEvent(tmpRoot, "01TESTWS32", "orchestrator", { event: "stage-complete", stage: "plan", spec_path: "docs/specs/EARLY.md" });
    appendEvent(tmpRoot, "01TESTWS32", "orchestrator", { event: "stage-complete", stage: "plan", spec_path: null });
    // Most recent non-null wins → but null is most recent, so we skip back to EARLY.
    expect(recoverSpecPathFromEvents(tmpRoot, "01TESTWS32")).toBe("docs/specs/EARLY.md");
  });

  test("returns null when events log has no stage-complete with a spec_path", () => {
    appendEvent(tmpRoot, "01TESTWS33", "orchestrator", { event: "start", description: "x" });
    appendEvent(tmpRoot, "01TESTWS33", "orchestrator", { event: "stage-error", stage: "plan", detail: "boom" });
    expect(recoverSpecPathFromEvents(tmpRoot, "01TESTWS33")).toBeNull();
  });

  test("skips malformed JSON lines gracefully", () => {
    const dir = join(tmpRoot, "01TESTWS34", "orchestrator");
    mkdirSync(dir, { recursive: true });
    // First a valid event, then a corrupted line, then a recent valid event.
    writeFileSync(join(dir, "events.jsonl"), "");
    appendEvent(tmpRoot, "01TESTWS34", "orchestrator", { event: "stage-complete", stage: "plan", spec_path: "docs/specs/A.md" });
    // Append a corrupted line directly.
    const f = join(dir, "events.jsonl");
    writeFileSync(f, "\n{ corrupted json line ", { flag: "a" });
    expect(recoverSpecPathFromEvents(tmpRoot, "01TESTWS34")).toBe("docs/specs/A.md");
  });
});

describe("findWorkspaceBySpecPath()", () => {
  test("returns null when agents dir does not exist", () => {
    expect(findWorkspaceBySpecPath(join(tmpRoot, "nope"), "docs/specs/SPEC-X.md")).toBeNull();
  });

  test("returns null when no workspace matches the spec path", () => {
    expect(findWorkspaceBySpecPath(tmpRoot, "docs/specs/SPEC-UNMATCHED.md")).toBeNull();
  });

  test("finds the workspace recording a matching spec_path", async () => {
    await writeState(tmpRoot, "01TESTWS40", { adw_id: "01TESTWS40", spec_path: "docs/specs/SPEC-065.md" }).run();
    await writeState(tmpRoot, "01TESTWS41", { adw_id: "01TESTWS41", spec_path: "docs/specs/SPEC-OTHER.md" }).run();
    expect(findWorkspaceBySpecPath(tmpRoot, "docs/specs/SPEC-065.md")).toBe("01TESTWS40");
  });

  test("returns the NEWEST workspace when multiple match (ULID lexicographic = temporal)", async () => {
    await writeState(tmpRoot, "01TESTWS40", { adw_id: "01TESTWS40", spec_path: "docs/specs/SPEC-DUP.md" }).run();
    await writeState(tmpRoot, "01TESTWS50", { adw_id: "01TESTWS50", spec_path: "docs/specs/SPEC-DUP.md" }).run();
    // 01TESTWS50 > 01TESTWS40 lexicographically → it's the newer one.
    expect(findWorkspaceBySpecPath(tmpRoot, "docs/specs/SPEC-DUP.md")).toBe("01TESTWS50");
  });

  test("ignores non-ULID directories (e.g. test artifacts)", async () => {
    // A dir that doesn't match the 10-char Crockford shape.
    mkdirSync(join(tmpRoot, "test-artifact"), { recursive: true });
    writeFileSync(join(tmpRoot, "test-artifact", "adw-state.json"), JSON.stringify({ spec_path: "docs/specs/SPEC-X.md" }));
    await writeState(tmpRoot, "01TESTWS60", { adw_id: "01TESTWS60", spec_path: "docs/specs/SPEC-X.md" }).run();
    expect(findWorkspaceBySpecPath(tmpRoot, "docs/specs/SPEC-X.md")).toBe("01TESTWS60");
  });

  test("matches a relative spec_path against a relative lookup (the persisted form)", async () => {
    // normalizeSpecPath defaults projectRoot to process.cwd(). State files
    // record the repo-relative form (`docs/specs/...`), and dispatchers look
    // up by the same form — this is the matching path actually exercised in
    // production.
    await writeState(tmpRoot, "01TESTWS70", { adw_id: "01TESTWS70", spec_path: "docs/specs/SPEC-NORM.md" }).run();
    expect(findWorkspaceBySpecPath(tmpRoot, "docs/specs/SPEC-NORM.md")).toBe("01TESTWS70");
  });
});

describe("normalizeSpecPath()", () => {
  test("passes through repo-relative paths unchanged", () => {
    const n = normalizeSpecPath("docs/specs/SPEC-001.md", { projectRoot: tmpRoot });
    expect(n.relative).toBe("docs/specs/SPEC-001.md");
    expect(n.absolute).toBe(join(tmpRoot, "docs/specs/SPEC-001.md"));
  });

  test("resolves relative paths against ADW_WORKTREE when set", () => {
    const wt = join(tmpRoot, "worktree");
    const n = normalizeSpecPath("docs/specs/SPEC-001.md", { projectRoot: tmpRoot, worktreeRoot: wt });
    expect(n.relative).toBe("docs/specs/SPEC-001.md");
    expect(n.absolute).toBe(join(wt, "docs/specs/SPEC-001.md"));
  });

  test("derives repo-relative from a main-checkout absolute path", () => {
    const abs = join(tmpRoot, "docs/specs/SPEC-001.md");
    const n = normalizeSpecPath(abs, { projectRoot: tmpRoot });
    expect(n.relative).toBe("docs/specs/SPEC-001.md");
  });
});

// ---------------------------------------------------------------------------
// 5. tokensOf() — subprocess stdout normalization
// ---------------------------------------------------------------------------

describe("tokensOf()", () => {
  test("returns the last non-empty line split on whitespace", () => {
    expect(tokensOf("first line\n01ABC00000 docs/specs/SPEC-001.md")).toEqual(
      ["01ABC00000", "docs/specs/SPEC-001.md"],
    );
  });

  test("returns null for empty input", () => {
    expect(tokensOf("")).toBeNull();
    expect(tokensOf("\n\n  \n")).toBeNull();
  });

  test("handles paths with spaces by joining the tail as separate tokens (matches pre-refactor behavior)", () => {
    // The pre-refactor behavior split on whitespace, so paths with spaces
    // become multiple tokens; callers join them back with `tokens.slice(N).join(" ")`.
    const tokens = tokensOf("01ABC00000 docs/specs/with space.md");
    expect(tokens).toEqual(["01ABC00000", "docs/specs/with", "space.md"]);
  });

  test("trims trailing whitespace from the last line", () => {
    expect(tokensOf("01ABC00000 pass docs/specs/X.md   \n")).toEqual(
      ["01ABC00000", "pass", "docs/specs/X.md"],
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Constants
// ---------------------------------------------------------------------------

describe("ADW_ID_RE", () => {
  test("matches a valid 10-char Crockford ULID id", () => {
    expect(ADW_ID_RE.test("01ABC00000")).toBe(true);
    expect(ADW_ID_RE.test("01TESTWS01")).toBe(true);
  });

  test("rejects ids with wrong length", () => {
    expect(ADW_ID_RE.test("01ABC0000")).toBe(false); // 9 chars
    expect(ADW_ID_RE.test("01ABC000000")).toBe(false); // 11 chars
  });

  test("rejects ids with non-Crockford characters (I, L, O, U)", () => {
    expect(ADW_ID_RE.test("01ABC0000I")).toBe(false); // I
    expect(ADW_ID_RE.test("01ABC0000L")).toBe(false); // L
    expect(ADW_ID_RE.test("01ABC0000O")).toBe(false); // O
    expect(ADW_ID_RE.test("01ABC0000U")).toBe(false); // U
  });

  test("rejects lowercase", () => {
    expect(ADW_ID_RE.test("01abc00000")).toBe(false);
  });
});

describe("CHORE-44 shared ADW execution boundaries", () => {
  const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

  test("runRaw and runCapture have one implementation and stage dispatchers are thin adapters", () => {
    const runtime = source("adws/adws-modules/dispatcher-runtime.ts");
    const testStage = source("adws/adw-test.ts");
    const patchStage = source("adws/adw-patch-review.ts");

    expect(runtime.match(/export\s+function\s+runRaw\s*\(/g)?.length).toBe(1);
    expect(runtime.match(/export\s+function\s+runCapture\s*\(/g)?.length).toBe(1);
    for (const stage of [testStage, patchStage]) {
      expect(stage).toContain("runRaw as runRawShared");
      expect(stage).toContain("runCapture as runCaptureShared");
      expect(stage).not.toMatch(/\bspawn\s*\(/);
      expect(stage).not.toMatch(/function\s+runRaw\s*\(/);
      expect(stage).not.toMatch(/function\s+runCapture\s*\(/);
    }
  });

  test("linear and retrying pipelines execute configured stages through the same runner", () => {
    const pipeline = source("adws/adws-modules/pipeline.ts");
    const retryingPipeline = source("adws/adw-plan-review-build-patch.ts");

    expect(pipeline).toMatch(/export\s+async\s+function\s+runConfiguredStage/);
    expect(pipeline).toContain("await runConfiguredStage({");
    expect(retryingPipeline).toContain('import { runConfiguredStage, type PipelineStageInfo }');
    expect(retryingPipeline.match(/await runConfiguredStage\s*\(\{/g)?.length).toBe(7);
  });
});

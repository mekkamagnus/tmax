/**
 * @file adw-status.test.ts
 * @description Unit tests for adws/adw-status.ts pure rendering functions:
 * deriveState (working/idle/done/failed transitions), formatElapsed,
 * deriveStageLabel, renderTable (column format, --id filtering, corrupt rows),
 * and loadAllWorkspaces (corrupt state handling).
 *
 * Tests use a fixture agents/ directory written under os.tmpdir(). No live
 * tmux, no live git — worktree list is passed as a fixture array.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import {
  deriveState,
  deriveStageLabel,
  formatElapsed,
  loadAllWorkspaces,
  renderTable,
  type WorkspaceRow,
  IDLE_THRESHOLD_MS,
} from "../../adws/adw-status.ts";
import type { WorktreeEntry } from "../../adws/adws-modules/worktree.ts";

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z — deterministic

// ---------------------------------------------------------------------------
// deriveState
// ---------------------------------------------------------------------------

describe("deriveState", () => {
  test("status=completed → done regardless of event ts", () => {
    expect(deriveState("completed", null, NOW)).toBe("done");
    expect(deriveState("completed", NOW - 10 * 60 * 1000, NOW)).toBe("done");
  });

  test("status=failed → failed", () => {
    expect(deriveState("failed", null, NOW)).toBe("failed");
    expect(deriveState("failed", NOW, NOW)).toBe("failed");
  });

  test("no status + recent event (< 2min) → working", () => {
    expect(deriveState("running", NOW - 30_000, NOW)).toBe("working");
    expect(deriveState("setup", NOW - 90_000, NOW)).toBe("working");
    expect(deriveState(undefined, NOW - IDLE_THRESHOLD_MS + 1000, NOW)).toBe("working");
  });

  test("no status + stale event (> 2min) → idle", () => {
    expect(deriveState("running", NOW - IDLE_THRESHOLD_MS - 1, NOW)).toBe("idle");
    expect(deriveState("setup", NOW - 10 * 60 * 1000, NOW)).toBe("idle");
  });

  test("no event ts → idle", () => {
    expect(deriveState("running", null, NOW)).toBe("idle");
    expect(deriveState("setup", null, NOW)).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// formatElapsed
// ---------------------------------------------------------------------------

describe("formatElapsed", () => {
  test("under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(5_000)).toBe("5s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  test("minutes", () => {
    expect(formatElapsed(60_000)).toBe("1m00s");
    expect(formatElapsed(4 * 60_000 + 12_000)).toBe("4m12s");
    expect(formatElapsed(18 * 60_000 + 2_000)).toBe("18m02s");
  });

  test("hours", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1h00m");
    expect(formatElapsed(3 * 60 * 60_000 + 2 * 60_000)).toBe("3h02m");
  });

  test("negative clamps to 0", () => {
    expect(formatElapsed(-1000)).toBe("0s");
  });
});

// ---------------------------------------------------------------------------
// deriveStageLabel
// ---------------------------------------------------------------------------

describe("deriveStageLabel", () => {
  test("completed status → 'completed'", () => {
    const row: WorkspaceRow = {
      id: "01KVE00001",
      state: { adw_id: "01KVE00001", status: "completed", completed_stages: ["plan", "review", "build", "test", "patch-review"] },
      latestEvent: null,
      latestEventTs: null,
    };
    expect(deriveStageLabel(row)).toBe("completed");
  });

  test("stage-error event → '<stage> (error)'", () => {
    const row: WorkspaceRow = {
      id: "01KVE00002",
      state: { adw_id: "01KVE00002", status: "failed" },
      latestEvent: { event: "stage-error", stage: "build", detail: "x" },
      latestEventTs: NOW,
    };
    expect(deriveStageLabel(row)).toBe("build (error)");
  });

  test("no events, no completed stages → '(starting)'", () => {
    const row: WorkspaceRow = {
      id: "01KVE00003",
      state: { adw_id: "01KVE00003", completed_stages: [] },
      latestEvent: null,
      latestEventTs: null,
    };
    expect(deriveStageLabel(row)).toBe("(starting)");
  });

  test("no events, some completed → next pending stage", () => {
    const row: WorkspaceRow = {
      id: "01KVE00004",
      state: { adw_id: "01KVE00004", completed_stages: ["plan", "review"] },
      latestEvent: null,
      latestEventTs: null,
    };
    expect(deriveStageLabel(row)).toBe("build");
  });
});

// ---------------------------------------------------------------------------
// renderTable
// ---------------------------------------------------------------------------

describe("renderTable", () => {
  const worktrees: WorktreeEntry[] = [
    { path: "/repo", branch: "refs/heads/main" },
    { path: "/repo.01KVE00001", branch: "refs/heads/adw/01KVE00001" },
    { path: "/repo.01KVE00002", branch: "refs/heads/adw/01KVE00002" },
  ];

  test("renders header + separator + rows with all columns", () => {
    const rows: WorkspaceRow[] = [
      {
        id: "01KVE00001",
        state: {
          adw_id: "01KVE00001",
          status: "running",
          spec_path: "docs/specs/SPEC-001.md",
          completed_stages: ["plan", "review"],
          branch: "adw/01KVE00001",
          worktree_path: "/repo.01KVE00001",
        },
        latestEvent: { event: "heartbeat", stage: "build", elapsed_ms: 30000 },
        latestEventTs: NOW - 30_000,
      },
      {
        id: "01KVE00002",
        state: {
          adw_id: "01KVE00002",
          status: "completed",
          spec_path: "docs/specs/SPEC-002.md",
          completed_stages: ["plan", "review", "build", "test", "patch-review"],
          branch: "adw/01KVE00002",
        },
        latestEvent: { event: "stage-complete", stage: "patch-review" },
        latestEventTs: NOW - 60_000,
      },
    ];
    const out = renderTable(rows, worktrees, NOW);
    const lines = out.split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("SPEC");
    expect(lines[0]).toContain("STAGE");
    expect(lines[0]).toContain("STATE");
    expect(lines[0]).toContain("ELAPSED");
    expect(lines[0]).toContain("WHERE");
    // Separator line of dashes (with double-space column gaps).
    expect(lines[1]).toMatch(/^-+(  -+)+$/);
    // Working row.
    expect(out).toContain("01KVE00001");
    expect(out).toContain("working");
    expect(out).toContain("build");
    expect(out).toContain("30s");
    // Done row.
    expect(out).toContain("01KVE00002");
    expect(out).toContain("done");
    expect(out).toContain("completed");
  });

  test("renderTable shows 'local' for unset host and host name when set", () => {
    const rows: WorkspaceRow[] = [
      {
        id: "01KVE00003",
        state: { adw_id: "01KVE00003", status: "completed", spec_path: "x.md", host: "mekkapi" },
        latestEvent: null,
        latestEventTs: null,
      },
      {
        id: "01KVE00004",
        state: { adw_id: "01KVE00004", status: "completed", spec_path: "y.md" },
        latestEvent: null,
        latestEventTs: null,
      },
    ];
    const out = renderTable(rows, [], NOW);
    expect(out).toContain("mekkapi");
    expect(out).toContain("local");
  });

  test("empty rows → '(no workspaces found)'", () => {
    const out = renderTable([], [], NOW);
    expect(out).toContain("(no workspaces found)");
  });
});

// ---------------------------------------------------------------------------
// loadAllWorkspaces — corrupt state handling
// ---------------------------------------------------------------------------

describe("loadAllWorkspaces", () => {
  let tmpAgents: string;
  beforeEach(() => {
    tmpAgents = mkdtempSync(join(tmpdir(), "adw-status-"));
  });
  afterEach(() => {
    try { rmSync(tmpAgents, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("skips non-ULID dirs; loads valid workspaces newest-first", () => {
    mkdirSync(join(tmpAgents, "01KVE00009", "orchestrator"), { recursive: true });
    writeFileSync(join(tmpAgents, "01KVE00009", "adw-state.json"), JSON.stringify({ adw_id: "01KVE00009", spec_path: "x.md" }));
    mkdirSync(join(tmpAgents, "01KVE00001", "orchestrator"), { recursive: true });
    writeFileSync(join(tmpAgents, "01KVE00001", "adw-state.json"), JSON.stringify({ adw_id: "01KVE00001", spec_path: "y.md" }));
    // Non-ULID dir, ignored.
    mkdirSync(join(tmpAgents, "garbage"), { recursive: true });

    const rows = loadAllWorkspaces(tmpAgents);
    expect(rows.length).toBe(2);
    expect(rows[0]!.id).toBe("01KVE00009"); // newest first
    expect(rows[1]!.id).toBe("01KVE00001");
  });

  test("keeps corrupt state files as a placeholder row with corrupt=true", () => {
    mkdirSync(join(tmpAgents, "01KVE00007"), { recursive: true });
    writeFileSync(join(tmpAgents, "01KVE00007", "adw-state.json"), "{not json");
    const rows = loadAllWorkspaces(tmpAgents);
    expect(rows.length).toBe(1);
    expect(rows[0]!.corrupt).toBe(true);
    expect(rows[0]!.id).toBe("01KVE00007");
  });

  test("renders (corrupt) in the spec column for corrupt rows", () => {
    mkdirSync(join(tmpAgents, "01KVE00008"), { recursive: true });
    writeFileSync(join(tmpAgents, "01KVE00008", "adw-state.json"), "{not json");
    const rows = loadAllWorkspaces(tmpAgents);
    const out = renderTable(rows, [], NOW);
    expect(out).toContain("(corrupt)");
  });
});

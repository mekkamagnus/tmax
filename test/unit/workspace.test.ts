/**
 * @file workspace.test.ts
 * @description Unit tests for adws/adws-modules/workspace.ts (spec-anchored
 * workspace discovery). All tests use temp dirs — no real agents/ mutation.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { findWorkspaceBySpecPath } from "../../adws/adws-modules/workspace.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "workspace-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Seed a workspace state file at {tmp}/agents/{id}/adw-state.json. */
function seed(id: string, state: Record<string, unknown>): void {
  const dir = join(tmp, "agents", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
}

const SPEC_A = "/abs/path/to/SPEC-001.md";
const SPEC_B = "/abs/path/to/SPEC-002.md";

describe("findWorkspaceBySpecPath", () => {
  test("returns the matching workspace id when exactly one exists", () => {
    seed("01TESTWS01", { adw_id: "01TESTWS01", spec_path: SPEC_A, status: "running" });
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBe("01TESTWS01");
  });

  test("returns null when no workspace matches the spec_path", () => {
    seed("01TESTWS01", { adw_id: "01TESTWS01", spec_path: SPEC_A, status: "running" });
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_B);
    expect(result).toBeNull();
  });

  test("returns null when agents/ directory does not exist", () => {
    const result = findWorkspaceBySpecPath(join(tmp, "nonexistent-agents"), SPEC_A);
    expect(result).toBeNull();
  });

  test("returns the NEWEST matching workspace when multiple exist (ULID sort)", () => {
    // Three workspaces for the same spec, created in this order (ids ascending).
    seed("01TESTAA01", { adw_id: "01TESTAA01", spec_path: SPEC_A, status: "completed" });
    seed("01TESTBB02", { adw_id: "01TESTBB02", spec_path: SPEC_A, status: "failed" });
    seed("01TESTCC03", { adw_id: "01TESTCC03", spec_path: SPEC_A, status: "running" });
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    // Highest ULID = most recent = 01TESTCC03.
    expect(result).toBe("01TESTCC03");
  });

  test("matches on exact spec_path string equality (no partial match)", () => {
    seed("01TESTWS01", { adw_id: "01TESTWS01", spec_path: "/abs/SPEC-001.md" });
    expect(findWorkspaceBySpecPath(join(tmp, "agents"), "/abs/SPEC-001.md")).toBe("01TESTWS01");
    expect(findWorkspaceBySpecPath(join(tmp, "agents"), "/abs/SPEC-001")).toBeNull();
    expect(findWorkspaceBySpecPath(join(tmp, "agents"), "SPEC-001.md")).toBeNull();
  });

  test("skips dirs that don't match the 10-char ULID shape", () => {
    // A non-ULID dir with a matching state file — should be skipped.
    const dir = join(tmp, "agents", "test-artifact");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "adw-state.json"), JSON.stringify({ spec_path: SPEC_A }));
    // No ULID dirs exist.
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBeNull();
  });

  test("skips corrupt/unparseable state files gracefully", () => {
    seed("01TESTWS01", { adw_id: "01TESTWS01", spec_path: SPEC_A });
    // Corrupt the state file.
    writeFileSync(join(tmp, "agents", "01TESTWS01", "adw-state.json"), "{not valid json");
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBeNull();
  });

  test("skips ULID dirs that have no adw-state.json", () => {
    const dir = join(tmp, "agents", "01TESTWS01");
    mkdirSync(dir, { recursive: true });
    // No state file — just events or something.
    writeFileSync(join(dir, "other.json"), "{}");
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBeNull();
  });

  test("matches a workspace whose status is 'failed' (any status wins)", () => {
    seed("01TESTWS01", { adw_id: "01TESTWS01", spec_path: SPEC_A, status: "failed" });
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBe("01TESTWS01");
  });

  test("ignores workspaces for a different spec even if newer", () => {
    seed("01TESTAA01", { adw_id: "01TESTAA01", spec_path: SPEC_A });
    seed("01TESTBB02", { adw_id: "01TESTBB02", spec_path: SPEC_B }); // newer, wrong spec
    const result = findWorkspaceBySpecPath(join(tmp, "agents"), SPEC_A);
    expect(result).toBe("01TESTAA01");
  });
});

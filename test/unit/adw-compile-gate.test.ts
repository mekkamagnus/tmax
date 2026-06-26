/**
 * @file adw-compile-gate.test.ts
 * @description ADR-0108 (a) + (b) unit tests.
 *   (a) runTypecheckGate — the build-stage compile gate (injected `run`, no
 *       real tsc). Asserts non-zero exit → { ok: false }, zero exit → { ok: true }.
 *   (b) isImportTimeFailure — the pure classifier for module-load signatures.
 *       Asserts duplicate-identifier / cannot-find-module classify true, while
 *       assertion failures and timeouts classify false.
 *
 * No real subprocesses, no real agents/ dir (ADR-0105).
 */
import { describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { runTypecheckGate } from "../../adws/adw-build.ts";
import { isImportTimeFailure, type TestFailure } from "../../adws/adws-modules/tester.ts";

/** Build an injected `run` that returns a canned Either (Right=exit0, Left=nonzero). */
function fakeRun(result: Either<string, string>) {
  return () => TaskEither.from(async () => result);
}

describe("ADR-0108 (a) — runTypecheckGate", () => {
  test("exit 0 → { ok: true, output: '' }", async () => {
    const res = await runTypecheckGate(fakeRun(Either.right("")), "/cwd").run();
    expect(Either.isRight(res)).toBe(true);
    if (Either.isRight(res)) {
      expect(res.right.ok).toBe(true);
      expect(res.right.output).toBe("");
    }
  });

  test("non-zero exit → { ok: false, output: <stderr> }", async () => {
    const stderr = "adws/x.ts(55,10): error TS2300: Duplicate identifier 'findWorkspaceBySpecPath'.";
    const res = await runTypecheckGate(fakeRun(Either.left(stderr)), "/cwd").run();
    expect(Either.isRight(res)).toBe(true);
    if (Either.isRight(res)) {
      expect(res.right.ok).toBe(false);
      expect(res.right.output).toContain("Duplicate identifier");
    }
  });

  test("output is truncated to ~400 chars on failure", async () => {
    const long = "x".repeat(2000);
    const res = await runTypecheckGate(fakeRun(Either.left(long)), "/cwd").run();
    expect(Either.isRight(res)).toBe(true);
    if (Either.isRight(res)) {
      expect(res.right.output.length).toBeLessThanOrEqual(400);
    }
  });
});

describe("ADR-0108 (b) — isImportTimeFailure", () => {
  const fail = (message: string): TestFailure => ({ name: "x > y", message });

  test("Duplicate identifier → true", () => {
    expect(isImportTimeFailure([fail("error TS2300: Duplicate identifier 'foo'.")])).toBe(true);
  });

  test("Cannot find module → true", () => {
    expect(isImportTimeFailure([fail("Cannot find module './stall-detector.ts'")])).toBe(true);
  });

  test("Could not resolve → true", () => {
    expect(isImportTimeFailure([fail("Could not resolve a dependency")])).toBe(true);
  });

  test("error TS2xxx family → true", () => {
    expect(isImportTimeFailure([fail("error TS2304: Cannot find name 'x'.")])).toBe(true);
  });

  test("SyntaxError → true", () => {
    expect(isImportTimeFailure([fail("SyntaxError: Unexpected token")])).toBe(true);
  });

  test("plain assertion failure → false", () => {
    expect(isImportTimeFailure([fail("expected 2 to be 3")])).toBe(false);
  });

  test("timeout → false", () => {
    expect(isImportTimeFailure([fail("this test timed out after 20000ms.")])).toBe(false);
  });

  test("empty failures → false", () => {
    expect(isImportTimeFailure([])).toBe(false);
  });

  test("mixed: one import-time among many → true (any match)", () => {
    expect(isImportTimeFailure([
      fail("expected 2 to be 3"),
      fail("this test timed out after 20000ms."),
      fail("error TS2300: Duplicate identifier 'bar'."),
    ])).toBe(true);
  });
});

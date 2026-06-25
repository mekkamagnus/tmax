/**
 * @file adw-patch-review-gates-phase.test.ts
 * @description Focused unit coverage for the §C2 runGates() onPhase callback
 * (SPEC-062 AC#9). The build wired the callback correctly and the existing
 * adw-patch-review.test.ts proves the markers don't break control flow, but
 * the auditor flagged that no test directly asserts the phase-callback
 * contract: that gates:typecheck, gates:unit, and the conditional
 * gates:tmax-use fire BEFORE their respective runRaw calls, in order, and that
 * a throwing observer is swallowed.
 *
 * No live `bun`/`claude`/`git` — all subprocess I/O is faked via
 * PatchReviewerDeps mocks; tmax-use target detection is driven by real fixture
 * dirs under a temp cwd (so the private hasTmaxUseTargets check exercises the
 * same code path production uses).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  runGates,
  type GatePhase,
  type PatchReviewerDeps,
  type RawRunResult,
} from "../../adws/adws-modules/patch-reviewer.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adw-gates-phase-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a PatchReviewerDeps whose runRaw records every call in order and
 * returns a canned RawRunResult. run and runCapture are unused by runGates but
 * required by the interface.
 */
function recordingDeps(
  calls: Array<{ cmd: string; args: string[] }>,
  result: RawRunResult = { ok: true, exitCode: 0, stdout: "", stderr: "" },
): PatchReviewerDeps {
  return {
    run: (_cmd, _args, _opts) => TaskEither.right("mock"),
    runRaw: (cmd, args, _opts) => {
      calls.push({ cmd, args });
      return TaskEither.right<RawRunResult, string>(result);
    },
    runCapture: (_cmd, _args, _opts) => TaskEither.right("mock"),
  };
}

/** Create an empty tmax-use/playbooks dir so hasTmaxUseTargets returns true. */
function seedTmaxUseTargets(cwd: string): void {
  const dir = join(cwd, "tmax-use", "playbooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "smoke.yaml"), "name: smoke\n");
}

// ---------------------------------------------------------------------------
// onPhase ordering + before-runRaw
// ---------------------------------------------------------------------------

describe("runGates onPhase callback (§C2)", () => {
  test("fires gates:typecheck and gates:unit in order, before each runRaw, when no tmax-use targets", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const phases: Array<{ phase: GatePhase; command: string; runRawCallsSoFar: number }> = [];

    // A cwd with NO tmax-use/ dir — hasTmaxUseTargets returns false.
    const deps = recordingDeps(calls);
    const onPhase = (phase: GatePhase, command: string): void => {
      phases.push({ phase, command, runRawCallsSoFar: calls.length });
    };

    const result = await runGates(deps, tmp, { onPhase }).run();

    expect(Either.isRight(result)).toBe(true);
    // Exactly two gates ran; no tmax-use.
    expect(calls.length).toBe(2);
    expect(calls[0]!.args).toEqual(["run", "typecheck:src"]);
    expect(calls[1]!.args).toEqual(["test", "--timeout", "30000", "test/unit/"]);

    // Phases fired in order with the documented commands.
    expect(phases.map((p) => p.phase)).toEqual(["gates:typecheck", "gates:unit"]);
    expect(phases[0]!.command).toBe("bun run typecheck:src");
    expect(phases[1]!.command).toBe("bun test test/unit/");

    // Each phase fired BEFORE its runRaw: typecheck phase at 0 prior calls,
    // unit phase at 1 prior call (typecheck already ran).
    expect(phases[0]!.runRawCallsSoFar).toBe(0);
    expect(phases[1]!.runRawCallsSoFar).toBe(1);
  });

  test("additionally fires gates:tmax-use before its runRaw when tmax-use targets exist", async () => {
    // Seed a real tmax-use/playbooks fixture under cwd so the private
    // hasTmaxUseTargets check returns true via the same code path as prod.
    seedTmaxUseTargets(tmp);

    const calls: Array<{ cmd: string; args: string[] }> = [];
    const phases: Array<{ phase: GatePhase; runRawCallsSoFar: number }> = [];
    const deps = recordingDeps(calls);
    const onPhase = (phase: GatePhase): void => {
      phases.push({ phase, runRawCallsSoFar: calls.length });
    };

    const result = await runGates(deps, tmp, { onPhase }).run();

    expect(Either.isRight(result)).toBe(true);
    // All three gates ran.
    expect(calls.length).toBe(3);
    expect(calls[2]!.args).toEqual(["test"]);

    expect(phases.map((p) => p.phase)).toEqual([
      "gates:typecheck",
      "gates:unit",
      "gates:tmax-use",
    ]);
    // tmax-use phase fired after typecheck + unit (2 prior calls), before its
    // own runRaw (which becomes the 3rd).
    expect(phases[2]!.runRawCallsSoFar).toBe(2);
  });

  test("gates:tmax-use does NOT fire when tmax-use targets are absent (marker stays in sync with gate)", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const phases: GatePhase[] = [];
    const deps = recordingDeps(calls);
    const onPhase = (phase: GatePhase): void => { phases.push(phase); };

    await runGates(deps, tmp, { onPhase }).run();

    expect(phases).not.toContain("gates:tmax-use");
    expect(calls.find((c) => c.args.includes("test:tmax-use"))).toBeUndefined();
  });

  test("a throwing onPhase observer is swallowed — gates still run and the result is Right", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const deps = recordingDeps(calls);
    const onPhase = (): void => { throw new Error("observer crashed"); };

    const result = await runGates(deps, tmp, { onPhase }).run();

    // Both gates still ran despite the observer throwing on each phase.
    expect(calls.length).toBe(2);
    expect(Either.isRight(result)).toBe(true);
  });

  test("no onPhase callback — runGates behaves identically to pre-§C2 (no crash, both gates run)", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const deps = recordingDeps(calls);

    const result = await runGates(deps, tmp).run();

    expect(calls.length).toBe(2);
    expect(Either.isRight(result)).toBe(true);
  });
});

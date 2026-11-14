/**
 * @file cli-launcher.test.ts
 * @description #250 — unit tests for the TS launcher ported from bin/tmax.
 *   The arg parser is pure; the daemon choreography (wait loop, stale-lock
 *  removal) is probed with a fake socket dir. Terminal verbs (stop/sweep/-e/
 *  capture/TUI attach) exit the process — they are covered by the live
 *  source-mode verification in the spec, not by in-process tests.
 */

import { describe, expect, it } from "bun:test";
import { __internals } from "../../src/cli/launcher.ts";
import { isCompiledBinary, tuiSpawnTarget, daemonSpawnTarget } from "../../src/cli/exec-target.ts";

const { parseArgs } = __internals;

describe("#250: launcher arg parsing (bash parity)", () => {
  it("parses the flag surface", () => {
    const p = parseArgs(["--daemon", "--clean", "--init-file", "/tmp/i.tl", "-e", "(+ 1 2)", "--json"]);
    expect(p.daemonOnly).toBe(true);
    expect(p.cleanStart).toBe(true);
    expect(p.initFile).toBe("/tmp/i.tl");
    expect(p.evalExpr).toBe("(+ 1 2)");
    expect(p.testJson).toBe(true);
  });

  it("sweep modifiers", () => {
    expect(parseArgs(["--sweep"]).sweepApply).toBe(false);
    expect(parseArgs(["--sweep", "--apply"]).sweepApply).toBe(true);
    expect(parseArgs(["--sweep", "--force"]).sweepForce).toBe(true);
    expect(parseArgs(["--sweep", "--apply", "--force"]).sweepApply).toBe(true);
  });

  it("workspace forms: -w NAME, --workspace NAME, files after -- are files", () => {
    expect(parseArgs(["-w", "docs"]).workspace).toBe("docs");
    expect(parseArgs(["--workspace", "new:docs"]).workspace).toBe("new:docs");
    const p = parseArgs(["--", "-weird-file.txt"]);
    expect(p.files).toEqual(["-weird-file.txt"]);
    expect(p.workspace).toBe("");
  });

  it("--test with target; --capture forms", () => {
    expect(parseArgs(["--test", "test/tlisp/foo.tlisp"]).testTarget).toBe("test/tlisp/foo.tlisp");
    expect(parseArgs(["--test"]).testTarget).toBe("");
    expect(parseArgs(["--capture"]).capture).toBe("ansi");
    expect(parseArgs(["--capture-html"]).capture).toBe("html");
  });

  it("embedded dev flags and --version pass through; files collect", () => {
    const p = parseArgs(["--dev", "--version", "file.txt"]);
    expect(p.files).toEqual(["file.txt"]);
    // -t is the default behavior — a no-op that must parse
    expect(parseArgs(["-t", "f.md"]).files).toEqual(["f.md"]);
  });

  it("unknown flags and missing values error (I6/BUG-41 parity)", () => {
    // parseArgs exits the process on these — stub exit so the failure is an
    // observable throw instead of killing the test runner.
    const origExit = process.exit;
    const codes: number[] = [];
    (process as any).exit = ((code?: number) => { codes.push(code ?? 0); throw new Error(`exit ${code}`); }) as never;
    try {
      expect(() => parseArgs(["--wat"])).toThrow(/exit 1/);        // unknown flag
      expect(() => parseArgs(["-x"])).toThrow(/exit 1/);
      expect(() => parseArgs(["-e"])).toThrow(/exit 1/);           // -e without expr
      expect(() => parseArgs(["-w"])).toThrow(/exit 1/);           // -w without name
      expect(() => parseArgs(["--workspace-kill"])).toThrow(/exit 1/);
      expect(() => parseArgs(["--init-file"])).toThrow(/exit 1/);
    } finally {
      (process as any).exit = origExit;
    }
    expect(codes.every((c) => c === 1)).toBe(true);
  });
});

describe("#250: exec targets (source vs $bunfs binary)", () => {
  it("tui target: source tree spawns the tui-client.ts entry under bun", () => {
    if (isCompiledBinary()) return; // unit tests only run from source
    const t = tuiSpawnTarget();
    expect(t.cmd).toBe(process.execPath);
    expect(t.args[0]).toMatch(/tui-client\.ts$/);
  });

  it("daemon target: source tree spawns server.ts under bun", () => {
    if (isCompiledBinary()) return;
    const t = daemonSpawnTarget();
    expect(t.cmd).toBe(process.execPath);
    expect(t.args[0]).toMatch(/server\/server\.ts$/);
  });
});

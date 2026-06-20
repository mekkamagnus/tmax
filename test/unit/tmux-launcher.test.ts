/**
 * @file tmux-launcher.test.ts
 * @description Deterministic unit tests for adws/adws-modules/tmux-launcher.ts.
 * All tmux calls are mocked via TmuxLauncherDeps — no real subprocess, no real
 * tmux, no real session mutation.
 */
import { describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  ensureSession,
  ensureTmux,
  launchInWindow,
  type TmuxLauncherDeps,
} from "../../adws/adws-modules/tmux-launcher.ts";

/**
 * Build a TmuxLauncherDeps whose `run` returns canned responses keyed by
 * `"<cmd> <args joined by space>"`. Defaults: tmux -V succeeds, has-session
 * succeeds (session exists), new-session succeeds, new-window succeeds.
 *
 * Each call also records the key so tests can assert call order/args.
 */
function fakeDeps(opts: {
  runResults?: Map<string, Either<string, string>>;
} = {}): TmuxLauncherDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      calls.push(key);
      return TaskEither.from(async () => {
        const preset = opts.runResults?.get(key);
        if (preset) return preset;
        if (key.startsWith("tmux -V")) return Either.right("tmux 3.5a");
        if (key.startsWith("tmux has-session")) return Either.right("");
        if (key.startsWith("tmux new-session")) return Either.right("");
        if (key.startsWith("tmux new-window")) return Either.right("");
        return Either.left(`unexpected command: ${key}`);
      });
    },
  };
}

describe("ensureTmux", () => {
  test("returns Right when tmux -V succeeds", async () => {
    const deps = fakeDeps();
    const r = await ensureTmux(deps).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBeUndefined();
    expect(deps.calls).toEqual(["tmux -V"]);
  });

  test("returns Left with install hint when tmux -V fails", async () => {
    const deps = fakeDeps({
      runResults: new Map([["tmux -V", Either.left("command not found: tmux")]]),
    });
    const r = await ensureTmux(deps).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("tmux is not installed");
      expect(r.left).toContain("brew install tmux");
    }
  });
});

describe("ensureSession", () => {
  test("returns Right when has-session succeeds (session exists)", async () => {
    const deps = fakeDeps();
    const r = await ensureSession(deps, "tmax").run();
    expect(Either.isRight(r)).toBe(true);
    // Should have probed has-session and NOT created a new session.
    expect(deps.calls).toEqual(["tmux has-session -t tmax"]);
  });

  test("creates the session when has-session fails", async () => {
    const deps = fakeDeps({
      runResults: new Map([
        ["tmux has-session -t tmax", Either.left("can't find session: tmax")],
        ["tmux new-session -d -s tmax", Either.right("")],
      ]),
    });
    const r = await ensureSession(deps, "tmax").run();
    expect(Either.isRight(r)).toBe(true);
    expect(deps.calls).toEqual([
      "tmux has-session -t tmax",
      "tmux new-session -d -s tmax",
    ]);
  });

  test("returns Left when both has-session and new-session fail", async () => {
    const deps = fakeDeps({
      runResults: new Map([
        ["tmux has-session -t dev", Either.left("no session")],
        ["tmux new-session -d -s dev", Either.left("permission denied")],
      ]),
    });
    const r = await ensureSession(deps, "dev").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("failed to create tmux session 'dev'");
      expect(r.left).toContain("permission denied");
    }
  });

  test("passes the session name through unchanged", async () => {
    const deps = fakeDeps({
      runResults: new Map([
        ["tmux has-session -t my-custom-session", Either.left("no session")],
        ["tmux new-session -d -s my-custom-session", Either.right("")],
      ]),
    });
    const r = await ensureSession(deps, "my-custom-session").run();
    expect(Either.isRight(r)).toBe(true);
    expect(deps.calls).toContain("tmux new-session -d -s my-custom-session");
  });
});

describe("launchInWindow", () => {
  test("calls new-window with session:, window name, and command; returns {session, window}", async () => {
    const deps = fakeDeps();
    const r = await launchInWindow(deps, {
      session: "tmax",
      windowName: "adw-smoke",
      command: "cd '/repo' && exec 'bun' 'script.ts'",
    }).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toEqual({ session: "tmax", window: "adw-smoke" });
    }
    // Target is "tmax:" (with colon) — see launchInWindow's JSDoc.
    expect(deps.calls).toEqual([
      `tmux new-window -t tmax: -n adw-smoke cd '/repo' && exec 'bun' 'script.ts'`,
    ]);
  });

  test("returns Left when new-window fails", async () => {
    const deps = fakeDeps({
      runResults: new Map([
        ["tmux new-window -t tmax: -n w cmd", Either.left("no server running")],
      ]),
    });
    const r = await launchInWindow(deps, {
      session: "tmax",
      windowName: "w",
      command: "cmd",
    }).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("no server running");
  });

  test("preserves special characters in the command verbatim", async () => {
    const deps = fakeDeps();
    const cmd = `cd '/repo' && exec 'bun' 'script.ts' '--message' 'hello world' 'path with spaces.md'`;
    const r = await launchInWindow(deps, {
      session: "tmax",
      windowName: "adw-123456",
      command: cmd,
    }).run();
    expect(Either.isRight(r)).toBe(true);
    expect(deps.calls[0]).toBe(`tmux new-window -t tmax: -n adw-123456 ${cmd}`);
  });
});

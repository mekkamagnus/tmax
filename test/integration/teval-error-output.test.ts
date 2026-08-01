/**
 * @file teval-error-output.test.ts
 * @description BUG-39 / #61 — `tmax -e` failure prints a clean single-line
 * T-Lisp error (no JS stack trace). Spawns the real bin/tmaxclient.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TmaxServer } from "../../src/server/server.ts";

let tmp = "";
let socketPath = "";
let server: TmaxServer;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tmax-teval-"));
  socketPath = `${tmp}/server.sock`;
  server = new TmaxServer(socketPath, true);
  await server.start();
});
afterEach(async () => {
  await server.shutdown();
  await rm(tmp, { recursive: true, force: true });
});

// ASYNC spawn (not spawnSync) so the in-process daemon's event loop stays alive
// to service the child client's connection.
function runClient(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["bin/tmaxclient", "-s", socketPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", () => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: -1 }));
    child.on("exit", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1 }));
  });
}

test("tmax -e failing expr: one-line error, message present, no stack frames, exit 1 (#61 / BUG-39)", async () => {
  for (const [expr, needle] of [
    ['(+ "a" 1)', "requires numeric"],
    ["undefined-xyz-abc", "Undefined symbol"],
    ["(+ 1 2", "to close list"], // parse error
  ] as const) {
    const { stderr, code } = await runClient("--eval", expr);
    expect(code).toBe(1);
    expect(stderr.split("\n").length).toBe(1);   // clean single line
    expect(stderr).toContain(needle);            // the real T-Lisp message
    expect(stderr).not.toMatch(/\n\s*at /);      // no JS stack frames
  }
});

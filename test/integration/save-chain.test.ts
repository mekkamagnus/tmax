/**
 * @file save-chain.test.ts
 * @description BUG-43 / #49 — the T-Lisp save chain works end-to-end:
 * save-buffer writes the buffer to disk; quick-save/save-file resolve;
 * set-buffer-modified-p accepts nil.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { connect } from "net";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TmaxServer } from "../../src/server/server.ts";

async function rpc(socketPath: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`RPC timed out: ${method}`)); }, 5000);
    let buf = "";
    socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n"));
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf("\n");
      if (nlIdx === -1) return;
      clearTimeout(timer); socket.destroy();
      const response = JSON.parse(buf.slice(0, nlIdx));
      if (response.error) reject(new Error(response.error.message)); else resolve(response.result);
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

let tmp = "";
let socketPath = "";
let server: TmaxServer;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tmax-save-"));
  socketPath = `${tmp}/server.sock`;
  server = new TmaxServer(socketPath, true);
  await server.start();
});
afterEach(async () => {
  await server.shutdown();
  await rm(tmp, { recursive: true, force: true });
});

test("save-buffer writes the buffer to disk (#49 / BUG-43)", async () => {
  const path = join(tmp, "saved.txt");
  await rpc(socketPath, "eval", { code: '(buffer-insert "savechain-marker-12345")' });
  await rpc(socketPath, "eval", { code: `(save-buffer "${path}")` });
  const written = await readFile(path, "utf-8");
  expect(written).toContain("savechain-marker-12345");
});

test("quick-save / save-file resolve (no Undefined symbol) (#49 / BUG-43)", async () => {
  // save-file takes a path; quick-save uses the associated file. Both must resolve.
  await rpc(socketPath, "eval", { code: `(save-file "${join(tmp, "sf.txt")}")` });
  // quick-save after save-file set the associated filename -> saves there.
  await rpc(socketPath, "eval", { code: "(quick-save)" });
  expect(await readFile(join(tmp, "sf.txt"), "utf-8")).toBeDefined();
});

test("set-buffer-modified-p nil works (was: requires a boolean) (#49 / BUG-43)", async () => {
  // Must not reject with "requires a boolean for argument at position 1".
  await rpc(socketPath, "eval", { code: "(set-buffer-modified-p nil)" });
});

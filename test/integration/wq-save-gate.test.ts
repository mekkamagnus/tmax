/**
 * @file wq-save-gate.test.ts
 * @description BUG-44 / #50 — :w (and :wq's save step) persist the buffer
 * SYNCHRONOUSLY before any quit, via save-buffer (was fire-and-forget file-save).
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
  tmp = await mkdtemp(join(tmpdir(), "tmax-wq-"));
  socketPath = `${tmp}/server.sock`;
  server = new TmaxServer(socketPath, true);
  await server.start();
});
afterEach(async () => {
  await server.shutdown();
  await rm(tmp, { recursive: true, force: true });
});

test(":w via command-line dispatch persists the buffer synchronously (#50 / BUG-44)", async () => {
  const path = join(tmp, "wq-gate.txt");
  await rpc(socketPath, "eval", { code: `(set-buffer-filename "${path}")` });
  await rpc(socketPath, "eval", { code: '(buffer-insert "wq-gate-marker-99")' });
  // :w dispatch -> save-buffer (sync) -> file written BEFORE this RPC returns.
  await rpc(socketPath, "eval", { code: '(editor-dispatch-command-line "w")' });
  const written = await readFile(path, "utf-8");
  expect(written).toContain("wq-gate-marker-99");
});

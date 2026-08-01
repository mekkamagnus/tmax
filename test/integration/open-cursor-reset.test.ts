/**
 * @file open-cursor-reset.test.ts
 * @description BUG-37 / #55 — RPC open() must reset the cursor to origin so the
 * first insert after open does not throw 'Line N is out of bounds'.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { connect } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TmaxServer } from "../../src/server/server.ts";

async function rpc(socketPath: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`RPC timed out: ${method}`));
    }, 5000);
    let buf = "";
    socket.on("connect", () => {
      socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n");
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf("\n");
      if (nlIdx === -1) return;
      clearTimeout(timer);
      socket.destroy();
      const response = JSON.parse(buf.slice(0, nlIdx));
      if (response.error) reject(new Error(response.error.message));
      else resolve(response.result);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tmax-open-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("open() resets cursor to origin — insert after open does not throw 'out of bounds' (#55 / BUG-37)", async () => {
  const socketPath = `/tmp/tmax-open-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  try {
    await server.start();

    const multiline = join(tmp, "multi.txt");
    await writeFile(multiline, "line0\nline1\nline2\nline3\n");
    const fresh = join(tmp, "fresh.txt");

    // Open the multi-line file, move the cursor deep, then open a NEW empty file.
    await rpc(socketPath, "open", { filepath: multiline });
    await rpc(socketPath, "eval", { code: "(cursor-move 3 5)" });
    await rpc(socketPath, "open", { filepath: fresh });

    // render-state after open: cursor MUST be at origin (0,0 internal / 1,1 display).
    const state = await rpc(socketPath, "render-state", {});
    expect(state.cursorPosition.line).toBe(0);
    expect(state.cursorPosition.column).toBe(0);

    // First insert after open MUST succeed (previously: -32010 'Line 3 is out of bounds (0-0)').
    const ins = await rpc(socketPath, "insert", { text: "hello" });
    expect(ins).toBeDefined();
  } finally {
    await server.shutdown();
  }
});

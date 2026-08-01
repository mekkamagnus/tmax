/**
 * @file init-file-daemon.test.ts
 * @description BUG-38 / #56 — --init-file is honored in daemon mode: a defvar
 * authored in the custom init file is live via the eval RPC.
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
let prevHome: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tmax-initfile-"));
  prevHome = process.env.HOME;
  process.env.HOME = tmp;  // isolate so the default-init path finds nothing
});
afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  await rm(tmp, { recursive: true, force: true });
});

test("--init-file is honored in daemon mode — a defvar from the init file is live (#56 / BUG-38)", async () => {
  const socketPath = `/tmp/tmax-initfile-${process.pid}-${Date.now()}.sock`;
  const cfg = join(tmp, "init.tlisp");
  await writeFile(cfg, '(defvar tmax-init-marker "custom-cfg-loaded")\n');

  // Boot the daemon with the custom init file path threaded through TmaxServer.
  const server = new TmaxServer(socketPath, true, undefined, cfg);
  try {
    await server.start();
    // Bare symbol reference reads the variable's value (parens would CALL it).
    const marker = await rpc(socketPath, "eval", { code: "tmax-init-marker" });
    // The defvar from the init file is live -> the init file was loaded (not the default).
    expect(String(marker)).toContain("custom-cfg-loaded");
  } finally {
    await server.shutdown();
  }
});

test("without --init-file the marker is absent (default init does not define it)", async () => {
  const socketPath = `/tmp/tmax-initfile-none-${process.pid}-${Date.now()}.sock`;
  // No initFilePath -> default init file (isolated HOME has none) -> marker undefined.
  const server = new TmaxServer(socketPath, true);
  try {
    await server.start();
    await expect(rpc(socketPath, "eval", { code: "tmax-init-marker" })).rejects.toBeDefined();
  } finally {
    await server.shutdown();
  }
});

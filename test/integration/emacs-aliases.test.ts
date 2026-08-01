/**
 * @file emacs-aliases.test.ts
 * @description BUG-45 / #51 — Emacs-conventional aliases resolve to the working
 * primitives and produce the correct side effects.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { connect } from "net";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
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
  tmp = await mkdtemp(join(tmpdir(), "tmax-aliases-"));
  socketPath = `${tmp}/server.sock`;
  server = new TmaxServer(socketPath, true);
  await server.start();
});
afterEach(async () => {
  await server.shutdown();
  await rm(tmp, { recursive: true, force: true });
});

test("buffer-name / current-buffer-name return the current buffer name (#51 / BUG-45)", async () => {
  const name = await rpc(socketPath, "eval", { code: "(buffer-name)" });
  expect(String(name).length).toBeGreaterThan(0); // returns a non-empty buffer name
  const name2 = await rpc(socketPath, "eval", { code: "(current-buffer-name)" });
  expect(name2).toEqual(name); // same result
});

test("switch-to-buffer switches to a named buffer (#51 / BUG-45)", async () => {
  await rpc(socketPath, "eval", { code: '(switch-to-buffer "*scratch*")' });
  const name = await rpc(socketPath, "eval", { code: "(buffer-name)" });
  expect(String(name)).toContain("scratch");
});

test("open-file opens a file (#51 / BUG-45)", async () => {
  const fp = join(tmp, "alias-test.txt");
  await writeFile(fp, "alias-content");
  await rpc(socketPath, "eval", { code: `(open-file "${fp}")` });
  // The buffer for the file should now exist + contain its content.
  const text = await rpc(socketPath, "eval", { code: "(buffer-text)" });
  expect(String(text)).toContain("alias-content");
});

test("save-file persists the buffer (#51 / BUG-45)", async () => {
  const fp = join(tmp, "alias-save.txt");
  await rpc(socketPath, "eval", { code: `(set-buffer-filename "${fp}")` });
  await rpc(socketPath, "eval", { code: '(buffer-insert "alias-save-marker")' });
  await rpc(socketPath, "eval", { code: `(save-file "${fp}")` });
  const written = await readFile(fp, "utf-8");
  expect(written).toContain("alias-save-marker");
});

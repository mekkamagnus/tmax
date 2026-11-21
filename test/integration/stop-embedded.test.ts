import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import Net from "node:net";

/**
 * @file stop-embedded.e2e.ts
 * @description #276 — the ORIGINAL repro, live: an EMBEDDED tmax session
 * holds the standard socket; `tmax --stop` must REFUSE to stop it (the
 * embedded row, exit 1) and the session must remain USABLE afterwards
 * (an eval round-trip through the still-listening socket — the "type"
 * half of the criterion; the quit half is the embedded process exiting
 * cleanly on its own stdin 'q', driven here through its stdio).
 *
 * Skips (with a clear message) when the standard socket is held by
 * ANOTHER process — the embedded path binds the FIXED socket
 * (#276's premise), so a concurrent daemon makes this test
 * unrunnable rather than failed.
 */

const REPO = join(import.meta.dir, "..", "..");
const SOCKET = `/tmp/tmax-${userInfo().uid}/server`;

function socketHeldByOther(): boolean {
  return existsSync(SOCKET);
}

function rpc(socket: string, method: string, params: object, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = Net.connect(socket);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, timeoutMs);
    sock.on("connect", () => sock.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n"));
    sock.on("data", (d) => {
      clearTimeout(timer);
      sock.destroy();
      try { resolve(JSON.parse(d.toString())); } catch (e) { reject(e); }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

describe("#276 e2e — embedded session survives --stop (the original repro)", () => {
  let child: ChildProcess | null = null;
  let dir: string;
  let hadForeignSocket: boolean;

  beforeAll(() => {
    hadForeignSocket = socketHeldByOther();
    if (hadForeignSocket) return;
    dir = mkdtempSync(join(tmpdir(), "i276-"));
    writeFileSync(join(dir, "note.txt"), "embedded session\n");
  });
  afterAll(() => {
    if (child?.exitCode === null) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
    if (!hadForeignSocket && dir!) rmSync(dir, { recursive: true, force: true });
  });

  test.skipIf(socketHeldByOther())("identity: embedded mode + pid; --stop refuses; session still usable; quits cleanly", async () => {
    // 1) Launch the EMBEDDED editor on the standard socket.
    child = spawn("bun", ["src/main.ts", join(dir!, "note.txt")], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
    // Wait for the socket to appear (the fire-and-forget startSocket).
    const deadline = Date.now() + 10000;
    while (!existsSync(SOCKET) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(SOCKET)).toBe(true);

    // 2) The identity RPC answers EMBEDDED + the process's pid.
    const ident = await rpc(SOCKET, "server-identity", {}) as { result?: { mode?: string; pid?: number } };
    expect(ident?.result?.mode).toBe("embedded");
    expect(ident?.result?.pid).toBe(child.pid);

    // 3) `tmax --stop` refuses: the embedded row, exit 1.
    const stop = spawnSync("bun", ["src/main.ts", "--stop"], { cwd: REPO, encoding: "utf8", timeout: 15000 });
    expect(stop.stdout ?? "").toContain("embedded tmax session running (not stopped)");
    expect(stop.status).toBe(1);

    // 3b) The SERVER-side gate: a RAW shutdown RPC (any direct client)
    //     is REFUSED for embedded — ok:false, and the session survives.
    const rawStop = await rpc(SOCKET, "shutdown", {}) as { result?: { ok?: boolean; reason?: string } };
    expect(rawStop?.result?.ok).toBe(false);
    expect(rawStop?.result?.reason).toBe("embedded");

    // 4) The session is STILL USABLE: the identity RPC still answers.
    const ident2 = await rpc(SOCKET, "server-identity", {}) as { result?: { mode?: string } };
    expect(ident2?.result?.mode).toBe("embedded");
    // And the "type" half: a keypress round-trips through the socket.
    const kp = await rpc(SOCKET, "keypress", { key: "l" }) as { result?: { mode?: string } };
    expect(kp?.result).toBeDefined();

    // 5) The quit half: ':q<CR> THROUGH THE SOCKET — the channel a real
    //    client types through (the documented quit; plain q is the
    //    macro-record prefix) — triggers the editor's quit path → exit 0.
    //    stdin is ended AFTER, so the exit attributes to the keys.
    await rpc(SOCKET, "keypress", { key: ":" });
    await rpc(SOCKET, "keypress", { key: "q" });
    await rpc(SOCKET, "keypress", { key: "Enter" });
    child.stdin!.end();
    const exitDeadline = Date.now() + 8000;
    while (child.exitCode === null && Date.now() < exitDeadline) await new Promise((r) => setTimeout(r, 100));
    expect(child.exitCode).toBe(0);
  }, 30000);
});

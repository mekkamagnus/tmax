import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Net from "node:net";
import { realStopDeps } from "../../src/cli/stop-sequence-deps.ts";

/**
 * @file stop-sequence-deps.test.ts
 * @description #276 — DIRECT adapter coverage (the landing gate's root
 * cause: every prior round mocked StopDeps, so the live lsof bug — the
 * ORed selection listing every unix-socket holder — survived four green
 * rounds). REAL sockets, NO mocks: two listeners, and pidsOnSocket must
 * return EXACTLY the asked socket's holder (the -a intersection).
 */

const sockets: string[] = [];
const servers: Net.Server[] = [];

function listen(path: string): Promise<Net.Server> {
  return new Promise((resolve, reject) => {
    const s = Net.createServer(() => {});
    s.on("error", reject);
    s.listen(path, () => resolve(s));
  });
}

afterAll(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  for (const p of sockets) { try { rmSync(p); } catch { /* gone */ } }
});

describe("#276 — the REAL adapter (no mocks)", () => {
  test("pidsOnSocket returns EXACTLY the asked socket's holder (the -a intersection; another unix socket present)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "i276d-"));
    const sockA = join(dir, "a.sock");
    const sockB = join(dir, "b.sock");
    sockets.push(sockA, sockB);
    const serverA = await listen(sockA);
    const serverB = await listen(sockB); // the NOISE holder
    servers.push(serverA, serverB);
    const deps = realStopDeps(sockA);
    const pids = deps.pidsOnSocket();
    expect(pids).not.toBeNull();
    // EXACTLY ONE pid — the holder of A (the pre-fix OR form listed B's
    // holder too: the exactly-one check always failed → step 5 dead).
    expect(pids!.length).toBe(1);
    expect(Number(pids![0])).toBe(process.pid); // our own listener
    rmSync(dir, { recursive: true, force: true });
  });

  test("socketExists/unlinkSocket round-trip on a real file; unlink failure reports false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "i276e-"));
    const sock = join(dir, "s.sock");
    sockets.push(sock);
    servers.push(await listen(sock));
    const deps = realStopDeps(sock);
    expect(deps.socketExists()).toBe(true);
    // A LIVE socket: unlink succeeds on most systems; the assertion that
    // MATTERS is the boolean contract (never claim removal on failure).
    const removed = deps.unlinkSocket();
    expect(typeof removed).toBe("boolean");
    expect(removed).toBe(!require("node:fs").existsSync(sock));
    rmSync(dir, { recursive: true, force: true });
  });
});

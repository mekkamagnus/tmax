import { describe, expect, test } from "bun:test";
import { Server, Socket } from "net";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { RemoteEditor } from "../../src/editor/remote-editor.ts";

describe("RemoteEditor response framing", () => {
  test("waits for and processes complete newline-delimited responses", async () => {
    const remote = new RemoteEditor("/tmp/not-used");
    const first = new Promise(resolve => {
      (remote as any).pending.set(1, { resolve, reject: () => undefined });
    });
    const second = new Promise(resolve => {
      (remote as any).pending.set(2, { resolve, reject: () => undefined });
    });

    (remote as any).onData(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"large":"'));
    expect((remote as any).pending.has(1)).toBe(true);

    (remote as any).onData(Buffer.from('value"}}\n{"jsonrpc":"2.0","id":2,"result":"done"}\n'));

    expect(await first).toEqual({ large: "value" });
    expect(await second).toBe("done");
    expect((remote as any).pending.size).toBe(0);
  });
});

describe("RemoteEditor socket-drop fail-fast (BUG-36 / #54)", () => {
  test("on socket close, isConnected -> false and sendRequest rejects FAST (no 30s hang)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tmax-re-"));
    const sockPath = join(dir, "s.sock");
    let clientSock: Socket | undefined;
    const server = new Server((c) => {
      clientSock = c;
      c.on("data", () => {});
      c.on("error", () => {});
    });
    await new Promise<void>((r) => server.listen(sockPath, r));

    const remote = new RemoteEditor(sockPath);
    await (remote as any).connect();
    expect(remote.isConnected).toBe(true);

    // Simulate the daemon dropping the connection (server side destroys it).
    // The RemoteEditor socket then emits 'close' -> onLost nulls this.socket.
    clientSock?.destroy();
    await new Promise<void>((r) => setTimeout(r, 150));
    expect(remote.isConnected).toBe(false);

    // A subsequent request must fail FAST via the !this.socket guard, not wait 30s.
    const t0 = Date.now();
    await expect((remote as any).sendRequest("ping", {})).rejects.toBeDefined();
    expect(Date.now() - t0).toBeLessThan(1500);

    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true });
  });
});

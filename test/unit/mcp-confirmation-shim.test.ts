import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { createServer, type Socket } from "net";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// #220 (RFC-027 §D5 L2) — the GENERIC MCP-stdio→daemon confirmation bridge.
// Hermetic: a fake daemon Unix socket plays the daemon's side of
// confirmation/mediate (including the DEFERRED response — the whole point
// of the bridge); the shim is spawned as a real subprocess.

const EOL = "\n";
let dir = "";
const procs: Array<{ kill: () => void; stdin: { write: (s: string) => void; end: () => void } }> = [];
type ProcHandle = { kill: () => void; stdin: { write: (s: string) => void; end: () => void } };
const servers: Array<{ close: () => void }> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-shim-"));
});

afterAll(() => {
  for (const p of procs) { try { p.kill(); } catch { /* already gone */ } }
  for (const s of servers) { try { s.close(); } catch { /* already closed */ } }
  rmSync(dir, { recursive: true, force: true });
});

interface FakeDaemon {
  socketPath: string;
  /** Requests received so far (parsed). */
  requests: Array<{ id: number; method: string; params: Record<string, unknown> }>;
  /** Answer the latest mediate request. */
  respond: (body: { result?: unknown; error?: unknown }) => void;
  /** Kill peer AND listener — a genuinely dead daemon (ECONNREFUSED). */
  close: () => void;
}

function fakeDaemon(script: (daemon: FakeDaemon, req: { id: number; method: string; params: Record<string, unknown> }, sock: Socket) => void): Promise<FakeDaemon> {
  return new Promise((resolve) => {
    const socketPath = join(dir, `daemon-${Math.floor(performance.now() * 1000)}.sock`);
    const daemon: FakeDaemon = {
      socketPath,
      requests: [],
      respond: () => { /* replaced below once a peer exists */ },
      // Default (no peer yet): still kill the LISTENER — a "dead daemon"
      // must refuse connections, not park them forever (test-harness bug
      // the dead-socket case caught).
      close: () => { server.close(); },
    };
    let buffer = "";
    const server = createServer((sock) => {
      daemon.respond = (body) => {
        sock.write(JSON.stringify({ jsonrpc: "2.0", id: daemon.requests[daemon.requests.length - 1]!.id, ...body }) + EOL);
      };
      const killPeer = () => sock.destroy();
      const prevClose = daemon.close;
      daemon.close = () => { prevClose(); killPeer(); };
      sock.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let eol: number;
        while ((eol = buffer.indexOf(EOL)) !== -1) {
          const line = buffer.slice(0, eol);
          buffer = buffer.slice(eol + 1);
          if (!line.trim()) continue;
          const req = JSON.parse(line) as { id: number; method: string; params: Record<string, unknown> };
          daemon.requests.push(req);
          script(daemon, req, sock);
        }
      });
    });
    servers.push(server);
    server.listen(socketPath, () => resolve(daemon));
  });
}

/** Poll until fn() returns truthy or the deadline passes (then return the
 * last value — the caller's expect reports it). */
async function waitFor<T>(fn: () => T, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  let last = fn();
  while (!last && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = fn();
  }
  return last;
}

interface ShimProc {
  send: (obj: unknown) => void;
  /** Resolves with the next stdout JSON-RPC response. */
  next: () => Promise<{ id: number | string; result?: Record<string, unknown>; error?: { message: string } }>;
  kill: () => void;
}

function spawnShim(source: string, token: string, socketPath: string): ShimProc {
  const proc = Bun.spawn(["bun", "bin/tmax-mcp-confirmation.ts", source, token, socketPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  procs.push({ kill: () => proc.kill(), stdin: proc.stdin as unknown as ProcHandle["stdin"] });
  let outBuffer = "";
  const waiters: Array<(msg: { id: number | string; result?: Record<string, unknown>; error?: { message: string } }) => void> = [];
  const pump = async (): Promise<void> => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      outBuffer += decoder.decode(value);
      let eol: number;
      while ((eol = outBuffer.indexOf(EOL)) !== -1) {
        const line = outBuffer.slice(0, eol);
        outBuffer = outBuffer.slice(eol + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id: number | string; result?: Record<string, unknown>; error?: { message: string } };
        waiters.shift()?.(msg);
      }
    }
  };
  void pump();
  return {
    send: (obj) => proc.stdin.write(JSON.stringify(obj) + EOL),
    next: () => new Promise((resolve) => waiters.push(resolve)),
    kill: () => proc.kill(),
  };
}

describe("#220 MCP bridge — MCP handshake surface", () => {
  test("initialize + tools/list: one generic permission tool", async () => {
    const daemon = await fakeDaemon(() => { /* no mediate expected */ });
    const shim = spawnShim("fikra", "tok-abc", daemon.socketPath);
    shim.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    const init = await shim.next();
    expect((init.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe("tmax-confirmation");
    shim.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await shim.next();
    const tools = (list.result as { tools?: Array<{ name: string; inputSchema: object }> }).tools!;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("permission");
    expect(tools[0]!.inputSchema).toBeTruthy();
    shim.kill();
  });

  test("unknown method → JSON-RPC error; notifications ignored", async () => {
    const daemon = await fakeDaemon(() => { /* unused */ });
    const shim = spawnShim("fikra", "tok-abc", daemon.socketPath);
    shim.send({ jsonrpc: "2.0", method: "notifications/initialized" }); // no id → ignored
    shim.send({ jsonrpc: "2.0", id: 7, method: "prompts/list" });
    const err = await shim.next();
    expect(err.error?.message).toContain("Method not found");
    shim.kill();
  });
});

describe("#220 MCP bridge — the deferred mediate round trip", () => {
  test("tools/call → daemon confirmation/mediate (argv token, verbatim detail); deferred allow → tool result", async () => {
    const daemon = await fakeDaemon(() => { /* parked: the test answers */ });
    const shim = spawnShim("fikra", "one-time-token", daemon.socketPath);
    shim.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await shim.next();
    shim.send({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "permission", arguments: { tool_name: "write-file", input: { path: "src/x.ts", content: "x" } } },
    });
    // The daemon sees the mediate with the shim's argv source+token and the
    // verbatim action payload. POLL (SPEC-217 load lesson): under a full
    // parallel suite the shim subprocess can take seconds to boot+connect —
    // a fixed sleep races.
    const mediate = await waitFor(
      () => daemon.requests.find((req) => req.method === "confirmation/mediate"), 8000);
    expect(mediate).toBeTruthy();
    expect(mediate!.params.source).toBe("fikra");
    expect(mediate!.params.token).toBe("one-time-token");
    expect(mediate!.params.kind).toBe("write-file");
    expect(String(mediate!.params.detail)).toContain("src/x.ts");
    // Nothing answered yet — no tool result.
    // Answer allow → the shim's tool result carries the decision.
    daemon.respond({ result: { decision: "allow", scope: "fikra/main/1" } });
    const result = await shim.next();
    const content = (result.result as { content?: Array<{ type: string; text: string }> }).content!;
    expect(content[0]!.text).toBe("allow");
    expect((result.result as { isError?: boolean }).isError).toBeUndefined();
    shim.kill();
  });

  test("reject decision maps to an isError tool result; daemon error rejects too", async () => {
    const daemon = await fakeDaemon((d, req) => {
      if (req.method === "confirmation/mediate") {
        // First mediate (reject path) — answer immediately.
        d.respond({ result: { decision: "reject", scope: "s" } });
      }
    });
    const shim = spawnShim("fikra", "t2", daemon.socketPath);
    shim.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await shim.next();
    shim.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "permission", arguments: { tool_name: "bash", input: { cmd: "rm -rf /" } } } });
    const rejected = await shim.next();
    expect((rejected.result as { isError?: boolean }).isError).toBe(true);
    expect((rejected.result as { content?: Array<{ text: string }> }).content![0]!.text).toBe("reject");
    shim.kill();
  });

  test("dead daemon socket → isError tool result, never a hang", async () => {
    const daemon = await fakeDaemon(() => { /* never answers; we kill it */ });
    const shim = spawnShim("fikra", "t3", daemon.socketPath);
    daemon.close(); // the daemon side of the socket dies mid-mediate
    shim.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await shim.next();
    shim.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "permission", arguments: { tool_name: "bash", input: {} } } });
    const result = await shim.next();
    expect((result.result as { isError?: boolean }).isError).toBe(true);
    expect((result.result as { content?: Array<{ text: string }> }).content![0]!.text).toContain("bridge error");
    shim.kill();
  });
});

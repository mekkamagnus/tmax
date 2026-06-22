import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connectWithTimeout, forceShutdown, sweepTestSockets } from "../fixtures/server-test-helpers.ts";
import { TmaxServer } from "../../src/server/server.ts";

const SERVER_CLIENT_TIMEOUT_MS = 20000;

async function ping(socketPath: string): Promise<Record<string, unknown>> {
  const socket = await connectWithTimeout(socketPath);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Ping timed out"));
    }, 5000);

    socket.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {},
    }) + "\n");
    socket.on("data", data => {
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(data.toString().trim()) as Record<string, unknown>);
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("Server client", () => {
  let server: TmaxServer | null = null;
  let socketPath: string;

  beforeEach(() => {
    sweepTestSockets();
    socketPath = `/tmp/tmax-server-client-${process.pid}-${Date.now()}.sock`;
  });

  afterEach(async () => {
    await forceShutdown(server);
    server = null;
  }, SERVER_CLIENT_TIMEOUT_MS);

  test("starts and accepts clients on an isolated socket", async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();
    const response = await ping(socketPath);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  }, SERVER_CLIENT_TIMEOUT_MS);
});

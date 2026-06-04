import { expect, test } from "bun:test";
import { connect } from "net";
import { TmaxServer } from "../../src/server/server.ts";

async function ping(socketPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Ping timed out"));
    }, 5000);

    socket.on("connect", () => {
      socket.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {},
      }) + "\n");
    });
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

test("starts and accepts clients on an isolated socket", async () => {
  const socketPath = `/tmp/tmax-server-client-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);

  try {
    await server.start();
    const response = await ping(socketPath);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  } finally {
    await server.shutdown();
  }
});

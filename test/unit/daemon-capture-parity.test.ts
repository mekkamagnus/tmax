/**
 * @file daemon-capture-parity.test.ts
 * @description Daemon parity tests verifying that the daemon's `capture` JSON-RPC method
 * produces valid output. Starts a daemon, connects, opens a file, captures, and validates.
 */

import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { Socket } from "net";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { connectWithTimeout, sweepTestSockets } from "../fixtures/server-test-helpers.ts";

const SOCKET = `/tmp/tmax-capture-parity-${process.pid}.sock`;
let daemonProcess: Subprocess | null = null;
let requestId = 0;

function sendRpc(socket: Socket, method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n";
    let buf = "";

    const handler = (data: Buffer) => {
      buf += data.toString();
      // Try to find our response
      const lines = buf.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.id === id) {
            socket.removeListener("data", handler);
            if (resp.error) reject(new Error(resp.error.message));
            else resolve(resp.result);
            return;
          }
        } catch {
          // incomplete JSON, keep buffering
        }
      }
    };

    socket.on("data", handler);
    socket.write(msg);

    // Timeout after 10s
    setTimeout(() => {
      socket.removeListener("data", handler);
      reject(new Error(`Timeout waiting for ${method} response`));
    }, 10000);
  });
}

function connectSocket(path: string): Promise<Socket> {
  return connectWithTimeout(path);
}

async function waitForSocket(path: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (existsSync(path)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Socket ${path} never appeared`);
}

describe("Daemon capture parity", () => {
  let sock: Socket;
  let homeDir: string;
  let previousHome: string | undefined;
  let previousWorkspaceDir: string | undefined;

  beforeAll(async () => {
    // Clean up stale socket
    if (existsSync(SOCKET)) unlinkSync(SOCKET);
    sweepTestSockets();
    homeDir = mkdtempSync(join(tmpdir(), "tmax-capture-home-"));
    previousHome = process.env.HOME;
    previousWorkspaceDir = process.env.TMAX_WORKSPACE_DIR;

    daemonProcess = spawn({
      cmd: ["bun", "src/main.ts", "--daemon"],
      env: {
        ...process.env,
        HOME: homeDir,
        TMAX_WORKSPACE_DIR: join(homeDir, ".config", "tmax", "workspaces"),
        TMAX_SOCKET: SOCKET,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    await waitForSocket(SOCKET);
    sock = await connectSocket(SOCKET);
  }, 15000);

  afterAll(() => {
    sock?.destroy();
    const proc = daemonProcess;
    if (proc) {
      try { proc.kill("SIGTERM"); } catch {}
      // Give the daemon a moment to shut down gracefully, then force-kill
      // to defend against a wedged process that ignores SIGTERM.
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 500);
      daemonProcess = null;
    }
    if (existsSync(SOCKET)) {
      try { unlinkSync(SOCKET); } catch {}
    }
    sweepTestSockets();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousWorkspaceDir === undefined) delete process.env.TMAX_WORKSPACE_DIR;
    else process.env.TMAX_WORKSPACE_DIR = previousWorkspaceDir;
    try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  test("daemon capture returns ANSI lines with syntax colors", async () => {
    // Register as a frame first
    const frameResult = await sendRpc(sock, "connect-frame", {
      clientType: "tui",
      clientName: "test-parity",
    });
    expect(frameResult.frameId).toBeDefined();

    // Open a tlisp file
    await sendRpc(sock, "open", {
      filepath: "src/tlisp/core/completion/minibuffer.tlisp",
    });

    // Send a render-state to sync
    await sendRpc(sock, "render-state", { frameId: frameResult.frameId });

    // Capture ANSI
    const result = await sendRpc(sock, "capture", { format: "ansi" });
    expect(result.lines).toBeDefined();
    expect(Array.isArray(result.lines)).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);

    // The output should contain ANSI escape codes
    const hasAnsi = result.lines.some((l: string) => l.includes("\x1b["));
    expect(hasAnsi).toBe(true);
  });

  test("daemon capture-html produces valid HTML with colors", async () => {
    const result = await sendRpc(sock, "capture", { format: "html" });
    expect(result.html).toBeDefined();
    expect(typeof result.html).toBe("string");
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("#282c34"); // One Dark background
    // Should have color spans
    expect(result.html).toMatch(/rgb\(\d+,\d+,\d+\)/);
  });

  test("daemon capture ANSI output contains syntax highlighting codes", async () => {
    const result = await sendRpc(sock, "capture", { format: "ansi" });
    // Since minibuffer.tlisp has defun/defvar keywords, comments, and strings,
    // the output should have 24-bit color codes for these
    const allText = result.lines.join("");
    // Keyword purple
    expect(allText).toContain("38;2;198;120;221");
    // Comment dim gray
    expect(allText).toContain("38;2;92;99;112");
  });
});

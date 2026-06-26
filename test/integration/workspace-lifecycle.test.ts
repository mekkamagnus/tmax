import { afterEach, beforeEach, expect, test } from "bun:test";
import { connect, Socket } from "net";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TmaxServer } from "../../src/server/server.ts";
import { TaskEither } from "../../src/utils/task-either.ts";

let workspaceDir = "";
let homeDir = "";
let previousWorkspaceDir: string | undefined;
let previousHome: string | undefined;
const WORKSPACE_TEST_TIMEOUT_MS = 15_000;

beforeEach(async () => {
  previousWorkspaceDir = process.env.TMAX_WORKSPACE_DIR;
  previousHome = process.env.HOME;
  workspaceDir = await mkdtemp(join(tmpdir(), "tmax-workspaces-"));
  homeDir = await mkdtemp(join(tmpdir(), "tmax-home-"));
  process.env.TMAX_WORKSPACE_DIR = workspaceDir;
  process.env.HOME = homeDir;
});

afterEach(async () => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.TMAX_WORKSPACE_DIR;
  } else {
    process.env.TMAX_WORKSPACE_DIR = previousWorkspaceDir;
  }
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

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
    socket.on("data", chunk => {
      buf += chunk.toString();
      // I9: accumulate until we have a complete newline-delimited response
      const nlIdx = buf.indexOf("\n");
      if (nlIdx === -1) return;
      clearTimeout(timer);
      socket.destroy();
      const response = JSON.parse(buf.slice(0, nlIdx));
      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function connectFrame(socketPath: string, workspaceId?: string): Promise<{ socket: Socket; frameId: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect-frame timed out"));
    }, 5000);
    let buf = "";
    socket.on("connect", () => {
      socket.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "connect-frame",
        params: { clientType: "test", ...(workspaceId ? { workspaceId } : {}) },
      }) + "\n");
    });
    socket.on("data", chunk => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf("\n");
      if (nlIdx === -1) return;
      clearTimeout(timer);
      const response = JSON.parse(buf.slice(0, nlIdx));
      if (response.error) {
        socket.destroy();
        reject(new Error(response.error.message));
      } else {
        resolve({ socket, frameId: response.result.frameId });
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2000, intervalMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value: T | undefined;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value !== undefined) return value;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

test("workspace lifecycle isolates buffers and persists through daemon restart", async () => {
  const socketPath = `/tmp/tmax-workspace-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();

    await rpc(socketPath, "workspace-new", { name: "project_a" });
    await rpc(socketPath, "workspace-new", { name: "project_b" });

    const frameA = await connectFrame(socketPath, "project_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", {
      frameId: frameA.frameId,
      code: '(buffer-create "a.txt")',
    });

    const frameB = await connectFrame(socketPath, "project_b");
    frameSockets.push(frameB.socket);
    await rpc(socketPath, "eval", {
      frameId: frameB.frameId,
      code: '(buffer-create "b.txt")',
    });

    const buffersA = await rpc(socketPath, "command", { frameId: frameA.frameId, command: "list-buffers" });
    const buffersB = await rpc(socketPath, "command", { frameId: frameB.frameId, command: "list-buffers" });
    expect(buffersA).toContain("a.txt");
    expect(buffersA).not.toContain("b.txt");
    expect(buffersB).toContain("b.txt");
    expect(buffersB).not.toContain("a.txt");

    await rpc(socketPath, "workspace-save", { name: "project_a" });
    await rpc(socketPath, "workspace-save", { name: "project_b" });
    await server.shutdown();

    const restarted = new TmaxServer(socketPath, true);
    try {
      await restarted.start();
      const restored = await rpc(socketPath, "workspace-load", { name: "project_a" });
      expect(restored.success).toBe(true);
      const frameRestored = await connectFrame(socketPath, "project_a");
      frameSockets.push(frameRestored.socket);
      const restoredBuffers = await rpc(socketPath, "command", {
        frameId: frameRestored.frameId,
        command: "list-buffers",
      });
      expect(restoredBuffers).toContain("a.txt");
    } finally {
      await restarted.shutdown();
    }
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("corrupt workspace file recovers from backup", async () => {
  const socketPath = `/tmp/tmax-workspace-recover-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "recover_me" });
    await rpc(socketPath, "workspace-save", { name: "recover_me" });
    await writeFile(join(workspaceDir, "recover_me.json"), "not-json", "utf8");

    const result = await rpc(socketPath, "workspace-load", { name: "recover_me" });
    expect(result.success).toBe(true);
  } finally {
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("frame edits remap to the current workspace buffer after reactivation", async () => {
  const socketPath = `/tmp/tmax-workspace-frame-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "project_a" });
    await rpc(socketPath, "workspace-new", { name: "project_b" });

    const frameA = await connectFrame(socketPath, "project_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "a.txt") (buffer-switch "a.txt"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "A" });

    const frameB = await connectFrame(socketPath, "project_b");
    frameSockets.push(frameB.socket);
    await rpc(socketPath, "eval", { frameId: frameB.frameId, code: '(progn (buffer-create "b.txt") (buffer-switch "b.txt"))' });
    await rpc(socketPath, "insert", { frameId: frameB.frameId, text: "B" });

    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "!" });
    const buffersA = await rpc(socketPath, "query", { frameId: frameA.frameId, query: "buffers" });
    const aBuffer = buffersA.find((buffer: any) => buffer.name === "a.txt");
    expect(aBuffer.content).toBe("A!");
    expect(buffersA.map((buffer: any) => buffer.name)).not.toContain("b.txt");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("explicit workspaceId overrides active frame workspace without rebinding the frame", async () => {
  const socketPath = `/tmp/tmax-workspace-override-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "override_a" });
    await rpc(socketPath, "workspace-new", { name: "override_b" });

    const frameA = await connectFrame(socketPath, "override_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "a.txt") (buffer-switch "a.txt"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "A" });

    await rpc(socketPath, "eval", {
      frameId: frameA.frameId,
      workspaceId: "override_b",
      code: '(progn (buffer-create "b.txt") (buffer-switch "b.txt"))',
    });
    await rpc(socketPath, "insert", {
      frameId: frameA.frameId,
      workspaceId: "override_b",
      text: "B",
    });

    const buffersA = await rpc(socketPath, "query", { frameId: frameA.frameId, query: "buffers" });
    expect(buffersA.map((buffer: any) => buffer.name)).toContain("a.txt");
    expect(buffersA.map((buffer: any) => buffer.name)).not.toContain("b.txt");

    const defaultBuffers = await rpc(socketPath, "query", { query: "buffers" });
    expect(defaultBuffers.map((buffer: any) => buffer.name)).toContain("a.txt");
    expect(defaultBuffers.map((buffer: any) => buffer.name)).not.toContain("b.txt");

    const frameB = await connectFrame(socketPath, "override_b");
    frameSockets.push(frameB.socket);
    const buffersB = await rpc(socketPath, "query", { frameId: frameB.frameId, query: "buffers" });
    const bBuffer = buffersB.find((buffer: any) => buffer.name === "b.txt");
    expect(bBuffer.content).toBe("B");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("inactive workspace frame render-state uses its own window metadata", async () => {
  const socketPath = `/tmp/tmax-workspace-render-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "project_a" });
    await rpc(socketPath, "workspace-new", { name: "project_b" });

    const frameA = await connectFrame(socketPath, "project_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "a.txt") (buffer-switch "a.txt"))' });
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(split-window "horizontal")' });

    const frameB = await connectFrame(socketPath, "project_b");
    frameSockets.push(frameB.socket);
    await rpc(socketPath, "eval", { frameId: frameB.frameId, code: '(progn (buffer-create "b.txt") (buffer-switch "b.txt"))' });

    const renderA = await rpc(socketPath, "render-state", { frameId: frameA.frameId });
    const windowNames = renderA.windows.map((window: any) => window.bufferName);
    expect(windowNames).toContain("a.txt");
    expect(windowNames).not.toContain("b.txt");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("connect-frame with explicit workspace persists last-workspace", async () => {
  const socketPath = `/tmp/tmax-workspace-last-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "remember_me" });
    const frame = await connectFrame(socketPath, "remember_me");
    frameSockets.push(frame.socket);

    const lastWorkspace = await readFile(join(homeDir, ".config", "tmax", "last-workspace"), "utf8");
    expect(lastWorkspace.trim()).toBe("remember_me");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-kill requires confirmation when target has modified buffers", async () => {
  const socketPath = `/tmp/tmax-workspace-kill-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "dirty_ws" });
    const frame = await connectFrame(socketPath, "dirty_ws");
    frameSockets.push(frame.socket);
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(progn (buffer-create "dirty.txt") (buffer-switch "dirty.txt"))' });
    await rpc(socketPath, "insert", { frameId: frame.frameId, text: "dirty" });
    await rpc(socketPath, "workspace-switch", { frameId: frame.frameId, name: "default" });

    const blocked = await rpc(socketPath, "workspace-kill", { name: "dirty_ws" });
    expect(blocked.success).toBe(false);
    expect(blocked.confirmationRequired).toBe(true);
    expect(blocked.dirtyBuffers).toContain("dirty.txt");

    const confirmed = await rpc(socketPath, "workspace-kill", { name: "dirty_ws", confirm: true });
    expect(confirmed.success).toBe(true);
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("debounced auto-save persists dirty workspace content", async () => {
  const previousDebounce = process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
  const previousAutoSave = process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
  process.env.TMAX_WORKSPACE_DEBOUNCE_MS = "20";
  process.env.TMAX_WORKSPACE_AUTOSAVE_MS = "1000";
  const socketPath = `/tmp/tmax-workspace-autosave-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "auto_ws" });
    const frame = await connectFrame(socketPath, "auto_ws");
    frameSockets.push(frame.socket);
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(progn (buffer-create "auto.txt") (buffer-switch "auto.txt"))' });
    await rpc(socketPath, "insert", { frameId: frame.frameId, text: "autosaved" });

    // Auto-save is debounced + writes JSON to disk; under full-suite CPU load the
    // default 2s waitFor budget is too tight. Poll up to 10s (integration test).
    const autoBuffer = await waitFor(async () => {
      const data = JSON.parse(await readFile(join(workspaceDir, "auto_ws.json"), "utf8"));
      const buffer = data.buffers.find((item: any) => item.name === "auto.txt");
      return buffer?.content === "autosaved" ? buffer : undefined;
    }, 10000);
    expect(autoBuffer.content).toBe("autosaved");
    expect(autoBuffer.modified).toBe(false);

    const restartedSocketPath = `/tmp/tmax-workspace-autosave-restart-${process.pid}-${Date.now()}.sock`;
    const restarted = new TmaxServer(restartedSocketPath, true);
    try {
      await restarted.start();
      await rpc(restartedSocketPath, "workspace-load", { name: "auto_ws" });
      const restoredFrame = await connectFrame(restartedSocketPath, "auto_ws");
      frameSockets.push(restoredFrame.socket);
      const buffers = await rpc(restartedSocketPath, "query", { frameId: restoredFrame.frameId, query: "buffers" });
      const restoredBuffer = buffers.find((buffer: any) => buffer.name === "auto.txt");
      expect(restoredBuffer.content).toBe("autosaved");
    } finally {
      await restarted.shutdown();
    }
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
    if (previousDebounce === undefined) delete process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
    else process.env.TMAX_WORKSPACE_DEBOUNCE_MS = previousDebounce;
    if (previousAutoSave === undefined) delete process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
    else process.env.TMAX_WORKSPACE_AUTOSAVE_MS = previousAutoSave;
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-switch persists current workspace before activation", async () => {
  const socketPath = `/tmp/tmax-workspace-switch-save-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "switch_save_a" });
    await rpc(socketPath, "workspace-new", { name: "switch_save_b" });
    const frame = await connectFrame(socketPath, "switch_save_a");
    frameSockets.push(frame.socket);
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(progn (buffer-create "switch.txt") (buffer-switch "switch.txt"))' });
    await rpc(socketPath, "workspace-save", { name: "switch_save_a" });
    const before = await stat(join(workspaceDir, "switch_save_a.json"));

    await delay(10);
    await rpc(socketPath, "insert", { frameId: frame.frameId, text: "saved on switch" });
    await rpc(socketPath, "workspace-switch", { frameId: frame.frameId, name: "switch_save_b" });

    const after = await stat(join(workspaceDir, "switch_save_a.json"));
    const sourceData = JSON.parse(await readFile(join(workspaceDir, "switch_save_a.json"), "utf8"));
    const buffer = sourceData.buffers.find((item: any) => item.name === "switch.txt");
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);
    expect(buffer.content).toBe("saved on switch");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("failed auto-save keeps dirty flags in active editor state", async () => {
  const previousDebounce = process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
  const previousAutoSave = process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
  process.env.TMAX_WORKSPACE_DEBOUNCE_MS = "20";
  process.env.TMAX_WORKSPACE_AUTOSAVE_MS = "1000";
  const socketPath = `/tmp/tmax-workspace-autosave-fail-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "auto_fail_ws" });
    const frame = await connectFrame(socketPath, "auto_fail_ws");
    frameSockets.push(frame.socket);
    await chmod(workspaceDir, 0o500);
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(progn (buffer-create "fail.txt") (buffer-switch "fail.txt"))' });
    await rpc(socketPath, "insert", { frameId: frame.frameId, text: "dirty after failed save" });

    await waitFor(async () => {
      const messages = await rpc(socketPath, "query", { query: "messages" });
      return messages.messages.some((entry: any) => String(entry.message ?? entry.text ?? entry).includes("Auto-save failed"))
        ? true
        : undefined;
    }, 5000);

    const buffers = await rpc(socketPath, "query", { frameId: frame.frameId, query: "buffers" });
    const failedBuffer = buffers.find((buffer: any) => buffer.name === "fail.txt");
    expect(failedBuffer.modified).toBe(true);
  } finally {
    await chmod(workspaceDir, 0o700).catch(() => {});
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
    if (previousDebounce === undefined) delete process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
    else process.env.TMAX_WORKSPACE_DEBOUNCE_MS = previousDebounce;
    if (previousAutoSave === undefined) delete process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
    else process.env.TMAX_WORKSPACE_AUTOSAVE_MS = previousAutoSave;
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-move-window copies buffer to target and removes it from source", async () => {
  const socketPath = `/tmp/tmax-workspace-move-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "move_a" });
    await rpc(socketPath, "workspace-new", { name: "move_b" });
    const frameA = await connectFrame(socketPath, "move_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "file.ts") (buffer-switch "file.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "const moved = true;" });

    const moved = await rpc(socketPath, "workspace-move-window", { frameId: frameA.frameId, target: "move_b" });
    expect(moved.success).toBe(true);
    expect(moved.moved).toBe("file.ts");

    const buffersA = await rpc(socketPath, "command", { frameId: frameA.frameId, command: "list-buffers" });
    expect(buffersA).not.toContain("file.ts");

    const frameB = await connectFrame(socketPath, "move_b");
    frameSockets.push(frameB.socket);
    const buffersB = await rpc(socketPath, "query", { frameId: frameB.frameId, query: "buffers" });
    const movedBuffer = buffersB.find((buffer: any) => buffer.name === "file.ts");
    expect(movedBuffer.content).toBe("const moved = true;");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-move-window keeps source buffer when another source window references it", async () => {
  const socketPath = `/tmp/tmax-workspace-move-shared-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "move_shared_a" });
    await rpc(socketPath, "workspace-new", { name: "move_shared_b" });
    const frameA = await connectFrame(socketPath, "move_shared_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "shared.ts") (buffer-switch "shared.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "const shared = true;" });
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(split-window "horizontal")' });

    const moved = await rpc(socketPath, "workspace-move-window", { frameId: frameA.frameId, target: "move_shared_b" });
    expect(moved.success).toBe(true);

    const buffersA = await rpc(socketPath, "command", { frameId: frameA.frameId, command: "list-buffers" });
    expect(buffersA).toContain("shared.ts");
    const renderA = await rpc(socketPath, "render-state", { frameId: frameA.frameId });
    expect(renderA.windows.map((window: any) => window.bufferName)).toContain("shared.ts");

    const frameB = await connectFrame(socketPath, "move_shared_b");
    frameSockets.push(frameB.socket);
    const buffersB = await rpc(socketPath, "query", { frameId: frameB.frameId, query: "buffers" });
    const movedBuffer = buffersB.find((buffer: any) => buffer.name === "shared.ts");
    expect(movedBuffer.content).toBe("const shared = true;");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-move-window rejects target buffer name collisions", async () => {
  const socketPath = `/tmp/tmax-workspace-move-collision-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "move_collision_a" });
    await rpc(socketPath, "workspace-new", { name: "move_collision_b" });
    const frameA = await connectFrame(socketPath, "move_collision_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "same.ts") (buffer-switch "same.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "source content" });

    const frameB = await connectFrame(socketPath, "move_collision_b");
    frameSockets.push(frameB.socket);
    await rpc(socketPath, "eval", { frameId: frameB.frameId, code: '(progn (buffer-create "same.ts") (buffer-switch "same.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameB.frameId, text: "target content" });

    let collisionError = "";
    try {
      await rpc(socketPath, "workspace-move-window", { frameId: frameA.frameId, target: "move_collision_b" });
    } catch (error) {
      collisionError = error instanceof Error ? error.message : String(error);
    }
    expect(collisionError).toContain('already has buffer "same.ts"');

    const buffersB = await rpc(socketPath, "query", { frameId: frameB.frameId, query: "buffers" });
    const targetBuffer = buffersB.find((buffer: any) => buffer.name === "same.ts");
    expect(targetBuffer.content).toBe("target content");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-move-window target save failure leaves source durable on disk", async () => {
  const socketPath = `/tmp/tmax-workspace-move-fail-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "move_fail_a" });
    await rpc(socketPath, "workspace-new", { name: "move_fail_b" });
    const frameA = await connectFrame(socketPath, "move_fail_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "durable.ts") (buffer-switch "durable.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "const durable = true;" });
    await rpc(socketPath, "workspace-save", { name: "move_fail_a" });

    const manager = (server as any).workspaceManager;
    const originalSave = manager.saveWithContentHash.bind(manager);
    manager.saveWithContentHash = (workspace: any, options: any) => {
      if (workspace.metadata.name === "move_fail_b") {
        return TaskEither.left('injected target save failure');
      }
      return originalSave(workspace, options);
    };

    let moveError = "";
    try {
      await rpc(socketPath, "workspace-move-window", { frameId: frameA.frameId, target: "move_fail_b" });
    } catch (error) {
      moveError = error instanceof Error ? error.message : String(error);
    } finally {
      manager.saveWithContentHash = originalSave;
    }

    expect(moveError).toContain("injected target save failure");
    await rpc(socketPath, "workspace-save", { name: "move_fail_a" });
    const sourceData = JSON.parse(await readFile(join(workspaceDir, "move_fail_a.json"), "utf8"));
    expect(sourceData.buffers.map((buffer: any) => buffer.name)).toContain("durable.ts");
    expect(sourceData.windows.map((window: any) => window.bufferName)).toContain("durable.ts");

    const restartedSocketPath = `/tmp/tmax-workspace-move-fail-restart-${process.pid}-${Date.now()}.sock`;
    const restarted = new TmaxServer(restartedSocketPath, true);
    try {
      await restarted.start();
      await rpc(restartedSocketPath, "workspace-load", { name: "move_fail_a" });
      const restoredFrame = await connectFrame(restartedSocketPath, "move_fail_a");
      frameSockets.push(restoredFrame.socket);
      const restoredBuffers = await rpc(restartedSocketPath, "query", { frameId: restoredFrame.frameId, query: "buffers" });
      expect(restoredBuffers.map((buffer: any) => buffer.name)).toContain("durable.ts");
      const restoredRender = await rpc(restartedSocketPath, "render-state", { frameId: restoredFrame.frameId });
      expect(restoredRender.windows.map((window: any) => window.bufferName)).toContain("durable.ts");
    } finally {
      await restarted.shutdown();
    }
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace-move-window source override restores previous active workspace on success and failure", async () => {
  const socketPath = `/tmp/tmax-workspace-move-override-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "move_override_a" });
    await rpc(socketPath, "workspace-new", { name: "move_override_b" });
    await rpc(socketPath, "workspace-new", { name: "move_override_c" });

    const frameA = await connectFrame(socketPath, "move_override_a");
    frameSockets.push(frameA.socket);
    await rpc(socketPath, "eval", { frameId: frameA.frameId, code: '(progn (buffer-create "a.txt") (buffer-switch "a.txt"))' });
    await rpc(socketPath, "insert", { frameId: frameA.frameId, text: "A" });

    const frameB = await connectFrame(socketPath, "move_override_b");
    frameSockets.push(frameB.socket);
    await rpc(socketPath, "eval", { frameId: frameB.frameId, code: '(progn (buffer-create "move.ts") (buffer-switch "move.ts"))' });
    await rpc(socketPath, "insert", { frameId: frameB.frameId, text: "move content" });

    const frameC = await connectFrame(socketPath, "move_override_c");
    frameSockets.push(frameC.socket);
    await rpc(socketPath, "eval", { frameId: frameC.frameId, code: '(progn (buffer-create "collision.ts") (buffer-switch "collision.ts"))' });

    const activeFrameA = await connectFrame(socketPath, "move_override_a");
    frameSockets.push(activeFrameA.socket);

    const moved = await rpc(socketPath, "workspace-move-window", {
      frameId: activeFrameA.frameId,
      sourceWorkspaceId: "move_override_b",
      target: "move_override_c",
    });
    expect(moved.success).toBe(true);

    const defaultBuffersAfterSuccess = await rpc(socketPath, "query", { query: "buffers" });
    expect(defaultBuffersAfterSuccess.map((buffer: any) => buffer.name)).toContain("a.txt");
    expect(defaultBuffersAfterSuccess.map((buffer: any) => buffer.name)).not.toContain("move.ts");

    await rpc(socketPath, "eval", { frameId: frameB.frameId, code: '(progn (buffer-create "collision.ts") (buffer-switch "collision.ts"))' });
    await rpc(socketPath, "workspace-switch", { frameId: activeFrameA.frameId, name: "move_override_a" });
    let failure = "";
    try {
      await rpc(socketPath, "workspace-move-window", {
        frameId: activeFrameA.frameId,
        sourceWorkspaceId: "move_override_b",
        target: "move_override_c",
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect(failure).toContain('already has buffer "collision.ts"');

    const defaultBuffersAfterFailure = await rpc(socketPath, "query", { query: "buffers" });
    expect(defaultBuffersAfterFailure.map((buffer: any) => buffer.name)).toContain("a.txt");
    expect(defaultBuffersAfterFailure.map((buffer: any) => buffer.name)).not.toContain("collision.ts");
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("layout-only workspace changes are persisted by debounced auto-save", async () => {
  const previousDebounce = process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
  const previousAutoSave = process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
  process.env.TMAX_WORKSPACE_DEBOUNCE_MS = "20";
  process.env.TMAX_WORKSPACE_AUTOSAVE_MS = "1000";
  const socketPath = `/tmp/tmax-workspace-layout-autosave-${process.pid}-${Date.now()}.sock`;
  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "layout_auto_ws" });
    const frame = await connectFrame(socketPath, "layout_auto_ws");
    frameSockets.push(frame.socket);
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(progn (buffer-create "layout.txt") (buffer-switch "layout.txt"))' });
    await rpc(socketPath, "workspace-save", { name: "layout_auto_ws" });
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(split-window "horizontal")' });

    await waitFor(async () => {
      const data = JSON.parse(await readFile(join(workspaceDir, "layout_auto_ws.json"), "utf8"));
      return data.windows.length >= 2 ? data : undefined;
    }, 5000);

    const restartedSocketPath = `/tmp/tmax-workspace-layout-autosave-restart-${process.pid}-${Date.now()}.sock`;
    const restarted = new TmaxServer(restartedSocketPath, true);
    try {
      await restarted.start();
      await rpc(restartedSocketPath, "workspace-load", { name: "layout_auto_ws" });
      const restoredFrame = await connectFrame(restartedSocketPath, "layout_auto_ws");
      frameSockets.push(restoredFrame.socket);
      const renderState = await rpc(restartedSocketPath, "render-state", { frameId: restoredFrame.frameId });
      expect(renderState.windows.length).toBeGreaterThanOrEqual(2);
    } finally {
      await restarted.shutdown();
    }
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
    if (previousDebounce === undefined) delete process.env.TMAX_WORKSPACE_DEBOUNCE_MS;
    else process.env.TMAX_WORKSPACE_DEBOUNCE_MS = previousDebounce;
    if (previousAutoSave === undefined) delete process.env.TMAX_WORKSPACE_AUTOSAVE_MS;
    else process.env.TMAX_WORKSPACE_AUTOSAVE_MS = previousAutoSave;
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

test("workspace restore rereads clean file buffers and reports conflicts and missing roots", async () => {
  const socketPath = `/tmp/tmax-workspace-restore-${process.pid}-${Date.now()}.sock`;
  const cleanFile = join(workspaceDir, "clean.txt");
  const conflictFile = join(workspaceDir, "conflict.txt");
  const thirdFile = join(workspaceDir, "third.txt");
  const missingRoot = join(workspaceDir, "missing-root");
  await writeFile(cleanFile, "clean v1", "utf8");
  await writeFile(conflictFile, "conflict disk v1", "utf8");
  await writeFile(thirdFile, "third file", "utf8");

  const server = new TmaxServer(socketPath, true);
  const frameSockets: Socket[] = [];

  try {
    await server.start();
    await rpc(socketPath, "workspace-new", { name: "restore_ws", projectRoot: missingRoot });
    const frame = await connectFrame(socketPath, "restore_ws");
    frameSockets.push(frame.socket);
    await rpc(socketPath, "open", { frameId: frame.frameId, filepath: cleanFile });
    await rpc(socketPath, "eval", { frameId: frame.frameId, code: '(split-window "horizontal")' });
    await rpc(socketPath, "open", { frameId: frame.frameId, filepath: conflictFile });
    await rpc(socketPath, "insert", { frameId: frame.frameId, text: " + workspace dirty" });
    await rpc(socketPath, "open", { frameId: frame.frameId, filepath: thirdFile });
    await rpc(socketPath, "workspace-save", { name: "restore_ws" });
    await server.shutdown();

    await writeFile(cleanFile, "clean v2 from disk", "utf8");
    await writeFile(conflictFile, "conflict disk v2", "utf8");

    const restarted = new TmaxServer(socketPath, true);
    try {
      await restarted.start();
      await rpc(socketPath, "workspace-load", { name: "restore_ws" });
      const restoredFrame = await connectFrame(socketPath, "restore_ws");
      frameSockets.push(restoredFrame.socket);

      const buffers = await rpc(socketPath, "query", { frameId: restoredFrame.frameId, query: "buffers" });
      const cleanBuffer = buffers.find((buffer: any) => buffer.name === cleanFile);
      const conflictBuffer = buffers.find((buffer: any) => buffer.name === conflictFile);
      const thirdBuffer = buffers.find((buffer: any) => buffer.name === thirdFile);
      expect(buffers.map((buffer: any) => buffer.name)).toContain(cleanFile);
      expect(buffers.map((buffer: any) => buffer.name)).toContain(conflictFile);
      expect(buffers.map((buffer: any) => buffer.name)).toContain(thirdFile);
      expect(cleanBuffer.content).toBe("clean v2 from disk");
      expect(conflictBuffer.content).toContain("workspace dirty");
      expect(thirdBuffer.content).toBe("third file");

      const renderState = await rpc(socketPath, "render-state", { frameId: restoredFrame.frameId });
      expect(renderState.windows.length).toBeGreaterThanOrEqual(2);

      const messages = await rpc(socketPath, "query", { query: "messages" });
      const messageText = messages.messages.map((entry: any) => String(entry.message ?? entry.text ?? entry)).join("\n");
      expect(messageText).toContain("Workspace project root missing");
      expect(messageText).toContain("Workspace restore conflict prompt");
      expect(messageText).toContain("keep disk version");
      expect(messageText).toContain("restore workspace version");
      expect(messageText).toContain("diff view");
    } finally {
      await restarted.shutdown();
    }
  } finally {
    for (const socket of frameSockets) socket.destroy();
    await server.shutdown();
  }
}, WORKSPACE_TEST_TIMEOUT_MS);

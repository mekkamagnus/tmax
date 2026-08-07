/**
 * @file terminal-manager.test.ts
 * @description Tests for the TerminalManager + shell-ops integration.
 * @see src/core/terminal-manager.ts, src/editor/api/shell-ops.ts
 */

import { describe, test, expect } from "bun:test";
import { TerminalManager } from "../../src/core/terminal-manager.ts";
import { createShellOps } from "../../src/editor/api/shell-ops.ts";

describe("TerminalManager", () => {
  test("createTerminal spawns a shell and produces output", async () => {
    const mgr = new TerminalManager();
    const id = mgr.createTerminal({ cols: 80, rows: 24, command: "/bin/sh", cwd: "/tmp" });

    expect(id).toMatch(/^term-[a-f0-9]{8}$/);
    expect(mgr.isAlive(id)).toBe(true);

    // Write a command and check output appears
    mgr.write(id, "echo TM_TEST_OK\n");

    // Wait for output to flow through PTY → parser → screen buffer
    const lines = await new Promise<string[]>((resolve) => {
      let attempts = 0;
      const check = () => {
        const visible = mgr.getVisibleLines(id);
        if (visible.some((l) => l.includes("TM_TEST_OK")) || ++attempts > 20) {
          resolve(visible);
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });

    expect(lines.some((l) => l.includes("TM_TEST_OK"))).toBe(true);

    mgr.destroy(id);
    expect(mgr.isAlive(id)).toBe(false);
  });

  test("list returns all terminal IDs", () => {
    const mgr = new TerminalManager();
    const id1 = mgr.createTerminal({ cols: 80, rows: 24, command: "/bin/sh", cwd: "/tmp" });
    const id2 = mgr.createTerminal({ cols: 80, rows: 24, command: "/bin/sh", cwd: "/tmp" });

    const ids = mgr.list();
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toHaveLength(2);

    mgr.destroyAll();
  });

  test("kill terminates the terminal", async () => {
    const mgr = new TerminalManager();
    const id = mgr.createTerminal({ cols: 80, rows: 24, command: "/bin/sh", args: ["-c", "sleep 30"], cwd: "/tmp" });

    expect(mgr.isAlive(id)).toBe(true);
    mgr.kill(id, "SIGKILL");

    // Give it a moment to exit
    await new Promise((r) => setTimeout(r, 500));
    expect(mgr.isAlive(id)).toBe(false);

    mgr.destroy(id);
  });

  test("resize updates the screen buffer dimensions", () => {
    const mgr = new TerminalManager();
    const id = mgr.createTerminal({ cols: 80, rows: 24, command: "/bin/sh", cwd: "/tmp" });

    mgr.resize(id, 120, 40);

    const term = mgr.get(id);
    expect(term?.screen.cols).toBe(120);
    expect(term?.screen.rows).toBe(40);

    mgr.destroy(id);
  });
});

describe("shell-ops (T-Lisp primitives)", () => {
  function setupShellOps() {
    const mgr = new TerminalManager();
    const ops = createShellOps(mgr, () => ({ width: 80, height: 24 }));
    return { mgr, ops };
  }

  test("shell creates a terminal and returns its ID", () => {
    const { ops, mgr } = setupShellOps();
    const result = ops.get("shell")!([]);
    expect(result._tag).toBe("Right");
    expect((result as any).right.value).toMatch(/^term-[a-f0-9]{8}$/);
    mgr.destroyAll();
  });

  test("shell-send writes to the terminal", async () => {
    const { ops, mgr } = setupShellOps();
    const shellResult = ops.get("shell")!([]);
    const termId = (shellResult as any).right.value;

    const sendResult = ops.get("shell-send")!([
      { type: "string", value: termId },
      { type: "string", value: "echo SHELL_OPS_OK\n" },
    ]);
    expect(sendResult._tag).toBe("Right");

    // Verify output flows
    const ok = await new Promise<boolean>((resolve) => {
      let attempts = 0;
      const check = () => {
        const lines = mgr.getVisibleLines(termId);
        if (lines.some((l) => l.includes("SHELL_OPS_OK")) || ++attempts > 20) {
          resolve(lines.some((l) => l.includes("SHELL_OPS_OK")));
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
    expect(ok).toBe(true);

    mgr.destroyAll();
  });

  test("shell-alive-p returns true for running terminal", () => {
    const { ops, mgr } = setupShellOps();
    const shellResult = ops.get("shell")!([]);
    const termId = (shellResult as any).right.value;

    const aliveResult = ops.get("shell-alive-p")!([{ type: "string", value: termId }]);
    expect(aliveResult._tag).toBe("Right");
    expect((aliveResult as any).right.value).toBe(true);

    mgr.destroyAll();
  });

  test("shell-list returns all terminal IDs", () => {
    const { ops, mgr } = setupShellOps();
    ops.get("shell")!([]);
    ops.get("shell")!([]);

    const listResult = ops.get("shell-list")!([]);
    expect(listResult._tag).toBe("Right");
    expect((listResult as any).right.value).toHaveLength(2);

    mgr.destroyAll();
  });
});

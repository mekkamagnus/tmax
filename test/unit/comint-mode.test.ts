/** comint-mode.test.ts — #165 / SPEC-099 */
import { describe, test, expect } from "bun:test";
import { ComintManager } from "../../src/editor/api/comint-ops.ts";
import { createComintOps } from "../../src/editor/api/comint-ops.ts";

describe("#165 — comint-mode (command interpreter)", () => {
  test("comint-run spawns a process and produces output", async () => {
    const mgr = new ComintManager();
    const outputs: string[] = [];
    const buf = mgr.run("echo", ["comint-test-ok"], "*test*", undefined, undefined, (_bn, line) => {
      outputs.push(line);
    });

    expect(buf).toBe("*test*");
    expect(mgr.isComint("*test*")).toBe(true);

    // Wait for output
    await new Promise(r => setTimeout(r, 1000));
    expect(outputs.some(l => l.includes("comint-test-ok"))).toBe(true);
    mgr.destroyAll();
  });

  test("comint-send writes to stdin (interactive echo)", async () => {
    const mgr = new ComintManager();
    const outputs: string[] = [];
    mgr.run("cat", [], "*cat*", undefined, undefined, (_bn, line) => {
      outputs.push(line);
    });

    await new Promise(r => setTimeout(r, 300));
    mgr.send("*cat*", "hello from comint\n");
    await new Promise(r => setTimeout(r, 500));
    expect(outputs.some(l => l.includes("hello from comint"))).toBe(true);
    mgr.kill("*cat*");
    mgr.destroyAll();
  });

  test("comint-kill terminates the process", async () => {
    const mgr = new ComintManager();
    mgr.run("sleep", ["30"], "*sleep*", undefined, undefined, () => {});
    await new Promise(r => setTimeout(r, 200));
    expect(mgr.status("*sleep*")).toBe("running");
    mgr.kill("*sleep*");
    await new Promise(r => setTimeout(r, 500));
    expect(mgr.status("*sleep*")).toMatch(/^exited/);
    mgr.destroyAll();
  });

  test("comint-process-status returns running then exited", async () => {
    const mgr = new ComintManager();
    mgr.run("echo", ["done"], "*status*", undefined, undefined, () => {});
    expect(mgr.status("*status*")).toBe("running");
    await new Promise(r => setTimeout(r, 1000));
    expect(mgr.status("*status*")).toMatch(/^exited/);
    mgr.destroyAll();
  });

  test("multiple comint buffers coexist", () => {
    const mgr = new ComintManager();
    mgr.run("echo", ["1"], "*buf1*", undefined, undefined, () => {});
    mgr.run("echo", ["2"], "*buf2*", undefined, undefined, () => {});
    expect(mgr.list()).toContain("*buf1*");
    expect(mgr.list()).toContain("*buf2*");
    expect(mgr.list()).toHaveLength(2);
    mgr.destroyAll();
  });

  test("input history: push + prev + next", () => {
    const mgr = new ComintManager();
    mgr.run("cat", [], "*hist*", undefined, undefined, () => {});
    mgr.pushHistory("*hist*", "first");
    mgr.pushHistory("*hist*", "second");
    mgr.pushHistory("*hist*", "third");
    expect(mgr.historyPrev("*hist*")).toBe("third");
    expect(mgr.historyPrev("*hist*")).toBe("second");
    expect(mgr.historyPrev("*hist*")).toBe("first");
    expect(mgr.historyNext("*hist*")).toBe("second");
    expect(mgr.historyNext("*hist*")).toBe("third");
    mgr.destroyAll();
  });

  test("comint-buffer-p identifies comint buffers", () => {
    const mgr = new ComintManager();
    mgr.run("echo", ["x"], "*comint1*", undefined, undefined, () => {});
    expect(mgr.isComint("*comint1*")).toBe(true);
    expect(mgr.isComint("*nonexistent*")).toBe(false);
    mgr.destroyAll();
  });
});

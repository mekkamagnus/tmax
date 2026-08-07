/**
 * @file pty.test.ts
 * @description Tests for the PTY manager using Bun's native terminal API.
 * @see src/core/pty.ts
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "../../src/core/pty.ts";

describe("PTY manager (Bun.spawn terminal API)", () => {
  test("spawn produces output (shell prompt)", async () => {
    const pty = spawn({ command: "/bin/sh", args: ["-c", "echo pty-test-ok"], cols: 80, rows: 24 });

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        if (buf.includes("pty-test-ok")) resolve(buf);
      });
      pty.onExit(() => resolve(buf));
      setTimeout(() => resolve(buf), 5000);
    });

    expect(output).toContain("pty-test-ok");
  });

  test("inner process sees a real tty (isatty)", async () => {
    const pty = spawn({ command: "/bin/sh", args: ["-c", "tty"], cols: 80, rows: 24 });

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        if (buf.includes("/dev/ttys") || buf.includes("/dev/pts/")) resolve(buf);
      });
      pty.onExit(() => resolve(buf));
      setTimeout(() => resolve(buf), 5000);
    });

    expect(output).toMatch(/\/dev\/(ttys|pts\/)\d+/);
  });

  test("interactive: write input, get echoed output", async () => {
    const pty = spawn({ command: "/bin/sh", cols: 80, rows: 24 });

    // Wait for prompt
    await new Promise((r) => setTimeout(r, 500));
    pty.write("echo INTERACTIVE_PTY_OK\n");

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        if (buf.includes("INTERACTIVE_PTY_OK")) resolve(buf);
      });
      setTimeout(() => resolve(buf), 5000);
    });

    expect(output).toContain("INTERACTIVE_PTY_OK");

    pty.write("exit\n");
    await new Promise((r) => setTimeout(r, 300));
    pty.kill();
  });

  test("kill terminates the process", async () => {
    const pty = spawn({ command: "/bin/sh", args: ["-c", "sleep 30"], cols: 80, rows: 24 });

    await new Promise((r) => setTimeout(r, 300));
    pty.kill("SIGKILL");

    const exitCode = await new Promise<number | null>((resolve) => {
      pty.onExit((code) => resolve(code));
      setTimeout(() => resolve(null), 3000);
    });

    expect(exitCode).not.toBeNull();
  });

  test("resize changes terminal dimensions", async () => {
    const pty = spawn({ command: "/bin/sh", cols: 80, rows: 24 });

    await new Promise((r) => setTimeout(r, 500));
    pty.resize(120, 40);
    await new Promise((r) => setTimeout(r, 200));

    pty.write("tput cols\n");

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        if (/\b120\b/.test(buf.slice(-20))) resolve(buf);
      });
      setTimeout(() => resolve(buf), 5000);
    });

    expect(output).toContain("120");

    pty.write("exit\n");
    await new Promise((r) => setTimeout(r, 300));
    pty.kill();
  });
});

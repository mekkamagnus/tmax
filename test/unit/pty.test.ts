/**
 * @file pty.test.ts
 * @description Tests for the zero-dependency PTY manager (script(1) + Bun.spawn).
 * @see src/core/pty.ts
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "../../src/core/pty.ts";

describe("PTY manager (script(1) + Bun.spawn)", () => {
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
    const pty = spawn({ command: "/bin/sh", args: ["-c", "tty > /tmp/pty-tty-test; cat /tmp/pty-tty-test"], cols: 80, rows: 24 });

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        if (buf.includes("/dev/ttys") || buf.includes("/dev/pts/")) resolve(buf);
      });
      pty.onExit(() => resolve(buf));
      setTimeout(() => resolve(buf), 5000);
    });

    // The process should report a real tty device
    expect(output).toMatch(/\/dev\/(ttys|pts\/)\d+/);
  });

  test("interactive: write input, get echoed output", async () => {
    const pty = spawn({ command: "/bin/sh", cols: 80, rows: 24 });

    // Wait for prompt, then send a command
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

    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 300));

    pty.kill("SIGKILL");

    const exitCode = await new Promise<number | null>((resolve) => {
      pty.onExit((code) => resolve(code));
      setTimeout(() => resolve(null), 3000);
    });

    expect(exitCode).not.toBeNull();
  });

  test("resize changes terminal dimensions (stty inside PTY)", async () => {
    const pty = spawn({ command: "/bin/sh", cols: 80, rows: 24 });

    await new Promise((r) => setTimeout(r, 500));

    // Resize to 120x40
    pty.resize(120, 40);
    await new Promise((r) => setTimeout(r, 300));

    // Query the current terminal width
    pty.write("tput cols\n");

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      pty.onOutput((data) => {
        buf += data;
        // tput cols outputs "120" on its own line
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

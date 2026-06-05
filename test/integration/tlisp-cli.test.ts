import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (args: string[], env?: Record<string, string>) => Bun.spawnSync({
  cmd: args,
  cwd: process.cwd(),
  env: { ...process.env, ...env },
  stdout: "pipe",
  stderr: "pipe",
});

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("standalone tlisp CLI", () => {
  test("evaluates one expression", () => {
    const result = run(["bun", "src/tlisp/cli.ts", "-e", "(+ 1 2)"]);
    expect(result.exitCode).toBe(0);
    expect(text(result.stdout).trim()).toBe("3");
  });

  test("launcher evaluates one expression", () => {
    const result = run(["bin/tlisp", "-e", "(+ 1 2)"]);
    expect(result.exitCode).toBe(0);
    expect(text(result.stdout).trim()).toBe("3");
  });

  test("executes script files and strips shebangs", () => {
    const dir = mkdtempSync(join(tmpdir(), "tlisp-cli-"));
    const script = join(dir, "script.tlisp");
    writeFileSync(script, "#!/usr/bin/env tlisp\n(defvar x 40)\n(+ x 2)\n");

    const result = run(["bin/tlisp", script]);
    expect(result.exitCode).toBe(0);
    expect(text(result.stdout).trim()).toBe("42");

    rmSync(dir, { recursive: true, force: true });
  });

  test("returns nonzero for eval errors", () => {
    const result = run(["bin/tlisp", "-e", "(undefined-symbol)"]);
    expect(result.exitCode).not.toBe(0);
    expect(text(result.stderr)).toContain("Error:");
  });

  test("loads modules from TLISP_PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "tlisp-cli-path-"));
    const moduleDir = join(dir, "local");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, "tools.tlisp"), `
(defmodule local/tools
  (export answer)

  (defun answer ()
    42))
`);

    const result = run(["bin/tlisp", "-e", "(progn (require-module local/tools :as tools) (tools/answer))"], {
      TLISP_PATH: dir,
    });
    expect(result.exitCode).toBe(0);
    expect(text(result.stdout).trim()).toBe("42");

    rmSync(dir, { recursive: true, force: true });
  });
});

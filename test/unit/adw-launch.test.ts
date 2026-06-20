/**
 * @file adw-launch.test.ts
 * @description Deterministic unit tests for adws/adw-launch.ts. Covers the
 * parseArgs surface (launcher flags, pass-through semantics, --resume alias,
 * -- separator), resolveScriptPath (bare/relative/absolute), and the shell
 * construction helpers (shellQuote, buildForegroundArgv, buildTmuxCommand).
 * No live tmux, no live bun — pure parser/path/string behavior.
 */
import { describe, test, expect } from "bun:test";
import { Either } from "../../src/utils/task-either.ts";
import {
  buildForegroundArgv,
  buildTmuxCommand,
  listAvailableScripts,
  parseArgs,
  resolveScriptPath,
  shellQuote,
} from "../../adws/adw-launch.ts";

// ---------------------------------------------------------------------------
// parseArgs — launcher flags + pass-through semantics
// ---------------------------------------------------------------------------

describe("parseArgs — launcher flags", () => {
  test("defaults: session=tmax, script=adw-plan-review-build-patch.ts, no foreground", () => {
    const r = parseArgs(["some description"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.session).toBe("tmax");
      expect(r.right.script).toBe("adw-plan-review-build-patch.ts");
      expect(r.right.foreground).toBe(false);
      expect(r.right.window).toBeUndefined();
      expect(r.right.resume).toBeUndefined();
      expect(r.right.scriptArgs).toEqual(["some description"]);
    }
  });

  test("-s/--session sets the session name", () => {
    for (const flag of ["-s", "--session"]) {
      const r = parseArgs([flag, "dev", "x"]);
      expect(Either.isRight(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right.session).toBe("dev");
    }
  });

  test("-w/--window sets the window name", () => {
    for (const flag of ["-w", "--window"]) {
      const r = parseArgs([flag, "review", "x"]);
      expect(Either.isRight(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right.window).toBe("review");
    }
  });

  test("-t/--script sets the target script", () => {
    for (const flag of ["-t", "--script"]) {
      const r = parseArgs([flag, "adw-spec-review.ts", "x"]);
      expect(Either.isRight(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right.script).toBe("adw-spec-review.ts");
    }
  });

  test("-f/--foreground enables foreground mode", () => {
    for (const flag of ["-f", "--foreground"]) {
      const r = parseArgs([flag, "x"]);
      expect(Either.isRight(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right.foreground).toBe(true);
    }
  });

  test("known launcher flag with missing value → Left parse error (long and short forms)", () => {
    // Parser reports errors using the long form; the test just verifies each
    // flag-without-value case produces a "requires a value" error.
    const cases: string[][] = [
      ["--session"], ["-s"],
      ["--window"], ["-w"],
      ["--script"], ["-t"],
      ["--resume"],
    ];
    for (const argv of cases) {
      const r = parseArgs(argv);
      expect(Either.isLeft(r)).toBe(true);
      if (Either.isLeft(r)) expect(r.left).toContain("requires a value");
    }
  });

  test("-h/--help → help sentinel", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseArgs([flag]);
      expect(Either.isLeft(r)).toBe(true);
      if (Either.isLeft(r)) expect(r.left.startsWith("__help__:")).toBe(true);
    }
  });

  test("no args at all → usage sentinel", () => {
    const r = parseArgs([]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__usage__:")).toBe(true);
  });
});

describe("parseArgs — pass-through", () => {
  test("unknown flag begins pass-through and is forwarded unchanged", () => {
    const r = parseArgs(["--chore", "logging cleanup"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.scriptArgs).toEqual(["--chore", "logging cleanup"]);
    }
  });

  test("multiple unknown flags + values are all forwarded", () => {
    const r = parseArgs(["--model", "gpt-5", "implement feature X"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.scriptArgs).toEqual(["--model", "gpt-5", "implement feature X"]);
    }
  });

  test("launcher flag before unknown flag works, then pass-through", () => {
    const r = parseArgs(["--session", "dev", "--bug", "x"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.session).toBe("dev");
      expect(r.right.scriptArgs).toEqual(["--bug", "x"]);
    }
  });

  test("positional arg begins pass-through", () => {
    const r = parseArgs(["docs/specs/SPEC-056.md", "--extra-flag", "value"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.scriptArgs).toEqual(["docs/specs/SPEC-056.md", "--extra-flag", "value"]);
    }
  });

  test("`--` separator begins pass-through (preserves --flag args)", () => {
    const r = parseArgs(["--session", "dev", "--", "--marker", "/tmp/x", "--signal", "ready"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.session).toBe("dev");
      expect(r.right.scriptArgs).toEqual(["--marker", "/tmp/x", "--signal", "ready"]);
    }
  });

  test("`--` works with `-w/--window` and bare positional afterward", () => {
    // Mirrors the live smoke test command:
    //   --script test/fixtures/smoke.ts --window adw-smoke -- --marker … "hello world" "p w s.md"
    const r = parseArgs([
      "--script", "test/fixtures/smoke.ts",
      "--window", "adw-smoke",
      "--",
      "--marker", "/tmp/m",
      "--signal", "adw-smoke-123",
      "hello world",
      "path with spaces.md",
    ]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.script).toBe("test/fixtures/smoke.ts");
      expect(r.right.window).toBe("adw-smoke");
      expect(r.right.scriptArgs).toEqual([
        "--marker", "/tmp/m",
        "--signal", "adw-smoke-123",
        "hello world",
        "path with spaces.md",
      ]);
    }
  });

  test("launcher flags after pass-through begins are NOT consumed (forwarded verbatim)", () => {
    // Once --feature triggers pass-through, a later --session is forwarded, not consumed.
    const r = parseArgs(["--feature", "--session", "dev"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.session).toBe("tmax"); // NOT consumed
      expect(r.right.scriptArgs).toEqual(["--feature", "--session", "dev"]);
    }
  });
});

describe("parseArgs --resume alias", () => {
  test("--resume <id> translates to ['--id', '<id>'] and does not forward --resume", () => {
    const r = parseArgs(["--resume", "01KVFS25X8"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.resume).toBe("01KVFS25X8");
      expect(r.right.scriptArgs).toEqual(["--id", "01KVFS25X8"]);
    }
  });

  test("--resume with a description → --id prepended before description", () => {
    const r = parseArgs(["--resume", "01KVFS25X8", "implement feature X"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.scriptArgs).toEqual(["--id", "01KVFS25X8", "implement feature X"]);
    }
  });

  test("--resume combined with other launcher flags", () => {
    const r = parseArgs(["--session", "dev", "--resume", "01ABC", "--window", "w"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.session).toBe("dev");
      expect(r.right.window).toBe("w");
      expect(r.right.resume).toBe("01ABC");
      // No positional, so scriptArgs is just the resume translation.
      expect(r.right.scriptArgs).toEqual(["--id", "01ABC"]);
    }
  });

  test("--resume missing value → parse error", () => {
    const r = parseArgs(["--resume"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--resume requires a value");
  });
});

// ---------------------------------------------------------------------------
// resolveScriptPath
// ---------------------------------------------------------------------------

describe("resolveScriptPath", () => {
  test("bare adw script name resolves under adws/", () => {
    const p = resolveScriptPath("adw-spec-review.ts");
    expect(p.endsWith("/adws/adw-spec-review.ts")).toBe(true);
  });

  test("default script resolves under adws/", () => {
    const p = resolveScriptPath("adw-plan-review-build-patch.ts");
    expect(p.endsWith("/adws/adw-plan-review-build-patch.ts")).toBe(true);
  });

  test("relative path with '/' resolves relative to PROJECT_ROOT", () => {
    const p = resolveScriptPath("test/fixtures/adw-launch-smoke.ts");
    expect(p.endsWith("/test/fixtures/adw-launch-smoke.ts")).toBe(true);
  });

  test("absolute path is returned as-is", () => {
    const abs = "/abs/path/to/script.ts";
    expect(resolveScriptPath(abs)).toBe(abs);
  });

  test("does not check existence (nonexistent paths still resolve)", () => {
    const p = resolveScriptPath("nonexistent.ts");
    expect(p.endsWith("/adws/nonexistent.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listAvailableScripts
// ---------------------------------------------------------------------------

describe("listAvailableScripts", () => {
  test("returns the default script and other adw-*.ts entries", () => {
    const list = listAvailableScripts();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain("adw-plan-review-build-patch.ts");
    expect(list).toContain("adw-build.ts");
    expect(list).toContain("adw-launch.ts");
    // Sorted.
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
  });

  test("only includes files starting with adw- and ending in .ts", () => {
    for (const f of listAvailableScripts()) {
      expect(f.startsWith("adw-")).toBe(true);
      expect(f.endsWith(".ts")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------

describe("shellQuote", () => {
  test("wraps a plain string in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  test("preserves spaces inside the quotes", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  test("escapes embedded single quotes via close-escape-reopen", () => {
    // "it's" → 'it'\''s'
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("handles paths with spaces", () => {
    expect(shellQuote("path with spaces.md")).toBe("'path with spaces.md'");
  });

  test("empty string → ''", () => {
    expect(shellQuote("")).toBe("''");
  });
});

// ---------------------------------------------------------------------------
// buildForegroundArgv
// ---------------------------------------------------------------------------

describe("buildForegroundArgv", () => {
  test("produces ['bun', scriptPath, ...scriptArgs]", () => {
    expect(buildForegroundArgv("/repo/adws/x.ts", [])).toEqual(["bun", "/repo/adws/x.ts"]);
  });

  test("preserves args with spaces verbatim (no shell joining)", () => {
    const argv = buildForegroundArgv("/repo/adws/x.ts", ["hello world", "path with spaces.md"]);
    expect(argv).toEqual(["bun", "/repo/adws/x.ts", "hello world", "path with spaces.md"]);
    // Critical: each arg stays a single element, not split on spaces.
    expect(argv.length).toBe(4);
    expect(argv[2]).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// buildTmuxCommand
// ---------------------------------------------------------------------------

describe("buildTmuxCommand", () => {
  test("builds a cd-and-exec shell command with each component quoted", () => {
    const cmd = buildTmuxCommand("/repo", "/repo/adws/x.ts", []);
    expect(cmd).toBe("cd '/repo' && exec 'bun' '/repo/adws/x.ts'");
  });

  test("shell-quotes every scriptArgs value (spaces preserved inside quotes)", () => {
    const cmd = buildTmuxCommand("/repo", "/repo/adws/x.ts", ["hello world", "path with spaces.md"]);
    expect(cmd).toBe(
      "cd '/repo' && exec 'bun' '/repo/adws/x.ts' 'hello world' 'path with spaces.md'",
    );
  });

  test("escapes single quotes in args", () => {
    const cmd = buildTmuxCommand("/repo", "/repo/x.ts", ["it's"]);
    expect(cmd).toBe("cd '/repo' && exec 'bun' '/repo/x.ts' 'it'\\''s'");
  });

  test("PROJECT_ROOT with a single quote is escaped in the cd", () => {
    const cmd = buildTmuxCommand("/repo/it's", "/repo/x.ts", []);
    expect(cmd.startsWith("cd '/repo/it'\\''s' && exec ")).toBe(true);
  });

  test("no scriptArgs produces just cd + exec bun + script", () => {
    const cmd = buildTmuxCommand("/r", "/r/s.ts", []);
    expect(cmd).toBe("cd '/r' && exec 'bun' '/r/s.ts'");
  });
});

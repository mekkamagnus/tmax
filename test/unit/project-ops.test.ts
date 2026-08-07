/** project-ops.test.ts — project root detection + file discovery + search */
import { describe, test, expect } from "bun:test";
import { createProjectOps } from "../../src/editor/api/project-ops.ts";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TLispValue } from "../../src/tlisp/types.ts";

function str(s: string): TLispValue { return { type: "string", value: s } as TLispValue; }
function nil(): TLispValue { return { type: "nil", value: null } as TLispValue; }

function call(ops: Map<string, any>, name: string, ...args: any[]): any {
  const fn = ops.get(name)!;
  const tlispArgs = args.map(a => typeof a === "string" ? str(a) : a ?? nil());
  const result = fn(tlispArgs);
  if (result?._tag === "Left") throw new Error(`${name} failed: ${result.left?.message ?? result.left}`);
  return result.right.value;
}

describe("project-ops", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "tmax-proj-"));

  test("project-detect-root finds .git marker", () => {
    const ops = createProjectOps();
    const projDir = join(tmpRoot, "myproject");
    mkdirSync(join(projDir, "src"), { recursive: true });
    mkdirSync(join(projDir, ".git"), { recursive: true });
    writeFileSync(join(projDir, "src", "main.ts"), "console.log('hi');");

    const root = call(ops, "project-detect-root", join(projDir, "src", "main.ts"));
    expect(root).toBe(projDir);
  });

  test("project-detect-root finds package.json marker", () => {
    const ops = createProjectOps();
    const projDir = join(tmpRoot, "nodeproject");
    mkdirSync(join(projDir, "lib"), { recursive: true });
    writeFileSync(join(projDir, "package.json"), '{"name":"test"}');
    writeFileSync(join(projDir, "lib", "index.js"), "module.exports = {};");

    const root = call(ops, "project-detect-root", join(projDir, "lib", "index.js"));
    expect(root).toBe(projDir);
  });

  test("project-detect-root returns nil when no marker", () => {
    const ops = createProjectOps();
    const noProj = join(tmpRoot, "noproject");
    mkdirSync(noProj, { recursive: true });
    writeFileSync(join(noProj, "file.txt"), "hello");

    const result = ops.get("project-detect-root")!([str(join(noProj, "file.txt"))]);
    expect(result._tag).toBe("Right");
    expect((result as any).right.type).toBe("nil");
  });

  test("project-files-walk lists files, respects ignores", () => {
    const ops = createProjectOps();
    const projDir = join(tmpRoot, "walktest");
    mkdirSync(join(projDir, "src"), { recursive: true });
    mkdirSync(join(projDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(projDir, "src", "a.ts"), "a");
    writeFileSync(join(projDir, "src", "b.ts"), "b");
    writeFileSync(join(projDir, "node_modules", "pkg", "index.js"), "ignored");

    const files = call(ops, "project-files-walk", projDir) as any[];
    const paths = files.map((f: any) => f.value as string);
    expect(paths.some((p) => p.endsWith("a.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("b.ts"))).toBe(true);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
  });

  test("project-search finds pattern across files", () => {
    const ops = createProjectOps();
    const projDir = join(tmpRoot, "searchtest");
    mkdirSync(join(projDir, "src"), { recursive: true });
    writeFileSync(join(projDir, "src", "find.ts"), "TODO: fix this\nconsole.log('ok');");
    writeFileSync(join(projDir, "src", "other.ts"), "const x = 1;\n// TODO: review");

    const matches = call(ops, "project-search", projDir, "TODO") as any[];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      const items = m.value as any[];
      expect(items[0]!.type).toBe("string"); // file path
      expect(items[1]!.type).toBe("number"); // line number
      expect(items[2]!.type).toBe("string"); // line content
    }
  });
});

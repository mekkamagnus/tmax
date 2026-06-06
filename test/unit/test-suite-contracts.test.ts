import { describe, expect, test } from "bun:test";

describe("test-suite contracts", () => {
  test("editor startup is always awaited in TypeScript tests", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("test/**/*.{test.ts,ts}");

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();
      source.split("\n").forEach((line, index) => {
        if (/\beditor\.start\(\);/.test(line) && !/\bawait\s+editor\.start\(\);/.test(line)) {
          violations.push(`${path}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  }, 15000);

  test("editor key handling uses the current one-argument contract", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("test/**/*.{test.ts,ts}");

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();
      source.split("\n").forEach((line, index) => {
        const lineWithoutStrings = line.replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`/g, "\"\"");
        if (/\.handleKey\([^)]*,/.test(lineWithoutStrings)) {
          violations.push(`${path}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  }, 15000);
});

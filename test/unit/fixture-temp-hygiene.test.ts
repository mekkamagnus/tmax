import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { createEditorAfterFixture, createEditorFixture } from "../helpers/editor-fixture.ts";

const box = mkdtempSync(join(tmpdir(), "fixture-hygiene-"));
afterAll(() => rmSync(box, { recursive: true, force: true }));

test("fixture log directories are cleaned up after child test files", () => {
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  const isolatesModules = major > 1 || (major === 1 && minor >= 4);
  const home = join(box, "home");
  mkdirSync(home);
  for (const flag of ["--parallel", "--isolate", ""]) {
    const temp = mkdtempSync(join(box, "tmp-"));
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", ...(flag ? [flag] : []), "test/fixtures/fixture-temp-child-a.test.ts", "test/fixtures/fixture-temp-child-b.test.ts", "--timeout", "60000"],
      env: { ...process.env, TMPDIR: temp, HOME: home, TMAX_FIXTURE_CHILD: "1" },
      stdout: "pipe", stderr: "pipe", timeout: 120000,
    });
    const output = result.stdout.toString() + result.stderr.toString();
    expect({ exitCode: result.exitCode, output }).toMatchObject({ exitCode: 0 });
    expect(output).toContain("2 pass");
    const leftovers = readdirSync(temp).filter(name => name.startsWith("tmax-test-log-"));
    if (flag && isolatesModules) expect(leftovers).toEqual([]);
    else {
      expect(leftovers.length).toBeLessThanOrEqual(1);
      if (leftovers.length) expect(statSync(join(temp, leftovers[0]!)).isDirectory()).toBe(true);
    }
    expect(existsSync(join(home, ".config/tmax/messages.log"))).toBe(false);
  }
}, 400000);

test("fixture editors have isolated logs and tail-load their own history", async () => {
  const original = process.env.TMAX_LOG_PATH;
  const fixtures: Awaited<ReturnType<typeof createEditorFixture>>[] = [];
  try {
    const first = await createEditorFixture();
    fixtures.push(first);
    const firstPath = process.env.TMAX_LOG_PATH!;
    const second = await createEditorFixture();
    fixtures.push(second);
    const secondPath = process.env.TMAX_LOG_PATH!;
    expect(firstPath).not.toBe(secondPath);
    for (const path of [firstPath, secondPath]) {
      const rel = relative(tmpdir(), path);
      expect(rel.startsWith("..")).toBe(false);
      expect(isAbsolute(rel)).toBe(false);
      expect(path).not.toBe(join(homedir(), ".config/tmax/messages.log"));
    }
    first.editor.logMessage("first-isolation-marker");
    second.editor.logMessage("second-isolation-marker");
    await Bun.sleep(0);
    const firstLog = readFileSync(firstPath, "utf8");
    const secondLog = readFileSync(secondPath, "utf8");
    expect(firstLog).toContain("first-isolation-marker");
    expect(firstLog).not.toContain("second-isolation-marker");
    expect(secondLog).toContain("second-isolation-marker");
    expect(secondLog).not.toContain("first-isolation-marker");
    const third = createEditorAfterFixture();
    const loaded = third.getUnifiedLog().getEntries().map(entry => entry.text);
    expect(loaded).toContain("second-isolation-marker");
    expect(loaded).not.toContain("first-isolation-marker");
    third.stop();
    await Bun.sleep(0);
  } finally {
    for (const fixture of fixtures) fixture.dispose();
    if (original === undefined) delete process.env.TMAX_LOG_PATH;
    else process.env.TMAX_LOG_PATH = original;
  }
});

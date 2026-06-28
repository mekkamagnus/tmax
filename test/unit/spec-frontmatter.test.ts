/**
 * @file spec-frontmatter.test.ts
 * @description CHORE-40 unit tests for the shared `goal` frontmatter parser.
 * All fixtures are temp files — no real specs are read.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseGoalFromSpec, SpecFrontmatterError } from "../../adws/adws-modules/spec-frontmatter.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "spec-fm-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSpec(name: string, content: string): string {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
}

describe("parseGoalFromSpec", () => {
  test("no frontmatter returns undefined", () => {
    const p = writeSpec("no-fm.md", "# Spec\n\nNo frontmatter here.");
    expect(parseGoalFromSpec(p)).toBeUndefined();
  });

  test("normal --- ... --- frontmatter extracts goal (double-quoted)", () => {
    const p = writeSpec("quoted.md", '---\ngoal: "bun run test:unit passes"\n---\n\n# Spec');
    expect(parseGoalFromSpec(p)).toBe("bun run test:unit passes");
  });

  test("single-quoted goal strips only the outer pair", () => {
    const p = writeSpec("single.md", "---\ngoal: 'bun run typecheck'\n---\n\n# Spec");
    expect(parseGoalFromSpec(p)).toBe("bun run typecheck");
  });

  test("plain (unquoted) goal without : or # is accepted", () => {
    const p = writeSpec("plain.md", "---\ngoal: all-tests-pass\n---\n\n# Spec");
    expect(parseGoalFromSpec(p)).toBe("all-tests-pass");
  });

  test("frontmatter with a blank line before closing delimiter still parses", () => {
    const p = writeSpec("blank.md", '---\ngoal: "done"\n\n---\n\n# Spec');
    expect(parseGoalFromSpec(p)).toBe("done");
  });

  test("frontmatter with no goal returns undefined", () => {
    const p = writeSpec("no-goal.md", "---\ntitle: Some Spec\n---\n\n# Spec");
    expect(parseGoalFromSpec(p)).toBeUndefined();
  });

  test("empty goal returns undefined", () => {
    const p = writeSpec("empty-goal.md", "---\ngoal:\n---\n\n# Spec");
    expect(parseGoalFromSpec(p)).toBeUndefined();
  });

  test("missing closing delimiter throws SpecFrontmatterError", () => {
    const p = writeSpec("unclosed.md", "---\ngoal: \"done\"\n\n# Spec with no closing");
    expect(() => parseGoalFromSpec(p)).toThrow(SpecFrontmatterError);
    expect(() => parseGoalFromSpec(p)).toThrow(/opening --- with no closing ---/);
  });

  test("goal value with unquoted ': ' throws SpecFrontmatterError", () => {
    const p = writeSpec("colon.md", "---\ngoal: bun run typecheck && foo: bar\n---\n\n# Spec");
    expect(() => parseGoalFromSpec(p)).toThrow(SpecFrontmatterError);
    expect(() => parseGoalFromSpec(p)).toThrow(/unquoted ': ' or '#'/);
  });

  test("goal value with unquoted '#' throws SpecFrontmatterError", () => {
    const p = writeSpec("hash.md", "---\ngoal: run tests # comment\n---\n\n# Spec");
    expect(() => parseGoalFromSpec(p)).toThrow(SpecFrontmatterError);
    expect(() => parseGoalFromSpec(p)).toThrow(/unquoted ': ' or '#'/);
  });

  test("goal value with balanced outer double quotes strips only the outer pair", () => {
    // Inner single quotes survive; only the outer double-quote pair is stripped.
    const p = writeSpec("inner.md', ' + '.md", "---\ngoal: \"bun run test:unit && echo 'hi'\"\n---\n\n# Spec");
    expect(parseGoalFromSpec(p)).toBe("bun run test:unit && echo 'hi'");
  });

  test("goal value with unbalanced quotes throws SpecFrontmatterError", () => {
    const p = writeSpec("unbalanced.md", '---\ngoal: "unbalanced\n---\n\n# Spec');
    expect(() => parseGoalFromSpec(p)).toThrow(SpecFrontmatterError);
    expect(() => parseGoalFromSpec(p)).toThrow(/not balanced/);
  });

  test("YAML block scalar goal is rejected", () => {
    const p = writeSpec("block.md", "---\ngoal: |\n  multiline\n---\n\n# Spec");
    expect(() => parseGoalFromSpec(p)).toThrow(SpecFrontmatterError);
    expect(() => parseGoalFromSpec(p)).toThrow(/block scalar/);
  });

  test("missing file returns undefined (not an error)", () => {
    expect(parseGoalFromSpec(join(tmp, "nonexistent.md"))).toBeUndefined();
  });

  test("double-quoted goal containing ': ' is accepted (quotes protect it)", () => {
    const p = writeSpec("protected.md", '---\ngoal: "run: the thing"\n---\n\n# Spec');
    expect(parseGoalFromSpec(p)).toBe("run: the thing");
  });
});

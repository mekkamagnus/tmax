/**
 * @file adw-spec-review-verdict-line.test.ts
 * @description §D1: focused unit tests for the spec-review verdict line formatter.
 * Exercises formatVerdictLine directly — pass one-liner, fail with 3 issues, 11
 * issues cap, long issue truncation, embedded-newline collapse, empty-issues
 * safety, non-string coercion.
 */
import { describe, test, expect } from "bun:test";
import { formatVerdictLine } from "../../adws/adw-spec-review.ts";
import type { ReviewVerdictPayload } from "../../adws/adws-modules/reviewer.ts";

describe("formatVerdictLine (§D1)", () => {
  test("pass verdict → single line, no bullets", () => {
    const v: ReviewVerdictPayload = { verdict: "pass", summary: "ok", issues: [] };
    expect(formatVerdictLine(v)).toBe("adw-spec-review: verdict=pass\n");
  });

  test("fail with 3 issues → header + 3 bullets, no tail", () => {
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "bad",
      issues: [
        "Validation Commands list `bun run build` but the spec adds no build script",
        "AC#2 references a file path that does not exist in the repo",
        "Edge case for stderr-closed is missing",
      ],
    };
    const out = formatVerdictLine(v);
    expect(out).toContain("verdict=fail — 3 issues:\n");
    expect(out).toContain("  - Validation Commands list");
    expect(out).toContain("  - AC#2 references a file path");
    expect(out).toContain("  - Edge case for stderr-closed is missing\n");
    expect(out).not.toContain("more)");
  });

  test("fail with 11 issues → cap at 10 + '... (1 more)' tail", () => {
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "broken",
      issues: Array.from({ length: 11 }, (_, i) => `issue ${i + 1}`),
    };
    const out = formatVerdictLine(v);
    expect(out).toContain("verdict=fail — 11 issues:\n");
    // Exactly 10 bullets.
    const bulletCount = (out.match(/^  - /gm) ?? []).length;
    expect(bulletCount).toBe(10);
    expect(out).toContain("  ... (1 more)\n");
  });

  test("fail with exactly 10 issues → no tail", () => {
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "broken",
      issues: Array.from({ length: 10 }, (_, i) => `issue ${i + 1}`),
    };
    const out = formatVerdictLine(v);
    expect(out).not.toContain("more)");
    const bulletCount = (out.match(/^  - /gm) ?? []).length;
    expect(bulletCount).toBe(10);
  });

  test("single issue >200 chars → truncated with trailing '...'", () => {
    const longIssue = "x".repeat(300);
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "bad",
      issues: [longIssue],
    };
    const out = formatVerdictLine(v);
    const bullet = out.split("\n").find((l) => l.startsWith("  - "))!;
    expect(bullet.length).toBeLessThan(210);
    expect(bullet.endsWith("...")).toBe(true);
  });

  test("issue with embedded newlines → collapsed to single line", () => {
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "bad",
      issues: ["line one\nline two\nline three"],
    };
    const out = formatVerdictLine(v);
    // The bullet containing this issue must be a single line.
    const bullet = out.split("\n").find((l) => l.includes("line one"));
    expect(bullet).toBeDefined();
    expect(bullet!).toContain("line one line two line three");
  });

  test("fail with empty issues array → header only, no bullets", () => {
    const v: ReviewVerdictPayload = { verdict: "fail", summary: "bad", issues: [] };
    const out = formatVerdictLine(v);
    expect(out).toBe("adw-spec-review: verdict=fail — 0 issues:\n");
  });

  test("non-string issue entries → coerced via String()", () => {
    const v: ReviewVerdictPayload = {
      verdict: "fail",
      summary: "bad",
      issues: [42 as unknown as string],
    };
    const out = formatVerdictLine(v);
    expect(out).toContain("  - 42\n");
  });

  test("header is pluralized correctly (1 issue vs N issues)", () => {
    const v1: ReviewVerdictPayload = { verdict: "fail", summary: "x", issues: ["only one"] };
    const v2: ReviewVerdictPayload = { verdict: "fail", summary: "x", issues: ["a", "b"] };
    expect(formatVerdictLine(v1)).toContain("verdict=fail — 1 issue:\n");
    expect(formatVerdictLine(v2)).toContain("verdict=fail — 2 issues:\n");
  });
});

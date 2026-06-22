/**
 * @file live-filter.test.ts
 * @description Unit tests for adws/adws-modules/live-filter.ts (§C pure helper).
 */
import { describe, test, expect } from "bun:test";
import { formatToolUseLine } from "../../adws/adws-modules/live-filter.ts";

function assistantLine(content: unknown[]): string {
  return JSON.stringify({ type: "assistant", message: { content } });
}

function toolUseBlock(name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_use", name, input, id: `tu_${name}` };
}

describe("formatToolUseLine", () => {
  // --- Tool name → keyInput mapping ---

  test("Edit → file path", () => {
    const line = assistantLine([toolUseBlock("Edit", { file_path: "src/editor/editor.ts" })]);
    expect(formatToolUseLine("build", line)).toBe("[build] Edit src/editor/editor.ts");
  });

  test("MultiEdit → file path", () => {
    const line = assistantLine([toolUseBlock("MultiEdit", { file_path: "src/core/buffer.ts" })]);
    expect(formatToolUseLine("build", line)).toBe("[build] MultiEdit src/core/buffer.ts");
  });

  test("Write → file path", () => {
    const line = assistantLine([toolUseBlock("Write", { file_path: "adws/adws-modules/live-filter.ts" })]);
    expect(formatToolUseLine("build", line)).toBe("[build] Write adws/adws-modules/live-filter.ts");
  });

  test("Read → file path", () => {
    const line = assistantLine([toolUseBlock("Read", { file_path: "src/server/server.ts" })]);
    expect(formatToolUseLine("plan", line)).toBe("[plan] Read src/server/server.ts");
  });

  test("Bash → command (first line)", () => {
    const line = assistantLine([toolUseBlock("Bash", { command: "bun run typecheck:src" })]);
    expect(formatToolUseLine("build", line)).toBe("[build] Bash bun run typecheck:src");
  });

  test("Grep → pattern", () => {
    const line = assistantLine([toolUseBlock("Grep", { pattern: "gapBuffer", path: "src" })]);
    expect(formatToolUseLine("build", line)).toBe("[build] Grep gapBuffer");
  });

  test("Glob → pattern", () => {
    const line = assistantLine([toolUseBlock("Glob", { pattern: "src/**/*.ts" })]);
    expect(formatToolUseLine("plan", line)).toBe("[plan] Glob src/**/*.ts");
  });

  // --- Edge cases ---

  test("Bash: multi-line command → only first line shown", () => {
    const cmd = "bun run test:unit &&\nbun run test:tmax-use";
    const line = assistantLine([toolUseBlock("Bash", { command: cmd })]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    expect(result!).not.toContain("\n");
    expect(result!).toContain("bun run test:unit");
    expect(result!).not.toContain("test:tmax-use");
  });

  test("Bash: long command → truncated to ~80 chars", () => {
    const cmd = "x".repeat(200);
    const line = assistantLine([toolUseBlock("Bash", { command: cmd })]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThan(100); // label + "Bash " + 80 + "..."
    expect(result!.endsWith("...")).toBe(true);
  });

  test("Unknown tool name → graceful fallback to first string field", () => {
    const line = assistantLine([toolUseBlock("SomeNewTool", { query: "hello world", foo: 42 })]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    expect(result!).toBe("[build] SomeNewTool hello world");
  });

  test("Unknown tool with no string fields → tool name only", () => {
    const line = assistantLine([toolUseBlock("NewTool", { count: 5, flag: true })]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    expect(result!).toBe("[build] NewTool");
  });

  // --- Non-tool-use events → null ---

  test("Top-level type:tool_use line → null (not the nested shape)", () => {
    const line = JSON.stringify({ type: "tool_use", name: "Edit", input: { file_path: "x.ts" } });
    expect(formatToolUseLine("build", line)).toBeNull();
  });

  test("Assistant with only text content → null", () => {
    const line = assistantLine([{ type: "text", text: "Thinking about the approach..." }]);
    expect(formatToolUseLine("build", line)).toBeNull();
  });

  test("type:text delta → null", () => {
    const line = JSON.stringify({ type: "text", text: "partial" });
    expect(formatToolUseLine("build", line)).toBeNull();
  });

  test("type:tool_result → null", () => {
    const line = JSON.stringify({ type: "tool_result", content: "done" });
    expect(formatToolUseLine("build", line)).toBeNull();
  });

  test("type:result → null", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" });
    expect(formatToolUseLine("build", line)).toBeNull();
  });

  test("Malformed non-JSON line → null", () => {
    expect(formatToolUseLine("build", "not json at all")).toBeNull();
    expect(formatToolUseLine("build", "{ broken")).toBeNull();
    expect(formatToolUseLine("build", "")).toBeNull();
  });

  // --- Multiple tool_use blocks ---

  test("Multiple tool_use blocks in one assistant event → all represented", () => {
    const line = assistantLine([
      toolUseBlock("Edit", { file_path: "src/a.ts" }),
      toolUseBlock("Edit", { file_path: "src/b.ts" }),
    ]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    const parts = result!.split("\n");
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe("[build] Edit src/a.ts");
    expect(parts[1]).toBe("[build] Edit src/b.ts");
  });

  test("Mixed content (text + tool_use) → only tool_use line(s)", () => {
    const line = assistantLine([
      { type: "text", text: "Let me edit the file." },
      toolUseBlock("Edit", { file_path: "src/foo.ts" }),
    ]);
    const result = formatToolUseLine("build", line);
    expect(result).not.toBeNull();
    expect(result!).toBe("[build] Edit src/foo.ts");
  });

  // --- Label interpolation ---

  test("Label is interpolated correctly", () => {
    const line = assistantLine([toolUseBlock("Read", { file_path: "x.ts" })]);
    expect(formatToolUseLine("patch-review", line)).toBe("[patch-review] Read x.ts");
    expect(formatToolUseLine("plan", line)).toBe("[plan] Read x.ts");
  });
});

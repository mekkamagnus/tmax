/**
 * live-filter.ts — pure stream-json line filter for live console visibility (§C).
 *
 * Parses a single stream-json line from `claude --output-format stream-json` and,
 * if it contains a nested assistant `message.content[]` block with
 * `type: "tool_use"`, returns a short `[label] ToolName keyInput` string suitable
 * for one-glance console output. Returns `null` for every other event type:
 * text deltas, tool_result, result, system events, malformed lines, and assistant
 * events without tool calls.
 *
 * Pure function — no I/O, no side effects, no imports beyond JSON.
 */

/** Truncation limits for key inputs — keeps console lines readable. */
const MAX_BASH_LEN = 80;
const MAX_GENERIC_LEN = 80;
const MAX_FILE_LEN = 80;

/**
 * Extract the key input string for a given tool name from its input object.
 * Returns a short, single-line string representing what the tool operates on.
 */
function extractKeyInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const fp = input.file_path;
      if (typeof fp === "string") return truncate(fp, MAX_FILE_LEN);
      return firstStringField(input);
    }
    case "Bash": {
      const cmd = input.command;
      if (typeof cmd === "string") {
        const firstLine = cmd.split("\n")[0] ?? cmd;
        return truncate(firstLine, MAX_BASH_LEN);
      }
      return firstStringField(input);
    }
    case "Grep":
    case "Glob": {
      const pattern = input.pattern;
      if (typeof pattern === "string") return truncate(pattern, MAX_GENERIC_LEN);
      const path = input.path;
      if (typeof path === "string") return truncate(path, MAX_GENERIC_LEN);
      return firstStringField(input);
    }
    default:
      return firstStringField(input);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

/** Fallback: return the first string-valued field, truncated. */
function firstStringField(input: Record<string, unknown>): string {
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0) {
      return truncate(v, MAX_GENERIC_LEN);
    }
  }
  return "";
}

/**
 * Parse a stream-json line and return the filtered tool-use string(s).
 *
 * Returns `null` for:
 * - Malformed (non-JSON) lines.
 * - Events where `type !== "assistant"`.
 * - Assistant events without `message.content` or without any `tool_use` blocks.
 *
 * Returns one `[label] ToolName keyInput` line per tool_use block. If a single
 * assistant event contains multiple tool_use blocks, all are represented —
 * joined with `\n`. This preserves the common single-tool case as a single
 * string while not silently dropping later tool calls.
 *
 * @param label  The stage label, e.g. `"build"` or `"plan"`.
 * @param jsonLine  One complete stream-json line (without trailing newline).
 * @returns The formatted line(s), or `null` if the event has no tool_use blocks.
 */
export function formatToolUseLine(label: string, jsonLine: string): string | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonLine) as Record<string, unknown>;
  } catch {
    return null; // malformed line — skip
  }

  // Only assistant events carry tool_use blocks in the nested content shape.
  if (obj.type !== "assistant") return null;

  const message = obj.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return null;

  const lines: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "tool_use"
    ) {
      const b = block as Record<string, unknown>;
      const name = typeof b.name === "string" ? b.name : "unknown";
      const input = (typeof b.input === "object" && b.input !== null ? b.input : {}) as Record<string, unknown>;
      const keyInput = extractKeyInput(name, input);
      const line = keyInput ? `[${label}] ${name} ${keyInput}` : `[${label}] ${name}`;
      lines.push(line);
    }
  }

  if (lines.length === 0) return null;
  return lines.join("\n");
}

/**
 * spec-frontmatter.ts — shared, dependency-free parser for the optional `goal`
 * field in a spec's YAML frontmatter (CHORE-40).
 *
 * Both `adw-build.ts` (the build subprocess) and `adw-plan-review-build-patch.ts`
 * (the orchestrator) import this single helper rather than duplicating parser
 * logic. The parser is intentionally minimal — it extracts only the `goal`
 * string field and enforces quoting rules that avoid the `: ` bug class that
 * broke 7 skill files in June 2026. It does NOT handle nested maps, lists,
 * anchors, or YAML block scalars; those are out of scope for CHORE-40.
 */
import { readFileSync } from "fs";

/**
 * Thrown when frontmatter is malformed: missing closing delimiter, unquoted
 * `: `/`#` in a goal value, unbalanced quotes, or a YAML block scalar. Callers
 * fail the build on this error rather than silently disabling goal mode —
 * malformed `goal:` frontmatter is a spec-authoring mistake worth surfacing.
 */
export class SpecFrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecFrontmatterError";
  }
}

/**
 * Extract the optional `goal` string from a spec file's YAML frontmatter.
 *
 * @returns the goal string, or `undefined` if there is no frontmatter, no
 *          `goal` field, or an empty goal.
 * @throws {SpecFrontmatterError} if the frontmatter is malformed (missing
 *          closing delimiter, unquoted `: `/`#`, unbalanced quotes, block scalar).
 */
export function parseGoalFromSpec(specPath: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(specPath, "utf8");
  } catch (e) {
    // A spec we can't read is not a frontmatter error — let the caller handle
    // the missing file. Return undefined (no goal).
    return undefined;
  }

  // Rule 2: only parse if the file opens with a standalone `---` line.
  const firstNewline = content.indexOf("\n");
  const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
  if (firstLine.trim() !== "---") return undefined;

  // Rule 3: find the closing standalone `---`. Do NOT stop at blank lines or
  // headers — valid YAML frontmatter may contain them.
  const afterFirstLine = firstNewline === -1 ? "" : content.slice(firstNewline + 1);
  const lines = afterFirstLine.split("\n");
  let closingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    // Rule 5: opening `---` with no closing `---` is malformed.
    throw new SpecFrontmatterError(
      `spec-frontmatter: ${specPath} has an opening --- with no closing ---`,
    );
  }

  const frontmatterLines = lines.slice(0, closingIdx);

  // Find the `goal:` line (first match wins).
  let goalLineIdx = -1;
  let goalValueRaw = "";
  for (let i = 0; i < frontmatterLines.length; i++) {
    const line = frontmatterLines[i]!;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("goal:")) {
      goalLineIdx = i;
      // Everything after `goal:` on the same line (Rule 7: single-line only).
      goalValueRaw = line.slice(line.indexOf("goal:") + "goal:".length);
      break;
    }
  }
  if (goalLineIdx === -1) return undefined; // Rule 6: no goal field.

  // Rule 7: reject YAML block scalars (multiline goals) up front.
  if (goalValueRaw.trimStart().startsWith("|") || goalValueRaw.trimStart().startsWith(">")) {
    throw new SpecFrontmatterError(
      `spec-frontmatter: goal value at ${specPath}:${goalLineIdx + 2} uses a YAML block scalar (| or >) — frontmatter goals must be single-line; multiline goals are CLI-only via --goal`,
    );
  }

  const value = goalValueRaw.trim();
  if (value === "") return undefined; // Rule 6: empty goal.

  return extractGoalValue(value, specPath, goalLineIdx + 2);
}

/**
 * Given the trimmed value portion after `goal:`, apply quoting rules and return
 * the final string. Throws SpecFrontmatterError on malformed input.
 *
 * @param displayLineNo 1-based line number for error messages (frontmatter
 *                      section line, +2 for the leading `---` line and 0-indexing).
 */
function extractGoalValue(value: string, specPath: string, displayLineNo: number): string {
  // Quoted value: must be balanced (same quote char at both ends).
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0]!;
    if (!value.endsWith(quote) || value.length < 2) {
      throw new SpecFrontmatterError(
        `spec-frontmatter: goal value at ${specPath}:${displayLineNo} starts with ${quote} but is not balanced — fix the quotes`,
      );
    }
    // Strip only the outermost matching pair; leave inner quotes intact.
    return value.slice(1, -1);
  }

  // Unquoted value: enforce the `: ` / `#` guardrail (Concern #4). A bare
  // `: ` risks YAML map parsing; a `#` risks YAML comment truncation. Require
  // quotes for either.
  if (value.includes(": ") || value.includes("#")) {
    throw new SpecFrontmatterError(
      `spec-frontmatter: goal value at ${specPath}:${displayLineNo} contains unquoted ': ' or '#' — double-quote the value (see CHORE-40 Step 3)`,
    );
  }

  return value;
}

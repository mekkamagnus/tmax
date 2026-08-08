/** snippet-fields.test.ts — #167 Phase 3-4: field marker tracking + navigation */
import { describe, test, expect } from "bun:test";
import { SnippetManager } from "../../src/editor/api/snippet-ops.ts";

describe("SnippetManager — field marker tracking", () => {
  test("startExpansion records field positions", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("function ${1:name}() {\n  $0\n}");
    mgr.startExpansion(fields, 5, 10);

    expect(mgr.active).not.toBeNull();
    expect(mgr.active!.fields.length).toBeGreaterThanOrEqual(2); // $1 + $0
  });

  test("currentField returns the first field after startExpansion", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x} = ${2:y}");
    mgr.startExpansion(fields, 0, 0);

    const field = mgr.currentField();
    expect(field).not.toBeNull();
    expect(field!.id).toBe(1);
    // Field at position (0, 0) with default "x" → startCol 0
    expect(field!.startLine).toBe(0);
    expect(field!.startCol).toBe(0);
  });

  test("nextField advances to the next field", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x} = ${2:y}$0");
    mgr.startExpansion(fields, 0, 0);

    const f1 = mgr.currentField();
    expect(f1!.id).toBe(1);

    const f2 = mgr.nextField();
    expect(f2).not.toBeNull();
    expect(f2!.id).toBe(2);

    // Advance past $2 → reach $0 (final position)
    const f0 = mgr.nextField();
    expect(f0).not.toBeNull();
    expect(f0!.id).toBe(0);
  });

  test("nextField returns null after $0 (all fields exhausted)", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x}$0");
    mgr.startExpansion(fields, 0, 0);

    mgr.nextField(); // skip $1 → $0
    mgr.nextField(); // skip $0 → done
    expect(mgr.nextField()).toBeNull();
    expect(mgr.active).toBeNull();
  });

  test("prevField goes backward", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:a}${2:b}${3:c}$0");
    mgr.startExpansion(fields, 0, 0);

    mgr.nextField(); // $1 → $2
    mgr.nextField(); // $2 → $3
    expect(mgr.currentField()!.id).toBe(3);

    mgr.prevField(); // $3 → $2
    expect(mgr.currentField()!.id).toBe(2);
  });

  test("prevField returns null at the first field", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x}$0");
    mgr.startExpansion(fields, 0, 0);

    expect(mgr.prevField()).toBeNull();
    expect(mgr.currentField()!.id).toBe(1);
  });

  test("exit clears active state", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x}$0");
    mgr.startExpansion(fields, 0, 0);

    expect(mgr.active).not.toBeNull();
    mgr.exit();
    expect(mgr.active).toBeNull();
    expect(mgr.currentField()).toBeNull();
  });

  test("mirror fields are tracked in the field", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("${1:x} = ${1:x} + 1");
    mgr.startExpansion(fields, 0, 0);

    const f1 = mgr.currentField()!;
    expect(f1.mirrors.length).toBe(1); // second occurrence is a mirror
  });

  test("field positions computed from insertion point", () => {
    const mgr = new SnippetManager("/tmp/test-snip");
    const { fields } = mgr.parsePlaceholders("function ${1:name}() {\n  $0\n}");
    // Insert at line 10, col 5
    mgr.startExpansion(fields, 10, 5);

    const f1 = mgr.currentField()!;
    // ${1:name} is at relative (0, 9) → absolute (10, 5+9=14)
    expect(f1.startLine).toBe(10);
    expect(f1.startCol).toBe(14);

    // $0 is at relative (1, 2) → absolute (11, 2)
    const f0 = mgr.nextField()!;
    expect(f0.startLine).toBe(11);
    expect(f0.startCol).toBe(2);
  });
});

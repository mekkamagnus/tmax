import { describe, expect, test } from "bun:test";
import { resolveKeyBinding } from "../../src/editor/key-resolution.ts";

describe("mode-aware key resolution", () => {
  test("minor mode shadows major and global bindings", () => {
    const result = resolveKeyBinding({
      activeMinorModes: ["older", "newer"],
      minorModeBindings: {
        older: { x: "(older)" },
        newer: { x: "(newer)" },
      },
      currentMajorMode: "python",
      majorModeBindings: { python: { x: "(python)" } },
      globalBindings: { x: "(global)" },
    }, "x");

    expect(result).toEqual({ command: "(newer)", source: "minor", sourceMode: "newer" });
  });

  test("major mode shadows mode-specific and global bindings", () => {
    const result = resolveKeyBinding({
      currentMajorMode: "python",
      majorModeBindings: { python: { x: "(python)" } },
      modeBindings: { x: "(normal)" },
      globalBindings: { x: "(global)" },
    }, "x");

    expect(result).toEqual({ command: "(python)", source: "major", sourceMode: "python" });
  });

  test("falls back to mode then global bindings", () => {
    expect(resolveKeyBinding({ modeBindings: { x: "(normal)" }, globalBindings: { x: "(global)" } }, "x"))
      .toEqual({ command: "(normal)", source: "mode" });
    expect(resolveKeyBinding({ globalBindings: { x: "(global)" } }, "x"))
      .toEqual({ command: "(global)", source: "global" });
  });
});

import { describe, test, expect } from "bun:test";
import {
  computeWhichKeyPopup,
  renderWhichKeyOverlay,
} from "../../src/frontend/render/which-key-overlay.ts";
import type { WhichKeyBinding } from "../../src/core/types.ts";

const Z_BINDINGS: WhichKeyBinding[] = [
  { key: "z t", command: "(scroll-cursor-top)", mode: "normal" },
  { key: "z z", command: "(scroll-cursor-center)", mode: "normal" },
  { key: "z b", command: "(scroll-cursor-bottom)", mode: "normal" },
  { key: "z l", command: "(scroll-column-left)", mode: "normal" },
  { key: "z h", command: "(scroll-column-right)", mode: "normal" },
  { key: "z s", command: "(scroll-cursor-start)", mode: "normal" },
  { key: "z e", command: "(scroll-cursor-end)", mode: "normal" },
];

describe("computeWhichKeyPopup", () => {
  test("returns empty for zero bindings", () => {
    const result = computeWhichKeyPopup([], "z", 80, 10, "z — scroll/viewport");
    expect(result.rows).toHaveLength(0);
    expect(result.height).toBe(0);
    expect(result.prefixLabel).toBe("z — scroll/viewport");
  });

  test("produces rows for 7 bindings at 80-width", () => {
    const result = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z — scroll/viewport");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(9); // maxRows - 1 for header
    expect(result.prefixLabel).toBe("z — scroll/viewport");
  });

  test("each entry has extracted command name without parens", () => {
    const result = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z — scroll/viewport");
    const flat = result.rows.flat();
    expect(flat.length).toBe(7);
    expect(flat[0]!.key).toBe("t");
    expect(flat[0]!.command).toBe("scroll-cursor-top");
    expect(flat[1]!.key).toBe("z");
    expect(flat[1]!.command).toBe("scroll-cursor-center");
  });

  test("uses raw prefix as default label when no label provided", () => {
    const result = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10);
    expect(result.prefixLabel).toBe("z");
  });

  test("truncates to maxRows - 1 (reserves header row)", () => {
    const many: WhichKeyBinding[] = Array.from({ length: 20 }, (_, i) => ({
      key: `z ${String.fromCharCode(97 + i)}`, command: `(cmd-${i})`, mode: "normal",
    }));
    const result = computeWhichKeyPopup(many, "z", 80, 4, "z — test");
    expect(result.rows.length).toBeLessThanOrEqual(3); // maxRows - 1
  });

  test("adjusts to single column for narrow terminals", () => {
    const result = computeWhichKeyPopup(Z_BINDINGS, "z", 30, 10, "z");
    expect(result.rows.length).toBeGreaterThan(0);
    // At 30-width, each row should have at most 1 entry
    for (const row of result.rows) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("renderWhichKeyOverlay", () => {
  test("produces at least 2 lines for non-empty popup (header + border)", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z — scroll/viewport");
    const lines = renderWhichKeyOverlay(popup, 80);
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + border
  });

  test("header row contains prefix label text", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z — scroll/viewport");
    const lines = renderWhichKeyOverlay(popup, 80);
    const header = lines[0]!;
    expect(header).toContain("z — scroll/viewport");
  });

  test("header row uses accent color #f0883e", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z — scroll/viewport");
    const lines = renderWhichKeyOverlay(popup, 80);
    const header = lines[0]!;
    // 24-bit color sequence for #f0883e: \x1b[38;2;240;136;62m
    expect(header).toContain("38;2;240;136;62");
  });

  test("binding rows use key color #58a6ff", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    // First binding row is line index 2 (after header + border)
    const bindingLine = lines[2]!;
    // 24-bit color sequence for #58a6ff: \x1b[38;2;88;166;255m
    expect(bindingLine).toContain("38;2;88;166;255");
  });

  test("popup background uses #1a3a6a", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    const header = lines[0]!;
    // 24-bit bg color sequence for #1a3a6a: \x1b[48;2;26;58;106m
    expect(header).toContain("48;2;26;58;106");
  });

  test("empty bindings produce only header + border", () => {
    const popup = computeWhichKeyPopup([], "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    expect(lines).toHaveLength(2);
  });

  test("command names appear as light gray #c9d1d9", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    const bindingLine = lines[2]!;
    // 24-bit color for #c9d1d9: \x1b[38;2;201;209;217m
    expect(bindingLine).toContain("38;2;201;209;217");
  });

  test("no raw \\x1b[44m or \\x1b[36m escape codes", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    for (const line of lines) {
      expect(line).not.toContain("\x1b[44m");
      expect(line).not.toContain("\x1b[36m");
    }
  });

  test("bg color fills full row width (no trailing unstyled padding)", () => {
    const popup = computeWhichKeyPopup(Z_BINDINGS, "z", 80, 10, "z");
    const lines = renderWhichKeyOverlay(popup, 80);
    const header = lines[0]!;
    // The reset \x1b[0m must be the very last sequence — no plain spaces after it
    const afterReset = header.split("\x1b[0m");
    // Only the final segment (after last reset) should be empty or whitespace-free
    const tail = afterReset[afterReset.length - 1]!;
    // The bg-active padding is before the final reset, so the tail after reset is empty
    expect(tail).toHaveLength(0);
  });
});

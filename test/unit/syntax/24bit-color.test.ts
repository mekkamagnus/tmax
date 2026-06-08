/**
 * @file 24bit-color.test.ts
 * @description Tests for 24-bit (true-color) ANSI support: hex colors, mixed mode, strip/pad
 */

import { describe, test, expect } from "bun:test";
import { isHexColor, hexToRGB, fg, bg, bold, style, stripAnsi } from "../../../src/frontend/frontends/steep/style.ts";

describe("24-bit Color Support", () => {
  describe("isHexColor", () => {
    test("accepts valid hex colors", () => {
      expect(isHexColor("#c678dd")).toBe(true);
      expect(isHexColor("#000000")).toBe(true);
      expect(isHexColor("#ffffff")).toBe(true);
      expect(isHexColor("#ABCDEF")).toBe(true);
    });

    test("rejects non-hex strings", () => {
      expect(isHexColor("red")).toBe(false);
      expect(isHexColor("#12345")).toBe(false);
      expect(isHexColor("#1234567")).toBe(false);
      expect(isHexColor("")).toBe(false);
      expect(isHexColor("#GGGGGG")).toBe(false);
    });
  });

  describe("hexToRGB", () => {
    test("converts hex to RGB tuple", () => {
      expect(hexToRGB("#c678dd")).toEqual([198, 120, 221]);
    });

    test("converts black", () => {
      expect(hexToRGB("#000000")).toEqual([0, 0, 0]);
    });

    test("converts white", () => {
      expect(hexToRGB("#ffffff")).toEqual([255, 255, 255]);
    });

    test("converts pure red", () => {
      expect(hexToRGB("#ff0000")).toEqual([255, 0, 0]);
    });
  });

  describe("fg (foreground)", () => {
    test("hex color produces 24-bit escape sequence", () => {
      const result = fg("hello", "#c678dd");
      expect(result).toContain("\x1b[38;2;198;120;221m");
      expect(result).toContain("hello");
      expect(result).toContain("\x1b[0m");
    });

    test("named color produces 256-color escape sequence", () => {
      const result = fg("hello", "green");
      expect(result).toContain("\x1b[38;5;"); // Uses 256-color code
      expect(result).toContain("hello");
    });
  });

  describe("bg (background)", () => {
    test("hex color produces 24-bit background escape sequence", () => {
      const result = bg("hello", "#ff0000");
      expect(result).toContain("\x1b[48;2;255;0;0m");
      expect(result).toContain("hello");
    });

    test("named color produces 256-color background sequence", () => {
      const result = bg("hello", "blue");
      expect(result).toContain("\x1b[48;5;");
    });
  });

  describe("bold", () => {
    test("wraps text with bold escape", () => {
      const result = bold("hello");
      expect(result).toContain("\x1b[1m");
      expect(result).toContain("hello");
      expect(result).toContain("\x1b[22m");
    });
  });

  describe("style", () => {
    test("applies hex fg color", () => {
      const result = style("hello", { fg: "#c678dd" });
      expect(result).toContain("\x1b[38;2;198;120;221m");
      expect(result).toContain("hello");
    });

    test("applies named fg color", () => {
      const result = style("hello", { fg: "green" });
      expect(result).toContain("\x1b[38;5;");
    });

    test("applies bold", () => {
      const result = style("hello", { bold: true });
      expect(result).toContain("\x1b[1m");
    });

    test("applies dim", () => {
      const result = style("hello", { dim: true });
      expect(result).toContain("\x1b[2m");
    });

    test("combines fg + bold", () => {
      const result = style("hello", { fg: "#c678dd", bold: true });
      expect(result).toContain("\x1b[1m");
      expect(result).toContain("\x1b[38;2;198;120;221m");
    });

    test("mixed hex fg + named bg in same line", () => {
      const result = style("hello", { fg: "#c678dd", bg: "black" });
      expect(result).toContain("\x1b[38;2;198;120;221m");
      expect(result).toContain("\x1b[48;5;");
    });

    test("returns plain text with no options", () => {
      expect(style("hello")).toBe("hello");
    });
  });

  describe("stripAnsi", () => {
    test("strips 24-bit escape sequences", () => {
      const styled = style("hello", { fg: "#c678dd", bold: true });
      const stripped = stripAnsi(styled);
      expect(stripped).toBe("hello");
    });

    test("strips 256-color sequences", () => {
      const styled = fg("test", "blue");
      expect(stripAnsi(styled)).toBe("test");
    });

    test("strips bold sequences", () => {
      const styled = bold("test");
      expect(stripAnsi(styled)).toBe("test");
    });

    test("leaves plain text unchanged", () => {
      expect(stripAnsi("hello world")).toBe("hello world");
    });
  });
});

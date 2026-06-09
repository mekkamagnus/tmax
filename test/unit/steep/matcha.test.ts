import { describe, test, expect } from "bun:test";
import {
  fg, bg, bold, dim, italic, underline, strikethrough, inverse,
  style, stripAnsi, isHexColor, hexToRGB, reset,
} from "../../../src/steep/matcha.ts";

describe("matcha", () => {
  describe("new ANSI attributes", () => {
    test("italic wraps with \\x1b[3m / \\x1b[23m", () => {
      const result = italic("hello");
      expect(result).toBe("\x1b[3mhello\x1b[23m");
    });

    test("underline wraps with \\x1b[4m / \\x1b[24m", () => {
      const result = underline("hello");
      expect(result).toBe("\x1b[4mhello\x1b[24m");
    });

    test("strikethrough wraps with \\x1b[9m / \\x1b[29m", () => {
      const result = strikethrough("hello");
      expect(result).toBe("\x1b[9mhello\x1b[29m");
    });

    test("inverse wraps with \\x1b[7m / \\x1b[27m", () => {
      const result = inverse("hello");
      expect(result).toBe("\x1b[7mhello\x1b[27m");
    });
  });

  describe("style() with new attributes", () => {
    test("style() accepts italic", () => {
      const result = style("hello", { italic: true });
      expect(result).toContain("\x1b[3m");
      expect(result).toContain(reset);
    });

    test("style() accepts underline", () => {
      const result = style("hello", { underline: true });
      expect(result).toContain("\x1b[4m");
    });

    test("style() accepts strikethrough", () => {
      const result = style("hello", { strikethrough: true });
      expect(result).toContain("\x1b[9m");
    });

    test("style() accepts inverse", () => {
      const result = style("hello", { inverse: true });
      expect(result).toContain("\x1b[7m");
    });

    test("style() combines multiple attributes", () => {
      const result = style("hello", { bold: true, italic: true, fg: "green" });
      expect(result).toContain("\x1b[1m");
      expect(result).toContain("\x1b[3m");
      expect(result).toContain("\x1b[38;5;46m");
      expect(result).toContain(reset);
    });

    test("style() returns unstyled text when no options", () => {
      expect(style("hello")).toBe("hello");
    });
  });

  describe("existing functions still work", () => {
    test("bold wraps text", () => {
      expect(bold("x")).toBe("\x1b[1mx\x1b[22m");
    });

    test("dim wraps text", () => {
      expect(dim("x")).toBe("\x1b[2mx\x1b[22m");
    });

    test("fg with named color", () => {
      const result = fg("x", "green");
      expect(result).toContain("\x1b[38;5;46m");
      expect(result).toContain(reset);
    });

    test("fg with hex color", () => {
      const result = fg("x", "#ff0000");
      expect(result).toContain("\x1b[38;2;255;0;0m");
    });

    test("bg with hex color", () => {
      const result = bg("x", "#0000ff");
      expect(result).toContain("\x1b[48;2;0;0;255m");
    });

    test("stripAnsi removes all attribute escapes", () => {
      const styled = bold(italic(underline("hello")));
      expect(stripAnsi(styled)).toBe("hello");
    });

    test("stripAnsi removes color escapes", () => {
      const styled = style("hello", { fg: "#ff0000", bg: "#0000ff", bold: true });
      expect(stripAnsi(styled)).toBe("hello");
    });

    test("isHexColor validates", () => {
      expect(isHexColor("#c678dd")).toBe(true);
      expect(isHexColor("red")).toBe(false);
    });

    test("hexToRGB converts", () => {
      expect(hexToRGB("#ff8040")).toEqual([255, 128, 64]);
    });
  });
});

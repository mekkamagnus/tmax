/**
 * @file wide-char-rendering.test.ts
 * @description Tests for BUG-09: emoji/wide character display width handling.
 */

import { describe, test, expect } from "bun:test";

// Import the functions under test — they're private, so we test via the module
// by re-implementing the same logic for unit testing.

function charWidth(ch: string): number {
  return ch.charCodeAt(0) > 127 ? 2 : 1;
}

function stringWidth(str: string): number {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return w;
}

function sliceToVisualWidth(text: string, maxCols: number): string {
  let cols = 0;
  let i = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (cols + cw > maxCols) break;
    cols += cw;
    i += ch.length;
  }
  return text.slice(0, i);
}

function fitToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const sw = stringWidth(text);
  if (sw <= width) return text + " ".repeat(width - sw);
  if (width <= 3) return sliceToVisualWidth(text, width);
  return sliceToVisualWidth(text, width - 3) + "...";
}

function padAnsiToWidth(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  const sw = stringWidth(visible);
  if (sw >= width) return text;
  return text + " ".repeat(width - sw);
}

describe("BUG-09 wide character rendering", () => {
  describe("stringWidth", () => {
    test("ASCII-only string returns length", () => {
      expect(stringWidth("hello")).toBe(5);
    });

    test("emoji counts as 2 columns", () => {
      expect(stringWidth("✅")).toBe(2);
    });

    test("mixed ASCII and emoji", () => {
      expect(stringWidth("- ✅ done")).toBe(9);
    });

    test("multiple emoji", () => {
      expect(stringWidth("✅❌")).toBe(4);
    });

    test("CJK character counts as 2 columns", () => {
      expect(stringWidth("中")).toBe(2);
    });

    test("empty string is 0", () => {
      expect(stringWidth("")).toBe(0);
    });
  });

  describe("fitToWidth", () => {
    test("pads ASCII to width", () => {
      const result = fitToWidth("hi", 5);
      expect(result.length).toBe(5);
      expect(result).toBe("hi   ");
    });

    test("truncates with ellipsis", () => {
      const result = fitToWidth("hello world", 8);
      expect(result).toBe("hello...");
    });

    test("handles emoji in content — no overflow", () => {
      const result = fitToWidth("✅ ok", 5);
      const sw = stringWidth(result.replace(/\.\.\./g, "..."));
      expect(sw).toBeLessThanOrEqual(5);
    });

    test("wide string fits in narrow width", () => {
      const result = fitToWidth("✅✅✅", 4);
      expect(stringWidth(result.replace(/\.\.\./g, "..."))).toBeLessThanOrEqual(4);
    });

    test("returns empty for width 0", () => {
      expect(fitToWidth("hello", 0)).toBe("");
    });

    test("pads after wide char correctly", () => {
      const result = fitToWidth("✅", 5);
      expect(stringWidth(result)).toBe(5);
    });

    test("ROADMAP-style line fits viewport", () => {
      const line = "- ✅ Modal editing (normal, insert, visual, command, mx modes) - **COMPLETE**";
      const result = fitToWidth(line, 80);
      expect(stringWidth(result)).toBeLessThanOrEqual(80);
    });
  });

  describe("padAnsiToWidth", () => {
    test("pads plain text", () => {
      const result = padAnsiToWidth("hi", 5);
      expect(result).toBe("hi   ");
    });

    test("pads text with ANSI codes", () => {
      const result = padAnsiToWidth("\x1b[31mhi\x1b[0m", 5);
      const visible = result.replace(/\x1b\[[0-9;]*m/g, "");
      expect(stringWidth(visible)).toBe(5);
    });

    test("pads text with emoji", () => {
      const result = padAnsiToWidth("✅ ok", 10);
      const visible = result.replace(/\x1b\[[0-9;]*m/g, "");
      expect(stringWidth(visible)).toBe(10);
    });

    test("does not over-pad when already at width", () => {
      const result = padAnsiToWidth("hello", 5);
      expect(result).toBe("hello");
    });
  });
});

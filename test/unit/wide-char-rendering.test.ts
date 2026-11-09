/**
 * @file wide-char-rendering.test.ts
 * @description Tests for BUG-09: emoji/wide character display width handling.
 *   #242 (SPEC-242): this suite now exercises the PRODUCTION width model in
 *   src/frontend/render/width.ts (it used to re-implement the helpers locally,
 *   gating nothing about production) and pins the Bun-backed grapheme
 *   semantics: CJK 2, emoji 2, ZWJ sequence 2, combining marks add 0, narrow
 *   non-ASCII 1, ANSI escapes width 0, never-overshoot slicing.
 */

import { describe, test, expect } from "bun:test";
import {
  stringWidth,
  sliceToVisualWidth,
  sliceFromVisualOffset,
  fitToWidth,
  padAnsiToWidth,
} from "../../src/frontend/render/width.ts";
import { renderTabBarAnsi } from "../../src/frontend/render/tab-bar.ts";
import { wrapAnsi } from "../../src/steep/oolong/wrap.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

    test("CJK string counts each character", () => {
      expect(stringWidth("中文")).toBe(4);
    });

    test("empty string is 0", () => {
      expect(stringWidth("")).toBe(0);
    });

    // Grapheme-model pins (Bun-backed, #242) — the crude model said 6 / 3 / 2 / 2.
    test("ZWJ emoji sequence is ONE grapheme (2 columns)", () => {
      expect(stringWidth("👨‍👩‍👧")).toBe(2);
    });

    test("combining mark adds no width", () => {
      expect(stringWidth("é")).toBe(1); // e + U+0301
      expect(stringWidth("é")).toBe(1);
    });

    test("narrow non-ASCII punctuation is 1 column", () => {
      expect(stringWidth("·")).toBe(1);
      expect(stringWidth("→")).toBe(1);
    });

    test("ANSI escapes count 0 columns", () => {
      expect(stringWidth("\x1b[31mhi\x1b[0m")).toBe(2);
      expect(stringWidth("\x1b[1m✅\x1b[0m")).toBe(2);
    });
  });

  describe("sliceToVisualWidth", () => {
    test("slices ASCII by columns", () => {
      expect(sliceToVisualWidth("hello", 3)).toBe("hel");
    });

    test("keeps whole wide chars, never overshoots", () => {
      expect(sliceToVisualWidth("中a中", 2)).toBe("中");
      // Odd boundary INTO a wide char: return the chars that FIT (Bun.sliceAnsi
      // alone rounds into the grapheme — production must not overshoot).
      expect(stringWidth(sliceToVisualWidth("中a", 1))).toBeLessThanOrEqual(1);
      expect(sliceToVisualWidth("中a", 1)).toBe("");
      expect(stringWidth(sliceToVisualWidth("中中", 3))).toBeLessThanOrEqual(3);
      expect(sliceToVisualWidth("中中", 3)).toBe("中");
    });

    test("slices through emoji and ANSI-free text", () => {
      expect(sliceToVisualWidth("✅ab", 2)).toBe("✅");
      expect(sliceToVisualWidth("a✅b", 2)).toBe("a");
    });

    test("returns everything when it fits", () => {
      expect(sliceToVisualWidth("中", 5)).toBe("中");
    });
  });

  describe("sliceFromVisualOffset", () => {
    test("identity at offset 0", () => {
      expect(sliceFromVisualOffset("中文abc", 0)).toBe("中文abc");
    });

    test("drops to the visual offset, grapheme-aligned", () => {
      expect(sliceFromVisualOffset("中文abc", 4)).toBe("abc"); // past both wide chars (4 cols)
      expect(sliceFromVisualOffset("中文abc", 2)).toBe("文abc"); // offset lands ON the second wide char
      expect(sliceFromVisualOffset("中a中", 1)).toBe("a中"); // straddling wide char dropped, never split
      expect(sliceFromVisualOffset("abcd", 2)).toBe("cd");
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

    test("CJK line truncates with ellipsis inside the width", () => {
      const result = fitToWidth("中文中文中文", 7);
      expect(stringWidth(result)).toBeLessThanOrEqual(7);
      expect(result.endsWith("...")).toBe(true);
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

    test("pads ANSI + CJK by VISIBLE width", () => {
      const result = padAnsiToWidth("\x1b[31m中文\x1b[0m", 6);
      expect(stringWidth(result)).toBe(6);
      expect(result.startsWith("\x1b[31m中文")).toBe(true);
    });
  });

  describe("tab bar (production consumer)", () => {
    test("CJK tab labels truncate with ellipsis inside the label budget", () => {
      const label = "标签".repeat(12); // 24 CJK chars = 48 cols, budget 16
      const bar = renderTabBarAnsi([{ label } as never, { label: "b" } as never], 0, 80);
      const plain = stripAnsi(bar);
      // Two tab segments rendered; the wide one must carry the … marker and
      // fit its 16-col budget (plus surrounding spaces).
      expect(plain.includes("…")).toBe(true);
      const seg = plain.trim().split(/\s{2,}/)[0] ?? plain;
      expect(seg.replace(/[ …]/g, "").length).toBeGreaterThan(0);
      expect(stringWidth(seg)).toBeLessThanOrEqual(18);
    });
  });

  describe("oolong wrap (production consumer)", () => {
    test("CJK paragraphs stay within the requested width", () => {
      // Old visualWidth (stripAnsi().length) measured 中文中文中文 as 6 for 12
      // display columns — this text collapsed onto one overflowing line at
      // width 20. The shared model measures 12 per word and wraps.
      const wrapped = wrapAnsi("中文中文中文 中文中文中文 中文", 20);
      expect(wrapped.length).toBeGreaterThanOrEqual(2);
      for (const line of wrapped) {
        expect(stringWidth(stripAnsi(line))).toBeLessThanOrEqual(20);
      }
    });

    test("indent parameter still prefixes continuation lines", () => {
      const result = wrapAnsi("hello", 10, 4);
      expect(result[0]?.startsWith("    ")).toBe(true);
    });
  });
});

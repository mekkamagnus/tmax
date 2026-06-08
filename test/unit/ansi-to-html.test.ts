/**
 * @file ansi-to-html.test.ts
 * @description Tests for ANSI to HTML conversion
 */

import { describe, test, expect } from "bun:test";
import { ansiToHtml, ansiLinesToHtmlDocument } from "../../src/render/ansi-to-html.ts";

describe("ansiToHtml", () => {
  test("returns plain text unchanged", () => {
    const result = ansiToHtml("hello world");
    expect(result).toContain("hello world");
    expect(result).not.toContain("style=");
  });

  test("escapes HTML entities", () => {
    const result = ansiToHtml("a < b > c & d");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&amp;");
  });

  test("converts 24-bit foreground color", () => {
    const input = "\x1b[38;2;198;120;221mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("color:rgb(198,120,221)");
    expect(result).toContain("hello");
  });

  test("converts 24-bit background color", () => {
    const input = "\x1b[48;2;255;0;0mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("background:rgb(255,0,0)");
    expect(result).toContain("hello");
  });

  test("converts 256-color foreground", () => {
    const input = "\x1b[38;5;46mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("color:");
    expect(result).toContain("hello");
  });

  test("converts 256-color background", () => {
    const input = "\x1b[48;5;21mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("background:");
    expect(result).toContain("hello");
  });

  test("converts bold attribute", () => {
    const input = "\x1b[1mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("font-weight:bold");
    expect(result).toContain("hello");
  });

  test("converts dim attribute", () => {
    const input = "\x1b[2mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("opacity:0.6");
    expect(result).toContain("hello");
  });

  test("resets style with \\x1b[0m", () => {
    const input = "\x1b[1mbold\x1b[0m normal";
    const result = ansiToHtml(input);
    expect(result).toContain("bold");
    expect(result).toContain("normal");
    // Should have closing and opening span tags
    expect(result).toContain("</span>");
    expect(result).toContain("<span");
  });

  test("handles combined fg + bold", () => {
    const input = "\x1b[1m\x1b[38;2;198;120;221mhello\x1b[0m";
    const result = ansiToHtml(input);
    expect(result).toContain("font-weight:bold");
    expect(result).toContain("color:rgb(198,120,221)");
  });

  test("handles empty string", () => {
    const result = ansiToHtml("");
    expect(result).toBeDefined();
  });

  test("handles text with only reset sequence", () => {
    const result = ansiToHtml("\x1b[0m");
    expect(result).toBeDefined();
  });
});

describe("ansiLinesToHtmlDocument", () => {
  test("produces valid HTML document", () => {
    const lines = ["hello", "\x1b[38;2;198;120;221mcolored\x1b[0m"];
    const doc = ansiLinesToHtmlDocument(lines);
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<html");
    expect(doc).toContain("</html>");
    expect(doc).toContain("<head>");
    expect(doc).toContain("</head>");
    expect(doc).toContain("<body>");
    expect(doc).toContain("</body>");
  });

  test("includes One Dark background style", () => {
    const doc = ansiLinesToHtmlDocument(["test"]);
    expect(doc).toContain("#282c34");
  });

  test("uses monospace font", () => {
    const doc = ansiLinesToHtmlDocument(["test"]);
    expect(doc).toContain("monospace");
  });

  test("handles empty lines array", () => {
    const doc = ansiLinesToHtmlDocument([]);
    expect(doc).toContain("<!DOCTYPE html>");
  });

  test("preserves ANSI colors as inline styles", () => {
    const lines = ["\x1b[38;2;198;120;221mpurple\x1b[0m"];
    const doc = ansiLinesToHtmlDocument(lines);
    expect(doc).toContain("rgb(198,120,221)");
  });

  test("replaces empty lines with non-breaking spaces", () => {
    const doc = ansiLinesToHtmlDocument([""]);
    expect(doc).toContain("&nbsp;");
  });
});

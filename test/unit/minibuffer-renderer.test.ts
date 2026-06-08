import { describe, expect, test } from "bun:test";
import { renderMinibuffer } from "../../src/frontend/render/minibuffer.ts";

describe("generic minibuffer renderer", () => {
  test("draws prompt at top with candidates below", () => {
    const rendered = renderMinibuffer({
      prompt: "Switch to buffer: ",
      input: "mes",
      inputPoint: 3,
      rows: [{
        selected: true,
        segments: [
          { text: "*Messages*", face: "completion-match" },
          { text: "  * Messages", face: "annotation" },
        ],
      }],
      message: "1/1",
    }, 80);

    expect(rendered.lines[0]).toContain("Switch to buffer: mes");
    expect(rendered.lines[1]).toContain("*Messages*");
    expect(rendered.cursorRow).toBe(0);
    expect(rendered.cursorColumn).toBe("Switch to buffer: ".length + 3);
  });

  test("places cursor at prompt position on first row", () => {
    const rendered = renderMinibuffer({
      prompt: "M-x ",
      input: "cur",
      inputPoint: 2,
      rows: [],
      message: "0/0",
    }, 80);

    expect(rendered.cursorRow).toBe(0);
    expect(rendered.cursorColumn).toBe("M-x ".length + 2);
  });

  test("renders multiple candidate rows below prompt", () => {
    const rendered = renderMinibuffer({
      prompt: "M-x ",
      input: "buf",
      inputPoint: 3,
      rows: [
        { selected: true, segments: [{ text: "buffer-list", face: "completion-match" }] },
        { selected: false, segments: [{ text: "buffer-switch", face: "completion-match" }] },
        { selected: false, segments: [{ text: "buffer-text", face: "completion-match" }] },
      ],
      message: "1/3",
    }, 80);

    expect(rendered.lines).toHaveLength(4);
    expect(rendered.lines[0]).toContain("M-x buf");
    expect(rendered.lines[1]).toContain("buffer-list");
    expect(rendered.lines[2]).toContain("buffer-switch");
    expect(rendered.lines[3]).toContain("buffer-text");
  });
});

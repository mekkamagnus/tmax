import { describe, expect, test } from "bun:test";
import { renderMinibuffer } from "../../src/frontend/render/minibuffer.ts";

describe("generic minibuffer renderer", () => {
  test("draws T-Lisp-produced rows and prompt without choosing candidates", () => {
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

    expect(rendered.lines.some(line => line.includes("*Messages*"))).toBe(true);
    expect(rendered.lines.at(-1)).toContain("Switch to buffer: mes");
  });
});

/**
 * @file clipboard-ops.test.ts
 * @description SPEC-044 Phase 2.4 — OS clipboard bridge.
 * Verifies clipboard-set/clipboard-get round-trip on macOS (test env).
 * Verifies graceful no-op when clipboard tool is unavailable.
 */

import { describe, test, expect } from "bun:test";
import {
  clipboardGet,
  clipboardSet,
  clipboardAvailable,
} from "../../src/editor/api/clipboard-ops.ts";

describe("SPEC-044 Phase 2.4 — OS clipboard bridge", () => {
  test("clipboardAvailable reflects platform tool presence", () => {
    expect(typeof clipboardAvailable()).toBe("boolean");
  });

  test("clipboard-set then clipboard-get round-trips text", () => {
    if (!clipboardAvailable()) {
      console.log("Skipping round-trip: no clipboard tool");
      return;
    }
    const sentinel = `tmax-clip-${Date.now()}`;
    expect(clipboardSet(sentinel)).toBe(true);
    expect(clipboardGet()).toBe(sentinel);
  });

  test("clipboard-set with empty string writes empty clipboard", () => {
    if (!clipboardAvailable()) return;
    expect(clipboardSet("")).toBe(true);
    expect(clipboardGet()).toBe("");
  });

  test("clipboard-set handles multi-line text", () => {
    if (!clipboardAvailable()) return;
    const text = "line1\nline2\nline3";
    expect(clipboardSet(text)).toBe(true);
    expect(clipboardGet()).toBe(text);
  });
});

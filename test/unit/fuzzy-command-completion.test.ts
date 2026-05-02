/**
 * @file fuzzy-command-completion.test.ts
 * @description Tests for fuzzy command completion (US-1.10.2)
 *
 * Tests fuzzy completion for minibuffer commands:
 * - 'buf-s' matches 'buffer-save'
 * - 'bs' completes to 'buffer-save' (fuzzy)
 * - Multiple matches show list
 * - Typing with visible list filters matches
 * - Single match completes fully
 * - No matches show 'No match' message
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { fuzzyMatch, fuzzyMatches, getBestMatch, getFuzzyCompletions } from "../../src/editor/utils/fuzzy-completion.ts";

describe("Fuzzy Command Completion (US-1.10.2)", () => {
  describe("Fuzzy Match Algorithm", () => {
    test("should match 'buf-s' to 'buffer-save'", () => {
      const result = fuzzyMatch("buf-s", "buffer-save");
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    test("should match 'bs' to 'buffer-save' (fuzzy)", () => {
      const result = fuzzyMatch("bs", "buffer-save");
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    test("should not match 'xyz' to 'buffer-save'", () => {
      const result = fuzzyMatch("xyz", "buffer-save");
      expect(result.matches).toBe(false);
    });

    test("should give higher score to better matches", () => {
      const result1 = fuzzyMatch("buf-s", "buffer-save");
      const result2 = fuzzyMatch("bs", "buffer-save");
      
      expect(result1.matches).toBe(true);
      expect(result2.matches).toBe(true);
      // More specific pattern should have higher score
      expect(result1.score).toBeGreaterThan(result2.score);
    });

    test("should match 'save' to 'buffer-save'", () => {
      const result = fuzzyMatch("save", "buffer-save");
      expect(result.matches).toBe(true);
    });

    test("should match 'b-s' to 'buffer-save'", () => {
      const result = fuzzyMatch("b-s", "buffer-save");
      expect(result.matches).toBe(true);
    });

    test("should handle hyphen matching in commands", () => {
      const result = fuzzyMatch("bufsave", "buffer-save");
      expect(result.matches).toBe(true);
    });
  });

  describe("Multiple Matches", () => {
    test("should return all matching commands", () => {
      const commands = ["buffer-save", "buffer-switch", "buffer-create", "editor-quit"];
      const results = fuzzyMatches("buf", commands);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.command === "buffer-save")).toBe(true);
      expect(results.some(r => r.command === "buffer-switch")).toBe(true);
    });

    test("should return matches sorted by score", () => {
      const commands = ["buffer-save", "buf", "buffer-switch"];
      const results = fuzzyMatches("buf", commands);
      
      // Results should be sorted by score (highest first)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    test("should return empty array when no matches", () => {
      const commands = ["buffer-save", "buffer-switch", "editor-quit"];
      const results = fuzzyMatches("xyz", commands);
      
      expect(results.length).toBe(0);
    });

    test("should handle 'save.*buffer' pattern (regex-like)", () => {
      const commands = ["buffer-save", "save-buffer", "editor-save"];
      const results = fuzzyMatches("save", commands);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.command === "buffer-save")).toBe(true);
      expect(results.some(r => r.command === "save-buffer")).toBe(true);
    });
  });

  describe("Best Match Selection", () => {
    test("should return single best match when one clear winner", () => {
      const commands = ["buffer-save", "buffer-switch", "buffer-create"];
      const result = getBestMatch("buf-s", commands);
      
      expect(result).toBeDefined();
      expect(result).toBe("buffer-save");
    });

    test("should return null when multiple equally good matches", () => {
      const commands = ["buffer-save", "buffer-switch"];
      const result = getBestMatch("buf", commands);
      
      // When scores are similar or equal, return null to indicate ambiguity
      expect(result).toBeNull();
    });

    test("should return null when no matches", () => {
      const commands = ["buffer-save", "buffer-switch"];
      const result = getBestMatch("xyz", commands);
      
      expect(result).toBeNull();
    });

    test("should prefer exact prefix match", () => {
      const commands = ["buffer", "buffer-save", "buf"];
      const result = getBestMatch("buffer", commands);
      
      expect(result).toBe("buffer");
    });
  });

  describe("Completion List", () => {
    test("should return completion list with scores", () => {
      const commands = ["buffer-save", "buffer-switch", "editor-quit"];
      const results = getFuzzyCompletions("buf", commands);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("command");
      expect(results[0]).toHaveProperty("score");
    });

    test("should limit completion list size", () => {
      // Generate many commands
      const commands = Array.from({ length: 20 }, (_, i) => `buffer-${i}`);
      const results = getFuzzyCompletions("buf", commands);
      
      // Should limit to reasonable number (e.g., 10)
      expect(results.length).toBeLessThanOrEqual(10);
    });

    test("should return empty list when no matches", () => {
      const commands = ["buffer-save", "buffer-switch"];
      const results = getFuzzyCompletions("xyz", commands);
      
      expect(results.length).toBe(0);
    });
  });

  describe("Editor Integration", () => {
    test("should complete 'buf-s' to 'buffer-save'", async () => {
      // This will be tested in integration tests
      // Here we just verify the fuzzy matching works
      const commands = ["buffer-save", "buffer-switch", "buffer-create"];
      const best = getBestMatch("buf-s", commands);
      
      expect(best).toBe("buffer-save");
    });

    test("should show options for ambiguous 'buf'", () => {
      const commands = ["buffer-save", "buffer-switch", "buffer-create"];
      const results = fuzzyMatches("buf", commands);
      
      expect(results.length).toBeGreaterThan(1);
    });

    test("should filter list as user types", () => {
      const commands = ["buffer-save", "buffer-switch", "buffer-create", "editor-quit"];
      
      const results1 = fuzzyMatches("b", commands);
      const results2 = fuzzyMatches("buf", commands);
      const results3 = fuzzyMatches("buf-s", commands);
      
      // More specific pattern should filter results
      expect(results1.length).toBeGreaterThanOrEqual(results2.length);
      expect(results2.length).toBeGreaterThanOrEqual(results3.length);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty input string", () => {
      const commands = ["buffer-save", "buffer-switch"];
      const result = fuzzyMatch("", "buffer-save");
      
      expect(result.matches).toBe(false);
    });

    test("should handle empty command list", () => {
      const commands: string[] = [];
      const results = fuzzyMatches("buf", commands);
      
      expect(results.length).toBe(0);
    });

    test("should handle special characters in pattern", () => {
      const result = fuzzyMatch("buf.*save", "buffer-save");
      expect(result.matches).toBe(true);
    });

    test("should be case-insensitive", () => {
      const result1 = fuzzyMatch("BUF-SAVE", "buffer-save");
      const result2 = fuzzyMatch("buf-save", "BUFFER-SAVE");
      
      expect(result1.matches).toBe(true);
      expect(result2.matches).toBe(true);
    });

    test("should handle very long patterns", () => {
      const result = fuzzyMatch("a".repeat(100), "buffer-save");
      expect(result.matches).toBe(false);
    });

    test("should handle patterns with only hyphens", () => {
      const result = fuzzyMatch("-", "buffer-save");
      expect(result.matches).toBe(false);
    });
  });

  describe("Real-world Command Examples", () => {
    const editorCommands = [
      "buffer-save",
      "buffer-switch",
      "buffer-create",
      "buffer-kill",
      "editor-quit",
      "editor-mode",
      "cursor-move",
      "delete-character",
      "yank",
      "paste",
      "undo",
      "redo"
    ];

    test("should find 'buffer-save' with 'bs'", () => {
      const best = getBestMatch("bs", editorCommands);
      expect(best).toBe("buffer-save");
    });

    test("should find 'editor-quit' with 'eq'", () => {
      const best = getBestMatch("eq", editorCommands);
      expect(best).toBe("editor-quit");
    });

    test("should find 'cursor-move' with 'cm'", () => {
      const best = getBestMatch("cm", editorCommands);
      expect(best).toBe("cursor-move");
    });

    test("should show multiple buffer commands with 'buf'", () => {
      const results = fuzzyMatches("buf", editorCommands);
      
      expect(results.length).toBeGreaterThan(1);
      expect(results.every(r => r.command.startsWith("buffer"))).toBe(true);
    });

    test("should match 'save' to all save commands", () => {
      const results = fuzzyMatches("save", editorCommands);
      
      expect(results.some(r => r.command === "buffer-save")).toBe(true);
    });
  });
});

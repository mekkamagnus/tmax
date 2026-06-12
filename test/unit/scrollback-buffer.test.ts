/**
 * @file scrollback-buffer.test.ts
 * @description Unit tests for RingBuffer and Scrollback
 *
 * Tests capacity, eviction, search, empty/single element edge cases,
 * and scrollback-specific operations.
 */

import { describe, test, expect } from "bun:test";
import {
  RingBuffer,
  createScrollbackBuffer,
  addLine,
  getVisibleLines,
  searchScrollback,
  nextSearchResult,
  prevSearchResult,
  clearSearch,
  serializeScrollback,
  deserializeScrollback,
  DEFAULT_SCROLLBACK_CAPACITY
} from "../../src/core/scrollback.ts";

describe("RingBuffer", () => {
  /**
   * Basic operations tests
   */
  describe("basic operations", () => {
    test("should create ring buffer with capacity", () => {
      const buffer = new RingBuffer<string>(10);
      expect(buffer.capacity).toBe(10);
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty).toBe(true);
      expect(buffer.isFull).toBe(false);
    });

    test("should throw on zero or negative capacity", () => {
      expect(() => new RingBuffer(0)).toThrow();
      expect(() => new RingBuffer(-1)).toThrow();
    });

    test("should push elements", () => {
      const buffer = new RingBuffer<string>(5);
      buffer.push("first");
      buffer.push("second");
      buffer.push("third");

      expect(buffer.size).toBe(3);
      expect(buffer.isEmpty).toBe(false);
    });

    test("should get elements by logical index", () => {
      const buffer = new RingBuffer<string>(5);
      buffer.push("first");
      buffer.push("second");
      buffer.push("third");

      expect(buffer.get(0)).toBe("first");   // oldest
      expect(buffer.get(1)).toBe("second");
      expect(buffer.get(2)).toBe("third");   // newest
    });

    test("should return undefined for out of bounds index", () => {
      const buffer = new RingBuffer<string>(3);
      buffer.push("test");

      expect(buffer.get(-1)).toBeUndefined();
      expect(buffer.get(5)).toBeUndefined();
      expect(buffer.get(100)).toBeUndefined();
    });

    test("should convert to array in insertion order", () => {
      const buffer = new RingBuffer<string>(5);
      buffer.push("a");
      buffer.push("b");
      buffer.push("c");

      expect(buffer.toArray()).toEqual(["a", "b", "c"]);
    });

    test("should clear all elements", () => {
      const buffer = new RingBuffer<string>(5);
      buffer.push("a");
      buffer.push("b");
      buffer.push("c");

      buffer.clear();

      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty).toBe(true);
      expect(buffer.toArray()).toEqual([]);
    });
  });

  /**
   * Eviction tests
   */
  describe("eviction", () => {
    test("should evict oldest element when at capacity", () => {
      const buffer = new RingBuffer<number>(3);
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4);  // Should evict 1

      expect(buffer.size).toBe(3);
      expect(buffer.get(0)).toBe(2);
      expect(buffer.get(1)).toBe(3);
      expect(buffer.get(2)).toBe(4);
    });

    test("should return evicted element from push", () => {
      const buffer = new RingBuffer<number>(3);
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);

      const evicted = buffer.push(4);
      expect(evicted).toBe(1);
    });

    test("should return undefined when not at capacity", () => {
      const buffer = new RingBuffer<number>(5);
      const evicted = buffer.push(1);
      expect(evicted).toBeUndefined();
    });

    test("should handle push beyond capacity", () => {
      const buffer = new RingBuffer<number>(5);

      // Push 10 items (capacity + 5)
      for (let i = 1; i <= 10; i++) {
        buffer.push(i);
      }

      expect(buffer.size).toBe(5);
      // Should only have items 6-10
      expect(buffer.toArray()).toEqual([6, 7, 8, 9, 10]);
    });

    test("should maintain correct logical indices after eviction", () => {
      const buffer = new RingBuffer<string>(3);
      buffer.push("a");
      buffer.push("b");
      buffer.push("c");
      buffer.push("d");
      buffer.push("e");

      // After eviction: buffer has [c, d, e]
      expect(buffer.get(0)).toBe("c");
      expect(buffer.get(1)).toBe("d");
      expect(buffer.get(2)).toBe("e");
    });
  });

  /**
   * Search tests
   */
  describe("search", () => {
    test("should search for regex pattern", () => {
      const buffer = RingBuffer.from([
        "error: file not found",
        "warning: deprecated",
        "info: operation complete",
        "error: connection failed"
      ], 10);

      const results = buffer.search(/error:/);
      expect(results).toEqual([0, 3]);
    });

    test("should return empty array for no matches", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      const results = buffer.search(/xyz/);
      expect(results).toEqual([]);
    });

    test("should search empty buffer", () => {
      const buffer = new RingBuffer<string>(5);
      const results = buffer.search(/test/);
      expect(results).toEqual([]);
    });

    test("should handle case-sensitive search", () => {
      const buffer = RingBuffer.from(["Hello", "HELLO", "hello"], 10);
      const results = buffer.search(/hello/);
      expect(results).toEqual([2]); // Only lowercase "hello"
    });

    test("should handle case-insensitive search", () => {
      const buffer = RingBuffer.from(["Hello", "HELLO", "hello"], 10);
      const results = buffer.search(/hello/i);
      expect(results).toEqual([0, 1, 2]);
    });

    test("should convert non-string elements to string for search", () => {
      const buffer = RingBuffer.from([1, 2, 3, 10, 20], 10);
      const results = buffer.search(/1/);
      expect(results).toEqual([0, 3]); // "1" and "10"
    });
  });

  /**
   * Edge cases
   */
  describe("edge cases", () => {
    test("should handle single element buffer", () => {
      const buffer = new RingBuffer<string>(1);

      buffer.push("first");
      expect(buffer.size).toBe(1);
      expect(buffer.get(0)).toBe("first");

      buffer.push("second");
      expect(buffer.size).toBe(1);
      expect(buffer.get(0)).toBe("second");
    });

    test("should handle empty buffer operations", () => {
      const buffer = new RingBuffer<string>(5);

      expect(buffer.get(0)).toBeUndefined();
      expect(buffer.newest()).toBeUndefined();
      expect(buffer.oldest()).toBeUndefined();
      expect(buffer.toArray()).toEqual([]);
    });

    test("should handle large capacity", () => {
      const buffer = new RingBuffer<number>(100000);
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }
      expect(buffer.size).toBe(1000);
    });

    test("should handle zero-size slice", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 5);
      expect(buffer.slice(1, 1)).toEqual([]);
    });

    test("should handle negative slice indices", () => {
      const buffer = RingBuffer.from(["a", "b", "c", "d", "e"], 10);
      expect(buffer.slice(-3)).toEqual(["c", "d", "e"]);
      expect(buffer.slice(-2)).toEqual(["d", "e"]);
    });

    test("should handle first and last helpers", () => {
      const buffer = RingBuffer.from(["a", "b", "c", "d", "e"], 10);

      expect(buffer.first(2)).toEqual(["a", "b"]);
      expect(buffer.last(2)).toEqual(["d", "e"]);
      expect(buffer.first(0)).toEqual([]);
      expect(buffer.last(0)).toEqual([]);
    });
  });

  /**
   * Static factory tests
   */
  describe("RingBuffer.from", () => {
    test("should create from array smaller than capacity", () => {
      const arr = ["a", "b", "c"];
      const buffer = RingBuffer.from(arr, 10);

      expect(buffer.capacity).toBe(10);
      expect(buffer.size).toBe(3);
      expect(buffer.toArray()).toEqual(["a", "b", "c"]);
    });

    test("should create from array equal to capacity", () => {
      const arr = ["a", "b", "c"];
      const buffer = RingBuffer.from(arr, 3);

      expect(buffer.size).toBe(3);
      expect(buffer.toArray()).toEqual(["a", "b", "c"]);
    });

    test("should truncate array larger than capacity", () => {
      const arr = ["a", "b", "c", "d", "e", "f"];
      const buffer = RingBuffer.from(arr, 4);

      expect(buffer.size).toBe(4);
      // Should keep last 4 elements
      expect(buffer.toArray()).toEqual(["c", "d", "e", "f"]);
    });

    test("should handle empty array", () => {
      const buffer = RingBuffer.from([], 5);
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty).toBe(true);
    });
  });

  /**
   * Iterator tests
   */
  describe("iteration", () => {
    test("should iterate in insertion order", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      const result = [...buffer];
      expect(result).toEqual(["a", "b", "c"]);
    });

    test("should iterate after eviction", () => {
      const buffer = new RingBuffer<number>(3);
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4);

      const result = [...buffer];
      expect(result).toEqual([2, 3, 4]);
    });

    test("should forEach correctly", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      const result: string[] = [];
      buffer.forEach((item) => result.push(item));
      expect(result).toEqual(["a", "b", "c"]);
    });

    test("should map correctly", () => {
      const buffer = RingBuffer.from([1, 2, 3], 10);
      const result = buffer.map((x) => x * 2);
      expect(result).toEqual([2, 4, 6]);
    });

    test("should reduce correctly", () => {
      const buffer = RingBuffer.from([1, 2, 3, 4], 10);
      const result = buffer.reduce((sum, x) => sum + x, 0);
      expect(result).toBe(10);
    });
  });

  /**
   * Filter indices test
   */
  describe("filterIndices", () => {
    test("should filter by predicate", () => {
      const buffer = RingBuffer.from([1, 2, 3, 4, 5], 10);
      const evenIndices = buffer.filterIndices((x) => x % 2 === 0);
      expect(evenIndices).toEqual([1, 3]); // indices of 2 and 4
    });

    test("should return empty array when no matches", () => {
      const buffer = RingBuffer.from([1, 2, 3], 10);
      const results = buffer.filterIndices((x) => x > 10);
      expect(results).toEqual([]);
    });
  });

  /**
   * Peek and newest/oldest tests
   */
  describe("peek", () => {
    test("should peek at elements", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      expect(buffer.peek(0)).toBe("a");
      expect(buffer.peek(2)).toBe("c");
    });

    test("should get newest element", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      expect(buffer.newest()).toBe("c");
    });

    test("should get oldest element", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      expect(buffer.oldest()).toBe("a");
    });

    test("should return undefined for newest/oldest on empty buffer", () => {
      const buffer = new RingBuffer<string>(5);
      expect(buffer.newest()).toBeUndefined();
      expect(buffer.oldest()).toBeUndefined();
    });
  });

  /**
   * toArrayReverse test
   */
  describe("toArrayReverse", () => {
    test("should return elements in reverse order", () => {
      const buffer = RingBuffer.from(["a", "b", "c"], 10);
      expect(buffer.toArrayReverse()).toEqual(["c", "b", "a"]);
    });

    test("should return empty array for empty buffer", () => {
      const buffer = new RingBuffer<string>(5);
      expect(buffer.toArrayReverse()).toEqual([]);
    });
  });
});

describe("Scrollback functions", () => {
  /**
   * Create and basic operations
   */
  describe("createScrollbackBuffer", () => {
    test("should create with default capacity", () => {
      const state = createScrollbackBuffer();
      expect(state.capacity).toBe(DEFAULT_SCROLLBACK_CAPACITY);
      expect(state.lines.size).toBe(0);
      expect(state.viewportOffset).toBe(0);
    });

    test("should create with custom capacity", () => {
      const state = createScrollbackBuffer(1000);
      expect(state.capacity).toBe(1000);
    });
  });

  /**
   * Line operations
   */
  describe("addLine", () => {
    test("should add lines to scrollback", () => {
      const state = createScrollbackBuffer(10);
      addLine(state, "line 1");
      addLine(state, "line 2");
      addLine(state, "line 3");

      expect(state.lines.size).toBe(3);
      expect(state.lines.toArray()).toEqual(["line 1", "line 2", "line 3"]);
    });

    test("should evict old lines at capacity", () => {
      const state = createScrollbackBuffer(3);
      addLine(state, "line 1");
      addLine(state, "line 2");
      addLine(state, "line 3");
      addLine(state, "line 4");  // Should evict "line 1"

      expect(state.lines.size).toBe(3);
      expect(state.lines.toArray()).toEqual(["line 2", "line 3", "line 4"]);
    });
  });

  /**
   * Visible lines
   */
  describe("getVisibleLines", () => {
    test("should get visible lines from viewport", () => {
      const state = createScrollbackBuffer(10);
      addLine(state, "line 1");
      addLine(state, "line 2");
      addLine(state, "line 3");
      addLine(state, "line 4");
      addLine(state, "line 5");

      // Viewport showing last 3 lines
      const visible = getVisibleLines(state, 3);
      expect(visible).toEqual(["line 3", "line 4", "line 5"]);
    });

    test("should handle viewport offset", () => {
      const state = createScrollbackBuffer(10);
      for (let i = 1; i <= 10; i++) {
        addLine(state, `line ${i}`);
      }

      state.viewportOffset = 5;
      const visible = getVisibleLines(state, 3);
      // With viewportOffset=5, we see lines 0-4 (excluding bottom 5)
      // Last 3 of visible range are lines 2-4 (1-indexed: 3, 4, 5)
      expect(visible).toEqual(["line 3", "line 4", "line 5"]);
    });

    test("should handle count larger than buffer", () => {
      const state = createScrollbackBuffer(10);
      addLine(state, "line 1");
      addLine(state, "line 2");

      const visible = getVisibleLines(state, 100);
      expect(visible).toEqual(["line 1", "line 2"]);
    });
  });

  /**
   * Search operations
   */
  describe("search", () => {
    test("should find matching lines", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "error: file not found");
      addLine(state, "info: started");
      addLine(state, "error: connection failed");
      addLine(state, "warning: retrying");

      searchScrollback(state, /error:/);

      expect(state.searchResults).toEqual([0, 2]);
      expect(state.searchIndex).toBe(0);
    });

    test("should handle no matches", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "line 1");
      addLine(state, "line 2");

      searchScrollback(state, /error:/);

      expect(state.searchResults).toEqual([]);
      expect(state.searchIndex).toBeUndefined();
    });

    test("should navigate to next result", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "error 1");
      addLine(state, "error 2");
      addLine(state, "error 3");

      searchScrollback(state, /error/);
      expect(state.searchIndex).toBe(0);

      nextSearchResult(state);
      expect(state.searchIndex).toBe(1);

      nextSearchResult(state);
      expect(state.searchIndex).toBe(2);

      nextSearchResult(state);  // Should wrap to 0
      expect(state.searchIndex).toBe(0);
    });

    test("should navigate to previous result", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "error 1");
      addLine(state, "error 2");
      addLine(state, "error 3");

      searchScrollback(state, /error/);
      expect(state.searchIndex).toBe(0);

      prevSearchResult(state);  // Should wrap to 2
      expect(state.searchIndex).toBe(2);

      prevSearchResult(state);
      expect(state.searchIndex).toBe(1);
    });

    test("should clear search results", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "error 1");
      addLine(state, "error 2");

      searchScrollback(state, /error/);
      expect(state.searchResults).toBeDefined();

      clearSearch(state);
      expect(state.searchResults).toBeUndefined();
      expect(state.searchIndex).toBeUndefined();
    });
  });

  /**
   * Serialization
   */
  describe("serialization", () => {
    test("should serialize scrollback state", () => {
      const state = createScrollbackBuffer(100);
      addLine(state, "line 1");
      addLine(state, "line 2");
      addLine(state, "line 3");
      state.viewportOffset = 5;

      const serialized = serializeScrollback(state);

      expect(serialized.capacity).toBe(100);
      expect(serialized.lines).toEqual(["line 1", "line 2", "line 3"]);
      expect(serialized.size).toBe(3);
      expect(serialized.viewportOffset).toBe(5);
    });

    test("should deserialize scrollback state", () => {
      const data = {
        capacity: 50,
        lines: ["a", "b", "c"],
        size: 3,
        viewportOffset: 2
      };

      const state = deserializeScrollback(data);

      expect(state.capacity).toBe(50);
      expect(state.lines.toArray()).toEqual(["a", "b", "c"]);
      expect(state.viewportOffset).toBe(2);
    });

    test("should round-trip serialize/deserialize", () => {
      const original = createScrollbackBuffer(100);
      addLine(original, "line 1");
      addLine(original, "line 2");
      addLine(original, "line 3");
      original.viewportOffset = 1;

      const serialized = serializeScrollback(original);
      const restored = deserializeScrollback(serialized);

      expect(restored.lines.toArray()).toEqual(original.lines.toArray());
      expect(restored.capacity).toBe(original.capacity);
      expect(restored.viewportOffset).toBe(original.viewportOffset);
    });
  });
});

/**
 * @file scrollback.ts
 * @description Ring buffer implementation for terminal scrollback
 *
 * Generic typed ring buffer with configurable capacity, push eviction,
 * random access, and regex search per RFC-014.
 *
 * Pure data structure - no I/O, no external dependencies.
 */

/**
 * Ring buffer error type
 */
export type RingBufferError = string;

/**
 * Generic ring buffer with fixed capacity
 *
 * Elements are pushed in and evicted in FIFO order when capacity is reached.
 * Random access uses logical indices (0 = oldest, size-1 = newest).
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];  // Underlying storage
  private head: number;  // Index of oldest element
  private tail: number;  // Index where next element will be written
  private _size: number;  // Current number of elements

  /**
   * Create a new ring buffer with specified capacity
   * @param capacity Maximum number of elements (must be > 0)
   */
  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error(`Ring buffer capacity must be positive, got ${capacity}`);
    }
    this.buffer = new Array(capacity);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }

  /**
   * Get the maximum capacity of the buffer
   */
  get capacity(): number {
    return this.buffer.length;
  }

  /**
   * Get the current number of elements in the buffer
   */
  get size(): number {
    return this._size;
  }

  /**
   * Check if the buffer is empty
   */
  get isEmpty(): boolean {
    return this._size === 0;
  }

  /**
   * Check if the buffer is at capacity
   */
  get isFull(): boolean {
    return this._size === this.capacity;
  }

  /**
   * Push an element into the buffer
   *
   * If at capacity, the oldest element is evicted.
   * @param item Element to add
   * @returns The evicted element if buffer was at capacity, undefined otherwise
   */
  push(item: T): T | undefined {
    if (this.capacity === 0) {
      return undefined;
    }

    const evicted = this.isFull ? this.buffer[this.head] : undefined;

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.isFull) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this._size++;
    }

    return evicted;
  }

  /**
   * Get element at logical index
   *
   * Index 0 = oldest element, size-1 = newest element
   * @param index Logical index (0 to size-1)
   * @returns Element at index, or undefined if index out of bounds
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this._size) {
      return undefined;
    }

    const physicalIndex = (this.head + index) % this.capacity;
    return this.buffer[physicalIndex];
  }

  /**
   * Get the newest (most recently pushed) element
   */
  newest(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return this.get(this._size - 1);
  }

  /**
   * Get the oldest element
   */
  oldest(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return this.get(0);
  }

  /**
   * Convert buffer to array in insertion order (oldest to newest)
   */
  toArray(): T[] {
    const result: T[] = [];

    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Clear all elements from the buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this._size = 0;
    // Clear references to help GC
    for (let i = 0; i < this.buffer.length; i++) {
      this.buffer[i] = undefined;
    }
  }

  /**
   * Search for elements matching a regex pattern
   *
   * For string elements, tests the element against the pattern.
   * For non-string elements, converts to string before testing.
   *
   * @param pattern Regular expression to match
   * @returns Array of logical indices where pattern matches (empty if no matches)
   */
  search(pattern: RegExp): number[] {
    const matches: number[] = [];

    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item === undefined) {
        continue;
      }

      const str = typeof item === 'string' ? item : String(item);
      // I8: reset lastIndex so global regexes don't alternate match/no-match
      pattern.lastIndex = 0;
      if (pattern.test(str)) {
        matches.push(i);
      }
    }

    return matches;
  }

  /**
   * Search for elements matching a predicate function
   *
   * @param predicate Function returning true for matching elements
   * @returns Array of logical indices where predicate returns true
   */
  filterIndices(predicate: (item: T) => boolean): number[] {
    const matches: number[] = [];

    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item !== undefined && predicate(item)) {
        matches.push(i);
      }
    }

    return matches;
  }

  /**
   * Create a new ring buffer from an array
   *
   * If array exceeds capacity, only the most recent 'capacity' elements are kept.
   * @param items Source array
   * @param capacity Maximum capacity
   */
  static from<T>(items: T[], capacity: number): RingBuffer<T> {
    const buffer = new RingBuffer<T>(capacity);

    // If items fit within capacity, push all
    // Otherwise, only push the last 'capacity' items
    const startIndex = Math.max(0, items.length - capacity);

    for (let i = startIndex; i < items.length; i++) {
      buffer.push(items[i]!);
    }

    return buffer;
  }

  /**
   * Iterate over elements in insertion order (oldest to newest)
   */
  [Symbol.iterator](): Iterator<T> {
    let index = 0;
    return {
      next: () => {
        if (index >= this._size) {
          return { done: true, value: undefined };
        }
        const value = this.get(index++);
        return { done: false, value: value! };
      }
    };
  }

  /**
   * Apply a function to each element in insertion order
   */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        fn(item, i);
      }
    }
  }

  /**
   * Map elements to a new array
   */
  map<U>(fn: (item: T, index: number) => U): U[] {
    const result: U[] = [];

    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        result.push(fn(item, i));
      }
    }

    return result;
  }

  /**
   * Reduce elements to a single value
   */
  reduce<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U {
    let acc = initial;

    for (let i = 0; i < this._size; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        acc = fn(acc, item, i);
      }
    }

    return acc;
  }

  /**
   * Get a slice of elements as an array
   * @param start Start index (inclusive)
   * @param end End index (exclusive)
   */
  slice(start: number, end?: number): T[] {
    if (start < 0) {
      start = Math.max(0, this._size + start);
    }
    if (end === undefined) {
      end = this._size;
    } else if (end < 0) {
      end = Math.max(0, this._size + end);
    }

    const result: T[] = [];
    for (let i = start; i < Math.min(end, this._size); i++) {
      const item = this.get(i);
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Peek at the element at logical index without removing it
   * Alias for get() for API compatibility
   */
  peek(index: number): T | undefined {
    return this.get(index);
  }

  /**
   * Get elements in reverse order (newest to oldest)
   */
  toArrayReverse(): T[] {
    const result: T[] = [];

    for (let i = this._size - 1; i >= 0; i--) {
      const item = this.get(i);
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Get the last N elements (newest N)
   * @param count Number of elements to return
   */
  last(count: number): T[] {
    if (count <= 0) {
      return [];
    }
    return this.slice(Math.max(0, this._size - count));
  }

  /**
   * Get the first N elements (oldest N)
   * @param count Number of elements to return
   */
  first(count: number): T[] {
    if (count <= 0) {
      return [];
    }
    return this.slice(0, Math.min(count, this._size));
  }
}

/**
 * Scrollback buffer wrapper for terminal windows
 *
 * Provides a specialized interface for terminal scrollback with:
 * - Line-oriented storage
 * - Viewport offset tracking
 * - Search result tracking
 */
export interface ScrollbackBufferState {
  lines: RingBuffer<string>;
  capacity: number;
  viewportOffset: number;
  searchResults?: number[];
  searchIndex?: number;
}

/**
 * Default scrollback capacity (50,000 lines per RFC-014)
 */
export const DEFAULT_SCROLLBACK_CAPACITY = 50_000;

/**
 * Create a new scrollback buffer state
 * @param capacity Maximum number of lines to store
 */
export function createScrollbackBuffer(capacity: number = DEFAULT_SCROLLBACK_CAPACITY): ScrollbackBufferState {
  return {
    lines: new RingBuffer(capacity),
    capacity,
    viewportOffset: 0,
    searchResults: undefined,
    searchIndex: undefined
  };
}

/**
 * Add a line to the scrollback buffer
 */
export function addLine(state: ScrollbackBufferState, line: string): ScrollbackBufferState {
  state.lines.push(line);
  return state;
}

/**
 * Get lines relative to viewport offset
 * @param state Scrollback state
 * @param count Number of lines to retrieve
 */
export function getVisibleLines(state: ScrollbackBufferState, count: number): string[] {
  const start = Math.max(0, state.lines.size - state.viewportOffset - count);
  const end = state.lines.size - state.viewportOffset;
  return state.lines.slice(start, end);
}

/**
 * Search scrollback for a pattern
 * @param state Scrollback state
 * @param pattern Regex pattern to search for
 * @returns Updated state with search results
 */
export function searchScrollback(state: ScrollbackBufferState, pattern: RegExp): ScrollbackBufferState {
  state.searchResults = state.lines.search(pattern);
  state.searchIndex = state.searchResults.length > 0 ? 0 : undefined;
  return state;
}

/**
 * Navigate to next search result
 */
export function nextSearchResult(state: ScrollbackBufferState): ScrollbackBufferState {
  if (state.searchResults && state.searchResults.length > 0) {
    state.searchIndex = ((state.searchIndex ?? -1) + 1) % state.searchResults.length;
  }
  return state;
}

/**
 * Navigate to previous search result
 */
export function prevSearchResult(state: ScrollbackBufferState): ScrollbackBufferState {
  if (state.searchResults && state.searchResults.length > 0) {
    state.searchIndex = ((state.searchIndex ?? 1) - 1 + state.searchResults.length) % state.searchResults.length;
  }
  return state;
}

/**
 * Clear search results
 */
export function clearSearch(state: ScrollbackBufferState): ScrollbackBufferState {
  state.searchResults = undefined;
  state.searchIndex = undefined;
  return state;
}

/**
 * Serialize scrollback state to JSON-compatible object
 */
export function serializeScrollback(state: ScrollbackBufferState): {
  capacity: number;
  lines: string[];
  size: number;
  head: number;
  tail: number;
  viewportOffset: number;
} {
  return {
    capacity: state.capacity,
    lines: state.lines.toArray(),
    size: state.lines.size,
    head: 0,  // Not tracking internal head/tail for serialization
    tail: state.lines.size,
    viewportOffset: state.viewportOffset
  };
}

/**
 * Deserialize scrollback state from JSON-compatible object
 */
export function deserializeScrollback(data: {
  capacity: number;
  lines: string[];
  size: number;
  viewportOffset: number;
}): ScrollbackBufferState {
  const lines = RingBuffer.from(data.lines, data.capacity);
  return {
    lines,
    capacity: data.capacity,
    viewportOffset: data.viewportOffset,
    searchResults: undefined,
    searchIndex: undefined
  };
}

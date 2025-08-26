/**
 * @file lens.ts
 * @description Lens/Optics pattern for focused immutable updates
 */

/**
 * A Lens focuses on a part of a data structure and allows getting and setting that part
 */
export class Lens<S, A> {
  constructor(
    private getter: (source: S) => A,
    private setter: (value: A) => (source: S) => S
  ) {}
  
  /**
   * Create a lens from a property key
   */
  static of<S, K extends keyof S>(key: K): Lens<S, S[K]> {
    return new Lens(
      source => source[key],
      value => source => ({ ...source as object, [key]: value } as S)
    );
  }
  
  /**
   * Create a lens from getter and setter functions
   */
  static fromPath<S, A>(
    getter: (source: S) => A,
    setter: (value: A) => (source: S) => S
  ): Lens<S, A> {
    return new Lens(getter, setter);
  }
  
  /**
   * Create a lens for array index access
   */
  static index<T>(index: number): Lens<T[], T | undefined> {
    return new Lens<T[], T | undefined>(
      arr => arr[index],
      value => arr => {
        const newArr = [...arr];
        if (value !== undefined) {
          newArr[index] = value;
        }
        return newArr;
      }
    );
  }
  
  /**
   * Create a lens for Map key access
   */
  static mapKey<K, V>(key: K): Lens<Map<K, V>, V | undefined> {
    return new Lens(
      map => map.get(key),
      value => map => {
        const newMap = new Map(map);
        if (value !== undefined) {
          newMap.set(key, value);
        } else {
          newMap.delete(key);
        }
        return newMap;
      }
    );
  }
  
  /**
   * Get the focused value from source
   */
  get(source: S): A {
    return this.getter(source);
  }
  
  /**
   * Set the focused value in source (returns new source)
   */
  set(value: A): (source: S) => S {
    return this.setter(value);
  }
  
  /**
   * Modify the focused value using a function
   */
  modify(f: (value: A) => A): (source: S) => S {
    return source => this.setter(f(this.getter(source)))(source);
  }
  
  /**
   * Compose this lens with another lens (goes deeper)
   */
  compose<B>(other: Lens<A, B>): Lens<S, B> {
    return new Lens(
      source => other.get(this.get(source)),
      value => source => this.modify(other.set(value))(source)
    );
  }
  
  /**
   * Map over the focused value's type (contravariant)
   */
  contramap<T>(f: (value: T) => S): Lens<T, A> {
    return new Lens(
      t => this.get(f(t)),
      value => t => {
        const s = f(t);
        const newS = this.set(value)(s);
        // This is a simplified version - in practice you'd need a way to "unlift"
        return t; // This is not fully correct but shows the pattern
      }
    );
  }
  
  /**
   * Create a lens that focuses on multiple values
   */
  zip<B>(other: Lens<S, B>): Lens<S, [A, B]> {
    return new Lens(
      source => [this.get(source), other.get(source)],
      ([a, b]) => source => other.set(b)(this.set(a)(source))
    );
  }
  
  /**
   * Convert to an Optional (may not find the value)
   */
  toOptional(): Optional<S, A> {
    return new Optional(
      source => this.get(source),
      value => source => this.set(value)(source)
    );
  }
}

/**
 * An Optional is like a Lens but may not find its target
 */
export class Optional<S, A> {
  constructor(
    private getter: (source: S) => A | null,
    private setter: (value: A) => (source: S) => S
  ) {}
  
  /**
   * Create an Optional from a nullable lens
   */
  static fromNullable<S, A>(lens: Lens<S, A | null>): Optional<S, A> {
    return new Optional(
      source => lens.get(source),
      value => lens.set(value)
    );
  }
  
  /**
   * Create an Optional for array find operation
   */
  static find<T>(predicate: (item: T) => boolean): Optional<T[], T> {
    return new Optional(
      arr => arr.find(predicate) || null,
      newValue => arr => {
        const index = arr.findIndex(predicate);
        if (index >= 0) {
          const newArr = [...arr];
          newArr[index] = newValue;
          return newArr;
        }
        return arr;
      }
    );
  }
  
  /**
   * Create an Optional for Map key with default
   */
  static mapKeyWithDefault<K, V>(key: K, defaultValue: V): Optional<Map<K, V>, V> {
    return new Optional(
      map => map.get(key) || defaultValue,
      value => map => new Map(map).set(key, value)
    );
  }
  
  /**
   * Try to get the focused value (may return null)
   */
  getOption(source: S): A | null {
    return this.getter(source);
  }
  
  /**
   * Set the focused value if it exists
   */
  set(value: A): (source: S) => S {
    return this.setter(value);
  }
  
  /**
   * Modify the focused value if it exists
   */
  modify(f: (value: A) => A): (source: S) => S {
    return source => {
      const current = this.getter(source);
      return current !== null ? this.setter(f(current))(source) : source;
    };
  }
  
  /**
   * Get the focused value or return a default
   */
  getOrElse(source: S, defaultValue: A): A {
    const value = this.getter(source);
    return value !== null ? value : defaultValue;
  }
  
  /**
   * Compose this Optional with a Lens
   */
  compose<B>(lens: Lens<A, B>): Optional<S, B> {
    return new Optional(
      source => {
        const a = this.getter(source);
        return a !== null ? lens.get(a) : null;
      },
      value => source => {
        const a = this.getter(source);
        return a !== null ? this.modify(lens.set(value))(source) : source;
      }
    );
  }
  
  /**
   * Compose this Optional with another Optional
   */
  composeOptional<B>(other: Optional<A, B>): Optional<S, B> {
    return new Optional(
      source => {
        const a = this.getter(source);
        return a !== null ? other.getOption(a) : null;
      },
      value => source => {
        const a = this.getter(source);
        return a !== null ? this.modify(other.set(value))(source) : source;
      }
    );
  }
  
  /**
   * Filter the Optional based on a predicate
   */
  filter(predicate: (value: A) => boolean): Optional<S, A> {
    return new Optional(
      source => {
        const value = this.getter(source);
        return value !== null && predicate(value) ? value : null;
      },
      this.setter
    );
  }
  
  /**
   * Map over the focused type
   */
  map<B>(f: (value: A) => B): Optional<S, B> {
    return new Optional(
      source => {
        const value = this.getter(source);
        return value !== null ? f(value) : null;
      },
      // This is simplified - proper implementation would need inverse function
      (newValue: B) => this.setter as unknown as (value: B) => (source: S) => S
    );
  }
}

/**
 * A Prism is an Optional that can also construct values
 */
export class Prism<S, A> {
  constructor(
    private matcher: (source: S) => A | null,
    private builder: (value: A) => S
  ) {}
  
  /**
   * Create a Prism for union type matching
   */
  static fromPredicate<S, A extends S>(
    predicate: (source: S) => source is A,
    builder: (value: A) => S = (x: A) => x as S
  ): Prism<S, A> {
    return new Prism(
      source => predicate(source) ? source : null,
      builder
    );
  }
  
  /**
   * Try to match and extract value
   */
  getOption(source: S): A | null {
    return this.matcher(source);
  }
  
  /**
   * Build a source value from the focused type
   */
  reverseGet(value: A): S {
    return this.builder(value);
  }
  
  /**
   * Modify if match succeeds
   */
  modify(f: (value: A) => A): (source: S) => S {
    return source => {
      const matched = this.matcher(source);
      return matched !== null ? this.builder(f(matched)) : source;
    };
  }
  
  /**
   * Set if match succeeds
   */
  set(value: A): (source: S) => S {
    return this.modify(() => value);
  }
  
  /**
   * Compose with a Lens
   */
  compose<B>(lens: Lens<A, B>): Optional<S, B> {
    return new Optional(
      source => {
        const a = this.matcher(source);
        return a !== null ? lens.get(a) : null;
      },
      value => source => {
        const a = this.matcher(source);
        return a !== null ? this.builder(lens.set(value)(a)) : source;
      }
    );
  }
}

/**
 * Traversal focuses on multiple values of the same type
 */
export class Traversal<S, A> {
  constructor(
    private traverse: <F>(
      source: S,
      f: (value: A) => F
    ) => F extends A ? S : F[]
  ) {}
  
  /**
   * Create a Traversal for all array elements
   */
  static array<T>(): Traversal<T[], T> {
    return new Traversal(
      <F>(source: T[], f: (value: T) => F): F extends T ? T[] : F[] => {
        return source.map(f) as F extends T ? T[] : F[];
      }
    );
  }
  
  /**
   * Create a Traversal for all Map values
   */
  static mapValues<K, V>(): Traversal<Map<K, V>, V> {
    return new Traversal(
      <F>(source: Map<K, V>, f: (value: V) => F): F extends V ? Map<K, V> : F[] => {
        if (typeof f(Array.from(source.values())[0]) === typeof Array.from(source.values())[0]) {
          // If F extends V, return modified Map
          const newMap = new Map<K, V>();
          for (const [key, value] of source) {
            newMap.set(key, f(value) as V);
          }
          return newMap as F extends V ? Map<K, V> : F[];
        } else {
          // Otherwise return array of results
          return Array.from(source.values()).map(f) as F extends V ? Map<K, V> : F[];
        }
      }
    );
  }
  
  /**
   * Get all focused values
   */
  getAll(source: S): A[] {
    return this.traverse(source, (x: A) => x) as A[];
  }
  
  /**
   * Modify all focused values
   */
  modify(f: (value: A) => A): (source: S) => S {
    return source => this.traverse(source, f) as S;
  }
  
  /**
   * Set all focused values to the same value
   */
  set(value: A): (source: S) => S {
    return this.modify(() => value);
  }
  
  /**
   * Find the first value matching a predicate
   */
  find(predicate: (value: A) => boolean): Optional<S, A> {
    return new Optional(
      source => this.getAll(source).find(predicate) || null,
      newValue => source => {
        let found = false;
        return this.modify(current => {
          if (!found && predicate(current)) {
            found = true;
            return newValue;
          }
          return current;
        })(source);
      }
    );
  }
  
  /**
   * Filter values based on predicate
   */
  filter(predicate: (value: A) => boolean): Traversal<S, A> {
    return new Traversal(
      <F>(source: S, f: (value: A) => F): F extends A ? S : F[] => {
        const allValues = this.getAll(source);
        const filteredValues = allValues.filter(predicate);
        
        if (typeof f(filteredValues[0]) === typeof filteredValues[0]) {
          // If F extends A, apply transformation and reconstruct
          let index = 0;
          return this.modify(current => {
            if (predicate(current)) {
              return f(current) as A;
            }
            return current;
          })(source) as F extends A ? S : F[];
        } else {
          // Otherwise just return mapped filtered values
          return filteredValues.map(f) as F extends A ? S : F[];
        }
      }
    );
  }
}

/**
 * Utility functions for working with optics
 */
export const optics = {
  /**
   * Apply a function to a source using a lens
   */
  over: <S, A>(lens: Lens<S, A>, f: (value: A) => A) => (source: S): S =>
    lens.modify(f)(source),
  
  /**
   * Set a value in source using a lens
   */
  set: <S, A>(lens: Lens<S, A>, value: A) => (source: S): S =>
    lens.set(value)(source),
  
  /**
   * Get a value from source using a lens
   */
  view: <S, A>(lens: Lens<S, A>) => (source: S): A =>
    lens.get,
  
  /**
   * Compose multiple lenses
   */
  compose: <S, A, B>(first: Lens<S, A>, second: Lens<A, B>): Lens<S, B> =>
    first.compose(second),
  
  /**
   * Create a lens chain for deep property access
   */
  chain: <S>() => ({
    to: <A>(lens: Lens<S, A>) => ({
      to: <B>(nextLens: Lens<A, B>) => lens.compose(nextLens),
      lens
    }),
    lens: null as unknown as Lens<S, S>
  }),
  
  /**
   * Batch multiple lens operations
   */
  batch: <S>(...operations: Array<(source: S) => S>) => (source: S): S =>
    operations.reduce((acc, op) => op(acc), source),
  
  /**
   * Create nested object path lens
   */
  path: <T, K1 extends keyof T>(k1: K1) => Lens.of(k1),
  
  /**
   * Helper for Map operations
   */
  mapLens: {
    key: <K, V>(key: K) => Lens.mapKey<K, V>(key),
    values: <K, V>() => Traversal.mapValues<K, V>()
  },
  
  /**
   * Helper for Array operations  
   */
  arrayLens: {
    index: <T>(index: number) => Lens.index<T>(index),
    all: <T>() => Traversal.array<T>(),
    find: <T>(predicate: (item: T) => boolean) => Optional.find(predicate)
  }
};

// Example usage patterns for editor state (commented for documentation)
/*
// Editor state type example
interface EditorState {
  statusMessage: string;
  buffers: Map<string, TextBuffer>;
  currentBuffer: TextBuffer | null;
  mode: EditorMode;
  cursorLine: number;
  cursorColumn: number;
}

// Basic lenses for editor state
const statusMessageLens = Lens.of<EditorState, 'statusMessage'>('statusMessage');
const buffersLens = Lens.of<EditorState, 'buffers'>('buffers');
const currentBufferLens = Lens.of<EditorState, 'currentBuffer'>('currentBuffer');
const modeLens = Lens.of<EditorState, 'mode'>('mode');

// Composed lenses for nested access
const bufferAtLens = (key: string) => 
  buffersLens.compose(Lens.mapKey<string, TextBuffer>(key)).toOptional();

// Usage examples
const updateStatus = (state: EditorState, message: string): EditorState =>
  statusMessageLens.set(message)(state);

const addBuffer = (state: EditorState, name: string, buffer: TextBuffer): EditorState =>
  buffersLens.modify(buffers => new Map(buffers).set(name, buffer))(state);

const updateBufferContent = (state: EditorState, bufferName: string, newContent: string): EditorState =>
  bufferAtLens(bufferName).modify(buffer => buffer.setContent(newContent))(state);

// Batch operations
const saveFileUpdates = (state: EditorState, filename: string, buffer: TextBuffer): EditorState =>
  optics.batch(
    statusMessageLens.set(`Saved ${filename}`),
    buffersLens.modify(buffers => new Map(buffers).set(filename, buffer)),
    currentBufferLens.set(buffer)
  )(state);

// Working with arrays of buffers
const allBuffersTraversal = buffersLens.compose(Traversal.mapValues<string, TextBuffer>());

const markAllBuffersClean = (state: EditorState): EditorState =>
  allBuffersTraversal.modify(buffer => buffer.markClean())(state);
*/
/**
 * Option<T> type represents a value that may or may not exist.
 * It's either Some(value) or None.
 */
export type Option<T> =
  | { _tag: 'Some'; value: T }
  | { _tag: 'None' };

/**
 * Interface that extends Option with functional methods
 */
export interface OptionWithMethods<T> extends Option<T> {
  /**
   * Maps the value inside Some to a new value.
   * If the Option is None, returns None.
   */
  map<U>(f: (value: T) => U): Option<U>;

  /**
   * Maps the value inside Some to a new Option.
   * If the Option is None, returns None.
   */
  flatMap<U>(f: (value: T) => Option<U>): Option<U>;

  /**
   * Extracts the value from Some or applies a function to get a default.
   */
  fold<U>(ifNone: () => U, ifSome: (value: T) => U): U;

  /**
   * Gets the value from Some or returns a default value.
   */
  getOrElse(defaultValue: () => T): T;
}

/**
 * Creates an Option containing a value with methods attached.
 */
export const Some = <T>(value: T): OptionWithMethods<T> => {
  const option = {
    _tag: 'Some' as const,
    value
  };

  return {
    ...option,
    map: <U>(f: (value: T) => U): Option<U> => {
      return Some(f(option.value));
    },
    flatMap: <U>(f: (value: T) => Option<U>): Option<U> => {
      return f(option.value);
    },
    fold: <U>(ifNone: () => U, ifSome: (value: T) => U): U => {
      return ifSome(option.value);
    },
    getOrElse: (defaultValue: () => T): T => {
      return option.value;
    }
  };
};

/**
 * Represents the absence of a value with methods attached.
 */
export const None: OptionWithMethods<never> = {
  _tag: 'None',
  map: function <U>(_f: (value: never) => U): Option<U> {
    return this as any;
  },
  flatMap: function <U>(_f: (value: never) => Option<U>): Option<U> {
    return this as any;
  },
  fold: function <U>(ifNone: () => U, _ifSome: (value: never) => U): U {
    return ifNone();
  },
  getOrElse: function (defaultValue: () => never): never {
    return defaultValue();
  }
};

/**
 * Checks if an Option is Some.
 */
export const isSome = <T>(option: Option<T>): option is { _tag: 'Some'; value: T } => {
  return option._tag === 'Some';
};

/**
 * Checks if an Option is None.
 */
export const isNone = <T>(option: Option<T>): option is { _tag: 'None' } => {
  return option._tag === 'None';
};

/**
 * Static methods for Option operations
 */
export const Option = {
  /**
   * Creates an Option from a nullable value.
   * Returns Some(value) if value is not null or undefined, otherwise None.
   */
  fromNullable: <T>(value: T | null | undefined): Option<T> => {
    return value == null ? None : Some(value);
  },

  /**
   * Creates an Option from a value that could be null.
   * Returns Some(value) if value is not null, otherwise None.
   */
  fromNull: <T>(value: T | null): Option<T> => {
    return value === null ? None : Some(value);
  },

  /**
   * Creates an Option from a value that could be undefined.
   * Returns Some(value) if value is not undefined, otherwise None.
   */
  fromUndefined: <T>(value: T | undefined): Option<T> => {
    return value === undefined ? None : Some(value);
  }
};
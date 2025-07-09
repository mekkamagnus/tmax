/**
 * @file values.ts
 * @description T-Lisp value creation and manipulation utilities
 */

import type {
  TLispValue,
  TLispNil,
  TLispBoolean,
  TLispNumber,
  TLispString,
  TLispSymbol,
  TLispList,
  TLispFunction,
  TLispFunctionImpl,
  TLispMacro,
  TLispMacroImpl,
} from "./types.ts";

/**
 * Create a T-Lisp nil value
 * @returns T-Lisp nil
 */
export const createNil = (): TLispNil => ({
  type: "nil",
  value: null,
});

/**
 * Create a T-Lisp boolean value
 * @param value - Boolean value
 * @returns T-Lisp boolean
 */
export const createBoolean = (value: boolean): TLispBoolean => ({
  type: "boolean",
  value,
});

/**
 * Create a T-Lisp number value
 * @param value - Number value
 * @returns T-Lisp number
 */
export const createNumber = (value: number): TLispNumber => ({
  type: "number",
  value,
});

/**
 * Create a T-Lisp string value
 * @param value - String value
 * @returns T-Lisp string
 */
export const createString = (value: string): TLispString => ({
  type: "string",
  value,
});

/**
 * Create a T-Lisp symbol value
 * @param value - Symbol name
 * @returns T-Lisp symbol
 */
export const createSymbol = (value: string): TLispSymbol => ({
  type: "symbol",
  value,
});

/**
 * Create a T-Lisp list value
 * @param values - List elements
 * @returns T-Lisp list
 */
export const createList = (values: TLispValue[]): TLispList => ({
  type: "list",
  value: values,
});

/**
 * Create a T-Lisp function value
 * @param fn - Function implementation
 * @param name - Optional function name
 * @returns T-Lisp function
 */
export const createFunction = (
  fn: TLispFunctionImpl,
  name?: string
): TLispFunction => ({
  type: "function",
  value: fn,
  name,
});

/**
 * Create a T-Lisp macro value
 * @param fn - Macro implementation
 * @param name - Optional macro name
 * @returns T-Lisp macro
 */
export const createMacro = (
  fn: TLispMacroImpl,
  name?: string
): TLispMacro => ({
  type: "macro",
  value: fn,
  name,
});

/**
 * Check if value is nil
 * @param value - Value to check
 * @returns True if nil
 */
export const isNil = (value: TLispValue): value is TLispNil => {
  return value.type === "nil";
};

/**
 * Check if value is a macro
 * @param value - Value to check
 * @returns True if macro
 */
export const isMacro = (value: TLispValue): value is TLispMacro => {
  return value.type === "macro";
};

/**
 * Check if value is truthy in T-Lisp
 * @param value - Value to check
 * @returns True if truthy
 */
export const isTruthy = (value: TLispValue): boolean => {
  if (isNil(value)) return false;
  if (value.type === "boolean") return value.value as boolean;
  return true;
};

/**
 * Convert T-Lisp value to string representation
 * @param value - Value to convert
 * @returns String representation
 */
export const valueToString = (value: TLispValue): string => {
  switch (value.type) {
    case "nil":
      return "nil";
    case "boolean":
      return (value.value as boolean) ? "t" : "nil";
    case "number":
      return (value.value as number).toString();
    case "string":
      return `"${value.value as string}"`;
    case "symbol":
      return value.value as string;
    case "list":
      return `(${(value.value as TLispValue[]).map(valueToString).join(" ")})`;
    case "function":
      return `#<function${(value as TLispFunction).name ? ` ${(value as TLispFunction).name}` : ""}>`;
    case "macro":
      return `#<macro${(value as TLispMacro).name ? ` ${(value as TLispMacro).name}` : ""}>`;
    default:
      return `#<unknown>`;
  }
};

/**
 * Check if two T-Lisp values are equal
 * @param a - First value
 * @param b - Second value
 * @returns True if equal
 */
export const valuesEqual = (a: TLispValue, b: TLispValue): boolean => {
  if (a.type !== b.type) return false;
  
  switch (a.type) {
    case "nil":
      return true;
    case "boolean":
    case "number":
    case "string":
    case "symbol":
      return a.value === b.value;
    case "list":
      const aList = a.value as TLispValue[];
      const bList = b.value as TLispValue[];
      if (aList.length !== bList.length) return false;
      return aList.every((val: TLispValue, i: number) => valuesEqual(val, bList[i]!));
    case "function":
      return a.value === b.value;
    default:
      return false;
  }
};
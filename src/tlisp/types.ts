/**
 * @file types.ts
 * @description T-Lisp type definitions and data structures
 */

/**
 * T-Lisp value types
 */
export type TLispValueType =
  | "nil"
  | "boolean"
  | "number"
  | "string"
  | "symbol"
  | "list"
  | "function"
  | "macro"
  | "hashmap";

/**
 * T-Lisp value interface
 */
export interface TLispValue {
  type: TLispValueType;
  value: unknown;
}

/**
 * T-Lisp nil value
 */
export interface TLispNil extends TLispValue {
  type: "nil";
  value: null;
}

/**
 * T-Lisp boolean value
 */
export interface TLispBoolean extends TLispValue {
  type: "boolean";
  value: boolean;
}

/**
 * T-Lisp number value
 */
export interface TLispNumber extends TLispValue {
  type: "number";
  value: number;
}

/**
 * T-Lisp string value
 */
export interface TLispString extends TLispValue {
  type: "string";
  value: string;
}

/**
 * T-Lisp symbol value
 */
export interface TLispSymbol extends TLispValue {
  type: "symbol";
  value: string;
}

/**
 * T-Lisp list value
 */
export interface TLispList extends TLispValue {
  type: "list";
  value: TLispValue[];
}

/**
 * T-Lisp function type
 */
export type TLispFunctionImpl = (args: TLispValue[]) => TLispValue;

/**
 * T-Lisp function value
 */
export interface TLispFunction extends TLispValue {
  type: "function";
  value: TLispFunctionImpl;
  name?: string;
}

/**
 * T-Lisp macro implementation function
 */
export type TLispMacroImpl = (args: TLispValue[]) => TLispValue;

/**
 * T-Lisp macro value
 */
export interface TLispMacro extends TLispValue {
  type: "macro";
  value: TLispMacroImpl;
  name?: string;
}

/**
 * T-Lisp hash-map value
 */
export interface TLispHashmap extends TLispValue {
  type: "hashmap";
  value: Map<string, TLispValue>;
}

/**
 * T-Lisp environment for variable bindings
 */
export interface TLispEnvironment {
  /** Parent environment for lexical scoping */
  parent?: TLispEnvironment;
  
  /** Variable bindings */
  bindings: Map<string, TLispValue>;
  
  /** Look up a variable */
  lookup(name: string): TLispValue | undefined;
  
  /** Define a variable */
  define(name: string, value: TLispValue): void;
  
  /** Set a variable (must already exist) */
  set(name: string, value: TLispValue): void;
}

/**
 * T-Lisp interpreter interface
 */
export interface TLispInterpreter {
  /** Global environment */
  globalEnv: TLispEnvironment;
  
  /** Parse T-Lisp source code */
  parse(source: string): TLispValue;
  
  /** Evaluate T-Lisp expression */
  eval(expr: TLispValue, env?: TLispEnvironment): TLispValue;
  
  /** Execute T-Lisp source code */
  execute(source: string, env?: TLispEnvironment): TLispValue;
  
  /** Define a built-in function */
  defineBuiltin(name: string, fn: TLispFunctionImpl): void;
}

/**
 * T-Lisp parser interface
 */
export interface TLispParser {
  /** Parse source code into T-Lisp values */
  parse(source: string): TLispValue;
  
  /** Tokenize source code */
  tokenize(source: string): string[];
}
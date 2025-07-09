/**
 * @file environment.ts
 * @description T-Lisp environment implementation for variable scoping
 */

import type { TLispEnvironment, TLispValue } from "./types.ts";

/**
 * T-Lisp environment implementation
 */
export class TLispEnvironmentImpl implements TLispEnvironment {
  public parent?: TLispEnvironment;
  public bindings: Map<string, TLispValue>;

  /**
   * Create a new T-Lisp environment
   * @param parent - Parent environment for lexical scoping
   */
  constructor(parent?: TLispEnvironment) {
    this.parent = parent;
    this.bindings = new Map();
  }

  /**
   * Look up a variable in this environment or parent environments
   * @param name - Variable name
   * @returns Variable value or undefined if not found
   */
  lookup(name: string): TLispValue | undefined {
    const value = this.bindings.get(name);
    if (value !== undefined) {
      return value;
    }
    
    if (this.parent) {
      return this.parent.lookup(name);
    }
    
    return undefined;
  }

  /**
   * Define a variable in this environment
   * @param name - Variable name
   * @param value - Variable value
   */
  define(name: string, value: TLispValue): void {
    this.bindings.set(name, value);
  }

  /**
   * Set a variable that must already exist in this or parent environments
   * @param name - Variable name
   * @param value - New variable value
   * @throws Error if variable doesn't exist
   */
  set(name: string, value: TLispValue): void {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return;
    }
    
    if (this.parent) {
      this.parent.set(name, value);
      return;
    }
    
    throw new Error(`Undefined variable: ${name}`);
  }

  /**
   * Create a new child environment
   * @returns New child environment
   */
  createChild(): TLispEnvironment {
    return new TLispEnvironmentImpl(this);
  }
}
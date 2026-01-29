/**
 * @file repl.ts
 * @description T-Lisp REPL (Read-Eval-Print Loop) implementation
 */

import { createInterface, Interface } from 'readline';
import { TLispParser } from "./parser.ts";
import { createEvaluatorWithBuiltins } from "./evaluator.ts";
import { valueToString } from "./values.ts";
import type { TLispEnvironment } from "./types.ts";
import { TLispEvaluator } from "./evaluator.ts";

/**
 * T-Lisp REPL for interactive development
 */
export class TLispREPL {
  private parser: TLispParser;
  private evaluator: TLispEvaluator;
  private env: TLispEnvironment;
  private running: boolean = false;
  private rl: Interface;

  /**
   * Create a new T-Lisp REPL
   */
  constructor() {
    this.parser = new TLispParser();
    const { evaluator, env } = createEvaluatorWithBuiltins();
    this.evaluator = evaluator;
    this.env = env;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    this.running = true;
    console.log("T-Lisp REPL v1.0.0");
    console.log("Type 'exit' or 'quit' to exit, 'help' for help");
    console.log("");

    while (this.running) {
      try {
        const input = await this.readInput("tlisp> ");
        
        if (!input.trim()) {
          continue;
        }
        
        // Handle special commands
        if (this.handleCommand(input.trim())) {
          continue;
        }
        
        // Parse and evaluate the input
        const result = this.evaluate(input);
        if (result !== undefined) {
          console.log(valueToString(result));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Stop the REPL
   */
  stop(): void {
    this.running = false;
    this.rl.close();
  }

  /**
   * Evaluate a T-Lisp expression
   * @param source - Source code to evaluate
   * @returns Evaluated result
   */
  evaluate(source: string) {
    const parseResult = this.parser.parse(source);
    if ('left' in parseResult) {
      throw new Error(`Parse error: ${parseResult.left.message}`);
    }
    const expr = parseResult.right;
    return this.evaluator.eval(expr, this.env);
  }

  /**
   * Handle special REPL commands
   * @param input - User input
   * @returns True if command was handled
   */
  private handleCommand(input: string): boolean {
    switch (input.toLowerCase()) {
      case "exit":
      case "quit":
        console.log("Goodbye!");
        this.stop();
        return true;
        
      case "help":
        this.showHelp();
        return true;
        
      case "env":
        this.showEnvironment();
        return true;
        
      case "clear":
        console.clear();
        return true;
        
      default:
        return false;
    }
  }

  /**
   * Show help information
   */
  private showHelp(): void {
    console.log("T-Lisp REPL Commands:");
    console.log("  help    - Show this help message");
    console.log("  env     - Show current environment bindings");
    console.log("  clear   - Clear the screen");
    console.log("  exit    - Exit the REPL");
    console.log("  quit    - Exit the REPL");
    console.log("");
    console.log("T-Lisp Syntax:");
    console.log("  Numbers: 42, 3.14, -7");
    console.log("  Strings: \"hello world\"");
    console.log("  Booleans: t, nil");
    console.log("  Symbols: x, +, my-var");
    console.log("  Lists: (1 2 3), (+ 1 2)");
    console.log("  Quote: '(a b c)");
    console.log("  Quasiquote: `(a ,x c)");
    console.log("  Functions: (lambda (x) (* x x))");
    console.log("  Macros: (defmacro when (cond body) `(if ,cond ,body nil))");
    console.log("");
  }

  /**
   * Show current environment bindings
   */
  private showEnvironment(): void {
    console.log("Environment bindings:");
    if ('bindings' in this.env && this.env.bindings && this.env.bindings.size > 0) {
      for (const [name, value] of this.env.bindings) {
        console.log(`  ${name}: ${valueToString(value)}`);
      }
    } else {
      console.log("  (no bindings)");
    }
    console.log("");
  }

  /**
   * Read input from user
   * @param prompt - Prompt to display
   * @returns User input
   */
  private async readInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer: string) => {
        resolve(answer.trim());
      });
    });
  }
}

/**
 * Run the T-Lisp REPL
 */
export async function runREPL(): Promise<void> {
  const repl = new TLispREPL();
  await repl.start();
}
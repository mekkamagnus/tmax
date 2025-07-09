/**
 * @file repl.ts
 * @description T-Lisp REPL (Read-Eval-Print Loop) implementation
 */

import { TLispParser } from "./parser.ts";
import { createEvaluatorWithBuiltins } from "./evaluator.ts";
import { valueToString } from "./values.ts";
import type { TLispEnvironment } from "./types.ts";

/**
 * T-Lisp REPL for interactive development
 */
export class TLispREPL {
  private parser: TLispParser;
  private evaluator: any;
  private env: TLispEnvironment;
  private running: boolean = false;

  /**
   * Create a new T-Lisp REPL
   */
  constructor() {
    this.parser = new TLispParser();
    const { evaluator, env } = createEvaluatorWithBuiltins();
    this.evaluator = evaluator;
    this.env = env;
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
  }

  /**
   * Evaluate a T-Lisp expression
   * @param source - Source code to evaluate
   * @returns Evaluated result
   */
  evaluate(source: string): any {
    const expr = this.parser.parse(source);
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
    const bindings = (this.env as any).bindings;
    if (bindings && bindings.size > 0) {
      for (const [name, value] of bindings) {
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
    // Write prompt
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    
    // Read input line by line
    const decoder = new TextDecoder();
    let input = "";
    
    while (true) {
      const buf = new Uint8Array(1);
      const n = await Deno.stdin.read(buf);
      if (n === null) {
        this.stop();
        return "";
      }
      
      const char = decoder.decode(buf);
      if (char === "\n") {
        break;
      }
      input += char;
    }
    
    return input.trim();
  }
}

/**
 * Run the T-Lisp REPL
 */
export async function runREPL(): Promise<void> {
  const repl = new TLispREPL();
  await repl.start();
}
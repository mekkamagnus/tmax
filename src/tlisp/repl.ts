/**
 * @file repl.ts
 * @description Standalone T-Lisp REPL.
 */

import { createInterface, type Interface } from "node:readline";
import { Either } from "../utils/task-either.ts";
import { createStandaloneInterpreter, type StandaloneProfileOptions } from "./profiles/standalone.ts";
import type { TLispInterpreterImpl } from "./interpreter.ts";
import type { TLispValue } from "./types.ts";
import { createNil, createString, valueToString } from "./values.ts";
import { renderDiagnostic } from "./diagnostic-renderer.ts";

export interface TLispREPLOptions extends StandaloneProfileOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export function formBalance(source: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (const ch of source) {
    if (inComment) {
      if (ch === "\n") inComment = false;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === ";") {
      inComment = true;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
  }

  return depth;
}

export class TLispREPL {
  private interpreter: TLispInterpreterImpl;
  private running = false;
  private rl: Interface;
  private output: NodeJS.WriteStream;
  private recent: TLispValue[] = [createNil(), createNil(), createNil()];

  constructor(options: TLispREPLOptions = {}) {
    this.output = options.output ?? process.stdout;
    this.interpreter = createStandaloneInterpreter({
      ...options,
      stdout: options.stdout ?? this.output,
    });
    this.rl = createInterface({
      input: options.input ?? process.stdin,
      output: this.output,
      historySize: 1000,
    });
    this.installReplBindings();
  }

  async start(): Promise<void> {
    this.running = true;
    this.write("T-Lisp REPL\n");
    this.write("Type 'exit' or 'quit' to exit, 'help' for help\n\n");

    while (this.running) {
      try {
        const input = await this.readForm();
        const trimmed = input.trim();
        if (trimmed === "") continue;
        if (this.handleCommand(trimmed)) continue;
        const result = this.evaluate(trimmed);
        if (Either.isRight(result)) {
          this.recordResult(result.right);
          this.write(`${valueToString(result.right)}\n`);
        } else {
          const err = result.left;
          if (err.diagnostic) {
            this.recordError(err.message);
            this.write(`${renderDiagnostic(err.diagnostic)}\n`);
          } else {
            this.recordError(err.message);
            this.write(`Error: ${err.message}\n`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.recordError(message);
        this.write(`Error: ${message}\n`);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.rl.close();
  }

  evaluate(source: string) {
    return this.interpreter.execute(source);
  }

  private installReplBindings(): void {
    this.interpreter.globalEnv.define("*1", this.recent[0]!);
    this.interpreter.globalEnv.define("*2", this.recent[1]!);
    this.interpreter.globalEnv.define("*3", this.recent[2]!);
    this.interpreter.globalEnv.define("*e", createNil());
  }

  private recordResult(value: TLispValue): void {
    this.recent = [value, this.recent[0]!, this.recent[1]!];
    this.interpreter.globalEnv.define("*1", this.recent[0]!);
    this.interpreter.globalEnv.define("*2", this.recent[1]!);
    this.interpreter.globalEnv.define("*3", this.recent[2]!);
  }

  private recordError(message: string): void {
    this.interpreter.globalEnv.define("*e", createString(message));
  }

  private handleCommand(input: string): boolean {
    switch (input.toLowerCase()) {
      case "exit":
      case "quit":
        this.stop();
        return true;
      case "help":
        this.showHelp();
        return true;
      case "env":
        this.showEnvironment();
        return true;
      case "clear":
        this.write("\x1Bc");
        return true;
      default:
        return false;
    }
  }

  private showHelp(): void {
    this.write("T-Lisp REPL Commands:\n");
    this.write("  help    Show this help message\n");
    this.write("  env     Show current environment bindings\n");
    this.write("  clear   Clear the screen\n");
    this.write("  exit    Exit the REPL\n");
    this.write("  quit    Exit the REPL\n\n");
    this.write("REPL bindings: *1, *2, *3 for recent results; *e for the last error\n");
  }

  private showEnvironment(): void {
    this.write("Environment bindings:\n");
    for (const [name, value] of this.interpreter.globalEnv.bindings) {
      this.write(`  ${name}: ${valueToString(value)}\n`);
    }
    this.write("\n");
  }

  private async readForm(): Promise<string> {
    let source = "";
    let prompt = "tlisp> ";

    while (true) {
      const line = await this.question(prompt);
      source += source.length === 0 ? line : `\n${line}`;
      if (formBalance(source) <= 0) return source;
      prompt = "....> ";
    }
  }

  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer: string) => resolve(answer));
    });
  }

  private write(text: string): void {
    this.output.write(text);
  }
}

export async function runREPL(options: TLispREPLOptions = {}): Promise<void> {
  const repl = new TLispREPL(options);
  await repl.start();
}

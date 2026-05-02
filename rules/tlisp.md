---
scope: src/tlisp/**/*
---

# T-Lisp Interpreter Rules

Applies to all files in the T-Lisp interpreter (`src/tlisp/`).

## Architecture

The T-Lisp interpreter is a complete Lisp implementation with:
- **Tokenizer**: Lexical analysis with quasiquote support
- **Parser**: AST generation with proper error handling
- **Evaluator**: Expression evaluation with lexical scoping and tail-call optimization
- **Standard Library**: 31 built-in functions (arithmetic, lists, strings, control flow)
- **Macro System**: Full quasiquote support with compile-time expansion
- **Environment**: Lexical scoping with environment chains

## Implementation Conventions

- All higher-level editor functionality lives in T-Lisp, not TypeScript
- T-Lisp handles: commands, modes, key bindings, UI logic, configuration, extensibility
- TypeScript provides only the low-level primitives the T-Lisp layer calls
- Tail-call optimization must be preserved in the evaluator
- Environment chains implement lexical scoping — no dynamic scope

## Key Files

| File | Responsibility |
|------|---------------|
| `src/tlisp/tokenizer.ts` | Lexical analysis, quasiquote tokens |
| `src/tlisp/parser.ts` | AST generation |
| `src/tlisp/evaluator.ts` | Expression evaluation, TCO, environment |
| `src/tlisp/stdlib.ts` | Built-in functions |
| `src/tlisp/core/bindings/*.tlisp` | T-Lisp defined key bindings and commands |

## Error Handling

- Parse and evaluation errors must return descriptive messages
- Use the project's functional error types, not raw throws
- Invalid T-Lisp expressions should fail gracefully with user-visible messages

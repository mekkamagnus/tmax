#!/usr/bin/env bash
# demo-tlisp.sh — Demo the T-Lisp interpreter and editor API.
#
# Exercises arithmetic, string ops, list manipulation, variable
# definitions, function definitions, and editor API primitives.
# Safe to re-run.
#
# Usage: bash .claude/skills/demo/scripts/demo-tlisp.sh

source "$(dirname "$0")/demo-lib.sh"

demo_start

demo_section "Arithmetic"

# Basic arithmetic — the T-Lisp standard library includes +, -, *, /.
demo_step "Addition"
demo_eval '(+ 1 2)'

demo_step "Chained arithmetic"
demo_eval '(+ (* 3 4) (- 10 5))'

demo_section "Strings"

# String operations — concat, length, substring.
demo_step "String concatenation"
demo_eval '(concat "hello" " " "world")'

demo_step "String length"
demo_eval '(length "tmax")'

demo_section "Lists"

# List construction and operations.
demo_step "List creation"
demo_eval '(list 1 2 3)'

demo_step "List length"
demo_eval '(length (list 1 2 3))'

demo_step "Map over a list"
demo_eval '(mapcar (lambda (x) (+ x 10)) (list 1 2 3))'

demo_section "Variables and Functions"

# Define a global variable with setq.
demo_step "Define a variable"
demo_eval "(setq x 42)"
demo_eval 'x'

# Define a function and call it.
demo_step "Define and call a function"
demo_eval '(defun square (n) (* n n))'
demo_eval '(square 7)'

# Let-binding for local scope.
demo_step "Let-binding"
demo_eval '(let ((a 3) (b 4)) (+ (* a a) (* b b)))'

demo_section "Editor API Primitives"

# These are the TypeScript primitives exposed to T-Lisp.
demo_step "Cursor position"
demo_eval '(cursor-position)'

demo_step "Editor mode"
demo_eval '(editor-mode)'

demo_step "Buffer line count"
demo_eval '(buffer-line-count)'

demo_step "Key binding lookup"
demo_eval '(key-binding "j" "normal")'

demo_section "Error Handling"

# T-Lisp errors are captured and returned — they don't crash the daemon.
demo_step "Undefined symbol error"
demo_eval '(this-does-not-exist)' ""

demo_step "Type error"
demo_eval '(+ "string" 5)' ""

demo_step "Arity error (variadic + returns identity 0)"
demo_eval '(+)'

demo_end

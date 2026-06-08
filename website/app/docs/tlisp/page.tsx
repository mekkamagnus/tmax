import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function TlispPage() {
  const { prev, next } = getPrevNext("/docs/tlisp");

  return (
    <DocsPage
      title="T-Lisp"
      description="Language reference — data types, special forms, modules, async, macros, and stdlib"
      prevPage={prev}
      nextPage={next}
    >
      <h2 id="language-overview">Language Overview</h2>
      <p>
        T-Lisp is tmax&apos;s built-in Lisp dialect. Every editor command, key
        binding, and mode is defined in T-Lisp. This means you can customize
        everything without touching TypeScript.
      </p>
      <p>
        T-Lisp is a <strong>Lisp-1</strong> (variables and functions share the
        same namespace) with lexical scoping, tail-call optimization, a
        quasiquote macro system, a Guile-style module system with namespaces,
        and async primitives.
      </p>
      <CodeBlock language="tlisp" filename="hello.tlisp">
        {`;; Your first T-Lisp expression
(+ 1 2)                              ; => 3

;; Define a function with a docstring
(defun greet (name)
  "Greet someone by name"
  (string-append "Hello, " name "!"))

(greet "tmax")                        ; => "Hello, tmax!"`}
      </CodeBlock>

      <h2 id="data-types">Data Types</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Example</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Number</td>
            <td>
              <code>42</code>, <code>3.14</code>
            </td>
            <td>Integers and floats (JavaScript number / float64)</td>
          </tr>
          <tr>
            <td>String</td>
            <td>
              <code>&quot;hello&quot;</code>
            </td>
            <td>Double-quoted with escape sequences (\n, \t, \\, \&quot;)</td>
          </tr>
          <tr>
            <td>Symbol</td>
            <td>
              <code>foo</code>, <code>buffer-text</code>
            </td>
            <td>Interned identifiers. Supports /-separated qualified names</td>
          </tr>
          <tr>
            <td>Boolean</td>
            <td>
              <code>t</code>, <code>nil</code>
            </td>
            <td>
              <code>t</code> is true. <code>nil</code> is false and the empty
              list.
            </td>
          </tr>
          <tr>
            <td>List</td>
            <td>
              <code>(1 2 3)</code>
            </td>
            <td>Ordered sequences. Code and data share the same structure.</td>
          </tr>
          <tr>
            <td>Hashmap</td>
            <td>
              <code>(hashmap &quot;key&quot; 42)</code>
            </td>
            <td>String-keyed dictionaries with immutable operations</td>
          </tr>
          <tr>
            <td>Function</td>
            <td>
              <code>(lambda (x) x)</code>
            </td>
            <td>First-class closures with docstring and parameter metadata</td>
          </tr>
          <tr>
            <td>Macro</td>
            <td>
              <code>(defmacro when ...)</code>
            </td>
            <td>Code transformers that receive unevaluated forms</td>
          </tr>
          <tr>
            <td>Promise</td>
            <td>
              <code>(promise-value p)</code>
            </td>
            <td>Async value wrapping a JavaScript Promise</td>
          </tr>
        </tbody>
      </table>

      <h2 id="special-forms">Special Forms</h2>
      <p>
        Special forms are core control structures that evaluate arguments
        lazily.
      </p>

      <h3>
        <code>quote</code> / <code>if</code> / <code>cond</code>
      </h3>
      <CodeBlock language="tlisp">
        {`(quote (1 2 3))    ; => (1 2 3)
'(1 2 3)            ; => (1 2 3) — shorthand

(if (> x 0) "positive" "non-positive")

(cond
  ((< x 0) "negative")
  ((= x 0) "zero")
  (t       "positive"))`}
      </CodeBlock>

      <h3>
        <code>let</code> / <code>async-let</code>
      </h3>
      <CodeBlock language="tlisp">
        {`;; Synchronous let — single body expression
(let ((x 10) (y 20))
  (+ x y))            ; => 30

;; Async let — multiple body expressions, auto-resolves promises
(async-let ((data (fetch-url "https://example.com")))
  (string-length data)
  (print "done"))`}
      </CodeBlock>

      <h3>
        <code>lambda</code> / <code>defun</code>
      </h3>
      <CodeBlock language="tlisp">
        {`;; Lambda with optional parameters and default values
(let ((add (lambda (x &optional (y 10 y-supplied?))
             (+ x y))))
  (add 5)       ; => 15 (y defaults to 10)
  (add 5 20))   ; => 25

;; Named function with docstring
(defun factorial (n)
  "Compute n! using tail recursion"
  (if (<= n 1) 1
    (* n (factorial (- n 1)))))`}
      </CodeBlock>

      <h3>
        <code>progn</code> / <code>defvar</code> / <code>set!</code>
      </h3>
      <CodeBlock language="tlisp">
        {`(progn expr1 expr2 expr3)   ; evaluate all, return last

(defvar counter 0)           ; declare variable
(set! counter (+ counter 1)) ; mutate existing variable`}
      </CodeBlock>

      <h2 id="quasiquote-and-macros">Quasiquote and Macros</h2>
      <p>
        Quasiquote (<code>`</code>) creates templates. <code>,</code> (unquote)
        and <code>,@</code> (splice-unquote) insert evaluated values. Nesting
        is tracked with a depth counter.
      </p>
      <CodeBlock language="tlisp">
        {`(let ((x 42))
  \`(a ,x b))           ; => (a 42 b)

(let ((xs '(1 2 3)))
  \`(a ,@xs b))         ; => (a 1 2 3 b)`}
      </CodeBlock>

      <h3>
        <code>defmacro</code>
      </h3>
      <p>
        Macros receive <strong>unevaluated</strong> arguments, produce code,
        and the expansion is evaluated in the caller&apos;s environment.
      </p>
      <CodeBlock language="tlisp" filename="macros.tlisp">
        {`;; Define when as a macro
(defmacro when (condition &rest body)
  \`(if ,condition
       (progn ,@body)))

;; Save-and-quit macro
(defmacro save-and-quit ()
  '(progn (quick-save) (editor-quit)))

;; Use it
(when (> x 0)
  (print "positive")
  (print x))`}
      </CodeBlock>

      <h2 id="module-system">Module System</h2>
      <p>
        T-Lisp has a <strong>Guile/Racket-style module system</strong> with
        isolated environments, explicit exports, qualified imports, and
        circular dependency detection.
      </p>

      <h3>Defining Modules</h3>
      <CodeBlock language="tlisp" filename="my/string-utils.tlisp">
        {`(defmodule my/string-utils
  (export capitalize word-count)
  (require-module std/strings)

  (defun capitalize (str)
    (let ((first (substring str 0 1))
          (rest  (substring str 1)))
      (string-append (string-upcase first)
                     (string-downcase rest))))

  (defun word-count (str)
    (length (string-split str " "))))`}
      </CodeBlock>
      <p>
        Modules have isolated environments (child of builtins, not global), so
        they can&apos;t accidentally access user variables. Only exported
        symbols are public.
      </p>

      <h3>Importing Modules</h3>
      <CodeBlock language="tlisp">
        {`;; Default alias — access as my/string-utils/capitalize
(require-module my/string-utils)

;; Custom alias — access as su/capitalize
(require-module my/string-utils :as su)

;; Selective import — use unqualified
(require-module my/string-utils :import (capitalize word-count))

(capitalize "hello")    ; => "Hello"`}
      </CodeBlock>

      <h3>Standard Library Modules</h3>
      <table>
        <thead>
          <tr>
            <th>Module</th>
            <th>Exports</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>std/strings</code>
            </td>
            <td>join, trim, replace, split, prefix?, suffix?, contains?</td>
          </tr>
          <tr>
            <td>
              <code>std/lists</code>
            </td>
            <td>map, filter, slice</td>
          </tr>
        </tbody>
      </table>

      <h3>Module Resolution</h3>
      <p>Modules are resolved in this order:</p>
      <ol>
        <li>Embedded modules (built into the binary)</li>
        <li>Core modules under <code>editor/</code> prefix</li>
        <li>
          Filesystem: <code>TLISP_PATH</code> env, CWD, package roots, user
          roots
        </li>
        <li>Plugin files: <code>module-name/plugin.tlisp</code></li>
      </ol>

      <h2 id="async">Async</h2>
      <p>
        T-Lisp supports async operations through JavaScript Promises. There is
        no explicit <code>async/await</code> syntax — async is handled
        implicitly through <code>async-let</code> and the interpreter&apos;s
        async evaluation path.
      </p>
      <CodeBlock language="tlisp">
        {`;; async-let auto-resolves promises in bindings
(async-let ((content (read-file "/path/to/file")))
  (string-length content))

;; Promise operations
(promise-resolved-p p)    ; check if resolved (sync)
(promise-value p)         ; await and get value (requires async context)
(promise-then p callback) ; chain promise`}
      </CodeBlock>
      <p>
        Functions created with <code>lambda</code> automatically get both sync
        and async execution paths. Built-ins can define separate async
        implementations via <code>defineAsyncBuiltin</code>.
      </p>

      <h2 id="error-handling">Error Handling</h2>
      <p>
        T-Lisp uses a structured error system with diagnostic codes, source
        spans, and stack traces.
      </p>
      <CodeBlock language="tlisp">
        {`;; Error types: EvalError, BufferError, FileSystemError,
;; TerminalError, ValidationError, ConfigError

;; Diagnostic codes:
;;   TL0001 (parse), TL0002 (tokenize)
;;   TL1001 (undefined symbol), TL1002 (type), TL1003 (arity)
;;   TL2001 (module not found), TL2002 (not exported),
;;   TL2003 (circular dependency)
;;   TL3001 (macro error), TL4001 (host primitive)

;; Debug builtins
(tlisp-last-error)         ; last error as string
(tlisp-last-error-json)    ; last error as alist
(tlisp-backtrace)          ; call stack as list of strings`}
      </CodeBlock>
      <p>
        When an undefined symbol is encountered, the evaluator suggests similar
        names using Levenshtein distance.
      </p>

      <h2 id="standard-library">Standard Library</h2>

      <h3>Arithmetic</h3>
      <CodeBlock language="tlisp">
        {`(+ 1 2 3)       ; => 6 (variadic)
(- 10 3)        ; => 7
(* 4 5)         ; => 20 (variadic)
(/ 10 2)        ; => 5
(mod 10 3)      ; => 1
(abs -5)        ; => 5
(min 3 1 4)     ; => 1
(max 3 1 4)     ; => 4
(sqrt 16)       ; => 4
(expt 2 10)     ; => 1024
(floor 3.7)     ; => 3
(ceiling 3.2)   ; => 4
(round 3.5)     ; => 4`}
      </CodeBlock>

      <h3>Comparison</h3>
      <CodeBlock language="tlisp">
        {`(= 3 3)         ; => t (structural equality)
(equal '(1 2) '(1 2))  ; => t (deep equality)
(< 1 2)         ; => t
(> 1 2)         ; => nil
(>= 2 2)        ; => t
(<= 1 2)        ; => t`}
      </CodeBlock>

      <h3>List Operations</h3>
      <CodeBlock language="tlisp">
        {`(car '(1 2 3))     ; => 1
(cdr '(1 2 3))     ; => (2 3)
(cons 0 '(1 2))    ; => (0 1 2)
(list 1 2 3)       ; => (1 2 3)
(append '(1 2) '(3 4))  ; => (1 2 3 4)
(reverse '(1 2 3)) ; => (3 2 1)
(nth 1 '(a b c))   ; => b
(last '(1 2 3))    ; => 3
(member 3 '(1 2 3))  ; => (3)
(length '(a b c))  ; => 3`}
      </CodeBlock>

      <h3>Higher-Order Functions</h3>
      <CodeBlock language="tlisp">
        {`(mapcar (lambda (x) (* x x)) '(1 2 3))  ; => (1 4 9)
(filter (lambda (x) (> x 2)) '(1 2 3 4))  ; => (3 4)
(stable-sort < '(3 1 4 1 5))              ; => (1 1 3 4 5)
(list-slice '(a b c d) 1 3)               ; => (b c)
(funcall + 1 2)                            ; => 3
(apply + '(1 2 3))                         ; => 6`}
      </CodeBlock>

      <h3>String Operations</h3>
      <CodeBlock language="tlisp">
        {`(string-append "hello" " " "world")  ; => "hello world"
(string-length "hello")                 ; => 5
(substring "hello" 1 3)                 ; => "el"
(string-split "a,b,c" ",")              ; => ("a" "b" "c")
(string-join "-" '("a" "b" "c"))        ; => "a-b-c"
(string-upcase "hello")                 ; => "HELLO"
(string-downcase "HELLO")               ; => "hello"
(string-trim "  hi  ")                  ; => "hi"
(string-replace "foo bar" "bar" "baz")  ; => "foo baz"
(string-prefix-p "hel" "hello")         ; => t
(string-contains-p "lo" "hello")        ; => t
(number-to-string 42)                   ; => "42"
(string-to-number "42")                 ; => 42`}
      </CodeBlock>

      <h3>Hashmap Operations</h3>
      <CodeBlock language="tlisp">
        {`(let ((m (hashmap "name" "tmax" "version" "0.2")))
  (hashmap-get m "name")          ; => "tmax"
  (hashmap-set m "year" 2026)     ; => new map with "year" added
  (hashmap-keys m)                 ; => ("name" "version")
  (hashmap-has-key? m "name"))    ; => t`}
      </CodeBlock>

      <h3>Type Predicates</h3>
      <CodeBlock language="tlisp">
        {`(null nil)       ; => t
(atom 42)        ; => t
(numberp 42)     ; => t
(stringp "hi")   ; => t
(symbolp 'foo)   ; => t
(listp '(1 2))   ; => t
(functionp +)    ; => t
(hashmapp m)     ; => t for hashmaps
(zerop 0)        ; => t
(evenp 4)        ; => t
(oddp 3)         ; => t`}
      </CodeBlock>

      <h3>Logical Operations</h3>
      <CodeBlock language="tlisp">
        {`(not nil)           ; => t
(and 1 2 3)         ; => 3
(or nil nil 42)     ; => 42`}
      </CodeBlock>

      <h3>Fuzzy Matching</h3>
      <p>
        T-Lisp includes several matching primitives used by the completion
        system:
      </p>
      <CodeBlock language="tlisp">
        {`;; Regex match spans
(string-match-spans "def" "define-function")  ; => ((0 3) (8 11))

;; Flex/fuzzy matching (in-order characters)
(string-flex-spans "dfn" "define-function")   ; => ((0 1) (3 4) (8 11))

;; Initialism matching (word-start characters)
(string-initialism-spans "df" "define-function")  ; => ((0 1) (8 9))

;; Literal matching
(literal-match-spans "fun" "define-function") ; => ((8 11))`}
      </CodeBlock>

      <h3>Debug and Introspection</h3>
      <CodeBlock language="tlisp">
        {`(trace my-function)    ; enable tracing
(untrace my-function)  ; disable tracing
(trace-list)           ; list traced functions
(doc my-function)      ; show docstring + params
(apropos "buffer")     ; find bindings matching substring
(loaded-modules)       ; list loaded module names`}
      </CodeBlock>

      <h2 id="test-framework">Test Framework</h2>
      <p>
        T-Lisp has a built-in test framework with suites, fixtures, and
        assertions.
      </p>
      <CodeBlock language="tlisp" filename="tests.tlisp">
        {`;; Define tests
(deftest test-arithmetic ()
  (assert-equal 4 (+ 2 2))
  (assert-true (> 5 3))
  (assert-false (< 1 0)))

;; Test suite with setup/teardown
(deftest-suite string-suite "String operations"
  (suite-setup
    (defvar test-str "hello world"))
  (suite-teardown
    (set! test-str nil))
  (deftest test-split ()
    (assert-equal 2 (length (string-split test-str " ")))))

;; Assertions
(assert-equal expected actual)
(assert-not-equal expected actual)
(assert-true value)
(assert-false value)
(assert-type value 'string)
(assert-error (car nil))      ; asserts the form errors

;; Run tests
(test-run "test-arithmetic")
(test-run-all)                 ; => [passed, failed, total]`}
      </CodeBlock>

      <h2 id="repl">REPL</h2>
      <p>
        The standalone T-Lisp REPL (<code>tlisp</code>) supports multi-line
        input and stores recent results:
      </p>
      <CodeBlock language="text" filename="repl">
        {`$ tlisp
> (+ 1 2)
3
> *1          ; last result
3
> *2          ; second-to-last
nil
> *e          ; last error (nil if none)
nil
> help        ; show commands
> env         ; show all bindings
> exit`}
      </CodeBlock>

      <h2 id="serialization">Serialization</h2>
      <p>
        T-Lisp values can be serialized to JSON and back. Functions, macros,
        and promises are not serializable.
      </p>
      <CodeBlock language="tlisp">
        {`;; Data types serialize to: { "type": "number", "value": 42 }
;; Lists serialize as arrays
;; Hashmaps serialize as plain objects`}
      </CodeBlock>

      <h2 id="editor-api">Editor API</h2>
      <p>
        When running inside tmax, T-Lisp exposes 100+ functions for editor
        control. The most commonly used:
      </p>
      <CodeBlock language="tlisp">
        {`;; Buffer operations
(buffer-text)              ; get entire buffer text
(buffer-line-count)        ; number of lines
(buffer-insert "text")     ; insert text at cursor
(buffer-delete 5)          ; delete 5 characters
(buffer-length)            ; total character count
(buffer-get-line n)        ; get line by index

;; Cursor
(cursor-line)              ; current line (0-indexed)
(cursor-column)            ; current column
(cursor-move line col)     ; move cursor

;; Editor state
(editor-mode)              ; current mode string
(editor-set-mode "insert") ; change mode
(editor-set-status "msg")  ; show message
(editor-quit)              ; quit editor

;; File
(quick-save)               ; save current file

;; Key bindings
(key-bind "C-s" "(quick-save)")
(key-bind "W" "(word-count)" "normal")`}
      </CodeBlock>
    </DocsPage>
  );
}

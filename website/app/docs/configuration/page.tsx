import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function ConfigurationPage() {
  const { prev, next } = getPrevNext("/docs/configuration");

  return (
    <DocsPage
      title="Configuration"
      description="init.tlisp, key bindings, custom functions, and plugins"
      prevPage={prev}
      nextPage={next}
    >
      <h2>init.tlisp</h2>
      <p>
        tmax loads <code>~/.config/tmax/init.tlisp</code> on startup. This file
        is where you define key bindings, custom functions, and load plugins.
      </p>
      <CodeBlock language="tlisp" filename="~/.config/tmax/init.tlisp">
        {`;; Welcome message
(editor-set-status "tmax ready - Custom config loaded")

;; Custom key bindings
(key-bind "C-s" "(quick-save)")
(key-bind "L" "(editor-set-status (string-append \\"Line: \\" (number-to-string (+ (cursor-line) 1))))" "normal")

;; Define a custom function
(defun word-count ()
  (let ((text (buffer-text)))
    (editor-set-status
      (string-append "Words: "
                     (number-to-string (length (split-string text " ")))))))

(key-bind "W" "(word-count)" "normal")`}
      </CodeBlock>

      <h2>Key Bindings</h2>
      <p>
        The <code>key-bind</code> function maps a key sequence to a T-Lisp
        expression in a specific mode.
      </p>
      <CodeBlock language="tlisp">
        {`;; (key-bind KEY EXPRESSION MODE)

;; Normal mode bindings
(key-bind "Q" "(editor-quit)" "normal")
(key-bind "D" "(buffer-insert (current-date))" "normal")

;; Insert mode bindings
(key-bind "C-s" "(quick-save)" "insert")

;; Works in all modes (omit mode argument)
(key-bind "C-s" "(quick-save)")`}
      </CodeBlock>

      <h3>Key Notation</h3>
      <table>
        <thead>
          <tr>
            <th>Notation</th>
            <th>Key</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>C-s</code>
            </td>
            <td>Ctrl+S</td>
          </tr>
          <tr>
            <td>
              <code>SPC ;</code>
            </td>
            <td>Space followed by ;</td>
          </tr>
          <tr>
            <td>
              <code>g g</code>
            </td>
            <td>g pressed twice</td>
          </tr>
          <tr>
            <td>
              <code>Enter</code>
            </td>
            <td>Enter/Return key</td>
          </tr>
          <tr>
            <td>
              <code>Tab</code>
            </td>
            <td>Tab key</td>
          </tr>
        </tbody>
      </table>

      <h2>Custom Functions</h2>
      <p>
        Define functions with <code>defun</code>. They have full access to the
        editor API.
      </p>
      <CodeBlock language="tlisp" filename="custom-functions.tlisp">
        {`;; Navigate to the middle of the buffer
(defun center-cursor ()
  (let ((line-count (buffer-line-count))
        (center-line (/ line-count 2)))
    (cursor-move center-line 0)))

(key-bind "zz" "(center-cursor)" "normal")

;; Show file statistics
(defun file-stats ()
  (let ((lines (buffer-line-count))
        (chars (buffer-length)))
    (editor-set-status
      (string-append "Lines: " (number-to-string lines)
                     " Chars: " (number-to-string chars)))))

(key-bind "S" "(file-stats)" "normal")`}
      </CodeBlock>

      <h2>Macros</h2>
      <p>
        Use <code>defmacro</code> to create code-generating macros. Macros are
        expanded at load time and can use quasiquote for templating.
      </p>
      <CodeBlock language="tlisp" filename="macros.tlisp">
        {`;; Save and quit in one command
(defmacro save-and-quit ()
  '(progn (quick-save) (editor-quit)))

;; Duplicate the current line
(defmacro duplicate-line ()
  '(progn
     (beginning-of-line)
     (let ((line-content (buffer-get-line (cursor-line))))
       (end-of-line)
       (buffer-insert "\\n")
       (buffer-insert line-content))))`}
      </CodeBlock>

      <h2>Plugin System</h2>
      <p>
        Plugins are T-Lisp files that extend tmax. Load them from your{" "}
        <code>init.tlisp</code>:
      </p>
      <CodeBlock language="tlisp" filename="init.tlisp">
        {`;; Load a plugin from a file
(load-file "~/.config/tmax/plugins/my-plugin.tlisp")

;; Or load from the T-Lisp path
(load "my-plugin")`}
      </CodeBlock>

      <h3>Example Plugin: Programming Mode</h3>
      <p>
        This plugin adds programming-focused key bindings and code navigation:
      </p>
      <CodeBlock language="tlisp" filename="programming.tlisp">
        {`;; Comment/uncomment line
(defun toggle-line-comment ()
  (let ((line (buffer-get-line (cursor-line))))
    (if (string-prefix-p ";; " line)
        (progn (beginning-of-line) (buffer-delete 3))
      (progn (beginning-of-line) (buffer-insert ";; ")))))

(key-bind "C-/" "(toggle-line-comment)" "normal")

;; Smart newline with auto-indent
(defun smart-newline ()
  (let ((current-line (buffer-get-line (cursor-line))))
    (let ((indent-level (count-leading-spaces current-line)))
      (buffer-insert "\\n")
      (dotimes (i indent-level)
        (buffer-insert " ")))))

(key-bind "Enter" "(smart-newline)" "insert")`}
      </CodeBlock>

      <h2>Complete Configuration Example</h2>
      <p>
        Here&apos;s a full <code>init.tlisp</code> with common customizations:
      </p>
      <CodeBlock language="tlisp" filename="~/.config/tmax/init.tlisp">
        {`;; tmax Configuration

;; === Key Bindings ===
(key-bind "C-s" "(quick-save)")
(key-bind "Q" "(editor-quit)" "normal")
(key-bind "L" "(show-position)" "normal")

;; === Custom Functions ===
(defun show-position ()
  (let ((line (+ (cursor-line) 1))
        (col (+ (cursor-column) 1))
        (total (buffer-line-count)))
    (editor-set-status
      (string-append "Line " (number-to-string line)
                     " of " (number-to-string total)
                     ", Col " (number-to-string col)))))

(defun word-count ()
  (let ((text (buffer-text)))
    (editor-set-status
      (string-append "Words: "
                     (number-to-string
                       (length (split-string text " ")))))))

(key-bind "W" "(word-count)" "normal")

;; === Navigation ===
(defun beginning-of-buffer ()
  (cursor-move 0 0))

(defun end-of-buffer ()
  (let ((last-line (- (buffer-line-count) 1)))
    (cursor-move last-line 0)))

(key-bind "g g" "(beginning-of-buffer)" "normal")
(key-bind "G" "(end-of-buffer)" "normal")

;; === Macros ===
(defmacro save-and-quit ()
  '(progn (quick-save) (editor-quit)))

;; === Status ===
(editor-set-status "tmax ready")`}
      </CodeBlock>
    </DocsPage>
  );
}

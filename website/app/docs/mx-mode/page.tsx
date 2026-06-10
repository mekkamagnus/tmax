import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function MxModePage() {
  const { prev, next } = getPrevNext("/docs/mx-mode");

  return (
    <DocsPage
      title="M-x Mode"
      description="Execute commands by name with completion"
      prevPage={prev}
      nextPage={next}
    >
      <h2 id="how-mx-works">How M-x Works</h2>
      <p>
        Press <code>SPC ;</code> in normal mode to enter M-x mode. Type a
        command name to execute any T-Lisp function by name. This is the
        Emacs-style extensibility entry point — every editor function is
        accessible through M-x.
      </p>
      <p>
        As you type, the minibuffer shows a completion list that narrows with
        each character. This vertico-style completion lets you find commands by
        partial match.
      </p>

      <h2 id="common-commands">Common Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>cursor-position</code></td>
            <td>Show current line and column number</td>
          </tr>
          <tr>
            <td><code>editor-mode</code></td>
            <td>Show current editing mode</td>
          </tr>
          <tr>
            <td><code>quit</code></td>
            <td>Quit the editor</td>
          </tr>
          <tr>
            <td><code>describe-key</code></td>
            <td>Show what a key binding does</td>
          </tr>
          <tr>
            <td><code>describe-function</code></td>
            <td>Show documentation for a function</td>
          </tr>
          <tr>
            <td><code>apropos-command</code></td>
            <td>Search for commands by keyword</td>
          </tr>
          <tr>
            <td><code>find-file</code></td>
            <td>Open a file (with completion)</td>
          </tr>
          <tr>
            <td><code>switch-buffer</code></td>
            <td>Switch to another buffer</td>
          </tr>
          <tr>
            <td><code>quick-save</code></td>
            <td>Save current file</td>
          </tr>
        </tbody>
      </table>

      <h2 id="minibuffer-keys">Minibuffer Keys</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Printable characters</td>
            <td>Type command name (narrows completion list)</td>
          </tr>
          <tr>
            <td><code>Tab</code></td>
            <td>Complete to longest common prefix</td>
          </tr>
          <tr>
            <td><code>Enter</code></td>
            <td>Execute command (or top completion)</td>
          </tr>
          <tr>
            <td><code>Escape</code></td>
            <td>Cancel and return to normal mode</td>
          </tr>
          <tr>
            <td><code>C-g</code></td>
            <td>Cancel and return to normal mode</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

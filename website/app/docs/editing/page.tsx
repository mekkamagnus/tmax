import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function EditingPage() {
  const { prev, next } = getPrevNext("/docs/editing");

  return (
    <DocsPage
      title="Editing"
      description="Modes, key bindings, operators, and text objects"
      prevPage={prev}
      nextPage={next}
    >
      <h2>Modes Overview</h2>
      <p>
        tmax is a <strong>modal editor</strong> — keys behave differently
        depending on the current mode. This follows the Vim tradition where each
        mode is optimized for a specific kind of interaction.
      </p>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Purpose</th>
            <th>Enter</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Normal</strong>
            </td>
            <td>Navigation, operators, commands</td>
            <td>
              <code>Escape</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Insert</strong>
            </td>
            <td>Text entry</td>
            <td>
              <code>i</code>, <code>a</code>, <code>o</code>, <code>O</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Visual</strong>
            </td>
            <td>Text selection</td>
            <td>
              <code>v</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Command</strong>
            </td>
            <td>Ex-style commands (<code>:q</code>, <code>:w</code>)</td>
            <td>
              <code>:</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>M-x</strong>
            </td>
            <td>Execute commands by name</td>
            <td>
              <code>SPC ;</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Normal Mode</h2>
      <p>
        Normal mode is the default. All key bindings are optimized for
        navigation and text manipulation.
      </p>
      <h3>Navigation</h3>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>h</code> <code>j</code> <code>k</code> <code>l</code>
            </td>
            <td>Left, down, up, right</td>
          </tr>
          <tr>
            <td>
              <code>w</code> / <code>b</code>
            </td>
            <td>Next word / previous word</td>
          </tr>
          <tr>
            <td>
              <code>0</code> / <code>$</code>
            </td>
            <td>Start / end of line</td>
          </tr>
          <tr>
            <td>
              <code>g g</code> / <code>G</code>
            </td>
            <td>Start / end of file</td>
          </tr>
          <tr>
            <td>
              <code>C-d</code> / <code>C-u</code>
            </td>
            <td>Half page down / up</td>
          </tr>
        </tbody>
      </table>

      <h2>Insert Mode</h2>
      <p>
        In insert mode, all keystrokes are entered as text. Press{" "}
        <code>Escape</code> to return to normal mode.
      </p>
      <h3>Entering Insert Mode</h3>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>i</code>
            </td>
            <td>Insert before cursor</td>
          </tr>
          <tr>
            <td>
              <code>a</code>
            </td>
            <td>Insert after cursor (append)</td>
          </tr>
          <tr>
            <td>
              <code>o</code>
            </td>
            <td>Open line below</td>
          </tr>
          <tr>
            <td>
              <code>O</code>
            </td>
            <td>Open line above</td>
          </tr>
          <tr>
            <td>
              <code>I</code>
            </td>
            <td>Insert at start of line</td>
          </tr>
          <tr>
            <td>
              <code>A</code>
            </td>
            <td>Insert at end of line</td>
          </tr>
        </tbody>
      </table>

      <h2>Visual Mode</h2>
      <p>
        Visual mode lets you select text. Use navigation keys to extend the
        selection, then apply an operator.
      </p>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>v</code>
            </td>
            <td>Enter visual mode (character-wise)</td>
          </tr>
          <tr>
            <td>
              <code>V</code>
            </td>
            <td>Enter visual mode (line-wise)</td>
          </tr>
          <tr>
            <td>
              <code>d</code>
            </td>
            <td>Delete selection</td>
          </tr>
          <tr>
            <td>
              <code>y</code>
            </td>
            <td>Yank (copy) selection</td>
          </tr>
          <tr>
            <td>
              <code>c</code>
            </td>
            <td>Change selection (delete + insert)</td>
          </tr>
        </tbody>
      </table>

      <h2>Command Mode</h2>
      <p>
        Press <code>:</code> in normal mode to enter command mode. Type a
        command and press Enter.
      </p>
      <CodeBlock language="bash" filename="commands">
        {`:q          Quit
:w          Save
:wq         Save and quit
:q!         Force quit without saving
:e file     Open file
:help       Show help`}
      </CodeBlock>

      <h2>M-x Mode</h2>
      <p>
        Press <code>SPC ;</code> to enter M-x mode. Type a command name to
        execute any T-Lisp function by name. This is the Emacs-style extensibility
        entry point.
      </p>
      <CodeBlock language="text" filename="M-x commands">
        {`cursor-position    Show cursor line and column
editor-mode        Show current editing mode
quit               Quit the editor
describe-key       Show what a key does
apropos-command    Search for commands`}
      </CodeBlock>

      <h2>Operators</h2>
      <p>
        Operators are combined with motions to act on text regions. The pattern
        is: <code>operator + motion</code> or <code>operator + text-object</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Operator</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>d</code>
            </td>
            <td>Delete</td>
          </tr>
          <tr>
            <td>
              <code>y</code>
            </td>
            <td>Yank (copy)</td>
          </tr>
          <tr>
            <td>
              <code>c</code>
            </td>
            <td>Change (delete + insert)</td>
          </tr>
          <tr>
            <td>
              <code>&gt;</code>
            </td>
            <td>Indent right</td>
          </tr>
          <tr>
            <td>
              <code>&lt;</code>
            </td>
            <td>Indent left</td>
          </tr>
        </tbody>
      </table>
      <p>
        Examples: <code>dw</code> (delete word), <code>yy</code> (yank line),{" "}
        <code>ci&quot;</code> (change inside quotes).
      </p>

      <h2>Text Objects</h2>
      <p>
        Text objects define structural regions. They work with operators using{" "}
        <code>i</code> (inner) and <code>a</code> (around) prefixes.
      </p>
      <table>
        <thead>
          <tr>
            <th>Object</th>
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>iw</code> / <code>aw</code>
            </td>
            <td>Inner word / a word</td>
          </tr>
          <tr>
            <td>
              <code>i&quot;</code> / <code>a&quot;</code>
            </td>
            <td>Inside quotes / around quotes</td>
          </tr>
          <tr>
            <td>
              <code>ip</code> / <code>ap</code>
            </td>
            <td>Inner paragraph / around paragraph</td>
          </tr>
          <tr>
            <td>
              <code>il</code> / <code>al</code>
            </td>
            <td>Inner line / around line</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

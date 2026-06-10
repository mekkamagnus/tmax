import DocsPage from "@/components/docs-page";
import { getPrevNext } from "@/lib/docs";

export default function InsertModePage() {
  const { prev, next } = getPrevNext("/docs/insert-mode");

  return (
    <DocsPage
      title="Insert Mode"
      description="Text entry, auto-indent, and special keys"
      prevPage={prev}
      nextPage={next}
    >
      <p>
        In insert mode, all keystrokes are entered as text at the cursor
        position. Press <code>Escape</code> to return to normal mode.
      </p>

      <h2 id="entering-insert-mode">Entering Insert Mode</h2>
      <p>
        The following keys in normal mode switch to insert mode. Each places
        the cursor at a different position:
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
            <td><code>i</code></td>
            <td>Insert before cursor</td>
          </tr>
          <tr>
            <td><code>a</code></td>
            <td>Insert after cursor (append)</td>
          </tr>
          <tr>
            <td><code>I</code></td>
            <td>Insert at first non-blank character of line</td>
          </tr>
          <tr>
            <td><code>A</code></td>
            <td>Insert at end of line</td>
          </tr>
          <tr>
            <td><code>o</code></td>
            <td>Open new line below and enter insert</td>
          </tr>
          <tr>
            <td><code>O</code></td>
            <td>Open new line above and enter insert</td>
          </tr>
        </tbody>
      </table>

      <h2 id="keys-in-insert-mode">Keys in Insert Mode</h2>
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
            <td>Insert character at cursor position</td>
          </tr>
          <tr>
            <td><code>Enter</code></td>
            <td>Insert newline with auto-indent. In markdown mode, continues lists automatically.</td>
          </tr>
          <tr>
            <td><code>Backspace</code></td>
            <td>Delete character before cursor</td>
          </tr>
          <tr>
            <td><code>Tab</code></td>
            <td>Insert tab character</td>
          </tr>
          <tr>
            <td><code>Escape</code></td>
            <td>Return to normal mode</td>
          </tr>
        </tbody>
      </table>
      <p>
        All other keys pass through as text input.
      </p>
    </DocsPage>
  );
}

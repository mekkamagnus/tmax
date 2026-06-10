import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function CommandModePage() {
  const { prev, next } = getPrevNext("/docs/command-mode");

  return (
    <DocsPage
      title="Command Mode"
      description="Ex-style commands (:q, :w, :s, dired)"
      prevPage={prev}
      nextPage={next}
    >
      <p>
        Press <code>:</code> in normal mode to enter command mode. Type a
        command and press <code>Enter</code> to execute it. Press{" "}
        <code>Escape</code> to cancel.
      </p>

      <h2 id="ex-commands">Ex Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>:q</code></td>
            <td>Quit editor</td>
          </tr>
          <tr>
            <td><code>:w</code></td>
            <td>Save current file</td>
          </tr>
          <tr>
            <td><code>:wq</code></td>
            <td>Save and quit</td>
          </tr>
          <tr>
            <td><code>:q!</code></td>
            <td>Force quit without saving</td>
          </tr>
          <tr>
            <td><code>:e {"{file}"}</code></td>
            <td>Open file</td>
          </tr>
          <tr>
            <td><code>:help</code></td>
            <td>Show help</td>
          </tr>
        </tbody>
      </table>

      <h2 id="special-patterns">Special Patterns</h2>
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>dired</code></td>
            <td>Open directory editor for current directory</td>
          </tr>
          <tr>
            <td><code>dired {"{path}"}</code></td>
            <td>Open directory editor for given path</td>
          </tr>
          <tr>
            <td><code>%s/{"{find}"}/{"{replace}"}/{"{flags}"}</code></td>
            <td>Substitute across entire buffer</td>
          </tr>
          <tr>
            <td><code>s/{"{find}"}/{"{replace}"}</code></td>
            <td>Substitute on current line</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock language="bash" filename="substitute examples">
        {`%s/old/new/g      Replace all "old" with "new" in buffer
s/foo/bar/        Replace first "foo" with "bar" on current line
%sw/old/new/g     Replace whole-word "old" with "new"`}
      </CodeBlock>

      <h2 id="command-line-keys">Command Line Keys</h2>
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
            <td>Append to command line</td>
          </tr>
          <tr>
            <td><code>Backspace</code></td>
            <td>Delete last character from command line</td>
          </tr>
          <tr>
            <td><code>Escape</code></td>
            <td>Cancel and return to normal mode</td>
          </tr>
          <tr>
            <td><code>Enter</code></td>
            <td>Execute command</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

import DocsPage from "@/components/docs-page";
import { getPrevNext } from "@/lib/docs";

export default function EditingModesPage() {
  const { prev, next } = getPrevNext("/docs/editing-modes");

  return (
    <DocsPage
      title="Modes"
      description="How the modal editing system works and mode transitions"
      prevPage={prev}
      nextPage={next}
    >
      <h2 id="what-are-modes">What Are Modes?</h2>
      <p>
        tmax is a <strong>modal editor</strong> — keys behave differently
        depending on the current mode. This follows the Vim tradition where each
        mode is optimized for a specific kind of interaction: navigation, text
        entry, selection, or command execution.
      </p>
      <p>
        Every tmax session starts in <strong>normal mode</strong>. From there
        you enter other modes to perform specific tasks, then return to normal
        mode when done. The current mode is always displayed in the status line
        at the bottom of the screen.
      </p>
      <p>
        The five modes are:
      </p>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Purpose</th>
            <th>Enter</th>
            <th>Exit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Normal</strong></td>
            <td>Navigation, operators, commands</td>
            <td>Default on startup</td>
            <td>—</td>
          </tr>
          <tr>
            <td><strong>Insert</strong></td>
            <td>Text entry</td>
            <td><code>i</code>, <code>a</code>, <code>o</code>, <code>O</code>, <code>I</code>, <code>A</code></td>
            <td><code>Escape</code></td>
          </tr>
          <tr>
            <td><strong>Visual</strong></td>
            <td>Text selection</td>
            <td><code>v</code>, <code>V</code>, <code>C-v</code></td>
            <td><code>Escape</code></td>
          </tr>
          <tr>
            <td><strong>Command</strong></td>
            <td>Ex-style commands (<code>:q</code>, <code>:w</code>)</td>
            <td><code>:</code></td>
            <td><code>Escape</code> or <code>Enter</code></td>
          </tr>
          <tr>
            <td><strong>M-x</strong></td>
            <td>Execute commands by name</td>
            <td><code>SPC ;</code></td>
            <td><code>Escape</code> or <code>C-g</code></td>
          </tr>
        </tbody>
      </table>

      <h2 id="mode-transitions">Mode Transitions</h2>
      <p>
        The following table shows every way to switch between modes. Each row
        is the current mode; each column is the target mode.
      </p>
      <table>
        <thead>
          <tr>
            <th>From \ To</th>
            <th>Normal</th>
            <th>Insert</th>
            <th>Visual</th>
            <th>Command</th>
            <th>M-x</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Normal</strong></td>
            <td>—</td>
            <td><code>i a o O I A</code></td>
            <td><code>v V C-v</code></td>
            <td><code>:</code></td>
            <td><code>SPC ;</code></td>
          </tr>
          <tr>
            <td><strong>Insert</strong></td>
            <td><code>Escape</code></td>
            <td>—</td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><strong>Visual</strong></td>
            <td><code>Escape</code></td>
            <td><code>c</code> (change)</td>
            <td>—</td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><strong>Command</strong></td>
            <td><code>Escape</code> / <code>Enter</code></td>
            <td></td>
            <td></td>
            <td>—</td>
            <td></td>
          </tr>
          <tr>
            <td><strong>M-x</strong></td>
            <td><code>Escape</code> / <code>C-g</code></td>
            <td></td>
            <td></td>
            <td></td>
            <td>—</td>
          </tr>
        </tbody>
      </table>

      <h2 id="status-line-indicator">Status Line Indicator</h2>
      <p>
        The status line at the bottom of the screen always shows the current
        mode. The indicator appears in the left portion of the status line:
      </p>
      <table>
        <thead>
          <tr>
            <th>Indicator</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>NORMAL</code></td>
            <td>Normal mode</td>
          </tr>
          <tr>
            <td><code>INSERT</code></td>
            <td>Insert mode</td>
          </tr>
          <tr>
            <td><code>VISUAL</code></td>
            <td>Visual mode (character)</td>
          </tr>
          <tr>
            <td><code>V-LINE</code></td>
            <td>Visual mode (line)</td>
          </tr>
          <tr>
            <td><code>V-BLOCK</code></td>
            <td>Visual mode (block)</td>
          </tr>
          <tr>
            <td><code>COMMAND</code></td>
            <td>Command mode</td>
          </tr>
          <tr>
            <td><code>M-x</code></td>
            <td>M-x mode</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

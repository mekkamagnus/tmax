import DocsPage from "@/components/docs-page";
import { getPrevNext } from "@/lib/docs";

export default function VisualModePage() {
  const { prev, next } = getPrevNext("/docs/visual-mode");

  return (
    <DocsPage
      title="Visual Mode"
      description="Text selection with character, line, and block modes"
      prevPage={prev}
      nextPage={next}
    >
      <p>
        Visual mode lets you select text. Use navigation keys to extend the
        selection, then apply an operator. Press <code>Escape</code> to cancel
        and return to normal mode.
      </p>

      <h2 id="entering-visual-mode">Entering Visual Mode</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>v</code></td>
            <td>Character-wise selection</td>
          </tr>
          <tr>
            <td><code>V</code></td>
            <td>Line-wise selection</td>
          </tr>
          <tr>
            <td><code>C-v</code></td>
            <td>Block selection</td>
          </tr>
        </tbody>
      </table>

      <h2 id="selection-motion">Selection Motion</h2>
      <p>
        Navigation keys extend the selection from the anchor point (where visual
        mode was entered) to the current cursor position:
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
            <td><code>h</code></td>
            <td>Extend left</td>
          </tr>
          <tr>
            <td><code>j</code></td>
            <td>Extend down</td>
          </tr>
          <tr>
            <td><code>k</code></td>
            <td>Extend up</td>
          </tr>
          <tr>
            <td><code>l</code></td>
            <td>Extend right</td>
          </tr>
          <tr>
            <td><code>w</code></td>
            <td>Extend to next word</td>
          </tr>
          <tr>
            <td><code>b</code></td>
            <td>Extend to previous word</td>
          </tr>
          <tr>
            <td><code>e</code></td>
            <td>Extend to end of word</td>
          </tr>
          <tr>
            <td><code>o</code></td>
            <td>Swap anchor and cursor (move to other end of selection)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="selection-actions">Selection Actions</h2>
      <p>
        Once text is selected, these operators act on the selection and return
        to normal mode (except <code>c</code>, which enters insert mode):
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
            <td><code>d</code></td>
            <td>Delete selection</td>
          </tr>
          <tr>
            <td><code>y</code></td>
            <td>Yank (copy) selection</td>
          </tr>
          <tr>
            <td><code>c</code></td>
            <td>Change selection (delete + enter insert mode)</td>
          </tr>
          <tr>
            <td><code>u</code></td>
            <td>Convert selection to lowercase</td>
          </tr>
          <tr>
            <td><code>U</code></td>
            <td>Convert selection to uppercase</td>
          </tr>
          <tr>
            <td><code>Escape</code></td>
            <td>Cancel selection, return to normal mode</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

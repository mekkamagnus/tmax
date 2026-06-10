import DocsPage from "@/components/docs-page";
import { getPrevNext } from "@/lib/docs";

export default function NormalModePage() {
  const { prev, next } = getPrevNext("/docs/normal-mode");

  return (
    <DocsPage
      title="Normal Mode"
      description="Navigation, operators, motions, and text objects"
      prevPage={prev}
      nextPage={next}
    >
      <p>
        Normal mode is the default. All key bindings are optimized for
        navigation and text manipulation. Every tmax session starts in normal
        mode.
      </p>

      <h2 id="basic-navigation">Basic Navigation</h2>
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
            <td>Move left</td>
          </tr>
          <tr>
            <td><code>j</code></td>
            <td>Move down</td>
          </tr>
          <tr>
            <td><code>k</code></td>
            <td>Move up</td>
          </tr>
          <tr>
            <td><code>l</code></td>
            <td>Move right</td>
          </tr>
          <tr>
            <td><code>Left</code> <code>Down</code> <code>Up</code> <code>Right</code></td>
            <td>Arrow keys (same as h/j/k/l)</td>
          </tr>
          <tr>
            <td><code>w</code></td>
            <td>Next word</td>
          </tr>
          <tr>
            <td><code>b</code></td>
            <td>Previous word</td>
          </tr>
          <tr>
            <td><code>e</code></td>
            <td>End of word</td>
          </tr>
          <tr>
            <td><code>0</code></td>
            <td>First column</td>
          </tr>
          <tr>
            <td><code>$</code></td>
            <td>Last column</td>
          </tr>
          <tr>
            <td><code>_</code></td>
            <td>First non-blank character</td>
          </tr>
          <tr>
            <td><code>-</code></td>
            <td>Previous line, first non-blank</td>
          </tr>
          <tr>
            <td><code>+</code></td>
            <td>Next line, first non-blank</td>
          </tr>
        </tbody>
      </table>

      <h2 id="scrolling">Scrolling</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>C-f</code></td>
            <td>Page down</td>
          </tr>
          <tr>
            <td><code>C-b</code></td>
            <td>Page up</td>
          </tr>
          <tr>
            <td><code>C-d</code></td>
            <td>Half page down</td>
          </tr>
          <tr>
            <td><code>C-u</code></td>
            <td>Half page up</td>
          </tr>
          <tr>
            <td><code>zt</code></td>
            <td>Scroll cursor to top of viewport</td>
          </tr>
          <tr>
            <td><code>zz</code></td>
            <td>Scroll cursor to center of viewport</td>
          </tr>
          <tr>
            <td><code>zb</code></td>
            <td>Scroll cursor to bottom of viewport</td>
          </tr>
        </tbody>
      </table>

      <h2 id="jump">Jump</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>gg</code></td>
            <td>Jump to first line (or line N with count)</td>
          </tr>
          <tr>
            <td><code>G</code></td>
            <td>Jump to last line (or line N with count)</td>
          </tr>
          <tr>
            <td><code>{"f{char}"}</code></td>
            <td>Find character forward on current line</td>
          </tr>
          <tr>
            <td><code>{"t{char}"}</code></td>
            <td>Till character forward (stop before it)</td>
          </tr>
          <tr>
            <td><code>{"F{char}"}</code></td>
            <td>Find character backward on current line</td>
          </tr>
          <tr>
            <td><code>{"T{char}"}</code></td>
            <td>Till character backward (stop after it)</td>
          </tr>
          <tr>
            <td><code>;</code></td>
            <td>Repeat last find/till</td>
          </tr>
          <tr>
            <td><code>,</code></td>
            <td>Repeat last find/till in reverse</td>
          </tr>
          <tr>
            <td><code>%</code></td>
            <td>Jump to matching bracket</td>
          </tr>
          <tr>
            <td><code>{"{"}</code></td>
            <td>Previous paragraph</td>
          </tr>
          <tr>
            <td><code>{"}"}</code></td>
            <td>Next paragraph</td>
          </tr>
        </tbody>
      </table>

      <h2 id="count-prefix">Count Prefix</h2>
      <p>
        Type a number before a motion or operator to repeat it. For
        example, <code>3j</code> moves down 3 lines, <code>5dw</code> deletes
        5 words.
      </p>
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Effect</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>{"{count}{motion}"}</code></td>
            <td>Repeat motion count times</td>
          </tr>
          <tr>
            <td><code>{"{count}{operator}{motion}"}</code></td>
            <td>Apply operator over count motions</td>
          </tr>
          <tr>
            <td><code>{"{count}{operator}{operator}"}</code></td>
            <td>Apply operator on count lines (e.g. <code>3dd</code>)</td>
          </tr>
          <tr>
            <td><code>{"{count}"}G</code></td>
            <td>Jump to line count</td>
          </tr>
        </tbody>
      </table>

      <h2 id="insert-entry">Insert Entry</h2>
      <p>
        These keys switch from normal mode to insert mode at a specific
        position:
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
            <td>Insert at first non-blank</td>
          </tr>
          <tr>
            <td><code>A</code></td>
            <td>Insert at end of line</td>
          </tr>
          <tr>
            <td><code>o</code></td>
            <td>Open line below, enter insert</td>
          </tr>
          <tr>
            <td><code>O</code></td>
            <td>Open line above, enter insert</td>
          </tr>
        </tbody>
      </table>

      <h2 id="single-key-operations">Single-Key Operations</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>x</code></td>
            <td>Delete character under cursor</td>
          </tr>
          <tr>
            <td><code>D</code></td>
            <td>Delete to end of line</td>
          </tr>
          <tr>
            <td><code>C</code></td>
            <td>Change to end of line (delete + insert)</td>
          </tr>
          <tr>
            <td><code>Y</code></td>
            <td>Yank to end of line</td>
          </tr>
          <tr>
            <td><code>J</code></td>
            <td>Join current line with next</td>
          </tr>
          <tr>
            <td><code>p</code></td>
            <td>Paste after cursor</td>
          </tr>
          <tr>
            <td><code>P</code></td>
            <td>Paste before cursor</td>
          </tr>
        </tbody>
      </table>

      <h2 id="operators">Operators</h2>
      <p>
        Operators are combined with motions or text objects to act on text
        regions. The pattern is <code>operator + motion</code>{" "}
        or <code>operator + text-object</code>.
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
            <td><code>d</code></td>
            <td>Delete</td>
          </tr>
          <tr>
            <td><code>y</code></td>
            <td>Yank (copy)</td>
          </tr>
          <tr>
            <td><code>c</code></td>
            <td>Change (delete + insert)</td>
          </tr>
          <tr>
            <td><code>&gt;</code></td>
            <td>Indent right</td>
          </tr>
          <tr>
            <td><code>&lt;</code></td>
            <td>Indent left</td>
          </tr>
        </tbody>
      </table>
      <p>
        Doubled operators act on the current line:
      </p>
      <table>
        <thead>
          <tr>
            <th>Combo</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>dd</code></td>
            <td>Delete line(s)</td>
          </tr>
          <tr>
            <td><code>dw</code></td>
            <td>Delete word(s)</td>
          </tr>
          <tr>
            <td><code>dl</code></td>
            <td>Delete character(s)</td>
          </tr>
          <tr>
            <td><code>d$</code></td>
            <td>Delete to end of line</td>
          </tr>
          <tr>
            <td><code>dG</code></td>
            <td>Delete to end of file</td>
          </tr>
          <tr>
            <td><code>dgg</code></td>
            <td>Delete to start of file</td>
          </tr>
          <tr>
            <td><code>yy</code></td>
            <td>Yank line(s)</td>
          </tr>
          <tr>
            <td><code>yw</code></td>
            <td>Yank word(s)</td>
          </tr>
          <tr>
            <td><code>yl</code></td>
            <td>Yank character(s)</td>
          </tr>
          <tr>
            <td><code>y$</code></td>
            <td>Yank to end of line</td>
          </tr>
          <tr>
            <td><code>cc</code></td>
            <td>Change line(s)</td>
          </tr>
          <tr>
            <td><code>cw</code></td>
            <td>Change word(s)</td>
          </tr>
          <tr>
            <td><code>cl</code></td>
            <td>Change character(s)</td>
          </tr>
          <tr>
            <td><code>c$</code></td>
            <td>Change to end of line</td>
          </tr>
        </tbody>
      </table>

      <h2 id="g-prefix">g-Prefix</h2>
      <p>
        Press <code>g</code> then another key for extended commands:
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
            <td><code>gg</code></td>
            <td>Jump to first line (or line N with count)</td>
          </tr>
          <tr>
            <td><code>gt</code></td>
            <td>Next tab</td>
          </tr>
          <tr>
            <td><code>gT</code></td>
            <td>Previous tab</td>
          </tr>
          <tr>
            <td><code>gh</code></td>
            <td>Markdown: navigate up heading tree</td>
          </tr>
          <tr>
            <td><code>gO</code></td>
            <td>Markdown: heading outline</td>
          </tr>
          <tr>
            <td><code>gx</code></td>
            <td>Markdown: context action (open link)</td>
          </tr>
          <tr>
            <td><code>gb</code></td>
            <td>Markdown: jump back</td>
          </tr>
        </tbody>
      </table>

      <h2 id="z-prefix">z-Prefix</h2>
      <p>
        Press <code>z</code> then another key for scroll commands:
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
            <td><code>zt</code></td>
            <td>Scroll cursor to top of viewport</td>
          </tr>
          <tr>
            <td><code>zz</code></td>
            <td>Scroll cursor to center of viewport</td>
          </tr>
          <tr>
            <td><code>zb</code></td>
            <td>Scroll cursor to bottom of viewport</td>
          </tr>
        </tbody>
      </table>

      <h2 id="window-prefix">Window Prefix (C-w)</h2>
      <p>
        Press <code>C-w</code> then another key for window management:
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
            <td><code>C-w s</code></td>
            <td>Split window below</td>
          </tr>
          <tr>
            <td><code>C-w v</code></td>
            <td>Split window right</td>
          </tr>
          <tr>
            <td><code>C-w w</code></td>
            <td>Cycle to next window</td>
          </tr>
          <tr>
            <td><code>C-w q</code></td>
            <td>Close current window</td>
          </tr>
          <tr>
            <td><code>C-w +</code></td>
            <td>Grow window height</td>
          </tr>
          <tr>
            <td><code>C-w -</code></td>
            <td>Shrink window height</td>
          </tr>
          <tr>
            <td><code>C-w &gt;</code></td>
            <td>Grow window width</td>
          </tr>
          <tr>
            <td><code>C-w &lt;</code></td>
            <td>Shrink window width</td>
          </tr>
        </tbody>
      </table>

      <h2 id="text-objects">Text Objects</h2>
      <p>
        Text objects define structural regions. They work with operators
        using <code>i</code> (inner) and <code>a</code> (around) prefixes.
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
            <td><code>iw</code> / <code>aw</code></td>
            <td>Inner word / a word (includes surrounding whitespace)</td>
          </tr>
          <tr>
            <td><code>i&quot;</code> / <code>a&quot;</code></td>
            <td>Inside quotes / around quotes (includes delimiters)</td>
          </tr>
          <tr>
            <td><code>ip</code> / <code>ap</code></td>
            <td>Inner paragraph / around paragraph</td>
          </tr>
          <tr>
            <td><code>il</code> / <code>al</code></td>
            <td>Inner line / around line</td>
          </tr>
        </tbody>
      </table>
      <p>
        Examples: <code>diw</code> (delete inner word), <code>ci&quot;</code>{" "}
        (change inside quotes), <code>yap</code> (yank around paragraph).
      </p>

      <h2 id="other-bindings">Other Bindings</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>u</code></td>
            <td>Undo</td>
          </tr>
          <tr>
            <td><code>C-r</code></td>
            <td>Redo</td>
          </tr>
          <tr>
            <td><code>v</code></td>
            <td>Enter visual mode (character-wise)</td>
          </tr>
          <tr>
            <td><code>V</code></td>
            <td>Enter visual mode (line-wise)</td>
          </tr>
          <tr>
            <td><code>C-v</code></td>
            <td>Enter visual mode (block)</td>
          </tr>
          <tr>
            <td><code>*</code></td>
            <td>Search word under cursor forward</td>
          </tr>
          <tr>
            <td><code>#</code></td>
            <td>Search word under cursor backward</td>
          </tr>
          <tr>
            <td><code>M-y</code></td>
            <td>Yank pop (cycle through kill ring)</td>
          </tr>
          <tr>
            <td><code>SPC x f</code></td>
            <td>Find file</td>
          </tr>
          <tr>
            <td><code>SPC x s</code></td>
            <td>Save file</td>
          </tr>
          <tr>
            <td><code>SPC x b</code></td>
            <td>Switch buffer</td>
          </tr>
          <tr>
            <td><code>SPC x u</code></td>
            <td>Undo</td>
          </tr>
          <tr>
            <td><code>SPC x C-c</code></td>
            <td>Quit editor</td>
          </tr>
          <tr>
            <td><code>C-x b</code></td>
            <td>Switch buffer</td>
          </tr>
          <tr>
            <td><code>C-h</code></td>
            <td>Help prefix</td>
          </tr>
          <tr>
            <td><code>C-h e</code></td>
            <td>Open <em>*Messages*</em> buffer</td>
          </tr>
          <tr>
            <td><code>C-g</code></td>
            <td>Cancel pending operator / reset state</td>
          </tr>
          <tr>
            <td><code>Escape</code></td>
            <td>Cancel pending operator / reset state</td>
          </tr>
          <tr>
            <td><code>q</code></td>
            <td>Quit editor</td>
          </tr>
          <tr>
            <td><code>:</code></td>
            <td>Enter command mode</td>
          </tr>
          <tr>
            <td><code>SPC ;</code></td>
            <td>Enter M-x mode</td>
          </tr>
        </tbody>
      </table>
    </DocsPage>
  );
}

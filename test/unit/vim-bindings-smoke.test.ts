import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createEditorFixture, executeTlisp, type EditorFixture } from "../helpers/editor-fixture.ts";

// SPEC-067 — comprehensive normal-mode binding smoke test.
//
// Goal: send EVERY Track 1 + Track 2 binding (and core nav) as real
// keypresses and assert the editor never crashes, stays in a valid mode, and
// keeps the cursor in bounds. Per-feature correctness lives in the focused
// test files; this is the regression net that catches unbound keys and
// thrown exceptions across the whole normal-mode surface.

const BUFFER = "hello world\nfoo bar baz\n  indented line\nnum = 42 end\n{\n  body\n}\nmore text";

/** A key is a single char or a special key name like "C-a" / "Escape". */
type Key = string;

async function send(editor: Editor, keys: Key[]): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function assertHealthy(editor: Editor, label: string): void {
  const mode = editor.getEditorState().mode;
  const cursorLine = executeTlisp(editor, "(cursor-line)").value as number;
  const cursorCol = executeTlisp(editor, "(cursor-column)").value as number;
  const lineCount = executeTlisp(editor, "(buffer-line-count)").value as number;
  expect(typeof mode === "string" && mode.length > 0, `${label}: mode was ${String(mode)}`).toBe(true);
  expect(cursorLine >= 0 && cursorLine < lineCount, `${label}: cursor-line ${cursorLine} out of [0,${lineCount})`).toBe(true);
  expect(cursorCol >= 0, `${label}: cursor-column ${cursorCol} < 0`).toBe(true);
}

// Each entry: [label, key sequence]. A fresh editor is used per entry so one
// key's state change cannot poison the next.
const SMOKES: Array<[string, Key[]]> = [
  // --- core navigation ---
  ["h", ["h"]],
  ["j", ["j"]],
  ["k", ["k"]],
  ["l", ["l"]],
  ["0", ["0"]],
  ["$", ["$"]],
  ["_", ["_"]],
  ["-", ["-"]],
  ["+", ["+"]],

  // --- word motions ---
  ["w", ["w"]],
  ["b", ["b"]],
  ["e", ["e"]],
  ["W", ["W"]],
  ["B", ["B"]],
  ["E", ["E"]],
  ["ge", ["g", "e"]],
  ["gE", ["g", "E"]],
  ["g_", ["g", "_"]],

  // --- jumps ---
  ["G", ["G"]],
  ["gg", ["g", "g"]],
  ["gi", ["g", "i"]],
  ["C-o", ["C-o"]],
  ["C-i", ["C-i"]],

  // --- find-char ---
  ["fa", ["f", "a"]],
  ["ta", ["t", "a"]],
  ["Fa", ["F", "a"]],
  ["Ta", ["T", "a"]],
  [";", [";"]],
  [",", [","]],

  // --- bracket / paragraph / sentence / section ---
  ["%", ["%"]],
  ["(", ["("]],
  [")", [")"]],
  ["[[", ["[", "["]],
  ["]]", ["]", "]"]],

  // --- window jumps ---
  ["H", ["H"]],
  ["M", ["M"]],
  ["L", ["L"]],

  // --- scrolling ---
  ["zt", ["z", "t"]],
  ["zz", ["z", "z"]],
  ["zb", ["z", "b"]],
  ["C-e", ["C-e"]],
  ["C-y", ["C-y"]],

  // --- Track 2: toggle case + increment/decrement (count-aware) ---
  ["~", ["~"]],
  ["3~", ["3", "~"]],
  ["C-a", ["C-a"]],
  ["C-x", ["C-x"]],
  ["5C-a", ["5", "C-a"]],

  // --- replace / repeat ---
  ["rx", ["r", "x"]],
  ["R", ["R", "Escape"]],
  [".", ["."]],

  // --- marks ---
  ["ma", ["m", "a"]],
  ["'a", ["'", "a"]],
  ["`a", ["`", "a"]],

  // --- macros ---
  ["@a", ["@", "a"]],
  ["q", ["q"]],

  // --- search ---
  ["*", ["*"]],
  ["#", ["#"]],
  ["n", ["n"]],
  ["N", ["N"]],
  ["/", ["/", "Escape"]],

  // --- indent / outdent ---
  [">>", [">", ">"]],
  ["<<", ["<", "<"]],

  // --- operators + motions ---
  ["dd", ["d", "d"]],
  ["yy", ["y", "y"]],
  ["cc", ["c", "c", "Escape"]],
  ["dw", ["d", "w"]],
  ["de", ["d", "e"]],

  // --- SPEC-069: generic operator×motion + text-objects + visual text-objects ---
  ["d%", ["d", "%"]],
  ["dj", ["d", "j"]],
  ["db", ["d", "b"]],
  ["yiw", ["y", "i", "w"]],
  ["ya\"", ["y", "a", "\""]],
  ["viw", ["v", "i", "w", "Escape"]],

  // --- single-stroke edits ---
  ["x", ["x"]],
  ["D", ["D"]],
  ["C", ["C", "Escape"]],
  ["Y", ["Y"]],
  ["J", ["J"]],
  ["s", ["s", "Escape"]],
  ["S", ["S", "Escape"]],
  ["p", ["p"]],
  ["P", ["P"]],
  ["u", ["u"]],

  // --- visual / mode entry ---
  ["v", ["v", "Escape"]],
  ["V", ["V", "Escape"]],
  ["C-v", ["C-v", "Escape"]],
  ["i", ["i", "Escape"]],
  ["a", ["a", "Escape"]],
  ["A", ["A", "Escape"]],
  ["I", ["I", "Escape"]],
  ["o", ["o", "Escape"]],
  ["O", ["O", "Escape"]],
  [":", [":", "Escape"]],
  ["SPC;", [" ", ";", "Escape"]],

  // --- undo/redo + page scroll ---
  ["C-r", ["C-r"]],
  ["C-f", ["C-f"]],
  ["C-b", ["C-b"]],
  ["C-d", ["C-d"]],
  ["C-u", ["C-u"]],
];

describe("SPEC-067 normal-mode bindings smoke", () => {
  // BUG-72/#122: createStartedEditor per entry = 99 editor.start() calls, each
  // loading 570 lines of core bindings synchronously. Under batch concurrency
  // the cumulative cost exceeded the runner's 120s inactivity gap. Share ONE
  // editor; reset state between entries (Escape clears pending prefix/count/
  // operator/which-key; createBuffer gives a fresh BUFFER). Each createBuffer is
  // cheap (no binding reload); the 99→1 editor reduction eliminates the stall.
  let editor: Editor;
  let fixture: EditorFixture;

  beforeAll(async () => {
    fixture = await createEditorFixture();
    editor = fixture.editor;
  });

  afterAll(() => {
    fixture.dispose();
  });

  for (const [label, keys] of SMOKES) {
    it(`${label} sends real keypress(es) without crashing`, async () => {
      // Reset between entries: Escape (clear any pending state + ensure normal
      // mode), then a fresh buffer (cheap — no editor.start()).
      await editor.handleKey("Escape");
      editor.createBuffer(`smoke-${label}`, BUFFER);
      await send(editor, keys);
      assertHealthy(editor, label);
    });
  }
});

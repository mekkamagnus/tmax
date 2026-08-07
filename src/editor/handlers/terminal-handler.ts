/**
 * @file terminal-handler.ts
 * @description Terminal mode key handler — routes keystrokes to the PTY.
 * Activated when the editor mode is "terminal" (set by M-x shell).
 * C-\ exits terminal mode back to normal editor mode.
 * @see SPEC-097 RFC-014A
 */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";

/** Map normalized key names to the bytes a PTY expects. */
function keyToPtyBytes(normalizedKey: string, rawKey: string): string | null {
  // C-\ is the escape hatch — handled by the caller, not here
  switch (normalizedKey) {
    case "Enter": return "\r";
    case "Backspace": return "\x7f";
    case "Tab": return "\t";
    case "Escape": return "\x1b";
    case "Up": return "\x1b[A";
    case "Down": return "\x1b[B";
    case "Right": return "\x1b[C";
    case "Left": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
    case "Delete": return "\x1b[3~";
    // Ctrl combos → control bytes
    case "C-c": return "\x03";
    case "C-d": return "\x04";
    case "C-z": return "\x1a";
    case "C-l": return "\x0c";
    case "C-a": return "\x01";
    case "C-e": return "\x05";
    case "C-k": return "\x0b";
    case "C-u": return "\x15";
    case "C-w": return "\x17";
    case "C-r": return "\x12";
    case "C-s": return "\x13";
    case "C-n": return "\x0e";
    case "C-p": return "\x10";
    case "C-f": return "\x06";
    case "C-b": return "\x02";
    case "C-g": return "\x07";
    case "C-v": return "\x16";
    default:
      // Single printable char → send as-is
      if (rawKey.length === 1) {
        const cc = rawKey.charCodeAt(0);
        if (cc >= 32 && cc !== 127) return rawKey;
      }
      // Other Ctrl combos: C-x where x is a-z → control byte 1-26
      if (normalizedKey.length === 3 && normalizedKey.startsWith("C-")) {
        const ch = normalizedKey[2]!.toLowerCase();
        if (ch >= "a" && ch <= "z") return String.fromCharCode(ch.charCodeAt(0) - 96);
      }
      return null;
  }
}

/**
 * Handle a key in terminal mode. Routes it to the active terminal's PTY.
 * C-\ exits terminal mode (back to normal editor mode).
 */
export async function handleTerminalMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
  // C-\ is the escape hatch — exit terminal mode
  if (normalizedKey === "C-\\" || normalizedKey === "C-\\") {
    editor.applyUpdate({ type: "SetMode", mode: "normal" });
    editor.applyUpdate({ type: "SetStatusMessage", message: "" });
    return;
  }

  // Get the active terminal ID from the T-Lisp variable
  const interp = editor.getInterpreter();
  const result = interp.execute("(if (boundp '*active-terminal*) *active-terminal* nil)") as any;
  const terminalId = result?._tag === "Right" ? result.right?.value : null;

  if (!terminalId || typeof terminalId !== "string") {
    // No active terminal — bail to normal mode
    editor.applyUpdate({ type: "SetMode", mode: "normal" });
    return;
  }

  // Map key to PTY bytes
  const bytes = keyToPtyBytes(normalizedKey, key);
  if (bytes !== null) {
    // Send to PTY via the shell-send primitive
    const escaped = bytes.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    interp.execute(`(shell-send "${terminalId}" "${escaped}")`);
  }
}

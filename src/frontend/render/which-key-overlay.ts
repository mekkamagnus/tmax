/**
 * @file which-key-overlay.ts
 * @description Popup overlay renderer for which-key display.
 *
 * Uses Steep `style()` from matcha.ts for all ANSI styling.
 * RFC-013 design: dark blue background, three-part binding format,
 * prefix header row, accent top border.
 */

import type { WhichKeyBinding } from "../../core/types.ts";
import { style, stripAnsi } from "../../steep/matcha.ts";

export interface WhichKeyBindingEntry {
  key: string;
  command: string;
  description?: string;
}

export interface WhichKeyPopupData {
  prefixLabel: string;
  rows: WhichKeyBindingEntry[][];
  height: number;
}

/** Extract function name from a T-Lisp command expression. */
function extractCommandName(cmd: string): string {
  if (cmd.startsWith("(")) {
    const inner = cmd.slice(1).trim();
    const spaceIdx = inner.indexOf(" ");
    return spaceIdx >= 0 ? inner.slice(0, spaceIdx) : inner.replace(")", "");
  }
  return cmd;
}

export function computeWhichKeyPopup(
  bindings: WhichKeyBinding[],
  prefix: string,
  width: number,
  maxRows: number,
  prefixLabel?: string,
): WhichKeyPopupData {
  const label = prefixLabel || prefix;
  if (bindings.length === 0) return { prefixLabel: label, rows: [], height: 0 };

  const entries: WhichKeyBindingEntry[] = bindings.map(b => {
    const displayKey = b.key === prefix ? b.key : b.key.substring(prefix.length + 1);
    return { key: displayKey, command: extractCommandName(b.command), description: b.documentation };
  });

  const keyWidth = Math.max(...entries.map(e => e.key.length)) + 1;
  const cmdWidth = Math.max(...entries.map(e => e.command.length));
  const colWidth = keyWidth + 2 + cmdWidth + 2;
  const cols = Math.max(1, Math.floor((width - 2) / colWidth));

  const rows: WhichKeyBindingEntry[][] = [];
  for (let i = 0; i < entries.length; i += cols) {
    if (rows.length >= maxRows - 1) break; // -1 for header row
    const row: WhichKeyBindingEntry[] = [];
    for (let c = 0; c < cols && i + c < entries.length; c++) {
      row.push(entries[i + c]!);
    }
    rows.push(row);
  }

  return { prefixLabel: label, rows, height: rows.length };
}

/** Pad styled text to width, keeping the bg color active across padding. */
function padToWidth(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  // Insert spaces before the trailing reset so bg fills the full row
  const gap = " ".repeat(width - visible);
  return text.replace(/\x1b\[0m$/, gap + "\x1b[0m");
}

export function renderWhichKeyOverlay(
  popup: WhichKeyPopupData,
  width: number,
): string[] {
  const lines: string[] = [];

  // Header row: prefix label in accent color
  const header = padToWidth(
    style(popup.prefixLabel, { fg: "#f0883e", bold: true, bg: "#1a3a6a" }),
    width,
  );
  lines.push(header);

  // Border row
  const border = padToWidth(
    style("─".repeat(width), { fg: "#58a6ff", bg: "#1a3a6a" }),
    width,
  );
  lines.push(border);

  if (popup.rows.length === 0) return lines;

  // Compute column widths from all entries
  const keyWidth = Math.max(...popup.rows.flat().map(e => e.key.length)) + 1;
  const cmdWidth = Math.max(...popup.rows.flat().map(e => e.command.length));
  const colGap = "  ";

  for (const row of popup.rows) {
    const parts = row.map(entry => {
      const keyPart = style(entry.key.padEnd(keyWidth), { fg: "#58a6ff", bold: true });
      const cmdPart = style(entry.command.padEnd(cmdWidth), { fg: "#c9d1d9" });
      return `${keyPart}${style(": ", { fg: "#8b949e" })}${cmdPart}`;
    });
    const content = parts.join(colGap);
    lines.push(padToWidth(style(content, { bg: "#1a3a6a" }), width));
  }

  return lines;
}

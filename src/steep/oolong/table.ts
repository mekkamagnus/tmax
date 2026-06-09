import type { Table as MdTable, TableRow, TableCell, Alignment } from "./ast.ts";
import { stripAnsi } from "../matcha.ts";

export interface FormattedTable {
  rows: string[][];
  colWidths: number[];
  align: (Alignment | null)[];
  separator: string;
}

export function formatTable(table: MdTable): FormattedTable {
  const rows = table.children.map((row) =>
    (row as TableRow).children.map((cell) => renderCellText(cell as TableCell))
  );

  const numCols = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    colWidths.push(
      Math.max(3, ...rows.map((r) => (r[c] ? stripAnsi(r[c]!).length : 0)))
    );
  }

  const align = table.align.length > 0
    ? table.align
    : colWidths.map(() => null as Alignment | null);

  const sepParts = colWidths.map((w, i) => {
    const a = align[i];
    if (a === "center") return ":" + "-".repeat(Math.max(1, w - 2)) + ":";
    if (a === "left") return ":" + "-".repeat(Math.max(1, w - 1));
    if (a === "right") return "-".repeat(Math.max(1, w - 1)) + ":";
    return "-".repeat(Math.max(3, w));
  });

  return {
    rows,
    colWidths,
    align,
    separator: "| " + sepParts.join(" | ") + " |",
  };
}

export function padCell(text: string, width: number, align: Alignment | null): string {
  const visualLen = stripAnsi(text).length;
  const pad = Math.max(0, width - visualLen);
  if (align === "center") {
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return " ".repeat(left) + text + " ".repeat(right);
  }
  if (align === "right") {
    return " ".repeat(pad) + text;
  }
  return text + " ".repeat(pad);
}

function renderCellText(cell: TableCell): string {
  return cell.children
    .map((n) => {
      if (n.type === "text") return n.value;
      return nodeText(n);
    })
    .join("");
}

function nodeText(node: any): string {
  if (node.type === "text") return node.value;
  if (node.type === "strong") return node.children.map(nodeText).join("");
  if (node.type === "emphasis") return node.children.map(nodeText).join("");
  if (node.type === "inlineCode") return node.value;
  if (node.type === "softBreak") return " ";
  if (node.children) return node.children.map(nodeText).join("");
  return "";
}

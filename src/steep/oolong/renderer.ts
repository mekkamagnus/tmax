import { parse } from "./parser.ts";
import { wrapAnsi } from "./wrap.ts";
import { formatTable, padCell } from "./table.ts";
import { style, stripAnsi } from "../matcha.ts";
import type { MdNode, Table as MdTable } from "./ast.ts";

export interface ThemeStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  prefix?: string;
  suffix?: string;
  margin?: number;
  indent?: number;
}

export interface Theme {
  document?: ThemeStyle;
  h1: ThemeStyle;
  h2: ThemeStyle;
  h3: ThemeStyle;
  h4: ThemeStyle;
  h5: ThemeStyle;
  h6: ThemeStyle;
  text: ThemeStyle;
  strong: ThemeStyle;
  emphasis: ThemeStyle;
  strikethrough: ThemeStyle;
  codespan: ThemeStyle;
  codeBlock: ThemeStyle;
  blockquote: ThemeStyle;
  link: ThemeStyle;
  image: ThemeStyle;
  orderedList: ThemeStyle;
  unorderedList: ThemeStyle;
  taskList: ThemeStyle;
  table: ThemeStyle;
  horizontalRule: ThemeStyle;
  yamlFrontMatter: ThemeStyle;
}

export function renderMarkdown(
  text: string,
  options: { width: number; theme: Theme },
): string[] {
  const ast = parse(text);
  return renderDocument(ast, options);
}

function renderDocument(doc: MdNode, options: { width: number; theme: Theme }): string[] {
  if (doc.type !== "document") return [];
  const lines: string[] = [];
  for (const child of (doc as any).children as MdNode[]) {
    lines.push(...renderNode(child, options, 0));
  }
  return lines;
}

function renderNode(node: MdNode, options: { width: number; theme: Theme }, depth: number): string[] {
  switch (node.type) {
    case "heading": return renderHeading(node, options);
    case "paragraph": return renderParagraph(node, options);
    case "codeBlock": return renderCodeBlock(node, options);
    case "blockquote": return renderBlockquote(node, options, depth);
    case "horizontalRule": return renderHorizontalRule(node, options);
    case "yamlFrontMatter": return renderYamlFrontMatter(node, options);
    case "unorderedList": return renderUnorderedList(node, options);
    case "orderedList": return renderOrderedList(node, options);
    case "taskList": return renderTaskList(node, options);
    case "table": return renderTable(node, options);
    default: return [];
  }
}

function applyStyle(text: string, ts: ThemeStyle | undefined): string {
  if (!ts) return text;
  return style(text, {
    fg: ts.color as any,
    bg: ts.background as any,
    bold: ts.bold,
    italic: ts.italic,
    underline: ts.underline,
    strikethrough: ts.strikethrough,
  });
}

function renderInline(nodes: MdNode[], theme: Theme): string {
  return nodes.map((n) => renderInlineNode(n, theme)).join("");
}

function renderInlineNode(node: MdNode, theme: Theme): string {
  switch (node.type) {
    case "text": return applyStyle((node as any).value, theme.text);
    case "strong": {
      const inner = renderInline((node as any).children, theme);
      return applyStyle(inner, theme.strong);
    }
    case "emphasis": {
      const inner = renderInline((node as any).children, theme);
      return applyStyle(inner, theme.emphasis);
    }
    case "strikethrough": {
      const inner = renderInline((node as any).children, theme);
      return applyStyle(inner, theme.strikethrough);
    }
    case "inlineCode":
      return applyStyle((node as any).value, theme.codespan);
    case "link": {
      const inner = renderInline((node as any).children, theme);
      const href = (node as any).href;
      const styled = applyStyle(inner, theme.link);
      return href ? `${styled} (${href})` : styled;
    }
    case "image": {
      const alt = (node as any).alt || "";
      const src = (node as any).src || "";
      return applyStyle(`[${alt}](${src})`, theme.image);
    }
    case "softBreak": return " ";
    case "hardBreak": return "\n";
    default: return "";
  }
}

function marginLines(margin: number | undefined): string[] {
  const m = margin ?? 0;
  return Array(m).fill("");
}

function renderHeading(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const n = node as any;
  const ts = options.theme[`h${n.level}` as keyof Theme] as ThemeStyle | undefined;
  const text = renderInline(n.children, options.theme);
  const lines = marginLines(ts?.margin);
  lines.push(applyStyle(text, ts));
  lines.push(...marginLines(ts?.margin));
  return lines;
}

function renderParagraph(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const text = renderInline((node as any).children, options.theme);
  return wrapAnsi(text, options.width, 0);
}

function renderCodeBlock(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const n = node as any;
  const ts = options.theme.codeBlock;
  const lines = marginLines(ts?.margin);
  const codeLines = (n.value as string).split("\n");
  for (const line of codeLines) {
    lines.push(applyStyle(line, ts));
  }
  lines.push(...marginLines(ts?.margin));
  return lines;
}

function renderBlockquote(node: MdNode, options: { width: number; theme: Theme }, depth: number): string[] {
  const n = node as any;
  const ts = options.theme.blockquote;
  const prefix = ts?.prefix ?? "> ";
  const innerLines: string[] = [];
  for (const child of n.children as MdNode[]) {
    innerLines.push(...renderNode(child, options, depth + 1));
  }
  return innerLines.map((l) => prefix + applyStyle(l, ts));
}

function renderHorizontalRule(_node: MdNode, options: { width: number; theme: Theme }): string[] {
  const ts = options.theme.horizontalRule;
  return [applyStyle("─".repeat(options.width), ts)];
}

function renderYamlFrontMatter(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const ts = options.theme.yamlFrontMatter;
  const value = (node as any).value as string;
  return ["---", ...value.split("\n").map((l: string) => applyStyle(l, ts)), "---"];
}

function renderUnorderedList(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const n = node as any;
  const ts = options.theme.unorderedList;
  const indent = ts?.indent ?? 2;
  const lines: string[] = [];
  for (const item of n.children as MdNode[]) {
    const text = renderInline((item as any).children, options.theme);
    const wrapped = wrapAnsi("• " + text, options.width, indent);
    lines.push(...wrapped);
  }
  return lines;
}

function renderOrderedList(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const n = node as any;
  const ts = options.theme.orderedList;
  const indent = ts?.indent ?? 2;
  const start = n.start ?? 1;
  const lines: string[] = [];
  let num = start;
  for (const item of n.children as MdNode[]) {
    const text = renderInline((item as any).children, options.theme);
    const wrapped = wrapAnsi(`${num}. ${text}`, options.width, indent);
    lines.push(...wrapped);
    num++;
  }
  return lines;
}

function renderTaskList(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const n = node as any;
  const ts = options.theme.taskList;
  const indent = ts?.indent ?? 2;
  const lines: string[] = [];
  for (const item of n.children as MdNode[]) {
    const checked = (item as any).checked ? "x" : " ";
    const text = renderInline((item as any).children, options.theme);
    const wrapped = wrapAnsi(`[${checked}] ${text}`, options.width, indent);
    lines.push(...wrapped);
  }
  return lines;
}

function renderTable(node: MdNode, options: { width: number; theme: Theme }): string[] {
  const tbl = formatTable(node as MdTable);
  const lines: string[] = [];

  // Header row
  const headerCells = tbl.rows[0]!.map((cell, i) =>
    padCell(cell, tbl.colWidths[i]!, tbl.align[i] ?? null)
  );
  lines.push("| " + headerCells.join(" | ") + " |");
  lines.push(tbl.separator);

  // Body rows
  for (let r = 1; r < tbl.rows.length; r++) {
    const rowCells = tbl.rows[r]!.map((cell, i) =>
      padCell(cell, tbl.colWidths[i] ?? tbl.colWidths[0]!, tbl.align[i] ?? null)
    );
    lines.push("| " + rowCells.join(" | ") + " |");
  }

  return lines;
}

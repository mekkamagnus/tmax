import type {
  MdNode, Document, Heading, Paragraph, Text, Strong, Emphasis, Strikethrough,
  InlineCode, CodeBlock, Blockquote, OrderedList, UnorderedList, TaskList,
  ListItem, TaskItem, Link, Image, HorizontalRule, Table, TableRow, TableCell,
  YamlFrontMatter, SoftBreak, HardBreak, Alignment,
} from "./ast.ts";

export function parse(text: string): Document {
  const lines = text.split("\n");
  let i = 0;
  const children: MdNode[] = [];

  // YAML front matter
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      children.push({ type: "yamlFrontMatter", value: lines.slice(1, end).join("\n") } as YamlFrontMatter);
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const node = parseBlock(lines, i);
    if (node) {
      children.push(node.node);
      i = node.nextIndex;
    } else {
      i++;
    }
  }

  return { type: "document", children };
}

interface ParseResult {
  node: MdNode;
  nextIndex: number;
}

function parseBlock(lines: string[], i: number): ParseResult | null {
  const line = lines[i]!;

  // Blank line
  if (line.trim() === "") return null;

  // Horizontal rule
  if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return { node: { type: "horizontalRule" } as HorizontalRule, nextIndex: i + 1 };
  }

  // ATX heading
  const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
    const text = headingMatch[2]!.replace(/\s*#+\s*$/, "");
    return { node: { type: "heading", level, children: parseInline(text) } as Heading, nextIndex: i + 1 };
  }

  // Fenced code block
  const fenceMatch = line.match(/^(\s{0,3})```(.*)/);
  if (fenceMatch) {
    const lang = fenceMatch[2]!.trim() || undefined;
    const codeLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j]!.match(/^\s{0,3}```\s*$/)) {
      codeLines.push(lines[j]!);
      j++;
    }
    return {
      node: { type: "codeBlock", language: lang, value: codeLines.join("\n") } as CodeBlock,
      nextIndex: j + 1,
    };
  }

  // Blockquote
  if (/^\s*>/.test(line)) {
    return parseBlockquote(lines, i);
  }

  // GFM table
  if (i + 1 < lines.length && /^\|/.test(line) && /^\|?\s*[-:]+[-| :]*$/.test(lines[i + 1]!)) {
    return parseTable(lines, i);
  }

  // Task list (starts with - [ ] or - [x])
  if (/^\s*[-*+]\s\[[ xX]\]\s/.test(line)) {
    return parseTaskList(lines, i);
  }

  // Unordered list
  if (/^\s*[-*+]\s/.test(line)) {
    return parseUnorderedList(lines, i);
  }

  // Ordered list
  const olMatch = line.match(/^\s*(\d+)\.\s/);
  if (olMatch) {
    return parseOrderedList(lines, i);
  }

  // Paragraph
  return parseParagraph(lines, i);
}

function parseParagraph(lines: string[], i: number): ParseResult {
  const textParts: string[] = [];
  let j = i;
  while (j < lines.length && lines[j]!.trim() !== "" && !lines[j]!.match(/^#{1,6}\s/) && !lines[j]!.match(/^\s{0,3}```/) && !lines[j]!.match(/^\s*>/) && !lines[j]!.match(/^\s*[-*+]\s/) && !lines[j]!.match(/^\s*\d+\.\s/)) {
    textParts.push(lines[j]!);
    j++;
    if (j < lines.length && lines[j] === "") break;
  }
  const text = textParts.join("\n");
  return { node: { type: "paragraph", children: parseInline(text) } as Paragraph, nextIndex: j };
}

function parseBlockquote(lines: string[], i: number): ParseResult {
  const quoteLines: string[] = [];
  let j = i;
  while (j < lines.length && /^\s*>/.test(lines[j]!)) {
    quoteLines.push(lines[j]!.replace(/^\s*>\s?/, ""));
    j++;
  }
  const inner = parse(quoteLines.join("\n"));
  return { node: { type: "blockquote", children: inner.children } as Blockquote, nextIndex: j };
}

function parseUnorderedList(lines: string[], i: number): ParseResult {
  const items: ListItem[] = [];
  let j = i;
  while (j < lines.length) {
    const match = lines[j]!.match(/^(\s*)[-*+]\s+(.*)/);
    if (!match) {
      if (lines[j]!.trim() === "" || /^\s{2,}/.test(lines[j]!)) { j++; continue; }
      break;
    }
    const text = match[2]!;
    const itemChildren: MdNode[] = parseInline(text);
    items.push({ type: "listItem", children: itemChildren });
    j++;
  }
  return { node: { type: "unorderedList", children: items } as UnorderedList, nextIndex: j };
}

function parseOrderedList(lines: string[], i: number): ParseResult {
  const items: ListItem[] = [];
  let start: number | undefined;
  let j = i;
  while (j < lines.length) {
    const match = lines[j]!.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (!match) {
      if (lines[j]!.trim() === "" || /^\s{2,}/.test(lines[j]!)) { j++; continue; }
      break;
    }
    if (start === undefined) start = parseInt(match[2]!);
    items.push({ type: "listItem", children: parseInline(match[3]!) });
    j++;
  }
  return { node: { type: "orderedList", children: items, start } as OrderedList, nextIndex: j };
}

function parseTaskList(lines: string[], i: number): ParseResult {
  const items: TaskItem[] = [];
  let j = i;
  while (j < lines.length) {
    const match = lines[j]!.match(/^(\s*)[-*+]\s\[[ xX]\]\s+(.*)/);
    if (!match) break;
    const checked = /\[[xX]\]/.test(lines[j]!);
    const text = match[2]!;
    items.push({ type: "taskItem", checked, children: parseInline(text) });
    j++;
  }
  return { node: { type: "taskList", children: items } as TaskList, nextIndex: j };
}

function parseTable(lines: string[], i: number): ParseResult {
  const headerCells = splitTableRow(lines[i]!);
  const sepLine = lines[i + 1]!;
  const align = parseTableAlign(sepLine);
  const rows: TableRow[] = [];

  // Header row
  rows.push({
    type: "tableRow",
    children: headerCells.map((cell) => ({
      type: "tableCell",
      children: parseInline(cell.trim()),
    } as TableCell)),
  });

  // Body rows
  let j = i + 2;
  while (j < lines.length && /^\|/.test(lines[j]!)) {
    const cells = splitTableRow(lines[j]!);
    rows.push({
      type: "tableRow",
      children: cells.map((cell) => ({
        type: "tableCell",
        children: parseInline(cell.trim()),
      } as TableCell)),
    });
    j++;
  }

  return {
    node: { type: "table", align, children: rows } as Table,
    nextIndex: j,
  };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const noEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return noEdges.split("|");
}

function parseTableAlign(sepLine: string): (Alignment | null)[] {
  const cells = splitTableRow(sepLine);
  return cells.map((cell) => {
    const c = cell.trim();
    if (/^:-+:$/.test(c)) return "center";
    if (/^:-+$/.test(c)) return "left";
    if (/^-+:$/.test(c)) return "right";
    return null;
  });
}

// --- Inline parsing ---

export function parseInline(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  let pos = 0;

  while (pos < text.length) {
    // Hard break (two spaces + newline)
    if (text[pos] === " " && text[pos + 1] === " " && text[pos + 2] === "\n") {
      nodes.push({ type: "hardBreak" } as HardBreak);
      pos += 3;
      continue;
    }

    // Soft break
    if (text[pos] === "\n") {
      nodes.push({ type: "softBreak" } as SoftBreak);
      pos++;
      continue;
    }

    // Image ![alt](src "title")
    const imgMatch = text.slice(pos).match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (imgMatch) {
      nodes.push({ type: "image", alt: imgMatch[1], src: imgMatch[2], title: imgMatch[3] } as Image);
      pos += imgMatch[0].length;
      continue;
    }

    // Link [text](href "title")
    const linkMatch = text.slice(pos).match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (linkMatch) {
      nodes.push({
        type: "link",
        href: linkMatch[2],
        title: linkMatch[3],
        children: parseInline(linkMatch[1]!),
      } as Link);
      pos += linkMatch[0].length;
      continue;
    }

    // Strikethrough ~~text~~
    if (text.slice(pos, pos + 2) === "~~") {
      const end = text.indexOf("~~", pos + 2);
      if (end > pos + 1) {
        const inner = text.slice(pos + 2, end);
        nodes.push({ type: "strikethrough", children: parseInline(inner) } as Strikethrough);
        pos = end + 2;
        continue;
      }
    }

    // Bold+italic ***text*** or ___text___
    if (text.slice(pos, pos + 3) === "***" || text.slice(pos, pos + 3) === "___") {
      const marker = text.slice(pos, pos + 3);
      const end = text.indexOf(marker, pos + 3);
      if (end > pos + 2) {
        const inner = text.slice(pos + 3, end);
        nodes.push({
          type: "strong",
          children: [{ type: "emphasis", children: parseInline(inner) } as Emphasis],
        } as Strong);
        pos = end + 3;
        continue;
      }
    }

    // Bold **text** or __text__
    if (text.slice(pos, pos + 2) === "**" || text.slice(pos, pos + 2) === "__") {
      const marker = text.slice(pos, pos + 2);
      const end = text.indexOf(marker, pos + 2);
      if (end > pos + 1) {
        const inner = text.slice(pos + 2, end);
        nodes.push({ type: "strong", children: parseInline(inner) } as Strong);
        pos = end + 2;
        continue;
      }
    }

    // Emphasis *text* or _text_
    if ((text[pos] === "*" || text[pos] === "_") && pos + 1 < text.length) {
      const marker = text[pos]!;
      const end = text.indexOf(marker, pos + 1);
      if (end > pos) {
        const inner = text.slice(pos + 1, end);
        // Don't treat empty emphasis
        if (inner.length > 0) {
          nodes.push({ type: "emphasis", children: parseInline(inner) } as Emphasis);
          pos = end + 1;
          continue;
        }
      }
    }

    // Inline code `code`
    if (text[pos] === "`") {
      const end = text.indexOf("`", pos + 1);
      if (end > pos) {
        nodes.push({ type: "inlineCode", value: text.slice(pos + 1, end) } as InlineCode);
        pos = end + 1;
        continue;
      }
    }

    // Plain text — collect until next special character
    let end = pos + 1;
    while (end < text.length && !"*_~`![\n".includes(text[end]!)) {
      // Check for double-space hard break
      if (text[end] === " " && text[end + 1] === " " && text[end + 2] === "\n") break;
      end++;
    }
    nodes.push({ type: "text", value: text.slice(pos, end) } as Text);
    pos = end;
  }

  return nodes;
}

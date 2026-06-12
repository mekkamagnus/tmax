import type { SyntaxRule } from "../../core/types.ts";

export const extensions = [".md", ".markdown", ".mdx"];

export const rules: SyntaxRule[] = [
  // YAML front matter delimiter
  { pattern: /^---$/gm, type: "meta", priority: 100 },
  // Fenced code block delimiter (backtick or tilde, with optional info string)
  { pattern: /^```[\w.-]*$|^~~~[\w.-]*$/gm, type: "code-delimiter", priority: 95 },
  // ATX headings h1-h6
  { pattern: /^#{1,6}\s+.*$/gm, type: "heading", priority: 90 },
  // Setext heading underlines (must be on its own line)
  { pattern: /^[ \t]*={3,}[ \t]*$|^[ \t]*-{3,}[ \t]*$/gm, type: "heading", priority: 89 },
  // Horizontal rules (3+ chars, no other content — tighter than setext)
  { pattern: /^\s{0,3}(\*{3,}|_{3,})\s*$/gm, type: "hr", priority: 85 },
  // Pipe table separator
  { pattern: /^\|?[\s]*[-:]+[-| :]*$/gm, type: "table-separator", priority: 80 },
  // Blockquote
  { pattern: /^\s*>\s?/gm, type: "blockquote", priority: 75 },
  // Task list markers
  { pattern: /^\s*[-*+]\s\[[ xX]\]/gm, type: "task-item", priority: 72 },
  // Unordered list markers
  { pattern: /^\s*[-*+]\s/gm, type: "list-item", priority: 70 },
  // Ordered list markers
  { pattern: /^\s*\d+[.)]\s/gm, type: "list-item", priority: 70 },
  // Wiki-link embeds: ![[file]] or ![[file#heading]] (before images and wiki-links)
  { pattern: /!\[\[[^\]]+\]\]/g, type: "wiki-link-embed", priority: 67 },
  // Images (before links to take priority)
  { pattern: /!\[([^\]]*)\]\([^)]*\)/g, type: "image", priority: 65 },
  // Wiki-links: [[file]] or [[file#heading]] or [[file#^block]] (before standard links)
  { pattern: /\[\[[^\]]+\]\]/g, type: "wiki-link", priority: 62 },
  // Links (inline)
  { pattern: /\[([^\]]*)\]\([^)]*\)/g, type: "link", priority: 60 },
  // Links (reference-style)
  { pattern: /\[([^\]]*)\]\[([^\]]*)\]/g, type: "link", priority: 59 },
  // Inline code
  { pattern: /`[^`]+`/g, type: "code", priority: 55 },
  // Bold+italic (must come before bold/italic to match first)
  { pattern: /\*\*\*[^*]+\*\*\*|___[^_]+___/g, type: "bold", priority: 50 },
  // Bold
  { pattern: /\*\*[^*]+\*\*|__[^_]+__/g, type: "bold", priority: 49 },
  // Strikethrough (before italic to avoid * conflict)
  { pattern: /~~[^~]+~~/g, type: "strikethrough", priority: 48 },
  // Italic
  { pattern: /(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_)/g, type: "italic", priority: 45 },
  // Tags: #word (after heading so heading ## takes priority; matches standalone #tag in text)
  { pattern: /(?:^|\s)#[a-zA-Z_-][a-zA-Z0-9_-]*/g, type: "tag", priority: 43 },
];

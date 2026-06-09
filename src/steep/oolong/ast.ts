export type MdNode =
  | Document
  | Heading
  | Paragraph
  | Text
  | Strong
  | Emphasis
  | Strikethrough
  | InlineCode
  | CodeBlock
  | Blockquote
  | OrderedList
  | UnorderedList
  | TaskList
  | ListItem
  | TaskItem
  | Link
  | Image
  | HorizontalRule
  | Table
  | TableRow
  | TableCell
  | YamlFrontMatter
  | SoftBreak
  | HardBreak;

export interface Document {
  type: "document";
  children: MdNode[];
}

export interface Heading {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: MdNode[];
}

export interface Paragraph {
  type: "paragraph";
  children: MdNode[];
}

export interface Text {
  type: "text";
  value: string;
}

export interface Strong {
  type: "strong";
  children: MdNode[];
}

export interface Emphasis {
  type: "emphasis";
  children: MdNode[];
}

export interface Strikethrough {
  type: "strikethrough";
  children: MdNode[];
}

export interface InlineCode {
  type: "inlineCode";
  value: string;
}

export interface CodeBlock {
  type: "codeBlock";
  language?: string;
  value: string;
}

export interface Blockquote {
  type: "blockquote";
  children: MdNode[];
}

export interface OrderedList {
  type: "orderedList";
  children: ListItem[];
  start?: number;
}

export interface UnorderedList {
  type: "unorderedList";
  children: ListItem[];
}

export interface TaskList {
  type: "taskList";
  children: TaskItem[];
}

export interface ListItem {
  type: "listItem";
  children: MdNode[];
}

export interface TaskItem {
  type: "taskItem";
  checked: boolean;
  children: MdNode[];
}

export interface Link {
  type: "link";
  href: string;
  title?: string;
  children: MdNode[];
}

export interface Image {
  type: "image";
  src: string;
  alt: string;
  title?: string;
}

export interface HorizontalRule {
  type: "horizontalRule";
}

export interface Table {
  type: "table";
  align: (Alignment | null)[];
  children: TableRow[];
}

export interface TableRow {
  type: "tableRow";
  children: TableCell[];
}

export interface TableCell {
  type: "tableCell";
  children: MdNode[];
}

export interface YamlFrontMatter {
  type: "yamlFrontMatter";
  value: string;
}

export interface SoftBreak {
  type: "softBreak";
}

export interface HardBreak {
  type: "hardBreak";
}

export type Alignment = "left" | "center" | "right";

export interface DocHeading {
  title: string;
  id: string;
}

export interface DocPage {
  title: string;
  description: string;
  href: string;
  section: string;
  order: number;
  headings?: DocHeading[];
}

export interface SidebarSection {
  title: string;
  pages: DocPage[];
}

export const docsPages: DocPage[] = [
  {
    title: "Getting Started",
    description: "Install tmax and run your first editing session",
    href: "/docs/getting-started",
    section: "Getting Started",
    order: 1,
  },
  {
    title: "Modes",
    description: "How the modal editing system works and mode transitions",
    href: "/docs/editing-modes",
    section: "Editing",
    order: 2,
    headings: [
      { title: "What Are Modes?", id: "what-are-modes" },
      { title: "Mode Transitions", id: "mode-transitions" },
      { title: "Status Line Indicator", id: "status-line-indicator" },
    ],
  },
  {
    title: "Normal Mode",
    description: "Navigation, operators, motions, and text objects",
    href: "/docs/normal-mode",
    section: "Editing",
    order: 3,
    headings: [
      { title: "Basic Navigation", id: "basic-navigation" },
      { title: "Scrolling", id: "scrolling" },
      { title: "Jump", id: "jump" },
      { title: "Count Prefix", id: "count-prefix" },
      { title: "Insert Entry", id: "insert-entry" },
      { title: "Single-Key Operations", id: "single-key-operations" },
      { title: "Operators", id: "operators" },
      { title: "g-Prefix", id: "g-prefix" },
      { title: "z-Prefix", id: "z-prefix" },
      { title: "Window Prefix (C-w)", id: "window-prefix" },
      { title: "Text Objects", id: "text-objects" },
      { title: "Other Bindings", id: "other-bindings" },
    ],
  },
  {
    title: "Insert Mode",
    description: "Text entry, auto-indent, and special keys",
    href: "/docs/insert-mode",
    section: "Editing",
    order: 4,
    headings: [
      { title: "Entering Insert Mode", id: "entering-insert-mode" },
      { title: "Keys in Insert Mode", id: "keys-in-insert-mode" },
    ],
  },
  {
    title: "Visual Mode",
    description: "Text selection with character, line, and block modes",
    href: "/docs/visual-mode",
    section: "Editing",
    order: 5,
    headings: [
      { title: "Entering Visual Mode", id: "entering-visual-mode" },
      { title: "Selection Motion", id: "selection-motion" },
      { title: "Selection Actions", id: "selection-actions" },
    ],
  },
  {
    title: "Command Mode",
    description: "Ex-style commands (:q, :w, :s, dired)",
    href: "/docs/command-mode",
    section: "Editing",
    order: 6,
    headings: [
      { title: "Ex Commands", id: "ex-commands" },
      { title: "Special Patterns", id: "special-patterns" },
      { title: "Command Line Keys", id: "command-line-keys" },
    ],
  },
  {
    title: "M-x Mode",
    description: "Execute commands by name with completion",
    href: "/docs/mx-mode",
    section: "Editing",
    order: 7,
    headings: [
      { title: "How M-x Works", id: "how-mx-works" },
      { title: "Common Commands", id: "common-commands" },
      { title: "Minibuffer Keys", id: "minibuffer-keys" },
    ],
  },
  {
    title: "T-Lisp",
    description:
      "Language reference, data types, special forms, and stdlib",
    href: "/docs/tlisp",
    section: "T-Lisp",
    order: 8,
    headings: [
      { title: "Language Overview", id: "language-overview" },
      { title: "Data Types", id: "data-types" },
      { title: "Special Forms", id: "special-forms" },
      { title: "Quasiquote & Macros", id: "quasiquote-and-macros" },
      { title: "Module System", id: "module-system" },
      { title: "Async", id: "async" },
      { title: "Error Handling", id: "error-handling" },
      { title: "Standard Library", id: "standard-library" },
      { title: "Test Framework", id: "test-framework" },
      { title: "REPL", id: "repl" },
      { title: "Editor API", id: "editor-api" },
    ],
  },
  {
    title: "Configuration",
    description:
      "init.tlisp, key bindings, custom functions, and plugins",
    href: "/docs/configuration",
    section: "Configuration",
    order: 9,
  },
];

export const sidebarSections: SidebarSection[] = [
  {
    title: "Getting Started",
    pages: docsPages.filter((p) => p.section === "Getting Started"),
  },
  {
    title: "Editing",
    pages: docsPages.filter((p) => p.section === "Editing"),
  },
  {
    title: "T-Lisp",
    pages: docsPages.filter((p) => p.section === "T-Lisp"),
  },
  {
    title: "Configuration",
    pages: docsPages.filter((p) => p.section === "Configuration"),
  },
];

export function getPrevNext(href: string): {
  prev: DocPage | null;
  next: DocPage | null;
} {
  const idx = docsPages.findIndex((p) => p.href === href);
  return {
    prev: idx > 0 ? docsPages[idx - 1] : null,
    next: idx < docsPages.length - 1 ? docsPages[idx + 1] : null,
  };
}

export const searchIndex = docsPages.map((p) => ({
  title: p.title,
  description: p.description,
  href: p.href,
  section: p.section,
}));

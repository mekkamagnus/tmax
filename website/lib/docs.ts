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
    title: "Editing",
    description: "Modes, key bindings, operators, and text objects",
    href: "/docs/editing",
    section: "Editing",
    order: 2,
  },
  {
    title: "T-Lisp",
    description:
      "Language reference, data types, special forms, and stdlib",
    href: "/docs/tlisp",
    section: "T-Lisp",
    order: 3,
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
    order: 4,
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

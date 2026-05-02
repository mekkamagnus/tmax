/**
 * @file documentation.ts
 * @description Documentation system for tmax editor
 *
 * Provides comprehensive documentation for T-Lisp functions, tutorials, and guides.
 */

import { TLispValue, createString, createList, createNil } from '../../tlisp/values';
import { TLispInterpreter } from '../../tlisp/types';
import { Either } from '../../utils/task-either';

/**
 * Documentation entry for a function
 */
export interface DocumentationEntry {
  /** Function name */
  name: string;
  /** Category (buffer, editor, keymap, etc.) */
  category: string;
  /** Function signature */
  signature: string;
  /** Description */
  description: string;
  /** Examples */
  examples: string[];
  /** Related functions */
  related: string[];
  /** Entry type (function, guide, tutorial) */
  type: 'function' | 'guide' | 'tutorial';
}

/**
 * Documentation database
 * In production, this could be loaded from external files
 */
const DOCUMENTATION_DATABASE: DocumentationEntry[] = [
  // Buffer operations
  {
    name: 'buffer-save',
    category: 'buffer',
    signature: '(buffer-save &optional filename)',
    description: 'Save the current buffer to a file. If filename is provided, save to that file. Otherwise, use the buffer\'s current filename.',
    examples: [
      '(buffer-save) ; Save to current file',
      '(buffer-save "newfile.txt") ; Save to new file'
    ],
    related: ['buffer-save-as', 'buffer-write', 'buffer-create'],
    type: 'function'
  },
  {
    name: 'buffer-save-as',
    category: 'buffer',
    signature: '(buffer-save-as filename)',
    description: 'Save the current buffer to a new filename and update the buffer\'s filename.',
    examples: [
      '(buffer-save-as "output.txt")'
    ],
    related: ['buffer-save', 'buffer-write'],
    type: 'function'
  },
  {
    name: 'buffer-create',
    category: 'buffer',
    signature: '(buffer-create &optional filename)',
    description: 'Create a new buffer. Optionally associate it with a filename.',
    examples: [
      '(buffer-create)',
      '(buffer-create "notes.txt")'
    ],
    related: ['buffer-switch', 'buffer-list', 'buffer-kill'],
    type: 'function'
  },
  {
    name: 'buffer-switch',
    category: 'buffer',
    signature: '(buffer-switch buffer-name-or-index)',
    description: 'Switch to a different buffer. Can be specified by name or index.',
    examples: [
      '(buffer-switch "main.ts")',
      '(buffer-switch 0) ; Switch to first buffer'
    ],
    related: ['buffer-create', 'buffer-list', 'buffer-kill'],
    type: 'function'
  },
  {
    name: 'buffer-list',
    category: 'buffer',
    signature: '(buffer-list)',
    description: 'Return a list of all open buffers.',
    examples: [
      '(buffer-list) ; => ((buffer1) (buffer2) (buffer3))'
    ],
    related: ['buffer-create', 'buffer-switch', 'buffer-kill'],
    type: 'function'
  },
  {
    name: 'buffer-kill',
    category: 'buffer',
    signature: '(buffer-kill &optional buffer-name)',
    description: 'Close a buffer. If no buffer name is provided, kill the current buffer.',
    examples: [
      '(buffer-kill "temp.txt")',
      '(buffer-kill) ; Kill current buffer'
    ],
    related: ['buffer-create', 'buffer-switch', 'buffer-list'],
    type: 'function'
  },
  {
    name: 'buffer-text',
    category: 'buffer',
    signature: '(buffer-text)',
    description: 'Return the full text content of the current buffer.',
    examples: [
      '(buffer-text) ; => "Hello, world!"'
    ],
    related: ['buffer-insert', 'buffer-delete', 'buffer-save'],
    type: 'function'
  },
  {
    name: 'buffer-insert',
    category: 'buffer',
    signature: '(buffer-insert text)',
    description: 'Insert text at the current cursor position in the buffer.',
    examples: [
      '(buffer-insert "Hello")'
    ],
    related: ['buffer-delete', 'buffer-text', 'cursor-move'],
    type: 'function'
  },
  {
    name: 'buffer-delete',
    category: 'buffer',
    signature: '(buffer-delete &optional count)',
    description: 'Delete characters at the current cursor position. If count is provided, delete that many characters.',
    examples: [
      '(buffer-delete) ; Delete one character',
      '(buffer-delete 5) ; Delete five characters'
    ],
    related: ['buffer-insert', 'buffer-text', 'cursor-move'],
    type: 'function'
  },

  // Cursor operations
  {
    name: 'cursor-move',
    category: 'cursor',
    signature: '(cursor-move line column)',
    description: 'Move the cursor to the specified line and column. Both are 0-indexed.',
    examples: [
      '(cursor-move 0 0) ; Move to beginning',
      '(cursor-move 10 5) ; Move to line 10, column 5'
    ],
    related: ['cursor-line', 'cursor-column', 'cursor-position'],
    type: 'function'
  },
  {
    name: 'cursor-line',
    category: 'cursor',
    signature: '(cursor-line)',
    description: 'Return the current cursor line (0-indexed).',
    examples: [
      '(cursor-line) ; => 0'
    ],
    related: ['cursor-column', 'cursor-move', 'cursor-position'],
    type: 'function'
  },
  {
    name: 'cursor-column',
    category: 'cursor',
    signature: '(cursor-column)',
    description: 'Return the current cursor column (0-indexed).',
    examples: [
      '(cursor-column) ; => 5'
    ],
    related: ['cursor-line', 'cursor-move', 'cursor-position'],
    type: 'function'
  },
  {
    name: 'cursor-position',
    category: 'cursor',
    signature: '(cursor-position)',
    description: 'Return the current cursor position as a list (line column).',
    examples: [
      '(cursor-position) ; => (0 5)'
    ],
    related: ['cursor-line', 'cursor-column', 'cursor-move'],
    type: 'function'
  },

  // Editor operations
  {
    name: 'editor-quit',
    category: 'editor',
    signature: '(editor-quit)',
    description: 'Quit the editor. If there are unsaved changes, prompts for confirmation.',
    examples: [
      '(editor-quit)'
    ],
    related: ['editor-mode', 'status-message'],
    type: 'function'
  },
  {
    name: 'editor-mode',
    category: 'editor',
    signature: '(editor-mode &optional new-mode)',
    description: 'Get or set the current editor mode. Modes: normal, insert, visual, command, mx.',
    examples: [
      '(editor-mode) ; => "normal"',
      '(editor-mode "insert") ; Switch to insert mode'
    ],
    related: ['editor-quit', 'key-bind', 'key-bindings'],
    type: 'function'
  },
  {
    name: 'status-message',
    category: 'editor',
    signature: '(status-message text)',
    description: 'Display a message in the editor\'s status line.',
    examples: [
      '(status-message "File saved successfully")'
    ],
    related: ['editor-mode', 'editor-quit'],
    type: 'function'
  },

  // Keymap operations
  {
    name: 'key-bind',
    category: 'keymap',
    signature: '(key-bind key command &optional mode)',
    description: 'Bind a key sequence to a command. Optionally specify the mode (normal, insert, visual, command, mx).',
    examples: [
      '(key-bind "C-c C-c" "save-file")',
      '(key-bind "k" "kill-line" "normal")'
    ],
    related: ['key-unbind', 'key-bindings', 'key-binding'],
    type: 'function'
  },
  {
    name: 'key-unbind',
    category: 'keymap',
    signature: '(key-unbind key &optional mode)',
    description: 'Remove a key binding. Optionally specify the mode.',
    examples: [
      '(key-unbind "C-c C-c")',
      '(key-unbind "k" "normal")'
    ],
    related: ['key-bind', 'key-bindings', 'key-binding'],
    type: 'function'
  },
  {
    name: 'key-bindings',
    category: 'keymap',
    signature: '(key-bindings)',
    description: 'Return a list of all active key bindings.',
    examples: [
      '(key-bindings) ; => (("C-x C-f" "find-file") ("C-x C-s" "save-file"))'
    ],
    related: ['key-bind', 'key-unbind', 'key-binding'],
    type: 'function'
  },
  {
    name: 'key-binding',
    category: 'keymap',
    signature: '(key-binding key &optional mode)',
    description: 'Get the command bound to a key sequence. Returns nil if unbound.',
    examples: [
      '(key-binding "C-x C-f") ; => ("find-file" "source" "all")',
      '(key-binding "xyz") ; => nil'
    ],
    related: ['key-bind', 'key-unbind', 'key-bindings'],
    type: 'function'
  },

  // Guides
  {
    name: 'key-bindings-guide',
    category: 'guide',
    signature: 'N/A',
    description: 'A comprehensive guide to understanding and using key bindings in tmax. Covers key binding syntax, mode-specific bindings, key sequences, and best practices for customizing your workflow.',
    examples: [
      'Read the full guide in the editor\'s documentation',
      'See related functions: key-bind, key-unbind, key-bindings'
    ],
    related: ['key-bind', 'key-unbind', 'key-bindings', 'key-binding'],
    type: 'guide'
  },
  {
    name: 'buffer-management-tutorial',
    category: 'tutorial',
    signature: 'N/A',
    description: 'Step-by-step tutorial for managing multiple buffers in tmax. Learn how to create, switch between, and kill buffers efficiently.',
    examples: [
      'Start with: (buffer-create "notes.txt")',
      'Then: (buffer-switch "notes.txt")',
      'Finally: (buffer-kill)'
    ],
    related: ['buffer-create', 'buffer-switch', 'buffer-list', 'buffer-kill'],
    type: 'tutorial'
  }
];

/**
 * Get all documentation entries
 */
export function listDocumentation(): DocumentationEntry[] {
  return [...DOCUMENTATION_DATABASE];
}

/**
 * Search documentation by pattern (case-insensitive)
 * Searches in name, category, and description
 */
export function searchDocumentation(pattern: string): DocumentationEntry[] {
  const lowerPattern = pattern.toLowerCase();
  return DOCUMENTATION_DATABASE.filter(doc =>
    doc.name.toLowerCase().includes(lowerPattern) ||
    doc.category.toLowerCase().includes(lowerPattern) ||
    doc.description.toLowerCase().includes(lowerPattern) ||
    doc.related.some(r => r.toLowerCase().includes(lowerPattern))
  );
}

/**
 * Get documentation for a specific function
 */
export function getDocumentation(name: string): DocumentationEntry | null {
  return DOCUMENTATION_DATABASE.find(doc => doc.name === name) || null;
}

/**
 * Get all unique categories
 */
export function getCategories(): string[] {
  const categories = new Set(DOCUMENTATION_DATABASE.map(doc => doc.category));
  return Array.from(categories).sort();
}

/**
 * Get documentation by category
 */
export function getByCategory(category: string): DocumentationEntry[] {
  return DOCUMENTATION_DATABASE.filter(doc =>
    doc.category.toLowerCase() === category.toLowerCase()
  );
}

/**
 * Format documentation as string
 */
export function formatDocumentation(doc: DocumentationEntry): string {
  const lines = [
    `Name: ${doc.name}`,
    `Category: ${doc.category}`,
    `Type: ${doc.type}`,
    `Signature: ${doc.signature}`,
    '',
    `Description:`,
    doc.description,
    ''
  ];

  if (doc.examples.length > 0) {
    lines.push('Examples:');
    doc.examples.forEach(ex => {
      lines.push(`  ${ex}`);
    });
    lines.push('');
  }

  if (doc.related.length > 0) {
    lines.push(`Related: ${doc.related.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Create documentation operations for T-Lisp API
 */
export function createDocumentationOps(
  interpreter: TLispInterpreter
): Map<string, (args: TLispValue[]) => Either<Error, TLispValue>> {
  const ops = {
    /**
     * (documentation-list) -> List all documented functions
     */
    'documentation-list': (): Either<Error, TLispValue> => {
      const docs = listDocumentation();

      const docLists = docs.map(doc => createList([
        createString(doc.name),
        createString(doc.category),
        createString(doc.signature)
      ]));

      return Either.right(createList(docLists));
    },

    /**
     * (documentation-search "pattern") -> Search documentation
     */
    'documentation-search': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString(
          'Error: documentation-search requires exactly one argument (pattern)'
        ));
      }

      const pattern = args[0];
      if (pattern.type !== 'string') {
        return Either.right(createString(
          'Error: documentation-search argument must be a string'
        ));
      }

      const docs = searchDocumentation(pattern.value);

      const docLists = docs.map(doc => createList([
        createString(doc.name),
        createString(doc.category),
        createString(doc.signature)
      ]));

      return Either.right(createList(docLists));
    },

    /**
     * (documentation-get "function-name") -> Get detailed documentation
     */
    'documentation-get': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString(
          'Error: documentation-get requires exactly one argument (function-name)'
        ));
      }

      const name = args[0];
      if (name.type !== 'string') {
        return Either.right(createString(
          'Error: documentation-get argument must be a string'
        ));
      }

      const doc = getDocumentation(name.value);
      if (!doc) {
        return Either.right(createString(
          `Error: Function '${name.value}' not found in documentation`
        ));
      }

      return Either.right(createString(formatDocumentation(doc)));
    },

    /**
     * (documentation-categories) -> List all categories
     */
    'documentation-categories': (): Either<Error, TLispValue> => {
      const categories = getCategories();
      return Either.right(createList(categories.map(c => createString(c))));
    },

    /**
     * (documentation-by-category "category") -> List functions by category
     */
    'documentation-by-category': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString(
          'Error: documentation-by-category requires exactly one argument (category)'
        ));
      }

      const category = args[0];
      if (category.type !== 'string') {
        return Either.right(createString(
          'Error: documentation-by-category argument must be a string'
        ));
      }

      const docs = getByCategory(category.value);

      const docLists = docs.map(doc => createList([
        createString(doc.name),
        createString(doc.category),
        createString(doc.signature)
      ]));

      return Either.right(createList(docLists));
    }
  };

  return new Map(Object.entries(ops));
}

/**
 * @file undo-tree.ts
 * @description Undo Tree implementation for branching edit history (US-3.4.1)
 *
 * Implements branching undo history with tree visualization and navigation:
 * - Creates branches when undoing and making new edits
 * - Visualizes tree structure with parent-child relationships
 * - Allows navigation between branches at branch points
 * - Shows current position in tree
 * - Maintains backward compatibility with linear undo/redo
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createString, createNil, createList, createBoolean } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  createBufferError,
  createValidationError,
  AppError
} from "../../error/types.ts";

/**
 * Tree node representing a single edit state
 */
interface TreeNode {
  id: number;                    // Unique node identifier
  description: string;           // Description of the edit (e.g., "delete", "insert")
  buffer: FunctionalTextBuffer;  // Buffer state after the edit
  cursorLine?: number;           // Cursor line position
  cursorColumn?: number;         // Cursor column position
  parent: number | null;         // Parent node ID (null for root)
  children: number[];            // Child node IDs
  timestamp: number;             // Creation timestamp
}

/**
 * Undo tree state management
 */
interface UndoTreeState {
  nodes: Map<number, TreeNode>;  // All nodes in the tree
  currentId: number | null;      // Current position in tree (null = at initial state)
  nextId: number;                // Counter for generating unique IDs
}

// Global undo tree state
let state: UndoTreeState = {
  nodes: new Map(),
  currentId: null,
  nextId: 0
};

// Initial buffer state (before any edits)
let initialBuffer: FunctionalTextBuffer | null = null;

/**
 * Reset undo tree state (for testing)
 */
export function resetUndoTreeState(): void {
  state = {
    nodes: new Map(),
    currentId: null,
    nextId: 0
  };
  initialBuffer = null;
}

/**
 * Set initial buffer state
 */
export function setInitialBuffer(buffer: FunctionalTextBuffer): void {
  initialBuffer = buffer;
}

/**
 * Push a new edit to the tree
 * @param description - Description of the edit
 * @param buffer - Buffer state after the edit
 * @param cursorLine - Optional cursor line position
 * @param cursorColumn - Optional cursor column position
 */
export function pushToTree(
  description: string,
  buffer: FunctionalTextBuffer,
  cursorLine?: number,
  cursorColumn?: number
): number {
  const parentId = state.currentId;
  const nodeId = state.nextId++;

  const node: TreeNode = {
    id: nodeId,
    description,
    buffer,
    cursorLine,
    cursorColumn,
    parent: parentId,
    children: [],
    timestamp: Date.now()
  };

  state.nodes.set(nodeId, node);
  state.currentId = nodeId;

  // Add this node as a child of its parent
  if (parentId !== null) {
    const parentNode = state.nodes.get(parentId);
    if (parentNode) {
      parentNode.children.push(nodeId);
    }
  }

  return nodeId;
}

/**
 * Undo to previous state
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success with status message
 */
export function undo(
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // If we're at the initial state, can't undo
  if (state.currentId === null) {
    return Either.right(createString("Already at oldest change"));
  }

  const currentNode = state.nodes.get(state.currentId);
  if (!currentNode) {
    return Either.left(createBufferError(
      'InvalidState',
      `Current node ${state.currentId} not found in tree`,
      'undo'
    ));
  }

  // Move to parent
  const parentId = currentNode.parent;
  state.currentId = parentId;

  // Restore buffer and cursor
  if (parentId === null) {
    // At initial state
    if (initialBuffer) {
      setCurrentBuffer(initialBuffer);
    }
  } else {
    const parentNode = state.nodes.get(parentId);
    if (parentNode) {
      setCurrentBuffer(parentNode.buffer);
      if (setCursorLine && parentNode.cursorLine !== undefined) {
        setCursorLine(parentNode.cursorLine);
      }
      if (setCursorColumn && parentNode.cursorColumn !== undefined) {
        setCursorColumn(parentNode.cursorColumn);
      }
    }
  }

  return Either.right(createNil());
}

/**
 * Redo to next state
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success with status message
 */
export function redo(
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // If we're at the initial state, go to first child
  if (state.currentId === null) {
    // Find root nodes (nodes with no parent)
    const rootNodes: TreeNode[] = [];
    for (const node of state.nodes.values()) {
      if (node.parent === null) {
        rootNodes.push(node);
      }
    }

    if (rootNodes.length === 0) {
      return Either.right(createString("Already at newest change"));
    }

    // For linear redo, use the first root node
    const node = rootNodes[0]!;
    state.currentId = node.id;
    setCurrentBuffer(node.buffer);
    if (setCursorLine && node.cursorLine !== undefined) {
      setCursorLine(node.cursorLine);
    }
    if (setCursorColumn && node.cursorColumn !== undefined) {
      setCursorColumn(node.cursorColumn);
    }

    return Either.right(createNil());
  }

  const currentNode = state.nodes.get(state.currentId);
  if (!currentNode) {
    return Either.left(createBufferError(
      'InvalidState',
      `Current node ${state.currentId} not found in tree`,
      'redo'
    ));
  }

  // For linear redo, use the first child
  if (currentNode.children.length === 0) {
    return Either.right(createString("Already at newest change"));
  }

  const childId = currentNode.children[0]!;
  const childNode = state.nodes.get(childId);
  if (!childNode) {
    return Either.left(createBufferError(
      'InvalidState',
      `Child node ${childId} not found in tree`,
      'redo'
    ));
  }

  state.currentId = childId;
  setCurrentBuffer(childNode.buffer);
  if (setCursorLine && childNode.cursorLine !== undefined) {
    setCursorLine(childNode.cursorLine);
  }
  if (setCursorColumn && childNode.cursorColumn !== undefined) {
    setCursorColumn(childNode.cursorColumn);
  }

  return Either.right(createNil());
}

/**
 * Navigate to a specific node in the tree
 * @param nodeId - Target node ID
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success
 */
export function gotoNode(
  nodeId: number,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  const targetNode = state.nodes.get(nodeId);
  if (!targetNode) {
    return Either.left(createBufferError(
      'NodeNotFound',
      `Node ${nodeId} not found in tree`,
      'gotoNode'
    ));
  }

  state.currentId = nodeId;
  setCurrentBuffer(targetNode.buffer);
  if (setCursorLine && targetNode.cursorLine !== undefined) {
    setCursorLine(targetNode.cursorLine);
  }
  if (setCursorColumn && targetNode.cursorColumn !== undefined) {
    setCursorColumn(targetNode.cursorColumn);
  }

  return Either.right(createNil());
}

/**
 * Get tree structure for visualization
 * @returns Tree structure as nested list
 */
export function getTreeStructure(): TLispValue {
  const nodes: TLispValue[] = [];

  for (const node of state.nodes.values()) {
    const nodeInfo = createList([
      createString(node.description),
      createNumber(node.id),
      createNumber(node.parent ?? -1),
      createList(node.children.map(id => createNumber(id))),
      createBoolean(node.id === state.currentId)
    ]);
    nodes.push(nodeInfo);
  }

  return createList(nodes);
}

/**
 * Get current node ID
 * @returns Current node ID or -1 if at initial state
 */
export function getCurrentNodeId(): number {
  return state.currentId ?? -1;
}

/**
 * Get branches from a node
 * @param nodeId - Node ID
 * @returns List of child node IDs
 */
export function getBranches(nodeId: number): Either<AppError, TLispValue> {
  const node = state.nodes.get(nodeId);
  if (!node) {
    return Either.left(createBufferError(
      'NodeNotFound',
      `Node ${nodeId} not found in tree`,
      'getBranches'
    ));
  }

  return Either.right(createList(node.children.map(id => createNumber(id))));
}

/**
 * Get total number of nodes in tree
 * @returns Node count
 */
export function getNodeCount(): number {
  return state.nodes.size;
}

/**
 * Create undo tree API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of undo tree function names to implementations
 */
export function createUndoTreeOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * undo-tree-push - push a new edit to the tree
   * Usage: (undo-tree-push description buffer [cursor-line] [cursor-column])
   */
  api.set("undo-tree-push", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-push requires at least 2 arguments: description, buffer, [cursor-line], [cursor-column]',
        'args',
        args,
        '2-4 arguments'
      ));
    }

    const descArg = args[0];
    if (descArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'undo-tree-push description must be a string',
        'args[0]',
        descArg,
        'string'
      ));
    }

    const bufferArg = args[1];
    if (typeof bufferArg !== 'object' || !('buffer' in bufferArg)) {
      return Either.left(createValidationError(
        'TypeError',
        'undo-tree-push buffer must be a FunctionalTextBuffer',
        'args[1]',
        bufferArg,
        'FunctionalTextBuffer'
      ));
    }

    const buffer = (bufferArg as any).buffer as FunctionalTextBuffer;

    let cursorLine: number | undefined = undefined;
    let cursorColumn: number | undefined = undefined;

    if (args.length >= 3 && args[2]!.type === 'number') {
      cursorLine = args[2]!.value as number;
    }

    if (args.length >= 4 && args[3]!.type === 'number') {
      cursorColumn = args[3]!.value as number;
    }

    const nodeId = pushToTree(descArg.value, buffer, cursorLine, cursorColumn);
    return Either.right(createNumber(nodeId));
  });

  /**
   * undo-tree-undo - undo to previous state
   * Usage: (undo-tree-undo)
   */
  api.set("undo-tree-undo", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-undo requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return undo(setCurrentBuffer, setCursorLine, setCursorColumn);
  });

  /**
   * undo-tree-redo - redo to next state
   * Usage: (undo-tree-redo)
   */
  api.set("undo-tree-redo", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-redo requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return redo(setCurrentBuffer, setCursorLine, setCursorColumn);
  });

  /**
   * undo-tree-goto - navigate to a specific node
   * Usage: (undo-tree-goto node-id)
   */
  api.set("undo-tree-goto", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-goto requires 1 argument: node-id',
        'args',
        args,
        '1 argument'
      ));
    }

    const idArg = args[0];
    if (idArg.type !== 'number') {
      return Either.left(createValidationError(
        'TypeError',
        'undo-tree-goto node-id must be a number',
        'args[0]',
        idArg,
        'number'
      ));
    }

    const nodeId = idArg.value as number;
    return gotoNode(nodeId, setCurrentBuffer, setCursorLine, setCursorColumn);
  });

  /**
   * undo-tree-structure - get tree structure for visualization
   * Usage: (undo-tree-structure)
   * Returns list of nodes: ((description id parent-id children-list current?) ...)
   */
  api.set("undo-tree-structure", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-structure requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(getTreeStructure());
  });

  /**
   * undo-tree-current - get current node ID
   * Usage: (undo-tree-current)
   * Returns current node ID or -1 if at initial state
   */
  api.set("undo-tree-current", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-current requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createNumber(getCurrentNodeId()));
  });

  /**
   * undo-tree-branches - get branches from a node
   * Usage: (undo-tree-branches node-id)
   * Returns list of child node IDs
   */
  api.set("undo-tree-branches", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-branches requires 1 argument: node-id',
        'args',
        args,
        '1 argument'
      ));
    }

    const idArg = args[0];
    if (idArg.type !== 'number') {
      return Either.left(createValidationError(
        'TypeError',
        'undo-tree-branches node-id must be a number',
        'args[0]',
        idArg,
        'number'
      ));
    }

    const nodeId = idArg.value as number;
    return getBranches(nodeId);
  });

  /**
   * undo-tree-nodes - get total number of nodes in tree
   * Usage: (undo-tree-nodes)
   */
  api.set("undo-tree-nodes", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-nodes requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createNumber(getNodeCount()));
  });

  /**
   * undo-tree-reset - reset tree state
   * Usage: (undo-tree-reset)
   */
  api.set("undo-tree-reset", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-tree-reset requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    resetUndoTreeState();
    return Either.right(createNil());
  });

  return api;
}

# Undo Tree

## Status

**proposed**

## Context

Advanced undo system needed:
- Branching undo history
- Visualize undo tree
- Navigate branches
- Undo timeline visualization

## Decision

Implement undo tree data structure:

### Undo Tree Structure

```typescript
export interface UndoNode {
  id: string;
  parent: string | null;
  children: string[];
  buffer: BufferSnapshot;
  timestamp: number;
  metadata: {
    type: 'insert' | 'delete' | 'replace';
    description: string;
  };
}

export class UndoTree {
  private nodes: Map<string, UndoNode> = new Map();
  private current: string | null = null;
  private root: string | null = null;

  addNode(parentId: string, snapshot: BufferSnapshot, metadata: NodeMetadata): string {
    const id = generateId();
    const node: UndoNode = {
      id,
      parent: parentId,
      children: [],
      buffer: snapshot,
      timestamp: Date.now(),
      metadata
    };

    this.nodes.set(id, node);

    // Add to parent's children
    if (parentId) {
      const parent = this.nodes.get(parentId)!;
      parent.children.push(id);
    } else {
      this.root = id;
    }

    this.current = id;
    return id;
  }

  goto(nodeId: string): BufferSnapshot | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    this.current = nodeId;
    return node.buffer;
  }

  getCurrentNode(): UndoNode | null {
    return this.current ? this.nodes.get(this.current)! : null;
  }

  getTree(): TreeNode[] {
    // Convert to tree structure for visualization
    return this.buildTree(this.root!);
  }
}
```

### Undo Tree Commands

```lisp
;; Undo tree visualization
(undo-tree-structure)  ; => Show tree structure
(undo-tree-current)    ; => Get current position
(undo-tree-branches)   ; => Get branches from node
(undo-tree-nodes)      ; => Get node count

;; Navigation
(undo-tree-undo)       ; => Move to parent
(undo-tree-redo)       ; => Move to child
(undo-tree-goto id)    ; => Jump to node
```

### Tree Visualization

```
Undo Tree:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

o Edit A (initial)
├── o Edit B
│   └── o Edit C [*]
└── o Edit D

[*] = current position
```

### Implementation

Created `src/editor/api/undo-tree.ts`:
- Undo tree data structure
- Node management
- Tree traversal
- Visualization helpers

## Consequences

### Benefits

1. **Branching**: Explore alternative edits
2. **History**: Full edit history preserved
3. **Visualization**: See edit history as tree
4. **Flexibility**: Jump to any point in history

### Trade-offs

1. **Memory**: Undo tree consumes more memory
2. **Complexity**: Tree navigation is complex
3. **Visualization**: Tree rendering is complex
4. **Learning Curve**: Users must understand branching

### Future Considerations

1. **Tree Pruning**: Remove old branches
2. **Tree Merging**: Merge branches
3. **Tree Persistence**: Save tree to disk
4. **Tree Diff**: Compare branches
5. **Tree Search**: Search through tree

### Testing

Created `test/unit/undo-tree.test.ts`:
- Tree creates branches correctly
- Navigation works
- Tree visualization correct
- Multiple branches from same point
- Jump to node works
- Current position tracked

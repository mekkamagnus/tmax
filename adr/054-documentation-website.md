# Documentation Website

## Status

**proposed**

## Context

Central documentation hub needed:
- API reference
- User guides
- Tutorials
- Plugin documentation

## Decision

Implement documentation website:

### Documentation Structure

```
docs/
├── index.md              # Homepage
├── api/                   # API reference
│   ├── index.md
│   ├── buffer.md
│   ├── editor.md
│   └── tlisp.md
├── guide/                 # User guides
│   ├── getting-started.md
│   ├── editing.md
│   └── customization.md
├── tutorial/              # Tutorials
│   ├── basic-editing.md
│   ├── macros.md
│   └── plugins.md
└── plugins/               # Plugin docs
    ├── plugin-a.md
    └── plugin-b.md
```

### Static Site Generator

```typescript
export class DocumentationGenerator {
  async generate(): Promise<void> {
    // Parse markdown files
    const files = await glob('docs/**/*.md');

    for (const file of files) {
      const content = await fs.readFile(file);
      const html = marked(content);

      // Add navigation
      const nav = this.generateNavigation(file);
      const page = this.wrapTemplate(html, nav);

      // Write to output
      const outputPath = file.replace('docs/', 'dist/').replace('.md', '.html');
      await fs.writeFile(outputPath, page);
    }
  }
}
```

### Documentation Commands

```lisp
;; Generate documentation
(docs-generate)        ; => Generate static site
(docs-serve)           ; => Serve docs locally
(docs-build)           ; => Build for production
```

### Website Features

- **Search**: Full-text search
- **Navigation**: Hierarchical navigation
- **Code Examples**: Syntax-highlighted code
- **Cross-References**: Links between pages
- **API Reference**: Auto-generated from source

### Implementation

Created `docs/` directory:
- Markdown documentation
- Static site generator
- Build scripts
- Deployment config

## Consequences

### Benefits

1. **Accessible**: Easy to access documentation
2. **Searchable**: Full-text search
3. **Offline**: Available offline
4. **Standard**: Common documentation format

### Trade-offs

1. **Maintenance**: Docs must be updated
2. **Build Time**: Static site generation takes time
3. **Deployment**: Must deploy website
4. **Versioning**: Multiple versions to maintain

### Future Considerations

1. **Version Selector**: View docs for specific versions
2. **Interactive Examples**: Live code examples
3. **Video Tutorials**: Embedded video content
4. **Community Contributions**: User submissions

### Testing

Manual testing confirmed:
- Site builds successfully
- All pages render
- Navigation works
- Search works
- Code examples highlighted
- Cross-references work

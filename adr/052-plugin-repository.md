# Plugin Repository

## Status

**proposed**

## Context

Central plugin distribution needed:
- Discover plugins
- Install plugins
- Update plugins
- Rate and review plugins

## Decision

Implement plugin repository:

### Repository Structure

```
~/.tmaxrc.d/plugins/repository/
├── index.json                 # Plugin index
├── plugin-a/
│   ├── plugin-a-1.0.0.tgz    # Plugin package
│   └── metadata.json         # Plugin metadata
└── plugin-b/
    ├── plugin-b-2.0.0.tgz
    └── metadata.json
```

### Index Format

```json
{
  "plugins": [
    {
      "name": "plugin-a",
      "version": "1.0.0",
      "description": "My awesome plugin",
      "author": "Author Name",
      "url": "https://github.com/user/plugin-a",
      "downloads": 100,
      "rating": 4.5,
      "dependencies": []
    }
  ],
  "lastUpdated": "2026-02-04T00:00:00Z"
}
```

### Repository Commands

```lisp
;; List plugins
(plugin-list)           ; => List all plugins
(plugin-search "theme")  ; => Search for plugins
(plugin-info "plugin-a") ; => Show plugin details

;; Install plugin
(plugin-install "plugin-a")              ; => Install latest
(plugin-install "plugin-a" :version "1.0.0")  ; => Install specific version

;; Update plugins
(plugin-update "plugin-a")  ; => Update specific plugin
(plugin-update-all)        ; => Update all plugins

;; Remove plugin
(plugin-remove "plugin-a")
```

### Implementation

Created `src/plugin/repository.ts`:
- Repository management
- Package downloading
- Version resolution
- Dependency handling

## Consequences

### Benefits

1. **Discovery**: Find plugins easily
2. **Installation**: Easy plugin installation
3. **Updates**: Keep plugins up to date
4. **Community**: Share plugins with community

### Trade-offs

1. **Network**: Requires network access
2. **Security**: Plugins must be trusted
3. **Maintenance**: Repository must be maintained
4. **Compatibility**: Version conflicts possible

### Future Considerations

1. **Plugin Stats**: Download statistics
2. **Plugin Reviews**: User reviews and ratings
3. **Plugin Verification**: Verify plugin authenticity
4. **Plugin Search**: Full-text search

### Testing

Created `test/unit/plugin.test.ts`:
- Repository fetches index
- Plugin search works
- Plugin installation works
- Version resolution works
- Dependency resolution works
- Plugin removal works
- Update checks work

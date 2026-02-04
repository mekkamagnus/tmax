# Plugin Directory Structure

## Status

Accepted

## Context

Plugin system foundation needed:
- Plugin discovery
- Plugin loading lifecycle
- Plugin isolation
- Plugin API access

## Decision

Implement plugin directory structure:

### Plugin Directories

```
~/.tmaxrc.d/plugins/       # User plugins
├── plugin1/
│   ├── plugin.tlisp      # Main plugin file
│   ├── manifest.json     # Plugin metadata
│   └── lib/              # Plugin dependencies
└── plugin2/
    ├── plugin.tlisp
    └── manifest.json
```

### Plugin Manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Author Name",
  "dependencies": [],
  "tmax-version": ">=0.1.0",
  "main": "plugin.tlisp"
}
```

### Plugin Discovery

```typescript
export class PluginLoader {
  async discoverPlugins(pluginDir: string): Promise<Plugin[]> {
    const plugins: Plugin[] = [];

    for (const dir of await fs.readdir(pluginDir)) {
      const manifestPath = path.join(pluginDir, dir, 'manifest.json');
      if (await fs.exists(manifestPath)) {
        const manifest = JSON.parse(await fs.readFile(manifestPath));
        plugins.push({
          name: manifest.name,
          version: manifest.version,
          directory: path.join(pluginDir, dir),
          main: manifest.main,
          manifest
        });
      }
    }

    return plugins;
  }
}
```

### Plugin Loading

```lisp
;; Load plugin
(plugin-load "my-plugin")

;; List loaded plugins
(plugin-list)

;; Unload plugin
(plugin-unload "my-plugin")

;; Reload plugin
(plugin-reload "my-plugin")
```

### Implementation

Created `src/plugin/loader.ts`:
- Plugin discovery
- Plugin loading/unloading
- Plugin lifecycle management
- Dependency resolution

## Consequences

### Benefits

1. **Extensibility**: Users can install plugins
2. **Distribution**: Plugins easily shared
3. **Isolation**: Plugins isolated from each other
4. **Standard Structure**: Consistent plugin format

### Trade-offs

1. **File I/O**: Plugin discovery requires filesystem access
2. **Loading Order**: Must handle dependencies
3. **Version Conflicts**: Plugin version compatibility
4. **Security**: Plugin code execution risks

### Future Considerations

1. **Plugin Repository**: Central plugin distribution
2. **Plugin Signing**: Verify plugin authenticity
3. **Sandboxing**: Restrict plugin capabilities
4. **Hot Reloading**: Reload plugins without restart

### Testing

Created `test/unit/plugin.test.ts`:
- Plugins discovered correctly
- Plugins load/unload correctly
- Dependencies resolved
- Version conflicts detected
- Invalid plugins rejected

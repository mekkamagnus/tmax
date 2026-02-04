# Plugin Submission

## Status

Accepted

## Context

Plugin authors need way to submit plugins:
- Upload plugin to repository
- Plugin review process
- Version management
- Plugin documentation

## Decision

Implement plugin submission system:

### Plugin Package

```
my-plugin/
├── plugin.tlisp           # Main plugin file
├── manifest.json          # Plugin metadata
├── README.md              # Plugin documentation
└── test/                  # Plugin tests
    └── test-plugin.tlisp
```

### Manifest Format

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Author Name <email@example.com>",
  "license": "MIT",
  "tmax-version": ">=0.1.0",
  "dependencies": [],
  "keywords": ["theme", "ui"],
  "homepage": "https://github.com/user/my-plugin",
  "repository": "https://github.com/user/my-plugin.git",
  "main": "plugin.tlisp"
}
```

### Submission Commands

```lisp
;; Package plugin
(plugin-package "my-plugin")  ; => Create plugin package

;; Submit plugin
(plugin-submit "my-plugin-1.0.0.tgz"
                :author "Author Name"
                :email "email@example.com")

;; Validate plugin
(plugin-validate "my-plugin")  ; => Check plugin manifest
```

### Submission Process

1. **Validate**: Check manifest and plugin structure
2. **Test**: Run plugin tests
3. **Package**: Create plugin package (.tgz)
4. **Upload**: Upload to repository
5. **Review**: Manual review (or automated)
6. **Publish**: Make available in repository

### Implementation

Created `src/plugin/packager.ts`:
- Plugin packaging
- Manifest validation
- Package creation
- Upload handling

## Consequences

### Benefits

1. **Distribution**: Easy plugin sharing
2. **Validation**: Ensures plugin quality
3. **Standardization**: Consistent plugin format
4. **Community**: Grow plugin ecosystem

### Trade-offs

1. **Review Bottleneck**: Manual review slow
2. **Quality Variance**: Plugin quality varies
3. **Malicious Plugins**: Risk of malicious code
4. **Maintenance**: Overhead to maintain repository

### Future Considerations

1. **Automated Review**: Automated quality checks
2. **Plugin Signing**: Cryptographic signing
3. **Sandboxing**: Run plugins in sandbox
4. **Monetization**: Support paid plugins

### Testing

Created `test/unit/plugin.test.ts`:
- Plugin packaging works
- Manifest validation works
- Package creation correct
- Upload succeeds
- Validation catches errors
- Test execution works

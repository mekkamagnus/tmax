# tmax Documentation

This directory contains comprehensive documentation for tmax, a terminal-based text editor with T-Lisp extensibility.

## Documentation Structure

```
docs/
├── README.md              # This file - documentation overview
├── manual/
│   ├── tmax.texi          # Complete Texinfo manual
│   ├── tmax.info          # Info format (generated)
│   ├── tmax.pdf           # PDF manual (generated)
│   └── tmax.html          # HTML manual (generated)
├── examples/
│   ├── basic-config.tlisp # Basic configuration examples
│   ├── advanced-config.tlisp # Advanced customization
│   └── programming.tlisp  # Programming-specific setup
├── api/
│   ├── tlisp-api.md       # T-Lisp API reference
│   └── functions.md       # Function documentation
└── contributing/
    ├── CONTRIBUTING.md    # Contribution guidelines
    ├── development.md     # Development setup
    └── testing.md         # Testing guidelines
```

## Building Documentation

### Texinfo to Info Format
```bash
makeinfo docs/manual/tmax.texi -o docs/manual/tmax.info
```

### Texinfo to HTML
```bash
makeinfo --html docs/manual/tmax.texi -o docs/manual/tmax.html
```

### Texinfo to PDF (requires TeX)
```bash
texi2pdf docs/manual/tmax.texi -o docs/manual/tmax.pdf
```

## Quick Start

For immediate help getting started with tmax:

1. **Installation**: See [manual/tmax.texi Chapter 2](manual/tmax.texi)
2. **Basic Usage**: See [manual/tmax.texi Chapter 3](manual/tmax.texi)
3. **Configuration**: See [examples/](examples/) directory

## Reading the Manual

### Using Info (Recommended)
```bash
info docs/manual/tmax.info
```

### Using a Text Editor
Open `manual/tmax.texi` in any text editor. The Texinfo markup is quite readable.

### Generate Other Formats
Use the build commands above to create HTML or PDF versions.

## Key Documentation Sections

- **Installation & Setup**: Complete installation instructions for all platforms
- **Basic Usage**: Essential commands and navigation for new users  
- **Editing Modes**: Detailed explanation of tmax's modal editing system
- **T-Lisp System**: Complete guide to customization and scripting
- **Key Bindings**: Default bindings and customization instructions
- **Command Reference**: Complete API documentation for all T-Lisp functions
- **Configuration Examples**: Real-world .tmaxrc configurations
- **Troubleshooting**: Solutions to common problems

## Contributing to Documentation

See [contributing/CONTRIBUTING.md](contributing/CONTRIBUTING.md) for guidelines on improving the documentation.

Documentation follows these standards:
- **Texinfo** for the main manual (GNU standard)
- **Markdown** for supplementary docs
- **T-Lisp comments** for inline code documentation
- **Examples** for all features and APIs

## Documentation Quality Standards

- All features must be documented
- Examples must be tested and working
- Cross-references between related sections
- Clear, concise writing appropriate for technical audience
- Comprehensive troubleshooting coverage
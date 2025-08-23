# Contributing to tmax Documentation

Thank you for your interest in improving tmax documentation! This guide will help you contribute effectively.

## Documentation Standards

### Primary Documentation Format

We use **GNU Texinfo** for the main manual (`docs/manual/tmax.texi`) because:

- **Professional Standard**: Used by GNU projects, GCC, Emacs, and other major software
- **Multiple Output Formats**: Generates Info, HTML, PDF, and plain text from single source
- **Excellent Cross-referencing**: Built-in support for nodes, menus, and indices
- **Accessibility**: Info format is highly accessible and works in any terminal
- **Integration**: Works seamlessly with GNU Info system (`info tmax`)

### Supplementary Formats

- **Markdown**: For contributing guides, READMEs, and project documentation
- **T-Lisp Comments**: Inline documentation in code files
- **Example Files**: Commented T-Lisp configuration examples

## Contributing to the Main Manual

### Getting Started

1. **Install Texinfo**:
   ```bash
   # macOS
   brew install texinfo
   
   # Ubuntu/Debian
   sudo apt install texinfo
   
   # Fedora/RHEL
   sudo dnf install texinfo
   ```

2. **Clone and Setup**:
   ```bash
   git clone <repository-url>
   cd tmax/docs
   make check-deps  # Verify tools are available
   ```

3. **Build Documentation**:
   ```bash
   make all         # Build all formats
   make info        # Just GNU Info format
   make html        # Just HTML format
   make pdf         # Just PDF (requires TeX)
   ```

### Texinfo Editing Guidelines

#### Basic Structure
```texinfo
@node NodeName
@section Section Title

@cindex index-entry
@cindex another-index-entry

Content goes here with @code{inline code} and @kbd{key bindings}.

@example
Code examples are indented
like this
@end example
```

#### Common Markup
- `@code{function-name}` - Function names, code elements
- `@kbd{C-x C-s}` - Keyboard bindings
- `@var{variable}` - Variable names or placeholders
- `@file{filename.txt}` - File and directory names
- `@samp{output}` - Sample program output
- `@strong{emphasis}` - Strong emphasis
- `@emph{emphasis}` - Light emphasis

#### Cross-References
```texinfo
@xref{NodeName}.           # See NodeName
@pxref{NodeName}.          # see NodeName (parenthetical)
@ref{NodeName, Link Text}. # Custom link text
```

#### Lists and Tables
```texinfo
@itemize @bullet
@item First item
@item Second item
@end itemize

@table @code
@item function-name
Description of function
@item another-function  
Another description
@end table
```

### Content Guidelines

#### Writing Style
- **Clear and Concise**: Technical accuracy without unnecessary verbosity
- **User-Focused**: Write from the user's perspective
- **Progressive**: Build from basic to advanced concepts
- **Consistent**: Use consistent terminology throughout

#### Code Examples
- **Test All Examples**: Every code example must be tested and working
- **Complete Context**: Provide enough context to understand the example
- **Real-World Usage**: Prefer practical examples over contrived ones
- **Error Handling**: Show both success and error cases where relevant

#### API Documentation
- **Function Signature**: Always show the complete function signature
- **Parameter Details**: Describe each parameter with type and constraints
- **Return Values**: Document what the function returns
- **Examples**: Provide at least one working example
- **Related Functions**: Cross-reference related functionality

### Submitting Changes

1. **Create Branch**:
   ```bash
   git checkout -b docs/improve-section-name
   ```

2. **Make Changes**:
   - Edit `docs/manual/tmax.texi`
   - Add examples to `docs/examples/` if needed
   - Update cross-references and indices

3. **Validate Changes**:
   ```bash
   make validate    # Check Texinfo syntax
   make info        # Build and test
   make html        # Verify HTML output
   ```

4. **Test Documentation**:
   ```bash
   make view-info   # Test Info navigation
   info docs/manual/tmax.info  # Browse the manual
   ```

5. **Commit and Submit**:
   ```bash
   git add docs/
   git commit -m "docs: improve T-Lisp API documentation"
   git push origin docs/improve-section-name
   # Submit pull request
   ```

## Documentation Quality Checklist

### Before Submitting
- [ ] All Texinfo syntax is valid (`make validate`)
- [ ] All code examples are tested and working
- [ ] Cross-references are correct and functional
- [ ] Index entries are appropriate and complete
- [ ] Generated HTML and Info formats display correctly
- [ ] No broken internal links
- [ ] New content follows existing style and conventions

### Content Review
- [ ] Information is accurate and up-to-date
- [ ] Examples demonstrate real-world usage
- [ ] Explanations are clear for target audience
- [ ] Prerequisites and context are provided
- [ ] Error conditions and edge cases are covered

### Integration Review  
- [ ] New content fits well with existing structure
- [ ] Appropriate level of detail for the section
- [ ] Cross-references to related material
- [ ] Index entries for discoverability
- [ ] Consistent with overall manual organization

## Specific Documentation Areas

### High-Priority Areas
1. **T-Lisp API Reference**: Complete function documentation with examples
2. **Configuration Examples**: More real-world `.tmaxrc` configurations
3. **Troubleshooting**: Solutions to common user problems
4. **Advanced Usage**: Power-user features and techniques

### New Feature Documentation Requirements

When adding new features to tmax:

1. **Update Manual**: Add documentation to appropriate chapter
2. **Add Examples**: Create working examples in `docs/examples/`
3. **Update API Reference**: Document new T-Lisp functions
4. **Add Troubleshooting**: Cover common issues with new feature
5. **Update Index**: Add appropriate index entries

### Style Preferences

- **American English** spelling and grammar
- **Oxford comma** in lists
- **Active voice** preferred over passive
- **Present tense** for describing current functionality
- **Imperative mood** for instructions ("Press Enter" not "The user should press Enter")

## Building and Testing

### Local Development
```bash
# Watch for changes and rebuild (requires entr or similar)
ls docs/manual/tmax.texi | entr -c make info

# Quick syntax check
make validate

# Full build and test
make clean && make all
```

### Integration Testing
- Test Info navigation: `info docs/manual/tmax.info`
- Test HTML rendering: Open in multiple browsers
- Test PDF generation: Verify formatting and fonts
- Test examples: Run example code in actual tmax sessions

### Performance Considerations
- Keep manual loading time reasonable (Info format)
- Optimize images and diagrams for multiple output formats
- Consider impact on PDF file size
- Test on slow terminals/connections

## Questions and Support

- **Documentation Issues**: Open issue with `docs:` prefix
- **Texinfo Help**: GNU Texinfo manual: `info texinfo`
- **Style Questions**: Reference existing high-quality sections
- **Technical Questions**: Ask in development discussions

## Recognition

Contributors to documentation are recognized in:
- Git commit history
- Annual contributor lists  
- Documentation credits section

Thank you for helping make tmax documentation better!
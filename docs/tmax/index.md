# docs/tmax/ — Texinfo Manuals (Source and Compiled)

Canonical reference documentation in texinfo format. Compiled to HTML and info formats via `make`.

| File | Description | Related |
|------|-------------|---------|
| [tmax.texinfo](tmax.texinfo) | Source for the tmax editor manual — editing modes, key bindings, commands, API reference | [manual/](../manual/index.md) — standalone HTML |
| [tmax.html](tmax.html) | Compiled HTML version of the tmax editor manual | [tmax.texinfo](tmax.texinfo) |
| [tmax.info](tmax.info) | Compiled info version (readable in Emacs or `info` command) | [tmax.texinfo](tmax.texinfo) |
| [tlisp.texinfo](tlisp.texinfo) | Source for the T-Lisp language reference — data types, special forms, stdlib, macros, modules | [SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), [RFC-005](../rfcs/RFC-005-tlisp-module-system.md) |
| [tlisp.html](tlisp.html) | Compiled HTML version of the T-Lisp language reference | [tlisp.texinfo](tlisp.texinfo) |
| [tlisp.info](tlisp.info) | Compiled info version of the T-Lisp language reference | [tlisp.texinfo](tlisp.texinfo) |
| [Makefile](Makefile) | Build targets: `make html`, `make info` to compile from .texinfo sources | — |

## Regenerating

```bash
cd docs/tmax
make html    # Compile .texinfo → .html
make info    # Compile .texinfo → .info
```

The `/update-tmax-documentation` skill regenerates these from the current codebase before publishing to the website.

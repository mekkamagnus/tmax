# Documentation build system for tmax manuals
# Requires: texinfo (makeinfo), GNU make

MANUALS = tmax texinfo tlisp.texinfo
INFO_TARGETS = tmax.info tlisp.info
HTML_TARGETS = tmax.html tlisp.html
HTML_CSS = --css-ref="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css"

.PHONY: all info html pdf clean validate drift-check help check-deps view-info

# Build default documentation format
all: info html

# Build Info format (GNU Info)
info: $(INFO_TARGETS)

tmax.info: tmax.texinfo
	@echo "Building tmax.info..."
	makeinfo tmax.texinfo -o tmax.info

tlisp.info: tlisp.texinfo
	@echo "Building tlisp.info..."
	makeinfo tlisp.texinfo -o tlisp.info

# Build HTML format (single-file per manual)
html: $(HTML_TARGETS)

tmax.html: tmax.texinfo
	@echo "Building tmax.html..."
	makeinfo --html --no-split $(HTML_CSS) tmax.texinfo -o tmax.html

tlisp.html: tlisp.texinfo
	@echo "Building tlisp.html..."
	makeinfo --html --no-split $(HTML_CSS) tlisp.texinfo -o tlisp.html

# Build PDF format (requires TeX distribution)
pdf: tmax.pdf tlisp.pdf

tmax.pdf: tmax.texinfo
	@echo "Building tmax.pdf..."
	texi2pdf tmax.texinfo

tlisp.pdf: tlisp.texinfo
	@echo "Building tlisp.pdf..."
	texi2pdf tlisp.texinfo

# Clean generated files
clean:
	@echo "Cleaning generated documentation..."
	rm -f $(INFO_TARGETS) $(HTML_TARGETS) tmax.pdf tlisp.pdf
	rm -f *.aux *.cp *.fn *.ky *.log *.pg *.toc *.tp *.vr

# Validate Texinfo syntax
validate:
	@echo "Validating tmax.texinfo..."
	@makeinfo --no-validate tmax.texinfo -o /dev/null
	@echo "Validating tlisp.texinfo..."
	@makeinfo --no-validate tlisp.texinfo -o /dev/null
	@echo "All manuals validate successfully."

# Drift guard: every registered major mode (src/tlisp/core/modes/*.tlisp)
# must have an @code{<mode>} entry in the Built-in Major Modes table.
drift-check:
	@echo "Checking manual <-> registered major modes..."
	@missing=0; \
	for m in $$(grep -rhoE 'major-mode-register "[a-z]+"' ../../src/tlisp/core/modes/*.tlisp \
	            | sed -E 's/.*"([a-z]+)".*/\1/' | sort -u); do \
	  grep -q "@code{$$m}" tmax.texinfo \
	    || { echo "  MISSING from manual: $$m"; missing=1; }; \
	done; \
	if [ "$$missing" -eq 0 ]; then \
	  echo "  all registered major modes are documented."; \
	else \
	  echo "  drift detected: add the missing mode(s) to tmax.texinfo."; \
	  exit 1; \
	fi

# Check for required tools
check-deps:
	@echo "Checking for required tools..."
	@command -v makeinfo >/dev/null 2>&1 || { echo "makeinfo is required but not installed"; exit 1; }
	@command -v texi2pdf >/dev/null 2>&1 || { echo "texi2pdf is required for PDF output (optional)"; }
	@echo "Dependencies satisfied."

# Install Info documentation to system
install-info: info
	@echo "Installing Info documentation..."
	sudo install-info tmax.info /usr/local/share/info/dir
	sudo install-info tlisp.info /usr/local/share/info/dir

# View documentation with Info reader
view-info: info
	@info -f tmax.info

view-tlisp-info: info
	@info -f tlisp.info

# Help target
help:
	@echo "tmax Documentation Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  all           - Build Info + HTML documentation (default)"
	@echo "  info          - Build GNU Info format (.info)"
	@echo "  html          - Build single-file HTML (.html)"
	@echo "  pdf           - Build PDF format (requires TeX)"
	@echo "  clean         - Remove generated files"
	@echo "  validate      - Check Texinfo syntax"
	@echo "  drift-check   - Verify every registered major mode is documented"
	@echo "  install-info  - Install Info docs to system"
	@echo "  view-info     - View tmax manual with Info reader"
	@echo "  view-tlisp-info - View T-Lisp reference with Info reader"
	@echo "  check-deps    - Check for required tools"
	@echo "  help          - Show this help message"
	@echo ""
	@echo "Manuals:"
	@echo "  tmax.texinfo  - tmax editor manual"
	@echo "  tlisp.texinfo - T-Lisp language and API reference"
	@echo ""
	@echo "Requirements:"
	@echo "  makeinfo      - From GNU Texinfo package"
	@echo "  texi2pdf      - From GNU Texinfo package (for PDF)"

.DEFAULT_GOAL := help

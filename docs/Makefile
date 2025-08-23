# Documentation build system for tmax
# Requires: texinfo, texi2pdf, makeinfo

MANUAL_DIR = manual
TEXI_SOURCE = $(MANUAL_DIR)/tmax.texi
INFO_TARGET = $(MANUAL_DIR)/tmax.info
HTML_TARGET = $(MANUAL_DIR)/tmax.html
PDF_TARGET = $(MANUAL_DIR)/tmax.pdf

.PHONY: all info html pdf clean help

# Build all documentation formats
all: info html pdf

# Build Info format (GNU Info)
info: $(INFO_TARGET)

$(INFO_TARGET): $(TEXI_SOURCE)
	@echo "Building Info documentation..."
	makeinfo $(TEXI_SOURCE) -o $(INFO_TARGET)

# Build HTML format
html: $(HTML_TARGET)

$(HTML_TARGET): $(TEXI_SOURCE)
	@echo "Building HTML documentation..."
	makeinfo --html --no-split $(TEXI_SOURCE) -o $(HTML_TARGET)

# Build PDF format (requires TeX distribution)
pdf: $(PDF_TARGET)

$(PDF_TARGET): $(TEXI_SOURCE)
	@echo "Building PDF documentation..."
	cd $(MANUAL_DIR) && texi2pdf $(notdir $(TEXI_SOURCE))

# Clean generated files
clean:
	@echo "Cleaning generated documentation..."
	rm -f $(INFO_TARGET) $(HTML_TARGET) $(PDF_TARGET)
	rm -f $(MANUAL_DIR)/*.aux $(MANUAL_DIR)/*.cp $(MANUAL_DIR)/*.fn
	rm -f $(MANUAL_DIR)/*.ky $(MANUAL_DIR)/*.log $(MANUAL_DIR)/*.pg
	rm -f $(MANUAL_DIR)/*.toc $(MANUAL_DIR)/*.tp $(MANUAL_DIR)/*.vr

# Validate Texinfo syntax
validate:
	@echo "Validating Texinfo syntax..."
	makeinfo --no-validate --no-warn $(TEXI_SOURCE) -o /dev/null

# Install Info documentation to system
install-info: info
	@echo "Installing Info documentation..."
	sudo install-info $(INFO_TARGET) /usr/local/share/info/dir

# View documentation with Info reader
view-info: info
	info $(INFO_TARGET)

# View HTML documentation in browser
view-html: html
	@if command -v xdg-open >/dev/null 2>&1; then \
		xdg-open $(HTML_TARGET); \
	elif command -v open >/dev/null 2>&1; then \
		open $(HTML_TARGET); \
	else \
		echo "Please open $(HTML_TARGET) in your browser"; \
	fi

# View PDF documentation
view-pdf: pdf
	@if command -v xdg-open >/dev/null 2>&1; then \
		xdg-open $(PDF_TARGET); \
	elif command -v open >/dev/null 2>&1; then \
		open $(PDF_TARGET); \
	else \
		echo "Please open $(PDF_TARGET) with a PDF viewer"; \
	fi

# Check for required tools
check-deps:
	@echo "Checking for required tools..."
	@command -v makeinfo >/dev/null 2>&1 || { echo "makeinfo is required but not installed"; exit 1; }
	@command -v texi2pdf >/dev/null 2>&1 || { echo "texi2pdf is required for PDF output"; }
	@echo "Dependencies satisfied"

# Help target
help:
	@echo "tmax Documentation Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  all         - Build all documentation formats (info, html, pdf)"
	@echo "  info        - Build GNU Info format"
	@echo "  html        - Build HTML format"
	@echo "  pdf         - Build PDF format (requires TeX)"
	@echo "  clean       - Remove generated files"
	@echo "  validate    - Check Texinfo syntax"
	@echo "  install-info - Install Info docs to system"
	@echo "  view-info   - View Info documentation"
	@echo "  view-html   - View HTML documentation in browser" 
	@echo "  view-pdf    - View PDF documentation"
	@echo "  check-deps  - Check for required tools"
	@echo "  help        - Show this help message"
	@echo ""
	@echo "Requirements:"
	@echo "  makeinfo    - From GNU Texinfo package"
	@echo "  texi2pdf    - From GNU Texinfo package (for PDF)"
	@echo "  TeX         - LaTeX distribution (for PDF)"

# Default help if no target specified
.DEFAULT_GOAL := help
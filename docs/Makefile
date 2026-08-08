# Documentation build system for tmax
# Requires: texinfo (makeinfo), GNU make
#
# The canonical Texinfo manuals live in docs/tmax/ (tmax.texinfo, tlisp.texinfo).
# This Makefile delegates to docs/tmax/Makefile.
#
# Note: the legacy docs/manual/ Texinfo source (Deno-era) was removed; the
# canonical manual is docs/tmax/tmax.texinfo. docs/manual/ now only holds an
# index.md redirect.

TMAX_DIR = tmax
.PHONY: all info html pdf clean validate help check-deps view-info view-html

all info html pdf clean validate help check-deps view-info view-html:
	@echo ">> docs/$(TMAX_DIR): make $@"
	@cd $(TMAX_DIR) && $(MAKE) $(MAKECMDGOALS)

.DEFAULT_GOAL := help

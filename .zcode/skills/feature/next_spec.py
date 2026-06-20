#!/usr/bin/env python3
"""Determine the next spec filename in SPEC-###-{name}.md format."""
import sys
import os
import re

def next_spec_name(specs_dir, feature_slug):
    if not os.path.isdir(specs_dir):
        print(f"SPEC-001-{feature_slug}.md")
        return

    existing = []
    for f in os.listdir(specs_dir):
        m = re.match(r"^SPEC-(\d+)-.*\.md$", f)
        if m:
            existing.append(int(m.group(1)))

    next_num = max(existing, default=0) + 1
    print(f"SPEC-{next_num:03d}-{feature_slug}.md")

if __name__ == "__main__":
    specs_dir = sys.argv[1] if len(sys.argv) > 1 else "specs"
    feature_slug = sys.argv[2] if len(sys.argv) > 2 else "untitled"
    next_spec_name(specs_dir, feature_slug)

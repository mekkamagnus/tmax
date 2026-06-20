#!/usr/bin/env python3
"""Determine the next chore filename in CHORE-##-{name}.md format."""
import sys
import os
import re

def next_chore_name(specs_dir, chore_slug):
    if not os.path.isdir(specs_dir):
        print(f"CHORE-01-{chore_slug}.md")
        return

    existing = []
    for f in os.listdir(specs_dir):
        m = re.match(r"^CHORE-(\d+)-.*\.md$", f)
        if m:
            existing.append(int(m.group(1)))

    next_num = max(existing, default=0) + 1
    print(f"CHORE-{next_num:02d}-{chore_slug}.md")

if __name__ == "__main__":
    specs_dir = sys.argv[1] if len(sys.argv) > 1 else "specs"
    chore_slug = sys.argv[2] if len(sys.argv) > 2 else "untitled"
    next_chore_name(specs_dir, chore_slug)

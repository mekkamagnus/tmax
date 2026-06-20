#!/usr/bin/env python3
"""Determine the next bug filename in BUG-##-{name}.md format."""
import sys
import os
import re

def next_bug_name(specs_dir, bug_slug):
    if not os.path.isdir(specs_dir):
        print(f"BUG-01-{bug_slug}.md")
        return

    existing = []
    for f in os.listdir(specs_dir):
        m = re.match(r"^BUG-(\d+)-.*\.md$", f)
        if m:
            existing.append(int(m.group(1)))

    next_num = max(existing, default=0) + 1
    print(f"BUG-{next_num:02d}-{bug_slug}.md")

if __name__ == "__main__":
    specs_dir = sys.argv[1] if len(sys.argv) > 1 else "specs"
    bug_slug = sys.argv[2] if len(sys.argv) > 2 else "untitled"
    next_bug_name(specs_dir, bug_slug)

#!/usr/bin/env python3
"""PreToolUse hook: validate that files written to docs/specs/ follow CHORE-##-name.md format.

Reads JSON from stdin (PreToolUse event), checks if the Write tool targets docs/specs/.
If so, validates the filename matches CHORE-##-*.md pattern.

Exit codes:
  0 - allow (not a specs/ file, or filename is valid)
  2 - block (filename doesn't match the required format)
"""
import json
import os
import re
import sys

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    if tool_name != "Write":
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path:
        sys.exit(0)

    # Normalize path separators
    file_path = file_path.replace("\\", "/")

    # Check if this is a specs/ directory file
    parts = file_path.split("/")
    if "specs" not in parts:
        sys.exit(0)

    # Get the filename
    filename = os.path.basename(file_path)

    # Must match CHORE-##-name.md (2+ digits)
    if re.match(r"^CHORE-\d{2,}-.+\.md$", filename):
        sys.exit(0)

    # Blocked — wrong format
    print(
        json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"Chore file '{filename}' must follow CHORE-##-name.md format. "
                    "Run from the project root: python3 .zcode/skills/chore/next_chore.py "
                    f"docs/specs <chore-slug> to get the correct filename."
                )
            }
        })
    )
    sys.exit(0)

if __name__ == "__main__":
    main()

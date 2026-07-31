#!/usr/bin/env python3
"""PreToolUse hook: validate files written to docs/specs/ follow a recognized spec format.

Allows BUG/SPEC/CHORE/FEATURE numbered specs and non-spec files (prd.md, *.json,
archive/*). Blocks only spec-shaped filenames (UPPERCASE-digits) with an unrecognized
prefix.
"""
import json
import os
import re
import sys

VALID_SPEC_RE = re.compile(r"^(BUG|SPEC|CHORE|FEATURE)-\d{2,}-.+\.md$")
SPEC_SHAPED_RE = re.compile(r"^[A-Z]+-\d{2,}-.+\.md$")


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    if data.get("tool_name", "") != "Write":
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path", "").replace("\\", "/")
    if not file_path or "specs" not in file_path.split("/"):
        sys.exit(0)

    filename = os.path.basename(file_path)

    if VALID_SPEC_RE.match(filename):      # valid spec format -> allow
        sys.exit(0)
    if not SPEC_SHAPED_RE.match(filename):  # not spec-shaped (prd.md, *.json, ...) -> allow
        sys.exit(0)

    # spec-shaped but unrecognized prefix -> block
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Spec file '{filename}' must follow BUG/SPEC/CHORE/FEATURE-##-name.md format."
            ),
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()

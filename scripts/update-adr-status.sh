#!/bin/bash

# Update ADR status from 006 onwards to 'proposed'

for file in adr/[0-5][0-9][0-9]-*.md; do
  # Skip files 001-005
  filename=$(basename "$file")
  number=$(echo "$filename" | cut -d'-' -f1)

  if [ "$number" -lt 6 ]; then
    echo "Skipping $file (005 and below remain as-is)"
    continue
  fi

  echo "Updating $file to 'proposed'"

  # Simply replace the status line after "## Status"
  # This handles both "**Accepted**" and "Accepted" formats
  awk '/^## Status$/ {status=1; print; getline; if (status) { print "**proposed**"; status=0; next} else print} !status {print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
done

echo "✅ Updated all ADRs from 006 onwards to 'proposed'"

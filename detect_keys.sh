#!/bin/bash
find src/pages src/components -name "*.tsx" | while read -r file; do
  grep -n "\.map(" "$file" | while read -r line; do
    line_num=$(echo "$line" | cut -d: -f1)
    # Check the next 12 lines for fragment shorthand
    if sed -n "$((line_num)),$((line_num + 12))p" "$file" | grep -q "<>"; then
      snippet=$(sed -n "$line_num,$((line_num + 12))p" "$file" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-100)
      echo "$file:$line_num: $snippet"
    fi
  done
done

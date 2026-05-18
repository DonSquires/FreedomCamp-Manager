#!/usr/bin/env bash
set -euo pipefail

MIGRATION_DIR="${1:-supabase/migrations}"

if [[ ! -d "$MIGRATION_DIR" ]]; then
  echo "ERROR: migration directory not found: $MIGRATION_DIR" >&2
  exit 1
fi

echo "Checking migrations in: $MIGRATION_DIR"

error_count=0
warn_count=0

# 1) Detect exact duplicate version prefixes (hard fail).
while IFS= read -r version; do
  [[ -z "$version" ]] && continue
  count=$(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "${version}_*.sql" | wc -l | tr -d ' ')
  if [[ "$count" -gt 1 ]]; then
    echo "ERROR: duplicate migration version prefix '$version' ($count files)."
    find "$MIGRATION_DIR" -maxdepth 1 -type f -name "${version}_*.sql" | sort
    error_count=$((error_count + 1))
  fi
done < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "*.sql" \
  | sed 's|.*/||; s|\.sql$||; s|_.*||' \
  | sort -u)

# 2) Detect short/long mixed version format for same day (warning).
while IFS= read -r file; do
  base="$(basename "$file" .sql)"
  short_prefix="${base%%_*}"
  if [[ ${#short_prefix} -eq 8 ]]; then
    matches=$(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "${short_prefix}[0-9]*_*.sql" | wc -l | tr -d ' ')
    if [[ "$matches" -gt 0 ]]; then
      echo "WARNING: short-form version '$short_prefix' coexists with timestamped variants."
      warn_count=$((warn_count + 1))
    fi
  fi
done < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "????????_*.sql" | sort)

# 3) Detect duplicate semantic stems (warning).
while IFS= read -r stem; do
  [[ -z "$stem" ]] && continue
  count=$(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "*_${stem}.sql" | wc -l | tr -d ' ')
  if [[ "$count" -gt 1 ]]; then
    echo "WARNING: duplicate semantic stem '${stem}' ($count files). Verify this is intentional."
    find "$MIGRATION_DIR" -maxdepth 1 -type f -name "*_${stem}.sql" | sort
    warn_count=$((warn_count + 1))
  fi
done < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name "*.sql" \
  | sed 's|.*/||; s|\.sql$||; s|^[0-9]\+_||' \
  | sort | uniq -d)

if [[ "$error_count" -gt 0 ]]; then
  echo "FAILED: migration integrity check found $error_count hard error(s), $warn_count warning(s)." >&2
  exit 1
fi

echo "PASSED: migration integrity check found 0 hard errors, $warn_count warning(s)."

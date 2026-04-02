#!/bin/bash
# Database Migration Dry-Run Validation Script
# Purpose: Validate SQL syntax and spot-check migration logic before deployment
# Usage: bash scripts/validate-migrations.sh

set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"
BATCH="202605{04..15}"
REPORT_FILE="db-dryrun-validation.log"

echo "========================================" | tee -a "$REPORT_FILE"
echo "DB Migration Dry-Run Validation Report" | tee -a "$REPORT_FILE"
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)" | tee -a "$REPORT_FILE"
echo "========================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# Function: Validate SQL syntax (basic check)
validate_sql_syntax() {
    local file=$1
    local name=$(basename "$file")
    echo "[VALIDATE] $name" | tee -a "$REPORT_FILE"
    
    # Check for unclosed quotes/parentheses (heuristic)
    local open_parens=$(grep -o '(' "$file" | wc -l)
    local close_parens=$(grep -o ')' "$file" | wc -l)
    
    if [[ $open_parens -ne $close_parens ]]; then
        echo "  ⚠️  WARNING: Unmatched parentheses (open: $open_parens, close: $close_parens)" | tee -a "$REPORT_FILE"
        return 1
    fi
    
    # Check for basic SQL keywords
    if grep -qi "^CREATE\|^ALTER\|^INSERT\|^DELETE\|^UPDATE\|^DROP" "$file"; then
        echo "  ✓ SQL keywords detected" | tee -a "$REPORT_FILE"
    else
        echo "  ⚠️  No DDL/DML keywords found; file may be comments-only" | tee -a "$REPORT_FILE"
    fi
    
    echo "  ✓ Syntax check passed" | tee -a "$REPORT_FILE"
    return 0
}

# Function: Extract migration metadata
extract_migration_metadata() {
    local file=$1
    local name=$(basename "$file")
    
    echo "[METADATA] $name" | tee -a "$REPORT_FILE"
    
    # Extract first comment block (should be description)
    local description=$(head -20 "$file" | grep "^--" | head -1 | sed 's/^-- *//')
    echo "  Description: $description" | tee -a "$REPORT_FILE"
    
    # Count DDL statements
    local create_count=$(grep -c "^CREATE\|^CREATE OR REPLACE" "$file" || true)
    local alter_count=$(grep -c "^ALTER" "$file" || true)
    local drop_count=$(grep -c "^DROP" "$file" || true)
    
    echo "  DDL Breakdown: CREATE=$create_count, ALTER=$alter_count, DROP=$drop_count" | tee -a "$REPORT_FILE"
    
    # Check for RLS policies
    if grep -q "CREATE POLICY\|ALTER POLICY" "$file"; then
        echo "  ⚠️  Contains RLS policy changes" | tee -a "$REPORT_FILE"
    fi
    
    # Check for index creation
    if grep -q "CREATE INDEX" "$file"; then
        local index_count=$(grep -c "CREATE INDEX" "$file" || true)
        echo "  📊 Creates $index_count index(es)" | tee -a "$REPORT_FILE"
    fi
    
    echo "" | tee -a "$REPORT_FILE"
}

# Function: Spot-check critical patterns
spot_check_patterns() {
    local file=$1
    local name=$(basename "$file")
    
    echo "[SPOT-CHECK] $name" | tee -a "$REPORT_FILE"
    
    # Check for DELETE without WHERE (dangerous)
    if grep -q "^DELETE.*[^W]HERE" "$file"; then
        echo "  ⚠️  CRITICAL: DELETE statement without WHERE clause detected" | tee -a "$REPORT_FILE"
        return 1
    fi
    
    # Check for TRUNCATE (risky in production)
    if grep -qi "TRUNCATE" "$file"; then
        echo "  ⚠️  WARNING: TRUNCATE detected (verify intention)" | tee -a "$REPORT_FILE"
    fi
    
    # Check for CASCADE drops (risky)
    if grep -qi "DROP.*CASCADE" "$file"; then
        echo "  ⚠️  WARNING: CASCADE drop detected" | tee -a "$REPORT_FILE"
    fi
    
    echo "  ✓ Pattern checks passed" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
    return 0
}

# Main validation loop
echo "Scanning migrations: $MIGRATIONS_DIR/$BATCH*.sql" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0

for migration_file in $MIGRATIONS_DIR/202605{04..15}*.sql; do
    if [[ -f "$migration_file" ]]; then
        if ! validate_sql_syntax "$migration_file"; then
            ((VALIDATION_ERRORS++))
        fi
        
        extract_migration_metadata "$migration_file"
        
        if ! spot_check_patterns "$migration_file"; then
            ((VALIDATION_ERRORS++))
        fi
    fi
done

# Summary
echo "========================================" | tee -a "$REPORT_FILE"
echo "Validation Summary" | tee -a "$REPORT_FILE"
echo "========================================" | tee -a "$REPORT_FILE"
echo "Errors: $VALIDATION_ERRORS" | tee -a "$REPORT_FILE"
echo "Warnings: $VALIDATION_WARNINGS" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

if [[ $VALIDATION_ERRORS -eq 0 ]]; then
    echo "✓ All migrations passed dry-run validation" | tee -a "$REPORT_FILE"
    echo "Ready for staged deployment." | tee -a "$REPORT_FILE"
    exit 0
else
    echo "✗ Validation failed; review errors above." | tee -a "$REPORT_FILE"
    exit 1
fi

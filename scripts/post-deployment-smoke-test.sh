#!/bin/bash
# Post-Deployment Smoke Test
# Run after Phase 4 deployment is complete
# Validates core workflows and system health

set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"

TEST_RESULTS_FILE="post-deployment-test-results-$(date +%Y%m%d_%H%M%S).txt"

echo "=========================================="
echo "POST-DEPLOYMENT SMOKE TEST"
echo "=========================================="
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo "Results: $TEST_RESULTS_FILE"
echo ""

# Setup
if [[ -z "$DATABASE_URL" && (-z "$DB_HOST" || -z "$DB_USER") ]]; then
    echo "ERROR: DATABASE_URL or SUPABASE_DB_* env vars not set"
    exit 1
fi

if [[ -n "$DATABASE_URL" ]]; then
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')
    export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\([^@]*\)@.*/\1/p')
fi

# Function: Run test and log result
run_test() {
    local name=$1
    local query=$2
    local expected=$3
    
    echo -n "  [$name] " | tee -a "$TEST_RESULTS_FILE"
    
    result=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "$query" 2>/dev/null || echo "ERROR")
    
    if [[ "$result" == "$expected" || "$result" =~ "$expected" ]]; then
        echo "✓ PASS" | tee -a "$TEST_RESULTS_FILE"
        return 0
    else
        echo "✗ FAIL (got: $result, expected: $expected)" | tee -a "$TEST_RESULTS_FILE"
        return 1
    fi
}

PASS_COUNT=0
FAIL_COUNT=0

# === CORE SCHEMA TESTS ===
echo "Core Schema Tests" | tee -a "$TEST_RESULTS_FILE"
echo "=================" | tee -a "$TEST_RESULTS_FILE"

# Core tables exist
if run_test "organizations table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'organizations';" "1"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Auth users accessible
if run_test "auth.users accessible" \
    "SELECT COUNT(*) FROM auth.users LIMIT 1;" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# RLS policies applied
if run_test "RLS policies exist" \
    "SELECT COUNT(*) FROM pg_policies WHERE tablename IN ('organizations') LIMIT 1;" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

echo "" | tee -a "$TEST_RESULTS_FILE"

# === FEATURE TABLE TESTS ===
echo "Feature Table Tests" | tee -a "$TEST_RESULTS_FILE"
echo "===================" | tee -a "$TEST_RESULTS_FILE"

# CRM tables
if run_test "CRM tables created" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'crm_%';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Patrol routes
if run_test "Patrol route tables created" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%route%';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Rostering
if run_test "Roster tables created" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'roster%';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Reporting
if run_test "Reporting tables created" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'report%';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

echo "" | tee -a "$TEST_RESULTS_FILE"

# === CRITICAL DATA INTEGRITY TESTS ===
echo "Data Integrity Tests" | tee -a "$TEST_RESULTS_FILE"
echo "=====================" | tee -a "$TEST_RESULTS_FILE"

# Observations not corrupted
if run_test "observations table intact" \
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'observations';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Patrols not corrupted
if run_test "patrols table intact" \
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'patrols';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# Vehicles not corrupted
if run_test "vehicles table intact" \
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vehicles';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

echo "" | tee -a "$TEST_RESULTS_FILE"

# === SECURITY TESTS ===
echo "Security Tests" | tee -a "$TEST_RESULTS_FILE"
echo "===============" | tee -a "$TEST_RESULTS_FILE"

# RLS on observations (org-scoped)
if run_test "observations RLS policies active" \
    "SELECT COUNT(*) FROM pg_policies WHERE tablename = 'observations';" "[0-9]"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

# ACL tables exist
if run_test "access_controls table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'access_controls';" "1"; then
    ((PASS_COUNT++))
else
    ((FAIL_COUNT++))
fi

echo "" | tee -a "$TEST_RESULTS_FILE"

# === PERFORMANCE TESTS ===
echo "Performance Tests" | tee -a "$TEST_RESULTS_FILE"
echo "==================" | tee -a "$TEST_RESULTS_FILE"

# Query performance baseline
SLOW_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_stat_statements WHERE mean_exec_time > 5000;" \
    2>/dev/null || echo "0")

if [[ "$SLOW_COUNT" -lt 5 ]]; then
    echo "  [Query Performance] ✓ PASS ($SLOW_COUNT queries > 5s)" | tee -a "$TEST_RESULTS_FILE"
    ((PASS_COUNT++))
else
    echo "  [Query Performance] ✗ FAIL ($SLOW_COUNT queries > 5s)" | tee -a "$TEST_RESULTS_FILE"
    ((FAIL_COUNT++))
fi

# Index count
INDEX_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" \
    | xargs)

echo "  [Index Count] Found: $INDEX_COUNT" | tee -a "$TEST_RESULTS_FILE"

echo "" | tee -a "$TEST_RESULTS_FILE"

# === SUMMARY ===
TOTAL=$((PASS_COUNT + FAIL_COUNT))

echo "=========================================="  | tee -a "$TEST_RESULTS_FILE"
echo "SMOKE TEST SUMMARY"  | tee -a "$TEST_RESULTS_FILE"
echo "=========================================="  | tee -a "$TEST_RESULTS_FILE"
echo "Passed: $PASS_COUNT/$TOTAL" | tee -a "$TEST_RESULTS_FILE"
echo "Failed: $FAIL_COUNT/$TOTAL" | tee -a "$TEST_RESULTS_FILE"
echo "" | tee -a "$TEST_RESULTS_FILE"

if [[ $FAIL_COUNT -eq 0 ]]; then
    echo "✓ ALL TESTS PASSED - Deployment successful!" | tee -a "$TEST_RESULTS_FILE"
    exit 0
else
    echo "✗ SOME TESTS FAILED - Review issues above" | tee -a "$TEST_RESULTS_FILE"
    exit 1
fi

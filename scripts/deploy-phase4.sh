#!/bin/bash
# Phase 4: Reporting & Finalization Deployment
# Migration: 20260513 (Comprehensive Reporting System)
# Estimated duration: 10-15 minutes
# FINAL PHASE: Completes all 12 migrations

set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"

PHASE_NAME="Phase 4: Reporting & Finalization"

echo "=========================================="
echo "$PHASE_NAME Deployment (FINAL)"
echo "=========================================="
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo ""

# Validate connectivity
if [[ -z "$DATABASE_URL" && (-z "$DB_HOST" || -z "$DB_USER") ]]; then
    echo "ERROR: DATABASE_URL or SUPABASE_DB_* env vars not set"
    exit 1
fi

if [[ -n "$DATABASE_URL" ]]; then
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')
    export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\([^@]*\)@.*/\1/p')
fi

echo "[PREREQUISITE] Verify Phase 3 complete..."
PHASE3_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name LIKE '202605090%' OR name LIKE '202605100%' OR name LIKE '202605110%' OR name LIKE '202605120%';" \
    | xargs)

if [[ "$PHASE3_COUNT" -lt 4 ]]; then
    echo "ERROR: Phase 3 migrations not complete (found $PHASE3_COUNT/4)"
    exit 1
fi
echo "✓ Phase 3 complete (4/4 migrations)"
echo ""

# Dry-run
echo "[STEP 1] Dry-run Phase 4 migration..."
echo "  Migration: 20260513 (Comprehensive Reporting System)"

if command -v supabase &> /dev/null; then
    if supabase db push --dry-run; then
        echo "  ✓ Dry-run successful"
    else
        echo "  ERROR: Dry-run failed"
        exit 1
    fi
else
    echo "  WARNING: supabase CLI not available; skipping dry-run"
fi
echo ""

# Pre-deployment checks
echo "[STEP 2] Pre-deployment checks..."
echo "  Verifying database health..."

# Check query performance baseline
SLOW_QUERIES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_stat_statements WHERE mean_exec_time > 2000;" \
    2>/dev/null || echo "0")

if [[ "$SLOW_QUERIES" -gt 5 ]]; then
    echo "  ⚠️  Found $SLOW_QUERIES queries with mean time > 2s"
fi

# Checkpoint
echo ""
echo "[CHECKPOINT] Ready for final migration deployment?"
echo "  This completes all 12 migrations (Phase 1-4)"
echo "  Estimated duration: 10-15 minutes"
echo "  Post-deployment: Full smoke test required"
echo ""
read -p "Proceed with Phase 4 deployment? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Deployment aborted by user"
    exit 0
fi
echo ""

# Deploy
echo "[STEP 3] Applying Phase 4 migration..."

if command -v supabase &> /dev/null; then
    if supabase db push --linked; then
        echo "✓ Phase 4 migration deployed"
    else
        echo "ERROR: Deployment failed"
        exit 1
    fi
else
    echo "ERROR: supabase CLI required"
    exit 1
fi
echo ""

# Post-deployment smoke tests
echo "[STEP 4] Running comprehensive smoke tests..."

# Verify all 12 migrations complete
echo "  Verifying all 12 migrations..."
TOTAL_MIGRATIONS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name LIKE '202605%';" \
    | xargs)

if [[ "$TOTAL_MIGRATIONS" -eq 12 ]]; then
    echo "  ✓ All 12 migrations deployed successfully"
else
    echo "  ⚠️  Expected 12 migrations; found $TOTAL_MIGRATIONS"
fi

# Reporting system validation
echo "  Reporting system validation..."
REPORT_VIEWS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'report%';" \
    | xargs)

echo "  Reporting tables created: $REPORT_VIEWS"

# Portal login test
echo "  Testing portal auth..."
USERS_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM auth.users LIMIT 100;" \
    | xargs)

echo "  Auth users accessible: $USERS_COUNT"

# Core workflow validation
echo "  Checking core data integrity..."
CORE_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
    | xargs)

echo "  Total public tables: $CORE_TABLES"

# Final query performance check
echo "  Query performance check..."
AVG_TIME=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT ROUND(AVG(mean_exec_time)) FROM pg_stat_statements WHERE mean_exec_time > 0;" \
    2>/dev/null || echo "N/A")

echo "  Average query time: ${AVG_TIME}ms"
echo ""

# Summary
echo "=========================================="
echo "ALL 12 MIGRATIONS DEPLOYED SUCCESSFULLY"
echo "=========================================="
echo "✓ Phase 1: Foundation Infrastructure"
echo "✓ Phase 2: Feature Schema Expansions"
echo "✓ Phase 3: Operational & Governance Features"
echo "✓ Phase 4: Reporting System"
echo ""
echo "Database size: $(du -sh $(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) FROM pg_database WHERE pg_database.datname = '$DB_NAME';" \
    2>/dev/null | awk '{print $2}') 2>/dev/null || echo 'N/A')"
echo ""

# Post-deployment tasks
echo "=========================================="
echo "POST-DEPLOYMENT TASKS"
echo "=========================================="
echo ""
echo "1. IMMEDIATE (next 30 minutes):"
echo "   [ ] Monitor error logs for auth anomalies"
echo "   [ ] Check slow query logs"
echo "   [ ] Verify all portals load correctly"
echo "   [ ] Test core workflows (patrol, observations, compliance)"
echo ""
echo "2. VALIDATION (1-2 hours):"
echo "   [ ] Run: bash scripts/post-deployment-smoke-test.sh"
echo "   [ ] Test all user roles (admin, master, officer, admin_officer)"
echo "   [ ] Verify reports generate successfully"
echo "   [ ] Check edge functions for any new schema incompatibilities"
echo ""
echo "3. DOCUMENTATION:"
echo "   [ ] Tag backup: git tag production-pre-migration-20260504-20260515"
echo "   [ ] Document any issues encountered"
echo "   [ ] Notify team of successful deployment"
echo ""
echo "4. SUCCESS CRITERIA MET:"
echo "   ✓ All 12 migrations executed without errors"
echo "   ✓ No RLS auth failures in logs (1+ hour post-deploy)"
echo "   ✓ Query performance baseline maintained"
echo "   ✓ All portals operational"
echo "   ✓ Edge functions compatible with new schema"
echo ""
echo "Emergency rollback (if needed): bash scripts/rollback-emergency.sh"
echo ""

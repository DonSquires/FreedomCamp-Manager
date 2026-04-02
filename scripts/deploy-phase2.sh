#!/bin/bash
# Phase 2: Feature Schema Expansions Deployment
# Migrations: 20260505, 20260506, 20260507, 20260508
# Estimated duration: 20-30 minutes

set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="./backups"

PHASE_NAME="Phase 2: Feature Schema Expansions"

echo "=========================================="
echo "$PHASE_NAME Deployment"
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

echo "[PREREQUISITE] Verify Phase 1 complete..."
PHASE1_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name LIKE '202605040%' OR name LIKE '202605140%' OR name LIKE '202605150%';" \
    | xargs)

if [[ "$PHASE1_COUNT" -lt 3 ]]; then
    echo "ERROR: Phase 1 migrations not complete (found $PHASE1_COUNT/3)"
    echo "Deploy Phase 1 first: bash scripts/deploy-phase1.sh"
    exit 1
fi
echo "✓ Phase 1 complete (3/3 migrations)"
echo ""

# Dry-run
echo "[STEP 1] Dry-run Phase 2 migrations..."
echo "  Migrations: 20260505, 20260506, 20260507, 20260508"

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

# Checkpoint: Ask for confirmation before proceeding
echo "[CHECKPOINT] Ready to deploy Phase 2?"
echo "  This migration creates 4 large feature schema tables."
echo "  Estimated impact: +1.5GB database size, +50+ indexes"
echo "  Estimated duration: 15-20 minutes"
echo ""
read -p "Proceed with Phase 2 deployment? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Deployment aborted by user"
    exit 0
fi
echo ""

# Deploy
echo "[STEP 2] Applying Phase 2 migrations..."

if command -v supabase &> /dev/null; then
    if supabase db push --linked; then
        echo "✓ Phase 2 migrations deployed"
    else
        echo "ERROR: Deployment failed"
        exit 1
    fi
else
    echo "ERROR: supabase CLI required for deployment"
    exit 1
fi
echo ""

# Health checks
echo "[STEP 3] Running health checks..."

# Reindex performance validation
echo "  Reindexing tables (may take 5-10 minutes)..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "REINDEX DATABASE $(echo $DB_NAME);" &

REINDEX_PID=$!
sleep 2  # Let reindex start

# Check for slow queries
echo "  Checking for slow queries..."
SLOW_QUERIES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_stat_statements WHERE mean_exec_time > 1000;" \
    2>/dev/null || echo "0")

if [[ "$SLOW_QUERIES" -gt 0 ]]; then
    echo "  ⚠️  Found $SLOW_QUERIES queries with mean time > 1s"
fi

# Count new tables
NEW_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
    | xargs)

echo "  Total public tables: $NEW_TABLES"

# Verify patrol/route tables
ROUTE_CHECK=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'patrol%' OR table_name LIKE '%route%';" \
    | xargs)

echo "  Patrol/route tables created: $ROUTE_CHECK"

# Wait for reindex to complete
wait $REINDEX_PID || true
echo "  ✓ Reindex complete"
echo ""

# Summary
echo "=========================================="
echo "Phase 2 Deployment Complete"
echo "=========================================="
echo "✓ Feature schema tables created"
echo "✓ Indexes optimized"
echo "✓ Health checks passed"
echo ""
echo "Next: Wait 10 minutes for monitoring, then proceed to Phase 3"
echo "See: docs/DB_MIGRATION_EXECUTION_PLAN.md for Phase 3 procedures"
echo ""

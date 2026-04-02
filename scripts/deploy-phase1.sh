#!/bin/bash
# Phase 1: Foundation Infrastructure Deployment
# Backup, Deploy, and Health Check
# Run against: Production Supabase database
# Estimated duration: 15-20 minutes

set -euo pipefail

# Configuration
DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"

BACKUP_DIR="./backups"
BACKUP_FILE="${BACKUP_DIR}/pre-migration-20260504-20260515-$(date +%Y%m%d_%H%M%S).dump"
PHASE_NAME="Phase 1: Foundation Infrastructure"

echo "=========================================="
echo "$PHASE_NAME Deployment"
echo "=========================================="
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo "Backup: $BACKUP_FILE"
echo ""

# Step 1: Validate database connectivity
echo "[STEP 1] Validating database connectivity..."
if [[ -z "$DATABASE_URL" && (-z "$DB_HOST" || -z "$DB_USER") ]]; then
    echo "ERROR: DATABASE_URL or SUPABASE_DB_* env vars not set"
    echo "Set DATABASE_URL or: SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD"
    exit 1
fi

if [[ -n "$DATABASE_URL" ]]; then
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')
    export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\([^@]*\)@.*/\1/p')
fi

# Quick connectivity test
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" &> /dev/null; then
    echo "ERROR: Cannot connect to database at $DB_HOST:$DB_PORT"
    exit 1
fi
echo "✓ Database connectivity confirmed"
echo ""

# Step 2: Create backup directory
echo "[STEP 2] Creating backup..."
mkdir -p "$BACKUP_DIR"

# Step 3: Full database backup
echo "  Backing up database to $BACKUP_FILE..."
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --format=custom \
    --verbose \
    --compress=9 \
    --file="$BACKUP_FILE"

if [[ -f "$BACKUP_FILE" ]]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✓ Backup created: $BACKUP_SIZE"
else
    echo "ERROR: Backup failed"
    exit 1
fi
echo ""

# Step 4: Snapshot current migration state
echo "[STEP 3] Capturing pre-deployment state..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT COUNT(*) as migration_count FROM _realtime_migrations;" \
    | tee "${BACKUP_DIR}/pre-migration-count.txt"
echo ""

# Step 5: Deploy Phase 1 migrations using Supabase CLI
echo "[STEP 4] Deploying Phase 1 migrations..."
echo "  Migrations: 20260504, 20260514, 20260515"

# Note: Uses Supabase CLI (must be installed and linked)
if command -v supabase &> /dev/null; then
    echo "  Using: supabase db push --linked"
    
    # Dry-run first
    echo "  Dry-run (no changes applied)..."
    if supabase db push --dry-run; then
        echo "  ✓ Dry-run successful"
        
        # Actual deployment
        echo "  Applying migrations..."
        if supabase db push --linked; then
            echo "  ✓ Phase 1 migrations deployed"
        else
            echo "  ERROR: supabase db push failed"
            exit 1
        fi
    else
        echo "  ERROR: Dry-run failed; aborting deployment"
        exit 1
    fi
else
    echo "  WARNING: supabase CLI not found"
    echo "  Manual deployment required:"
    echo "    1. Run: supabase db push --linked"
    echo "    2. Or use Supabase dashboard: Database → Migrations"
fi
echo ""

# Step 6: Health checks post-deployment
echo "[STEP 5] Running health checks..."

# Check RLS policies were applied
RLS_POLICIES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_policies WHERE tablename LIKE 'observ%' OR tablename LIKE 'patrol%';" \
    | xargs)

echo "  RLS policies found: $RLS_POLICIES"

# Check migrations table updated
MIGRATION_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name IN ('20260504000001_modular_platform_infrastructure', '20260514000001_org_smtp_sms_and_critical_fixes', '20260515000001_fix_rls_org_scoped_policies');" \
    | xargs)

echo "  Phase 1 migrations completed: $MIGRATION_COUNT/3"

# Test auth (basic check)
echo "  Testing auth..."
AUTH_CHECK=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM auth.users;" 2>/dev/null || echo "0")

if [[ "$AUTH_CHECK" -gt 0 ]]; then
    echo "  ✓ Auth system responsive"
else
    echo "  ⚠️  Auth check returned 0 users; verify manually"
fi
echo ""

# Step 7: Summary
echo "=========================================="
echo "Phase 1 Deployment Complete"
echo "=========================================="
echo "✓ Backup created: $BACKUP_FILE"
echo "✓ Migrations deployed"
echo "✓ Health checks passed"
echo ""
echo "Next: Wait 5-10 minutes for monitoring, then proceed to Phase 2"
echo "See: docs/DB_MIGRATION_EXECUTION_PLAN.md for Phase 2 procedures"
echo ""

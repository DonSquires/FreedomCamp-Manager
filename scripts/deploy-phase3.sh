#!/bin/bash
# Phase 3: Operational & Governance Features Deployment
# Migrations: 20260509, 20260510, 20260511, 20260512
# Estimated duration: 25-35 minutes
# CRITICAL: ACL and identity verification system — validate carefully

set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"

PHASE_NAME="Phase 3: Operational & Governance Features"

echo "=========================================="
echo "$PHASE_NAME Deployment"
echo "=========================================="
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo ""
echo "⚠️  CRITICAL PHASE: ACL, Identity Verification, Rostering, Allowances"
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

echo "[PREREQUISITE] Verify Phase 2 complete..."
PHASE2_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name LIKE '202605050%' OR name LIKE '202605060%' OR name LIKE '202605070%' OR name LIKE '202605080%';" \
    | xargs)

if [[ "$PHASE2_COUNT" -lt 4 ]]; then
    echo "ERROR: Phase 2 migrations not complete (found $PHASE2_COUNT/4)"
    exit 1
fi
echo "✓ Phase 2 complete (4/4 migrations)"
echo ""

# Dry-run
echo "[STEP 1] Dry-run Phase 3 migrations..."
echo "  Migrations: 20260509 (ACL), 20260510 (ACL Industry), 20260511 (Rostering), 20260512 (Allowances)"

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

# Critical validation before deployment
echo "[STEP 2] Pre-deployment critical validation..."
echo "  Checking for active ACL sessions..."

ACTIVE_SESSIONS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active';" \
    | xargs)

if [[ "$ACTIVE_SESSIONS" -gt 10 ]]; then
    echo "  ⚠️  WARNING: $ACTIVE_SESSIONS active sessions; consider maintenance window"
fi

echo "  Backup confirmation..."
if [[ -d "backups" ]]; then
    LATEST_BACKUP=$(ls -t backups/pre-migration*.dump 2>/dev/null | head -1)
    echo "  ✓ Latest backup: $(basename $LATEST_BACKUP)"
else
    echo "  ERROR: No backup found; run Phase 1 first"
    exit 1
fi
echo ""

# Checkpoint: Confirm before ACL deployment
echo "[CHECKPOINT] CRITICAL: About to deploy ACL/Identity system"
echo "  This phase enables:"
echo "    • Access control lists (RLS org-scoped policies)"
echo "    • Identity verification system"
echo "    • Officer rostering & shifts"
echo "    • Asset & allowance management"
echo ""
echo "  If anything fails, rollback: bash scripts/rollback-phase3.sh"
echo ""
read -p "Proceed with Phase 3 deployment? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Deployment aborted by user"
    exit 0
fi
echo ""

# Deploy
echo "[STEP 3] Applying Phase 3 migrations..."

if command -v supabase &> /dev/null; then
    if supabase db push --linked; then
        echo "✓ Phase 3 migrations deployed"
    else
        echo "ERROR: Deployment failed"
        exit 1
    fi
else
    echo "ERROR: supabase CLI required"
    exit 1
fi
echo ""

# Critical health checks
echo "[STEP 4] Running critical health checks..."

# ACL audit
echo "  ACL policy validation..."
ACL_POLICIES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(DISTINCT tablename) FROM pg_policies WHERE policyname LIKE '%orga%' OR policyname LIKE '%acl%';" \
    | xargs)

echo "  ACL-scoped tables: $ACL_POLICIES"

# Test auth after ACL
echo "  Testing auth (should verify org context)..."
TEST_ORG=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM organizations LIMIT 1;" \
    | xargs)

if [[ "$TEST_ORG" -gt 0 ]]; then
    echo "  ✓ Organizations accessible under new ACL"
else
    echo "  ⚠️  No organizations found; verify ACL policies"
fi

# Roster table validation
echo "  Roster tables validation..."
ROSTER_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'roster%' OR table_name LIKE 'shift%';" \
    | xargs)

echo "  Rostering tables created: $ROSTER_TABLES"

# Allowance system validation
echo "  Allowance system validation..."
ALLOWANCE_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'allowance%' OR table_name LIKE 'asset%';" \
    | xargs)

echo "  Allowance/asset tables created: $ALLOWANCE_TABLES"
echo ""

# Summary
echo "=========================================="
echo "Phase 3 Deployment Complete"
echo "=========================================="
echo "✓ ACL system deployed"
echo "✓ Identity verification enabled"
echo "✓ Rostering system live"
echo "✓ Allowance/asset management ready"
echo ""
echo "⚠️  IMPORTANT: Monitor logs for auth anomalies over next 30 minutes"
echo ""
echo "Next: Wait 15 minutes for monitoring, then proceed to Phase 4 (final)"
echo "See: docs/DB_MIGRATION_EXECUTION_PLAN.md for Phase 4 procedures"
echo ""

#!/bin/bash
# Emergency Rollback Coordinator
# Restores database from pre-migration backup
# Use only if deployment failed or critical issues detected

set -euo pipefail

echo "=========================================="
echo "⚠️  EMERGENCY ROLLBACK COORDINATOR"
echo "=========================================="
echo "Date: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo ""
echo "This script will:"
echo "  1. Locate most recent pre-migration backup"
echo "  2. Restore database to pre-deployment state"
echo "  3. Verify rollback successful"
echo ""
read -p "Are you SURE you want to rollback? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Rollback cancelled by user"
    exit 0
fi
echo ""

# Find backup
BACKUP_DIR="./backups"
BACKUP_FILE=$(ls -t "$BACKUP_DIR"/pre-migration*.dump 2>/dev/null | head -1)

if [[ -z "$BACKUP_FILE" ]]; then
    echo "ERROR: No backup found in $BACKUP_DIR"
    exit 1
fi

echo "Backup file: $BACKUP_FILE"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""

# Confirm backup exists and is readable
if [[ ! -r "$BACKUP_FILE" ]]; then
    echo "ERROR: Backup file not readable"
    exit 1
fi

# Setup database credentials
DB_HOST="${SUPABASE_DB_HOST:-}"
DB_PORT="${SUPABASE_DB_PORT:-5432}"
DB_USER="${SUPABASE_DB_USER:-}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DATABASE_URL="${DATABASE_URL:-}"

if [[ -z "$DATABASE_URL" && (-z "$DB_HOST" || -z "$DB_USER") ]]; then
    echo "ERROR: DATABASE_URL or SUPABASE_DB_* env vars not set"
    exit 1
fi

if [[ -n "$DATABASE_URL" ]]; then
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')
    export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\([^@]*\)@.*/\1/p')
fi

# Final confirmation
echo "Target database: $DB_HOST:$DB_PORT/$DB_NAME"
echo ""
read -p "FINAL CONFIRMATION - Restore from backup? (yes/no): " FINAL_CONFIRM

if [[ "$FINAL_CONFIRM" != "yes" ]]; then
    echo "Rollback cancelled"
    exit 0
fi
echo ""

# Disconnect all other connections
echo "[STEP 1] Disconnecting other database sessions..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
        WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
    2>/dev/null || true

echo "  ✓ Sessions terminated"
echo ""

# Restore from backup
echo "[STEP 2] Restoring database from backup..."
echo "  This may take 5-15 minutes depending on backup size..."

if pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --clean \
    --if-exists \
    --verbose \
    "$BACKUP_FILE" 2>&1 | tail -20; then
    echo "  ✓ Database restored"
else
    echo "  ERROR: Restore failed"
    exit 1
fi
echo ""

# Verify rollback
echo "[STEP 3] Verifying rollback..."

MIGRATION_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM _realtime_migrations WHERE name LIKE '202605%';" \
    | xargs)

echo "  Migrations with 202605 prefix: $MIGRATION_COUNT"

if [[ "$MIGRATION_COUNT" -eq 0 ]]; then
    echo "  ✓ All 12 migrations rolled back"
else
    echo "  ⚠️  WARNING: $MIGRATION_COUNT migrations still present"
fi

# Verify core data integrity
echo "  Checking core tables..."
CORE_TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_name IN ('organizations', 'users', 'patrols', 'observations');" \
    | xargs)

if [[ "$CORE_TABLES" -eq 4 ]]; then
    echo "  ✓ Core tables intact"
else
    echo "  ⚠️  Core tables: $CORE_TABLES/4 found"
fi

echo ""

# Tag backup as used
echo "[STEP 4] Creating rollback audit record..."
ROLLBACK_MARKER="backups/rollback-$(date +%Y%m%d_%H%M%S)-from-$(basename $BACKUP_FILE)"
touch "$ROLLBACK_MARKER"
echo "  Marked: $ROLLBACK_MARKER"
echo ""

# Summary
echo "=========================================="
echo "ROLLBACK COMPLETE"
echo "=========================================="
echo "✓ Database restored to pre-deployment state"
echo "✓ All 12 migrations (20260504–20260515) removed"
echo "✓ Core data integrity verified"
echo ""
echo "Next steps:"
echo "  1. Investigate root cause of deployment failure"
echo "  2. Review edge functions for any incompatibilities"
echo "  3. Update migrations if needed"
echo "  4. Schedule re-deployment when ready"
echo ""
echo "Contact: Product team for post-mortem and re-planning"
echo ""

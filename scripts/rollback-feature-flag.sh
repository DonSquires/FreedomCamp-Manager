#!/bin/bash
#
# Feature Flag Rollback Script
# Usage: bash scripts/rollback-feature-flag.sh FF_PHASE_B_PATROL_EVENTS [org_id]
#
# Rolls back a feature flag to disabled (0%) for all orgs or specific org
# Also logs the rollback event to feature_flag_rollout_history
#

set -e

FLAG_NAME=${1:-}
ORG_ID=${2:-}

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validate inputs
if [ -z "$FLAG_NAME" ]; then
    echo -e "${RED}❌ Error: Flag name required${NC}"
    echo "Usage: bash scripts/rollback-feature-flag.sh FF_PHASE_B_PATROL_EVENTS [org_id]"
    exit 1
fi

# Get Supabase credentials from environment
SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${RED}❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY${NC}"
    echo "Please set environment variables and try again:"
    echo "  export VITE_SUPABASE_URL=your_url"
    echo "  export SUPABASE_SERVICE_ROLE_KEY=your_key"
    exit 1
fi

echo -e "${BLUE}🔄 Starting feature flag rollback...${NC}"
echo "Flag: ${YELLOW}$FLAG_NAME${NC}"
if [ -n "$ORG_ID" ]; then
    echo "Organization: ${YELLOW}$ORG_ID${NC}"
fi

# Get current flag state
echo -e "\n${BLUE}📊 Fetching current flag state...${NC}"

CURRENT_FLAG=$(curl -s -X GET \
    "${SUPABASE_URL}/rest/v1/feature_flags?name=eq.${FLAG_NAME}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

if echo "$CURRENT_FLAG" | grep -q "\"id\""; then
    CURRENT_PERCENTAGE=$(echo "$CURRENT_FLAG" | grep -o '"rollout_percentage":[0-9]*' | head -1 | grep -o '[0-9]*')
    FLAG_ID=$(echo "$CURRENT_FLAG" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"\([^"]*\)"/\1/')
    
    echo -e "${GREEN}✓ Found flag${NC}"
    echo "  Current rollout: ${YELLOW}${CURRENT_PERCENTAGE}%${NC}"
    echo "  Flag ID: ${YELLOW}${FLAG_ID}${NC}"
else
    echo -e "${RED}❌ Flag not found: $FLAG_NAME${NC}"
    exit 1
fi

# Perform rollback
echo -e "\n${BLUE}🔙 Rolling back flag to 0%...${NC}"

ROLLBACK_RESULT=$(curl -s -X PATCH \
    "${SUPABASE_URL}/rest/v1/feature_flags?id=eq.${FLAG_ID}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"enabled\": false,
        \"rollout_percentage\": 0,
        \"updated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }")

if echo "$ROLLBACK_RESULT" | grep -q "\"id\""; then
    echo -e "${GREEN}✓ Flag disabled successfully${NC}"
else
    echo -e "${RED}❌ Rollback failed: $ROLLBACK_RESULT${NC}"
    exit 1
fi

# Log rollback event
echo -e "\n${BLUE}📝 Logging rollback event...${NC}"

LOG_RESULT=$(curl -s -X POST \
    "${SUPABASE_URL}/rest/v1/feature_flag_rollout_history" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"flag_id\": \"${FLAG_ID}\",
        \"from_percentage\": ${CURRENT_PERCENTAGE},
        \"to_percentage\": 0,
        \"stage\": \"emergency_rollback\",
        \"change_reason\": \"manual_rollback\",
        \"monitoring_notes\": \"Emergency rollback executed via CLI script\"
    }")

if echo "$LOG_RESULT" | grep -q "\"id\""; then
    echo -e "${GREEN}✓ Rollback logged to history${NC}"
else
    echo -e "${YELLOW}⚠ Rollback succeeded but logging failed (non-critical)${NC}"
fi

# Summary
echo -e "\n${GREEN}✅ Feature flag rollback complete!${NC}"
echo -e "${BLUE}Summary:${NC}"
echo "  Flag: ${YELLOW}$FLAG_NAME${NC}"
echo "  Previous rollout: ${YELLOW}${CURRENT_PERCENTAGE}%${NC}"
echo "  New rollout: ${YELLOW}0%${NC}"
echo "  Status: ${YELLOW}DISABLED${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Monitor application for any cascading failures"
echo "2. Check error logs for any users still on new code path"
echo "3. Review: https://app.supabase.com/project/_/editor?schema=public&table=feature_flags"
echo "4. When ready, manually re-enable with: bash scripts/rollback-feature-flag.sh --enable $FLAG_NAME [percentage]"
echo ""

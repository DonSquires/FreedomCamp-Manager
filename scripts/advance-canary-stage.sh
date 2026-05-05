#!/bin/bash
#
# Canary Stage Advance Script
# Usage: bash scripts/advance-canary-stage.sh FF_PHASE_B_PATROL_EVENTS [target_pct] [org_id]
#
# Advances a feature flag through the defined canary stages:
#   0% → 5% (canary) → 25% (early_adopters) → 50% (rollout) → 100% (general_availability)
#
# When target_pct is omitted the script automatically promotes to the next stage.
# Each stage transition is recorded in feature_flag_rollout_history.
#
# Prerequisites:
#   export VITE_SUPABASE_URL=https://your-project.supabase.co
#   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
#
# See also: scripts/rollback-feature-flag.sh (emergency rollback to 0%)
#

set -e

FLAG_NAME=${1:-}
TARGET_PCT=${2:-}   # optional – omit to auto-detect next stage
ORG_ID=${3:-}       # optional – reserved for future org-scoped rollout

# ── Colour codes ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Stage definitions (ordered) ───────────────────────────────────────────────
# Format: "pct:stage_name"
STAGES=("5:canary" "25:early_adopters" "50:rollout" "100:general_availability")

# ── Helpers ───────────────────────────────────────────────────────────────────
usage() {
  echo "Usage: bash scripts/advance-canary-stage.sh <FLAG_NAME> [target_pct] [org_id]"
  echo ""
  echo "  FLAG_NAME    Feature flag name (e.g. FF_PHASE_B_PATROL_EVENTS)"
  echo "  target_pct   Target rollout percentage: 5 | 25 | 50 | 100 (default: next stage)"
  echo "  org_id       Optional org UUID for future org-scoped rollouts"
  echo ""
  echo "Examples:"
  echo "  bash scripts/advance-canary-stage.sh FF_PHASE_B_PATROL_EVENTS        # promote to next stage"
  echo "  bash scripts/advance-canary-stage.sh FF_PHASE_B_PATROL_EVENTS 25     # jump to early_adopters"
  echo "  bash scripts/advance-canary-stage.sh FF_PHASE_B_ENFORCEMENT_TIMELINE  # auto-promote"
  exit 1
}

stage_name_for_pct() {
  local pct=$1
  for entry in "${STAGES[@]}"; do
    local p="${entry%%:*}"
    local name="${entry##*:}"
    if [ "$p" = "$pct" ]; then
      echo "$name"
      return
    fi
  done
  echo "custom_${pct}pct"
}

next_stage_for_pct() {
  local current=$1
  local prev=0
  for entry in "${STAGES[@]}"; do
    local p="${entry%%:*}"
    if [ "$prev" = "$current" ]; then
      echo "$p"
      return
    fi
    prev="$p"
  done
  # If current is 0 return the first stage
  if [ "$current" = "0" ]; then
    echo "${STAGES[0]%%:*}"
    return
  fi
  echo ""
}

# ── Validate inputs ────────────────────────────────────────────────────────────
if [ -z "$FLAG_NAME" ]; then
  echo -e "${RED}❌ Error: FLAG_NAME is required${NC}"
  usage
fi

if [ -n "$TARGET_PCT" ] && ! [[ "$TARGET_PCT" =~ ^[0-9]+$ ]]; then
  echo -e "${RED}❌ Error: target_pct must be a number (0-100)${NC}"
  usage
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY${NC}"
  echo "  export VITE_SUPABASE_URL=https://your-project.supabase.co"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key"
  exit 1
fi

# ── Fetch current flag state ───────────────────────────────────────────────────
echo -e "${BLUE}📊 Fetching flag state for ${YELLOW}${FLAG_NAME}${BLUE}...${NC}"

CURRENT_FLAG=$(curl -sf -X GET \
  "${SUPABASE_URL}/rest/v1/feature_flags?name=eq.${FLAG_NAME}&select=id,name,enabled,rollout_percentage,phase" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept: application/json")

if [ -z "$CURRENT_FLAG" ] || ! echo "$CURRENT_FLAG" | grep -q '"id"'; then
  echo -e "${RED}❌ Flag not found: ${FLAG_NAME}${NC}"
  echo "   Check the flag name and ensure it exists in the feature_flags table."
  exit 1
fi

FLAG_ID=$(echo "$CURRENT_FLAG" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"\([^"]*\)"/\1/')
CURRENT_PCT=$(echo "$CURRENT_FLAG" | grep -o '"rollout_percentage":[0-9]*' | head -1 | grep -o '[0-9]*')
CURRENT_ENABLED=$(echo "$CURRENT_FLAG" | grep -o '"enabled":[^,}]*' | head -1 | sed 's/"enabled"://')
CURRENT_PHASE=$(echo "$CURRENT_FLAG" | grep -o '"phase":"[^"]*"' | head -1 | sed 's/"phase":"\([^"]*\)"/\1/')

echo -e "${GREEN}✓ Found flag${NC}"
echo "  ID:      ${CYAN}${FLAG_ID}${NC}"
echo "  Phase:   ${CYAN}${CURRENT_PHASE}${NC}"
echo "  Enabled: ${CYAN}${CURRENT_ENABLED}${NC}"
echo "  Current: ${YELLOW}${CURRENT_PCT}%${NC}"

# ── Determine target percentage ────────────────────────────────────────────────
if [ -z "$TARGET_PCT" ]; then
  TARGET_PCT=$(next_stage_for_pct "$CURRENT_PCT")
  if [ -z "$TARGET_PCT" ]; then
    echo -e "${YELLOW}⚠ Flag is already at 100% (general availability). Nothing to advance.${NC}"
    exit 0
  fi
  echo -e "  Auto-detected next stage: ${CYAN}${TARGET_PCT}%${NC}"
fi

if [ "$TARGET_PCT" -le "$CURRENT_PCT" ] && [ "$CURRENT_PCT" -ne "0" ]; then
  echo -e "${YELLOW}⚠ Target ${TARGET_PCT}% is not greater than current ${CURRENT_PCT}%. Use rollback-feature-flag.sh to decrease.${NC}"
  exit 1
fi

STAGE_NAME=$(stage_name_for_pct "$TARGET_PCT")

echo ""
echo -e "${BLUE}📈 Advancing:${NC} ${YELLOW}${CURRENT_PCT}%${NC} → ${GREEN}${TARGET_PCT}%${NC} (${STAGE_NAME})"

# ── Canary threshold reminder ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}📋 Phase B canary thresholds (monitor before advancing further):${NC}"
echo "   Error rate:   < 1.0% (auto-rollback trigger)"
echo "   p95 latency:  < 500ms (auto-rollback trigger)"
echo ""

# ── Confirm before advancing past canary ──────────────────────────────────────
if [ "$TARGET_PCT" -gt 5 ] && [ -t 0 ]; then
  echo -e "${YELLOW}⚠  Advancing beyond canary (5%). Confirm thresholds have been verified.${NC}"
  read -r -p "Continue? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Aborted.${NC}"
    exit 1
  fi
fi

# ── Apply the percentage update ────────────────────────────────────────────────
PATCH_RESULT=$(curl -sf -X PATCH \
  "${SUPABASE_URL}/rest/v1/feature_flags?id=eq.${FLAG_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"enabled\": true,
    \"rollout_percentage\": ${TARGET_PCT},
    \"updated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }")

if ! echo "$PATCH_RESULT" | grep -q '"id"'; then
  echo -e "${RED}❌ Failed to update flag: ${PATCH_RESULT}${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Flag updated to ${TARGET_PCT}%${NC}"

# ── Record rollout history ─────────────────────────────────────────────────────
echo -e "${BLUE}📝 Recording rollout history...${NC}"

LOG_RESULT=$(curl -sf -X POST \
  "${SUPABASE_URL}/rest/v1/feature_flag_rollout_history" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"flag_id\": \"${FLAG_ID}\",
    \"from_percentage\": ${CURRENT_PCT},
    \"to_percentage\": ${TARGET_PCT},
    \"stage\": \"${STAGE_NAME}\",
    \"change_reason\": \"manual_increase\",
    \"monitoring_notes\": \"Stage advance via advance-canary-stage.sh at $(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }")

if echo "$LOG_RESULT" | grep -q '"id"'; then
  echo -e "${GREEN}✓ Rollout history recorded${NC}"
else
  echo -e "${YELLOW}⚠ Stage advance succeeded but history logging failed (non-critical)${NC}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Canary stage advanced successfully!${NC}"
echo -e "${BLUE}Summary:${NC}"
echo "  Flag:         ${YELLOW}${FLAG_NAME}${NC}"
echo "  Previous:     ${YELLOW}${CURRENT_PCT}%${NC}"
echo "  New rollout:  ${GREEN}${TARGET_PCT}% (${STAGE_NAME})${NC}"
echo "  Status:       ${GREEN}ENABLED${NC}"
echo ""

if [ "$TARGET_PCT" -lt 100 ]; then
  NEXT_ADVANCE=$(next_stage_for_pct "$TARGET_PCT")
  if [ -n "$NEXT_ADVANCE" ]; then
    echo -e "${BLUE}Next stage:${NC} ${CYAN}${NEXT_ADVANCE}%${NC} — monitor error rate and p95 latency before advancing."
    echo "  bash scripts/advance-canary-stage.sh ${FLAG_NAME} ${NEXT_ADVANCE}"
  fi
else
  echo -e "${GREEN}🎉 General availability reached (100%). Phase B feature fully rolled out.${NC}"
fi

echo ""
echo -e "${BLUE}Emergency rollback:${NC}"
echo "  bash scripts/rollback-feature-flag.sh ${FLAG_NAME}"
echo ""

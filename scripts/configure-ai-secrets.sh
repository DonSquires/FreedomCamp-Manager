#!/usr/bin/env bash
# =============================================================================
# configure-ai-secrets.sh
#
# Interactive script to configure Supabase Edge Function secrets for AI services.
# This fixes the "AI service not connecting" issue by setting required secrets.
#
# Prerequisites:
#   - Supabase CLI installed: brew install supabase/tap/supabase
#   - Logged in: supabase login
#
# Usage:
#   ./scripts/configure-ai-secrets.sh
#
# Required secrets to fix AI service connection:
#   - INFERENCE_SERVICE_URL (Railway inference service URL)
#   - GITHUB_TOKEN or OPENAI_API_KEY (for AI chat functionality)
#
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project configuration
PROJECT_REF="kxwjcupuxnnbnzcgmkoi"
RAILWAY_INFERENCE_URL_DEFAULT="https://orc-ai-inference-service-production.up.railway.app"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       FieldOps Manager - AI Service Configuration        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI not installed.${NC}"
    echo "Install with: brew install supabase/tap/supabase"
    echo "Or see: https://supabase.com/docs/guides/cli"
    exit 1
fi

# Check if logged in
echo -e "${YELLOW}Checking Supabase authentication...${NC}"
if ! supabase projects list &> /dev/null; then
    echo -e "${RED}Not logged in to Supabase CLI.${NC}"
    echo "Please run: supabase login"
    exit 1
fi
echo -e "${GREEN}✓ Authenticated with Supabase${NC}"
echo ""

# List current secrets
echo -e "${YELLOW}Current secrets configured:${NC}"
supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null || echo "(unable to list secrets)"
echo ""

# Function to set a secret
set_secret() {
    local name=$1
    local value=$2
    echo -e "${YELLOW}Setting $name...${NC}"
    supabase secrets set "$name=$value" --project-ref "$PROJECT_REF"
    echo -e "${GREEN}✓ $name configured${NC}"
}

# ============================================================================
# 1. INFERENCE_SERVICE_URL - Railway inference service
# ============================================================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Step 1: Configure Inference Service URL${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This is the Railway-hosted AI inference service URL."
echo "Default: $RAILWAY_INFERENCE_URL_DEFAULT"
echo ""
read -p "Enter INFERENCE_SERVICE_URL (press Enter for default): " INFERENCE_URL
INFERENCE_URL=${INFERENCE_URL:-$RAILWAY_INFERENCE_URL_DEFAULT}

if [ -n "$INFERENCE_URL" ]; then
    set_secret "INFERENCE_SERVICE_URL" "$INFERENCE_URL"
fi
echo ""

# ============================================================================
# 2. PROXY_SERVER_URL - Railway NZSCV proxy
# ============================================================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Step 2: Configure Proxy Server URL (Optional)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This is the Railway-hosted NZSCV/MotorWeb proxy URL."
echo "Used for vehicle certification lookups."
echo ""
read -p "Enter PROXY_SERVER_URL (or press Enter to skip): " PROXY_URL

if [ -n "$PROXY_URL" ]; then
    set_secret "PROXY_SERVER_URL" "$PROXY_URL"
    set_secret "NZSCV_PROXY_URL" "$PROXY_URL"
fi
echo ""

# ============================================================================
# 3. AI Provider - GitHub Copilot or OpenAI
# ============================================================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Step 3: Configure AI Provider${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "The AI chat feature requires either:"
echo "  1. GITHUB_TOKEN - GitHub PAT with 'copilot' scope (recommended)"
echo "  2. OPENAI_API_KEY - OpenAI API key"
echo ""
echo "Which provider do you want to configure?"
echo "  [1] GitHub Copilot (GITHUB_TOKEN)"
echo "  [2] OpenAI (OPENAI_API_KEY)"
echo "  [3] Skip"
echo ""
read -p "Enter choice [1/2/3]: " AI_CHOICE

case $AI_CHOICE in
    1)
        echo ""
        echo "To get a GitHub token with copilot scope:"
        echo "  1. Go to https://github.com/settings/tokens/new"
        echo "  2. Give it a name like 'FieldOps AI'"
        echo "  3. Check the 'copilot' scope"
        echo "  4. Generate token and paste below"
        echo ""
        read -sp "Enter GITHUB_TOKEN: " GITHUB_TOKEN
        echo ""
        if [ -n "$GITHUB_TOKEN" ]; then
            set_secret "GITHUB_TOKEN" "$GITHUB_TOKEN"
        fi
        ;;
    2)
        echo ""
        echo "Get your OpenAI API key from: https://platform.openai.com/api-keys"
        echo ""
        read -sp "Enter OPENAI_API_KEY: " OPENAI_KEY
        echo ""
        if [ -n "$OPENAI_KEY" ]; then
            set_secret "OPENAI_API_KEY" "$OPENAI_KEY"
        fi
        ;;
    *)
        echo "Skipping AI provider configuration."
        ;;
esac
echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Configuration Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Secrets have been configured in Supabase."
echo ""
echo "Current secrets:"
supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null || echo "(unable to list)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Redeploy Edge Functions to pick up new secrets:"
echo "     gh workflow run deploy-edge-functions.yml"
echo ""
echo "  2. Test the AI chat in Field Officer Portal"
echo ""
echo "  3. Check System Diagnostics page for service status"
echo ""
echo -e "${GREEN}Done!${NC}"

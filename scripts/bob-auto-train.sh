#!/bin/bash
# Bob Training Bootstrap — Auto-load Copilot Reasoning + Project Knowledge
# Run on startup: source scripts/bob-auto-train.sh

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(dirname "$SCRIPT_DIR")

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[BOB TRAINING]${NC} Loading Copilot reasoning framework..."

# 1. Source Bob unified config (has all credentials)
if [ -f "$REPO_ROOT/.runtime/bob-unified.env" ]; then
  source "$REPO_ROOT/.runtime/bob-unified.env"
  echo -e "${GREEN}✓${NC} Loaded unified config"
else
  echo -e "${BLUE}[INFO]${NC} .runtime/bob-unified.env not found; using environment"
fi

# 2. Use Codespace secrets if available
if [ -n "$INFERENCE_SERVICE_URL" ]; then
  export INFERENCE_SERVICE_URL
  echo -e "${GREEN}✓${NC} Using Codespace secret: INFERENCE_SERVICE_URL"
fi

if [ -n "$INFERENCE_API_KEY" ]; then
  export INFERENCE_API_KEY
  echo -e "${GREEN}✓${NC} Using Codespace secret: INFERENCE_API_KEY"
fi

# 3. Validate connection
echo -e "${BLUE}[BOB TRAINING]${NC} Verifying Bob connectivity..."
if ! curl -s -m 5 "${INFERENCE_SERVICE_URL_RUNPOD:-${INFERENCE_SERVICE_URL}}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}' > /dev/null 2>&1; then
  
  echo -e "${BLUE}[WARNING]${NC} Bob endpoint not reachable"
  echo "  Set INFERENCE_SERVICE_URL and INFERENCE_API_KEY in GitHub Codespace secrets"
  echo "  Or run: export INFERENCE_SERVICE_URL=... && export INFERENCE_API_KEY=..."
else
  echo -e "${GREEN}✓${NC} Bob endpoint is reachable"
  
  # 4. Inject training
  echo -e "${BLUE}[BOB TRAINING]${NC} Injecting Copilot reasoning framework..."
  node "$REPO_ROOT/scripts/bob-inject-training.mjs" --coding 2>/dev/null || true
  
  echo -e "${GREEN}✓${NC} Training loaded into Bob's context"
fi

# 5. Create training context file for reference
cat > "$REPO_ROOT/.runtime/bob-training-context.md" << 'EOF'
# Bob's Loaded Training Context

## Loaded Training Modules
- Copilot Coding Logic Framework
- Copilot Instructions & Protocols
- Project Architecture Decisions
- Code Patterns & Conventions

## Key Reasoning Patterns
1. Ground Truth First — Always verify assumptions by reading actual code
2. Multi-Layer Understanding — Follow data flow from UI to database
3. Code Archaeology — Systematic method for reading unfamiliar code
4. Architectural Thinking — Respect abstraction layers
5. Security Thinking — Auth, Authorization, Validation
6. Testing Thinking — Unit → Integration → E2E pyramid
7. Problem-Solving — Systematic debugging checklist

## Quick Reference Commands

### Test Bob with Training
```bash
node scripts/bob-direct-chat.mjs "Walk me through how login works in this app"
```

### Reload Training
```bash
node scripts/bob-inject-training.mjs --full
```

### Check Training Status
```bash
curl -X POST "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"What reasoning frameworks do you know?"}}'
```

## Training Expectations

After training, Bob should:
- ✓ Explain code tier by tier (UI → hooks → API → database)
- ✓ Identify security issues (missing RLS, no org filter, etc.)
- ✓ Debug systematically (steps 1-6 checklist)
- ✓ Propose changes with ground truth verification
- ✓ Write tests alongside code changes
- ✓ Explain multi-org architecture correctly

## Continuous Improvement

Bob's training will improve as you:
1. Add new architecture decisions to docs/adr/
2. Update DECISIONS.md when patterns change
3. Add project patterns to BOB_TRAINING_*.md
4. Run `node scripts/bob-inject-training.mjs --full` periodically
EOF

echo -e "${GREEN}✓${NC} Training context saved to .runtime/bob-training-context.md"

echo ""
echo -e "${GREEN}✓ Bob Training Bootstrap Complete!${NC}"
echo ""
echo "Test Bob with training:"
echo "  node scripts/bob-direct-chat.mjs \"Walk me through the auth flow\""
echo ""

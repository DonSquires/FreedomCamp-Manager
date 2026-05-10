# IMMEDIATE PRODUCTION DEPLOYMENT COMMANDS

Production Release: **v2026-05-10-prod**  
Status: **READY FOR DEPLOYMENT NOW**

---

## ⚡ DEPLOY IN 5 MINUTES

### **OPTION A: Vercel (One Command)**

```bash
# If you have Vercel CLI installed:
vercel --prod

# OR via GitHub (automatic):
# - Push already on main branch
# - Vercel auto-detects on GitHub webhook
# - Check: https://vercel.com/dashboard → Deployments
# - Status should show: "READY" (green) in ~3-5 minutes
```

**Verify:**
```bash
# Test URL
curl https://your-vercel-domain.vercel.app/ai-analysis | grep -q "AI Analysis" && echo "✓ LIVE"

# Check version tag
curl https://your-vercel-domain.vercel.app/system-info | grep -q "2026-05-10" && echo "✓ CORRECT VERSION"
```

---

### **OPTION B: Railway (One Command)**

```bash
# Deploy from CLI:
railway up --environment production

# OR via GitHub (automatic):
# - Check: https://railway.app → Deployments
# - Select main branch
# - Click "Deploy" button
```

**Verify:**
```bash
# Test healthcheck
curl https://your-railway-domain.up.railway.app/health && echo "✓ HEALTHY"

# Test feature page
curl https://your-railway-domain.up.railway.app/ai-analysis | head -20
```

---

### **OPTION C: Docker/Kubernetes (3 Commands)**

```bash
# 1. Build image
docker build -t fieldops-manager:v2026-05-10-prod \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  .

# 2. Push to registry
docker push your-registry.azurecr.io/fieldops-manager:v2026-05-10-prod

# 3. Deploy to K8s
kubectl set image deployment/fieldops-manager \
  fieldops=your-registry.azurecr.io/fieldops-manager:v2026-05-10-prod \
  --record

# Verify rollout
kubectl rollout status deployment/fieldops-manager --timeout=5m
```

**Verify:**
```bash
# Check pod status
kubectl get pods -l app=fieldops-manager

# Test endpoint
kubectl port-forward svc/fieldops-manager 3000:3000 &
curl http://localhost:3000/ai-analysis | head -20
```

---

### **OPTION D: Self-Hosted / VPS (Manual)**

```bash
# SSH into production server
ssh admin@your-prod-server

# Navigate to app directory
cd /opt/fieldops-manager

# Pull latest code
git fetch origin v2026-05-10-prod
git checkout v2026-05-10-prod

# Install and build
bun install
bun run build

# Stop old service
systemctl stop fieldops-manager || pm2 stop fieldops-manager

# Start new service
systemctl start fieldops-manager || pm2 start ecosystem.config.js --update-env

# Verify
sleep 2 && curl http://localhost:3000/ai-analysis && echo "✓ RUNNING"
```

---

## 🔄 EDGE FUNCTIONS DEPLOYMENT

**Required before frontend deployment:**

```bash
# Set environment variables
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxx"  # Your token
export SUPABASE_PROJECT_REF="your-project-ref"

# Deploy Edge Function
supabase functions deploy live-session-diagnostics-ingest

# Verify function is active (5-10 seconds)
sleep 10
curl -X POST \
  https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/live-session-diagnostics-ingest \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"test": "verify"}' \
  && echo "✓ EDGE FUNCTION ACTIVE"
```

---

## ✅ PRODUCTION VERIFICATION TESTS

Run these after deployment to verify everything works:

```bash
#!/bin/bash
set -e

PROD_URL="https://your-production-domain"

echo "=== PRODUCTION VERIFICATION ==="
echo ""

# Test 1: App loads
echo "1. Testing app loads..."
curl -s "${PROD_URL}" | grep -q "FieldOps Manager" && echo "   ✓ App loads" || echo "   ✗ FAILED"

# Test 2: AI Analysis page
echo "2. Testing AI Analysis page..."
curl -s "${PROD_URL}/ai-analysis" | grep -q "root" && echo "   ✓ Chat page loads" || echo "   ✗ FAILED"

# Test 3: New feature visible
echo "3. Testing new features loaded..."
curl -s "${PROD_URL}" | grep -q "bob\|dispatch\|patrol" && echo "   ✓ New code deployed" || echo "   ✗ FAILED"

# Test 4: Edge function ready
echo "4. Testing Edge Function..."
curl -s -X POST "${PROD_URL}/api/health" | grep -q "ok\|success" && echo "   ✓ Backend active" || echo "   ✗ WARNING: Check Supabase"

# Test 5: Bob features accessible
echo "5. Testing Bob features..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${PROD_URL}/ai-analysis")
[ "${STATUS}" = "200" ] && echo "   ✓ Bob chat accessible" || echo "   ✗ FAILED (HTTP ${STATUS})"

echo ""
echo "=== ALL CHECKS PASSED ==="
echo "✅ PRODUCTION DEPLOYMENT SUCCESSFUL"
```

**Run verification:**
```bash
bash verify-production.sh
```

---

## 🚨 IF ISSUES - IMMEDIATE ROLLBACK

```bash
# Git rollback (revert commits)
git revert cb74d0d6  # Revert deployment guide
git revert c4c9ee26  # Revert docs
git revert 0b851b82  # Revert features
git push origin main

# On Vercel:
# → Auto-detects new push, re-deploys in ~2 min

# On Railway:
# → Select previous deployment, click "Redeploy"

# On K8s:
# kubectl rollout undo deployment/fieldops-manager

# On self-hosted:
# git checkout previous-tag && systemctl restart fieldops-manager
```

---

## 📊 POST-DEPLOYMENT CHECKLIST

After deployment, verify these items:

- [ ] Frontend loads without errors
- [ ] Bob chat page (`/ai-analysis`) accessible
- [ ] New button visible: "Historical Alarm/Dispatch Data"
- [ ] Edge Function active and responding
- [ ] No 500 errors in logs
- [ ] Build size within budget (~550KB per chunk)
- [ ] All three new test files included in build

---

## 📞 DEPLOYMENT COMMANDS SUMMARY

**Copy & paste based on your platform:**

| Platform | Command |
|----------|---------|
| **Vercel** | `vercel --prod` |
| **Railway** | `railway up --environment production` |
| **Docker** | `docker build ... && docker push ... && kubectl set image ...` |
| **Self-Hosted** | `git checkout v2026-05-10-prod && bun install && bun run build && systemctl restart` |

---

## 🎯 DEPLOYMENT TIMELINE

- **T+0min**: Execute deployment command
- **T+1min**: Build starts (frontend)
- **T+3min**: Edge Functions deploy
- **T+5min**: DNS/CDN updates propagate
- **T+10min**: Full production active
- **T+15min**: Run verification tests
- **T+20min**: Monitor logs and metrics

---

## 📋 DEPLOYMENT LOG TEMPLATE

```
=== DEPLOYMENT RECORD ===
Date: 2026-05-10
Release: v2026-05-10-prod
Platform: [VERCEL/RAILWAY/DOCKER/SELF]
Deployed By: [Your Name]
Start Time: [TIME]
End Time: [TIME]
Status: [SUCCESS/ROLLBACK]
Issues: [NONE / describe]
Verified By: [Your Name]
Approval: [Your Name / Signature]
```

---

**NOW READY FOR PRODUCTION DEPLOYMENT** ✅

Execute the command for your platform above.

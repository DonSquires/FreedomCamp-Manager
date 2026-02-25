# 🚀 Quick Start Guide - ORC/AI Inference Service

**Deploy to Railway in 5 minutes - using your existing account!**

---

## Prerequisites

- ✅ Railway account (you already have this!)
- ✅ GitHub repo with code
- ✅ That's it!

---

## 🚂 **Railway Deployment (Recommended)**

### **Option 1: Web UI (Easiest)**

1. **Go to Railway Dashboard**
   - https://railway.app/dashboard

2. **New Project → Deploy from GitHub**
   - Select your repository
   - Root directory: `inference-service`

3. **Configure Variables**
   - `PORT` = `3000`
   - `NODE_ENV` = `production`
   - `ALLOWED_ORIGINS` = `https://xbfnlzmpumthnjmtqufp.supabase.co`
   - `OPENAI_API_KEY` = `sk-...` *(optional — enables plate + vehicle metadata extraction via gpt-4o-mini; omit to use OnSpace AI client-side plate data)*

4. **Deploy**
   - Click Deploy button
   - Wait 2-3 minutes

5. **Generate Domain**
   - Settings → Networking → Generate Domain
   - Copy URL: `https://orc-ai-inference-production.up.railway.app`

**✅ Done!**

---

### **Option 2: Railway CLI** (For advanced users)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Deploy
railway up

# Get URL
railway domain
```

---

## 🧪 **Test Deployment**

```bash
# Replace with YOUR Railway URL
RAILWAY_URL="https://orc-ai-inference-production.up.railway.app"

# Test health
curl "$RAILWAY_URL/health" | jq .

# Expected:
# {
#   "status": "healthy",
#   "models": { "yolo": "loaded", "embedding": "loaded" }
# }
```

---

## 📝 **Configure Supabase Secrets**

The system uses **three independent secrets** — set whichever you have:

```bash
# ── ALREADY SET ───────────────────────────────────────────────────────────────
# The following secrets are already configured in your Supabase project:
#   PLATERECOGNIZER_TOKEN   ← primary token name used by orc-ingest / vehicle-ingest
#   ALPR_API_TOKEN          ← same value, alternate name (both accepted)
#   ALPR_API_URL            ← API endpoint URL
#   PARKPOW_API_TOKEN       ← ParkPow enforcement integration

# To verify they are present:
supabase secrets list

# To update/rotate the Plate Recognizer token:
supabase secrets set PLATERECOGNIZER_TOKEN="new-token-here"

# ── OPTIONAL ─────────────────────────────────────────────────────────────────
# Railway ORC/AI — adds 384-D visual embedding (vehicle fingerprinting)
# Set this AFTER deploying the inference service to Railway.
# The system works fully with Plate Recognizer alone if Railway is not deployed.
supabase secrets set INFERENCE_SERVICE_URL="https://orc-ai-inference-production.up.railway.app"
```

**Priority order once secrets are set:**
1. 🥇 **Plate Recognizer API** (`PLATERECOGNIZER_TOKEN` / `ALPR_API_TOKEN`) → plate + make/model/colour
2. 🥈 **Railway ORC/AI** (`INFERENCE_SERVICE_URL`) → 384-D visual embedding (runs in parallel with tier 1)
3. 🥉 **OnSpace AI / manual** → client-side fallback if both above unavailable

---

## ✅ **Success Checklist**

- [x] `PLATERECOGNIZER_TOKEN` set in Supabase ✅ already configured
- [x] `ALPR_API_TOKEN` set in Supabase ✅ already configured
- [x] `ALPR_API_URL` set in Supabase ✅ already configured
- [x] `PARKPOW_API_TOKEN` set in Supabase ✅ already configured
- [ ] Railway project created (optional — adds visual embeddings)
- [ ] Environment variables set on Railway
- [ ] Deployment successful
- [ ] Health check passes
- [ ] `INFERENCE_SERVICE_URL` set in Supabase ← add once Railway is deployed

---

## 🎯 **Next Steps**

Reply with:
```
✅ Railway deployed
URL: https://orc-ai-inference-production.up.railway.app
```

Then I'll proceed with:
- **Part B:** Deploy `orc-ingest` Edge Function
- **Part C:** Update frontend to use ORC/AI

---

## 💰 **Cost**

Railway Starter: **$5/month**  
Uses your **existing Railway account** - no new services!

---

## 🚨 **Troubleshooting**

**"Can't find repository"**
- Grant Railway access to your GitHub repo
- Railway dashboard → GitHub permissions

**"Build failing"**
- Check build logs in Railway dashboard
- Ensure Dockerfile is in `inference-service/` directory

**"Models not loading"**
- Wait for first build to complete (downloads 27 MB)
- Models are cached after first deployment

---

**Need help?** Check Railway logs or see full guide in `RAILWAY_DEPLOY.md`

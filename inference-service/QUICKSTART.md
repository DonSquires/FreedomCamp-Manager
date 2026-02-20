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

## 📝 **Configure Supabase**

```bash
# Set inference URL in Supabase
supabase secrets set INFERENCE_SERVICE_URL="https://orc-ai-inference-production.up.railway.app"

# Verify
supabase secrets list
```

---

## ✅ **Success Checklist**

- [ ] Railway project created
- [ ] Environment variables set
- [ ] Deployment successful
- [ ] Health check passes
- [ ] `INFERENCE_SERVICE_URL` set in Supabase

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

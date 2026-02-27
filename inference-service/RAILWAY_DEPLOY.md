# 🚂 **Railway Deployment Guide - 5 Minutes**

**Using your existing Railway account - no new services needed!**

---

## 🎯 **Quick Deploy (Web UI)**

### **Step 1: Create New Project** (1 min)

1. Go to https://railway.app/dashboard
2. Click **New Project**
3. Select **Deploy from GitHub repo**
4. Choose your repository
5. Select `inference-service` as the root directory

---

### **Step 2: Configure Environment** (1 min)

In Railway dashboard:

1. Click **Variables** tab
2. Add these variables:
   - `PORT` = `3000`
   - `NODE_ENV` = `production`
   - `ALLOWED_ORIGINS` = `https://xbfnlzmpumthnjmtqufp.supabase.co`

3. Click **Settings** tab
4. Set **Health Check Path** to `/health`

---

### **Step 3: Deploy** (5 min)

1. Click **Deploy** button
2. Wait 5-8 minutes for first build (Python model export takes time)
3. Railway will automatically:
   - Export ONNX models via Python (ultralytics + torchvision)
   - Build Docker image with baked-in models
   - Start server on port 3000
   - Run health checks

---

### **Step 4: Get Your URL** (30 sec)

1. Go to **Settings** → **Networking**
2. Click **Generate Domain**
3. Copy your Railway URL:
   ```
   https://orc-ai-inference-production.up.railway.app
   ```

---

### **Step 5: Test Deployment** (1 min)

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

**✅ If health check passes, you're done!**

---

## 📝 **Configure Supabase** (1 min)

```bash
# Set your Railway URL in Supabase
supabase secrets set INFERENCE_SERVICE_URL="https://orc-ai-inference-production.up.railway.app"

# Verify
supabase secrets list
```

---

## 🎉 **Success!**

Your inference service is now running on **Railway** (your existing platform):

✅ No new accounts needed  
✅ Automatic deploys from GitHub  
✅ Built-in health checks  
✅ Free $5/month credit  

**Next:** Reply with your Railway URL and I'll deploy the orc-ingest Edge Function!

---

## 💰 **Cost**

Railway Starter: **$5/month** (same as Fly.io)  
Uses your existing Railway account - no additional service!

---

## 🚨 **Troubleshooting**

**"Build timeout"**
- First build takes ~5-8 min (Python exports ONNX models)
- Subsequent builds are faster (Docker layer caching)
- Railway has 15-min build limit — usually sufficient
- If timeout, retry — cached layers will speed it up

**"Protobuf parsing failed" or "degraded mode"**
- Models weren't exported correctly during build
- Clear Railway build cache: **Settings** → **Build** → **Clear Build Cache**
- Redeploy to force a clean rebuild

**"Health check failing"**
- Check logs in Railway dashboard
- Ensure PORT=3000 is set
- Service starts in degraded mode if models fail — health check still passes

**"Can't connect from Supabase"**
- Add ALLOWED_ORIGINS environment variable
- Check Railway domain is public (not private)

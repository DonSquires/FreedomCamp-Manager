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

### **Step 3: Deploy** (2 min)

1. Click **Deploy** button
2. Wait 2-3 minutes for build
3. Railway will automatically:
   - Build Docker image
   - Download ONNX models (27 MB)
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

## 🔧 **Fix: "Could not find root directory: inference-service"**

This error means Railway is connected to the **wrong source repository**.  

**Root cause:** Railway is pointing at `DonSquires/orc-ai-inference-service` (which is empty — only has `.github/` and `README.md`). The actual inference code lives in `DonSquires/FreedomCamp-Manager` under the `inference-service/` folder.

**Fix in 4 steps:**

1. In Railway, click your service → **Settings** tab
2. Scroll to **Source** section → click **Disconnect** next to the current repo
3. Click **Connect Repo** → select **`DonSquires/FreedomCamp-Manager`**
4. In the **Root Directory** field, type `inference-service` → Save → **Redeploy**

Railway will now find the correct `Dockerfile`, `package.json`, and `server.js`. ✅

> **Your Railway URL is already set up:** `https://orc-ai-inference-service-production.up.railway.app`  
> No need to generate a new domain — just reconnect the source and redeploy.

---

## 🚨 **Troubleshooting**

**"Build timeout"**
- Railway has 15-min build limit
- Model downloads are cached after first build
- Wait and retry if timeout occurs

**"Health check failing"**
- Check logs in Railway dashboard
- Ensure PORT=3000 is set
- Verify ONNX models downloaded

**"Can't connect from Supabase"**
- Add ALLOWED_ORIGINS environment variable
- Check Railway domain is public (not private)

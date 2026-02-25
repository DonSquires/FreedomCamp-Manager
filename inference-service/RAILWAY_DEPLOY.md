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

## 🔧 **Fix: Already connected Railway to the wrong directory?**

If Railway shows this error:
```
⚠ Script start.sh not found
✖ Railpack could not determine how to build the app.
The app contents that Railpack analyzed contains:
./
├── .github/
└── README.md
```

This means Railway is pointing at the **repo root** instead of `inference-service/`. Fix it in 3 clicks:

1. In Railway, click your **service** (the one showing the error)
2. Click the **Settings** tab
3. Scroll to **Source** → find the **Root Directory** field
4. Type `inference-service` and press **Enter / Save**
5. Click **Redeploy** (or push any commit to trigger a rebuild)

Railway will now look inside `inference-service/` and find the Dockerfile, `package.json`, and `server.js`. ✅

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

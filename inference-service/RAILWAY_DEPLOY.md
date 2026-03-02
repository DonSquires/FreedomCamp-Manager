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

### **Step 4: Create a CI/CD Token** (1 min)

> ⚠️ **Important**: Use a **project token**, NOT your personal account token.  
> Personal tokens (`Account → Tokens`) are rejected by Railway CLI in CI/CD.

1. Inside your Railway project, click **Settings** → **Tokens**
2. Click **New Token**, name it `GitHub Actions`
3. Copy the generated token
4. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
5. Add a secret named `RAILWAY_TOKEN` with the copied value
6. Also copy the **Service ID** from **Settings** → Service ID
7. Add a secret named `RAILWAY_SERVICE_ID` with the Service ID

---

### **Step 5: Get Your URL** (30 sec)

1. Go to **Settings** → **Networking**
2. Click **Generate Domain**
3. Copy your Railway URL:
   ```
   https://orc-ai-inference-production.up.railway.app
   ```

---

### **Step 6: Test Deployment** (1 min)

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

**"Invalid RAILWAY_TOKEN" in GitHub Actions**
- You likely set a personal account token (`Account → Tokens`) instead of a project token
- Fix: Go to Railway → your project → **Settings → Tokens → New Token**
- Update the `RAILWAY_TOKEN` GitHub secret with the new project token

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

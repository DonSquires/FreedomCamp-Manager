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

### **Step 2: Configure Environment** (2 min)

In Railway dashboard, click the **Variables** tab and add:

#### Required

| Variable | Example Value | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (Railway uses this automatically) |
| `NODE_ENV` | `production` | Enables production optimisations |
| `SUPABASE_URL` | `https://<project>.supabase.co` | Your Supabase project URL (auto-derives JWKS/issuer) |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service-role-key>` | Allows Supabase Edge Functions to call authenticated endpoints |

#### AI Features (required for vehicle attribute extraction and face detection)

| Variable | Example Value | Description |
|---|---|---|
| `OPENAI_API_KEY` | `<key>` | OpenAI or AI Gateway key |
| `VEHICLE_ATTRS_PROVIDER` | `openai` | `basic` (no AI), `openai` (AI attribute extraction), or `ollama` (local LLM) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name — use `openai/gpt-4o-mini` for Vercel AI Gateway |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI API base URL — override to `https://ai-gateway.vercel.sh/v1` for Vercel AI Gateway or an Azure endpoint |

#### Optional

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` (all) | Comma-separated list of allowed CORS origins (e.g. your Supabase project URL) |
| `INFERENCE_API_KEY` | _(unset)_ | Static API key for direct service-to-service calls (not needed if `SUPABASE_SERVICE_ROLE_KEY` is set) |
| `TABULAR_NLP_PROVIDER` | `heuristic` | `heuristic` (rule-based) or `openai` (AI-powered tabular analysis) |
| `TABULAR_NLP_TIMEOUT_MS` | `2500` | Timeout for tabular NLP requests |
| `ATTR_TIMEOUT_MS` | `2500` | Timeout for AI attribute extraction |
| `INFER_RATE_LIMIT_RPM` | `30` | Max inference requests per minute per IP |
| `ALPR_RATE_LIMIT_RPM` | `60` | Max ALPR requests per minute per IP |
| `TABULAR_RATE_LIMIT_RPM` | `20` | Max tabular NLP requests per minute per IP |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Only needed if using `VEHICLE_ATTRS_PROVIDER=ollama` |
| `OLLAMA_MODEL` | `llama3.1:8b` | Only needed if using `VEHICLE_ATTRS_PROVIDER=ollama` |

Then click the **Settings** tab and set **Health Check Path** to `/health`.

---

### **Step 3: Deploy** (2 min)

1. Click **Deploy** button
2. Wait 2-3 minutes for build
3. Railway will automatically:
   - Build Docker image
   - Export ONNX models (YOLOv8n + MobileNetV3)
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
3. Copy your Railway URL (e.g. `https://orc-ai-inference-service-production.up.railway.app`)

---

### **Step 6: Test Deployment** (1 min)

```bash
# Replace with YOUR Railway URL
RAILWAY_URL="https://orc-ai-inference-service-production.up.railway.app"

# Test health
curl "$RAILWAY_URL/health" | jq .

# Expected (with AI features enabled):
# {
#   "status": "healthy",
#   "models": { "yolo": "loaded", "embedding": "loaded" },
#   "config": {
#     "VEHICLE_ATTRS_PROVIDER": "openai",
#     "OPENAI_API_KEY_SET": true,
#     "SUPABASE_SERVICE_ROLE_KEY_SET": true
#   },
#   "capabilities": { "plate_inference": true, "ai_attributes": true }
# }
```

**✅ If health check passes, you're done!**

---

## 📝 **Configure Supabase** (1 min)

```bash
# Set your Railway URL in Supabase so Edge Functions can find the service
supabase secrets set INFERENCE_SERVICE_URL="https://orc-ai-inference-service-production.up.railway.app"

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

---

## 💰 **Cost**

Railway Starter: **$5/month**  
Uses your existing Railway account - no additional service!

---

## 🚨 **Troubleshooting**

**"Invalid RAILWAY_TOKEN" in GitHub Actions**
- You likely set a personal account token (`Account → Tokens`) instead of a project token
- Fix: Go to Railway → your project → **Settings → Tokens → New Token**
- Update the `RAILWAY_TOKEN` GitHub secret with the new project token

**"Build timeout"**
- Railway has 15-min build limit
- Model exports are cached after first build
- Wait and retry if timeout occurs

**"Health check failing"**
- Check logs in Railway dashboard
- Ensure `PORT=3000` is set
- Confirm the Docker build completed (ONNX model export takes ~3 min on first build)

**"Can't connect from Supabase"**
- Set `ALLOWED_ORIGINS` to your Supabase project URL
- Confirm the Railway domain is public (Settings → Networking)

**"INFERENCE_API_KEY_SET: false in startup log"**
- This is fine if `SUPABASE_SERVICE_ROLE_KEY` is set — Edge Functions use the service role key for auth
- Only set `INFERENCE_API_KEY` if you need an additional static key for direct API calls

**"AI attributes not working"**
- Confirm `VEHICLE_ATTRS_PROVIDER=openai` and `OPENAI_API_KEY` are set
- If using Vercel AI Gateway, set `OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1` and prefix the model name: `OPENAI_MODEL=openai/gpt-4o-mini`

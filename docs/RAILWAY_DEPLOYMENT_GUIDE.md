# Railway Deployment Guide

**FreedomCamp Manager - Railway Services Deployment**

This guide covers deploying both Railway services (Proxy Server and Inference Service) and configuring them for production use.

---

## Prerequisites

- Railway account: https://railway.app
- Railway CLI installed: `npm install -g @railway/cli`
- GitHub repository (optional, for auto-deployment)
- Supabase project with Edge Functions deployed

---

## Service 1: Inference Service (YOLOv8 + MobileNetV3)

### Local Testing

```bash
# Navigate to inference service
cd inference-service

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env and add any required API keys

# Download models (first time only)
node scripts/download-models.js

# Start local server
npm start

# Test health endpoint
curl http://localhost:3000/health

# Test vehicle detection
curl -X POST http://localhost:3000/detect \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/car.jpg"}'
```

### Deploy to Railway (CLI Method)

```bash
# Login to Railway
railway login

# Link to existing project or create new
railway link
# OR
railway init

# Deploy the service
railway up

# Get deployment URL
railway status
# Copy the deployment URL (e.g., https://freedomcamp-inference.railway.app)

# Set environment variables (if needed)
railway variables set MODEL_PATH=/app/models
```

### Deploy to Railway (GitHub Method)

1. Push code to GitHub repository
2. Go to Railway dashboard: https://railway.app/dashboard
3. Click **"New Project"** → **"Deploy from GitHub"**
4. Select repository and set **Root Directory**: `inference-service/`
5. Railway auto-detects Dockerfile and builds
6. Wait for deployment to complete (~3-5 minutes for cold start)
7. Copy deployment URL from dashboard

### Test Deployed Service

```bash
# Set your Railway URL
INFERENCE_URL="https://your-service.railway.app"

# Health check
curl $INFERENCE_URL/health

# Expected response:
# {"status": "healthy", "models_loaded": true}

# Test vehicle detection
curl -X POST $INFERENCE_URL/detect \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800"}'

# Test embedding generation
curl -X POST $INFERENCE_URL/embed \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800"}'

# Test full analysis pipeline
curl -X POST $INFERENCE_URL/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800"}'
```

**Expected Results:**
- `/health`: Returns `{"status": "healthy", "models_loaded": true}`
- `/detect`: Returns vehicle detection with bounding boxes and confidence scores
- `/embed`: Returns 384-dimensional embedding vector
- `/analyze`: Returns detection + embedding + OCR results

---

## Service 2: Proxy Server (NZSCV/MotorWeb Gateway)

### Local Testing

```bash
# Navigate to proxy server
cd proxy-server

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env and add:
# NZSCV_API_KEY=your_key
# MOTORWEB_API_KEY=your_key
# PORT=3001

# Start local server
npm start

# Test health endpoint
curl http://localhost:3001/health

# Test NZSCV check
curl -X POST http://localhost:3001/api/nzscv/check \
  -H "Content-Type: application/json" \
  -d '{"plate_number": "ABC123"}'

# Test MotorWeb lookup
curl -X POST http://localhost:3001/api/motorweb/lookup \
  -H "Content-Type: application/json" \
  -d '{"plate_number": "ABC123"}'
```

### Deploy to Railway (CLI Method)

```bash
# Navigate to proxy server
cd proxy-server

# Login and link
railway login
railway link
# OR
railway init

# Set environment variables
railway variables set NZSCV_API_KEY=your_actual_key
railway variables set MOTORWEB_API_KEY=your_actual_key
railway variables set PORT=3000

# Deploy
railway up

# Get deployment URL
railway status
# Copy the deployment URL (e.g., https://freedomcamp-proxy.railway.app)
```

### Deploy to Railway (GitHub Method)

1. Push code to GitHub
2. Railway dashboard → **"New Project"** → **"Deploy from GitHub"**
3. Select repository and set **Root Directory**: `proxy-server/`
4. Add environment variables in Railway dashboard:
   - `NZSCV_API_KEY`: Your NZSCV API key
   - `MOTORWEB_API_KEY`: Your MotorWeb API key
   - `PORT`: 3000
5. Deploy and copy URL

### Test Deployed Proxy

```bash
# Set your Railway URL
PROXY_URL="https://your-proxy.railway.app"

# Health check
curl $PROXY_URL/health

# Test NZSCV
curl -X POST $PROXY_URL/api/nzscv/check \
  -H "Content-Type: application/json" \
  -d '{"plate_number": "ABC123"}'

# Test MotorWeb
curl -X POST $PROXY_URL/api/motorweb/lookup \
  -H "Content-Type: application/json" \
  -d '{"plate_number": "ABC123"}'
```

---

## Service 3: Frontend (Vite Web App) on Railway

The web UI can be self-hosted on Railway using the existing `start` script (`npm run start` wraps `vite preview --host 0.0.0.0 --port $PORT`).

### Deploy (GitHub or CLI)

```bash
railway login
railway init        # or railway link
railway up          # from repo root
```

If using the GitHub flow in the dashboard, set **Root Directory** to `/` and keep the default Nix pack. Railway will run `npm install` and `npm run start`.

### Required environment variables (Frontend)

```
VITE_SUPABASE_URL=...your Supabase project URL...
VITE_SUPABASE_ANON_KEY=...your anon key...
# Optional but recommended so the UI can display service status
VITE_PROXY_SERVER_URL=https://your-proxy.railway.app
VITE_INFERENCE_SERVICE_URL=https://your-inference.railway.app
```

### Smoke test

```bash
curl -I https://<frontend>.railway.app || true   # expect 200/302 depending on auth
```

Then open the URL in the browser and:
- Sign in via Supabase Auth
- Open **System Diagnostics** → verify Proxy/Inference cards show “Online”
- Open **Vehicle Management** → run NZSCV check (uses proxy)

---

## Step 3: Configure Supabase Edge Functions

Once both services are deployed, update Supabase secrets:

```bash
# Set Railway service URLs
supabase secrets set INFERENCE_SERVICE_URL=https://your-inference.railway.app
supabase secrets set PROXY_SERVER_URL=https://your-proxy.railway.app

# Verify secrets are set
supabase secrets list
```

### Update check-railway-health Edge Function

The `check-railway-health` Edge Function needs to return the Railway URLs. Make sure it's deployed:

```bash
# Deploy the Edge Function
supabase functions deploy check-railway-health

# Test it
curl -X POST https://your-project.supabase.co/functions/v1/check-railway-health \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Expected response:
# {
#   "proxy_url": "https://your-proxy.railway.app",
#   "inference_url": "https://your-inference.railway.app",
#   "proxy_status": "online",
#   "inference_status": "online"
# }
```

---

## Step 4: End-to-End Testing

### Test Flow 1: NZSCV Check (VehicleManagement Page)

1. Open VehicleManagement page: `/vehicles`
2. Click any vehicle to open details modal
3. Click **"Check Warrant"** button
4. Verify NZSCV certification result displays
5. Check console for any errors

**Expected Result:**
- Badge shows "Certified" or "Not Certified"
- Warrant type displays (Green/Blue)
- Warrant number and expiry date shown

### Test Flow 2: MotorWeb Enrichment (BreachAlerts Page)

1. Open BreachAlerts page: `/breaches`
2. Click **"Enrich Vehicle Data"** on any breach
3. Wait for enrichment to complete
4. Verify vehicle data is updated
5. Check database for updated fields

**Expected Result:**
- Toast notification: "Vehicle data enriched from MotorWeb"
- Vehicle details updated (make, model, owner info)
- Canonical_vehicles table updated

### Test Flow 3: AI Photo Analysis (ComplianceDashboard Page)

1. Open ComplianceDashboard: `/compliance`
2. Ensure some observations have photos
3. Click **"Analyze Photos"** button
4. Wait for AI analysis to complete
5. Verify results display

**Expected Result:**
- Detection shows vehicle count
- Embedding quality percentage displayed
- No errors in console

### Test Flow 4: System Health (SystemDiagnostics Page)

1. Open SystemDiagnostics: `/diagnostics`
2. Check Proxy Server card
3. Check Inference Service card
4. Both should show "Online" status
5. Latency should be displayed

**Expected Result:**
- Proxy Server: ✓ Online (latency ~100-500ms)
- Inference Service: ✓ Online (latency ~200-800ms)
- Auto-refreshes every 30 seconds

### Test Flow 5: PlateScanner (FieldOfficerPortal Page)

1. Open FieldOfficerPortal: `/field`
2. Click **"Scan Vehicle"**
3. PlateScanner should open
4. Test manual entry or camera capture
5. Verify observation is created

**Expected Result:**
- PlateScanner UI appears
- Can enter plate manually or use camera
- Railway services called for detection/embedding
- Observation created in database

---

## Troubleshooting

### Issue: Railway Service Returns 503

**Cause:** Cold start (Railway services sleep after inactivity)

**Solution:**
- First request may take 10-30 seconds to wake service
- Retry after 30 seconds
- Consider Railway Pro plan for always-on services

### Issue: CORS Errors

**Cause:** Missing CORS headers in Railway services

**Solution:**
- Ensure proxy-server and inference-service have CORS enabled
- Check server.js files have proper CORS middleware
- Verify headers include: `Access-Control-Allow-Origin: *`

### Issue: 401 Unauthorized

**Cause:** Missing or invalid API keys

**Solution:**
- Verify Railway environment variables are set
- Check NZSCV_API_KEY and MOTORWEB_API_KEY
- Use `railway variables` to verify secrets

### Issue: Inference Service Fails to Load Models

**Cause:** Model files not present or corrupted

**Solution:**
- Check Railway build logs
- Verify Dockerfile COPY steps succeeded
- Models should be in `/app/models/` directory
- Ensure export-models.py ran successfully

### Issue: Supabase Functions Can't Reach Railway

**Cause:** Incorrect URLs in secrets

**Solution:**
```bash
# Verify secrets
supabase secrets list

# Re-set if needed
supabase secrets set INFERENCE_SERVICE_URL=https://correct-url.railway.app
supabase secrets set PROXY_SERVER_URL=https://correct-url.railway.app

# Redeploy Edge Functions
supabase functions deploy check-railway-health
```

---

## Production Checklist

Before going live:

- [ ] Both Railway services deployed and accessible
- [ ] Health endpoints returning 200 OK
- [ ] Supabase secrets configured correctly
- [ ] check-railway-health Edge Function deployed
- [ ] All 5 test flows pass successfully
- [ ] Console shows no errors
- [ ] Railway services have proper environment variables
- [ ] API keys are valid and have sufficient credits
- [ ] Railway billing configured (if using Pro plan)
- [ ] Monitoring/alerting configured for Railway services
- [ ] Backup Railway URLs documented in case of redeployment

---

## Monitoring and Maintenance

### Railway Dashboard Monitoring

1. Login to Railway: https://railway.app
2. Select your project
3. Check deployment metrics:
   - CPU usage
   - Memory usage
   - Request count
   - Error rate

### Health Check Automation

Set up a cron job to monitor Railway services:

```bash
# Add to crontab (every 5 minutes)
*/5 * * * * curl -f https://your-inference.railway.app/health || echo "Inference service down"
*/5 * * * * curl -f https://your-proxy.railway.app/health || echo "Proxy service down"
```

### Log Monitoring

```bash
# View Railway logs (CLI)
railway logs

# Or in Railway dashboard:
# Project → Service → Logs tab
```

---

## Cost Optimization

**Railway Free Tier:**
- $5/month credit
- Services sleep after inactivity
- Cold start on first request

**Railway Pro Plan ($20/month):**
- Always-on services (no cold starts)
- Better performance
- More resources

**Recommendations:**
- Start with free tier for testing
- Upgrade to Pro for production (better UX)
- Monitor usage in Railway dashboard
- Set usage alerts to avoid overages

---

## Next Steps

Once Railway services are deployed and tested:

1. ✅ Verify all 5 test flows pass
2. ✅ Check SystemDiagnostics shows both services online
3. ✅ Test end-to-end scan flow (FieldOfficerPortal)
4. ✅ Proceed to **Phase 9: Integration Testing**

---

**Deployment Complete! 🚀**

Railway services are now integrated with FreedomCamp Manager.

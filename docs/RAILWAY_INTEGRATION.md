# Railway Services Integration Guide

This document describes how the FreedomCamp Manager application integrates with Railway-deployed backend services.

---

## 🚂 Deployed Services

### 1. **Proxy Server**
- **Purpose**: Secure API gateway for NZSCV and MotorWeb queries
- **Technology**: Node.js + Express
- **Deployment**: Railway (auto-deployed from `proxy-server/` directory)
- **URL**: Set via `PROXY_SERVER_URL` environment secret in Supabase

**Endpoints:**
- `GET /health` - Health check
- `POST /nzscv/check` - Query NZSCV register for warrant status
- `POST /motorweb/enrich` - Fetch vehicle details from MotorWeb

**Why we need it:**
- NZSCV/MotorWeb APIs require IP whitelisting
- Railway provides static IP addresses
- Frontend cannot call these APIs directly

---

### 2. **Inference Service**
- **Purpose**: Vehicle photo analysis, face detection, and embedding generation
- **Technology**: Node.js + ONNX Runtime
- **Models**: YOLOv8n (vehicle detection), UltraFace-640 (face detection), MobileNetV3 (384-D embeddings)
- **Deployment**: Railway (auto-deployed from `inference-service/` directory)
- **URL**: Set via `INFERENCE_SERVICE_URL` environment secret in Supabase

**Endpoints:**
- `GET /health` - Health check
- `POST /analyze` - Detect vehicle in photo + generate embedding
- `POST /compare` - Compare two vehicle embeddings (similarity score)
- `POST /select-best` - Choose best photo from multiple candidates
- `POST /infer/face` - Face detection with embeddings for POI matching

**Why we need it:**
- Vehicle photo matching for duplicate detection
- Profile photo selection (best quality/angle)
- Offline-first vehicle recognition
- **Face recognition** for Person of Interest (POI) matching

**Face Recognition Feature:**
The face recognition feature (`FaceRecognition` component) requires the inference service to be configured. Without `INFERENCE_SERVICE_URL` set in Supabase secrets, users will see:
- "AI Service Unavailable" warning banner
- "Service Not Available" message in the empty state
- Error toast when attempting to capture: "Face recognition service is not available"

If the inference service requires API key authentication:
- "API Key Required" warning banner will appear
- Set `INFERENCE_API_KEY` in Supabase secrets to authenticate

---

## 🔧 Configuration

### Environment Variables

**Supabase Edge Function Secrets** (set in Supabase Dashboard → Edge Functions → Manage Secrets):

```bash
PROXY_SERVER_URL=https://your-proxy-server.railway.app
INFERENCE_SERVICE_URL=https://your-inference-service.railway.app
# Optional: API key for inference service authentication (if required)
INFERENCE_API_KEY=your-api-key-here
```

**Frontend Environment Variables** (`.env` file - optional, only for direct health checks):

```bash
VITE_PROXY_SERVER_URL=https://your-proxy-server.railway.app
VITE_INFERENCE_SERVICE_URL=https://your-inference-service.railway.app
```

**Note:** Frontend should NEVER call Railway services directly. All calls must go through Supabase Edge Functions for proper authentication and rate limiting.

---

## 📡 Integration Architecture

```
┌──────────────┐
│   Frontend   │
│  (React SPA) │
└───────┬──────┘
        │
        │ supabase.functions.invoke()
        ▼
┌───────────────────┐
│ Supabase Edge     │
│ Functions (Deno)  │
└───────┬───────────┘
        │
        │ HTTP fetch()
        ▼
┌───────────────────┐       ┌──────────────────┐
│  Proxy Server     │◄──────┤  NZSCV/MotorWeb  │
│  (Railway)        │       │  External APIs   │
└───────────────────┘       └──────────────────┘

        │
        ▼
┌───────────────────┐
│ Inference Service │
│  (Railway)        │
│  YOLOv8n + MNv3   │
└───────────────────┘
```

---

## 🔌 Usage Examples

### Check NZSCV Warrant Status

```typescript
import { checkNZSCVStatus } from '@/lib/railway'

const result = await checkNZSCVStatus('ABC123')
// Returns:
// {
//   plate_number: 'ABC123',
//   warrant_type: 'green',
//   warrant_number: 'SC12345',
//   expires_on: '2025-12-31',
//   is_valid: true
// }
```

### Enrich Vehicle from MotorWeb

```typescript
import { enrichFromMotorWeb } from '@/lib/railway'

const vehicleData = await enrichFromMotorWeb('ABC123')
// Returns:
// {
//   plate_number: 'ABC123',
//   make: 'Toyota',
//   model: 'Hiace',
//   year: 2020,
//   colour: 'White',
//   body_style: 'Van'
// }
```

### Analyze Vehicle Photo

```typescript
import { analyzeVehiclePhoto } from '@/lib/railway'

const analysis = await analyzeVehiclePhoto('https://example.com/photo.jpg')
// Returns:
// {
//   detected: true,
//   confidence: 0.95,
//   bounding_box: { x: 100, y: 150, width: 400, height: 300 },
//   embedding: [0.123, -0.456, ...], // 384-D vector
//   quality_score: 0.87
// }
```

### Select Best Vehicle Photo

```typescript
import { selectBestVehiclePhoto } from '@/lib/railway'

const best = await selectBestVehiclePhoto([
  'https://example.com/photo1.jpg',
  'https://example.com/photo2.jpg',
  'https://example.com/photo3.jpg'
])
// Returns:
// {
//   best_photo_url: 'https://example.com/photo2.jpg',
//   quality_score: 0.92,
//   reasons: ['sharp focus', 'good lighting', 'full vehicle visible']
// }
```

---

## 🧪 Testing Railway Services

### Health Checks

```typescript
import { checkRailwayServicesHealth } from '@/lib/railway'

const health = await checkRailwayServicesHealth()
// Returns:
// {
//   proxy: { status: 'ok', uptime: 123456 },
//   inference: { status: 'ok', models_loaded: true }
// }
```

### Manual Testing (via Edge Functions)

```bash
# Test NZSCV check
curl -X POST https://your-project.supabase.co/functions/v1/check-nzscv-status \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plateNumber": "ABC123"}'

# Test vehicle photo analysis
curl -X POST https://your-project.supabase.co/functions/v1/analyze-vehicle-photo \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"photoUrl": "https://example.com/photo.jpg"}'
```

---

## 🚨 Troubleshooting

### Error: "Railway service timeout"
- **Cause**: Cold start (Railway spins down idle services)
- **Solution**: First request after idle may take 10-30s. Retry once.

### Error: "IP not whitelisted"
- **Cause**: NZSCV/MotorWeb APIs only accept requests from Railway IPs
- **Solution**: Verify Railway deployment is active. Check proxy server logs.

### Error: "Model not loaded"
- **Cause**: Inference service failed to download ONNX models
- **Solution**: Check Railway logs. Run `npm run download-models` locally to verify model URLs.

### Error: "CORS policy blocked"
- **Cause**: Frontend trying to call Railway services directly
- **Solution**: Always use Edge Functions as proxy. Never expose Railway URLs to frontend.

### Error: "Face recognition service is not available" / "AI Service Unavailable"
- **Cause**: `INFERENCE_SERVICE_URL` secret is not configured in Supabase
- **Solution**: 
  1. Deploy the inference service to Railway (see Part 3.2 in NEW_PROJECT_SETUP.md)
  2. Set `INFERENCE_SERVICE_URL` secret in Supabase Dashboard → Edge Functions → Manage Secrets
  3. Verify with: `curl https://YOUR_INFERENCE_URL/health`

### Error: "Inference service not configured"
- **Cause**: Edge function cannot find `INFERENCE_SERVICE_URL` environment variable
- **Solution**: Same as above. Ensure the secret is set in Supabase Edge Functions configuration.

### Error: "API Key Required" / Authentication failed (401/403)
- **Cause**: The inference service requires API key authentication but `INFERENCE_API_KEY` is not configured
- **Solution**:
  1. Check the inference service's health endpoint: `curl https://YOUR_INFERENCE_URL/health`
  2. If `INFERENCE_API_KEY_SET: true` appears in the response, the service requires authentication
  3. Get the API key from your Railway deployment (check environment variables)
  4. Set `INFERENCE_API_KEY` in Supabase Dashboard → Edge Functions → Manage Secrets
  5. The key must match what's configured on the Railway inference service

### Error: "Authentication failed" on face detection
- **Cause**: Either session expired or API key mismatch
- **Solution**:
  1. Try logging out and logging back in
  2. If the issue persists, verify `INFERENCE_API_KEY` matches between Supabase secrets and Railway

---

## 📚 Related Documentation

- [Proxy Server Setup](../proxy-server/README.md)
- [Inference Service Setup](../inference-service/README.md)
- [Edge Functions Guide](../supabase/functions/README_REBUILD.md)
- [Environment Variables](../.env.example)

---

## 🔐 Security Notes

1. **Never expose Railway URLs to frontend code**
   - Frontend should only call Supabase Edge Functions
   - Edge Functions authenticate users before calling Railway services

2. **Railway services should have CORS disabled**
   - Only accept requests from Supabase Edge Function IPs
   - Use API keys/tokens for additional security

3. **Rate limiting**
   - Implement rate limiting in Edge Functions
   - Railway services should reject requests without valid tokens

4. **Logging**
   - All Railway service calls should be logged in Edge Functions
   - Include user ID, timestamp, and request parameters
   - Store logs in Supabase for audit trail

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
- **Purpose**: Vehicle photo analysis and embedding generation
- **Technology**: Node.js + ONNX Runtime
- **Models**: YOLOv8n (vehicle detection) + MobileNetV3 (384-D embeddings)
- **Deployment**: Railway (auto-deployed from `inference-service/` directory)
- **URL**: Set via `INFERENCE_SERVICE_URL` environment secret in Supabase

**Endpoints:**
- `GET /health` - Health check
- `POST /analyze` - Detect vehicle in photo + generate embedding
- `POST /compare` - Compare two vehicle embeddings (similarity score)
- `POST /select-best` - Choose best photo from multiple candidates

**Why we need it:**
- Vehicle photo matching for duplicate detection
- Profile photo selection (best quality/angle)
- Offline-first vehicle recognition

---

## 🔧 Configuration

### Environment Variables

**Supabase Edge Function Secrets** (set in Supabase Dashboard → Edge Functions → Manage Secrets):

```bash
PROXY_SERVER_URL=https://your-proxy-server.railway.app
INFERENCE_SERVICE_URL=https://your-inference-service.railway.app
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

# 🚀 ORC/AI Inference Service

**Vehicle Detection + Embedding Generation**

This microservice processes vehicle photos to generate 384-dimensional embeddings for similarity matching.

---

## **Architecture**

```
┌─────────────────┐
│  Supabase Edge  │
│   orc-ingest    │
└────────┬────────┘
         │ POST /infer
         │ (photo)
         ↓
┌─────────────────┐
│ Inference Svc   │
│  (This service) │
│                 │
│  YOLOv8n        │─→ Detect vehicle
│  MobileNetV3    │─→ Generate 384D embedding
└────────┬────────┘
         │
         ↓ Returns:
    {
      embedding: [0.123, ...],
      quality: 0.87,
      confidence: 0.92
    }
```

---

## **Quick Start**

### **1. Install Dependencies**

```bash
npm install
```

### **2. Download Pretrained Models**

```bash
# Create models directory
mkdir -p models

# Download YOLOv8n (vehicle detection)
curl -L https://raw.githubusercontent.com/Hyuto/yolov8-onnxruntime-web/master/public/model/yolov8n.onnx \
  -o models/yolov8n.onnx

# Download MobileNetV3 (embeddings)
curl -L https://media.githubusercontent.com/media/onnx/models/main/Computer_Vision/mobilenetv3_large_100_Opset17_timm/mobilenetv3_large_100_Opset17.onnx \
  -o models/mobilenet_v3.onnx
```

### **3. Configure Environment**

```bash
cp .env.example .env
# Edit .env with your Supabase URL
```

Optional ONNX runtime tuning for latency/throughput/quality tradeoffs:

```env
ONNX_RUNTIME_PROFILE=balanced   # latency | throughput | quality | balanced
# ONNX_EXECUTION_MODE=parallel  # override profile default
# ONNX_GRAPH_OPT_LEVEL=all      # disabled | basic | extended | all
# ONNX_INTRA_OP_THREADS=4
# ONNX_INTER_OP_THREADS=1
# YOLO_INPUT_SIZE=640
```

### **4. Run Locally**

```bash
npm start
```

Service runs on http://localhost:3000

### **5. Benchmark ONNX Runtime Profiles**

Use this to compare latency/throughput across `latency`, `balanced`, and `throughput` profiles on your target host:

```bash
npm run benchmark:onnx-profiles
```

Optional custom run:

```bash
node scripts/benchmark-onnx-runtime-profiles.mjs --profiles latency,balanced,throughput --iterations 20 --warmup 5
```

The benchmark writes JSON output to `inference-service/data/onnx-runtime-benchmark.json`.
You can render a commit-ready markdown summary from the JSON report:

```bash
node ../scripts/summarize-onnx-runtime-benchmark.mjs \
  --in data/onnx-runtime-benchmark.json \
  --out data/onnx-runtime-benchmark.md
```

Note: `onnxruntime-node` requires a glibc-compatible runtime. On musl-based Alpine hosts, run this benchmark in a glibc container/runner (for example Debian/Ubuntu or your RunPod image).

For repeatable CI benchmarking on Ubuntu/glibc, use workflow `.github/workflows/ops-onnx-runtime-profile-benchmark.yml` (manual dispatch or scheduled weekly).

Deployment note: Bob inference deployments are triggered by changes under inference-service/ on main (syncs to DonSquires/Bob, deploys to RunPod).

---

## **API Reference**

### **POST /nlp/tabular/analyze**

Analyze tabular import samples (XLSX/CSV rows) for date format and data quality.

This endpoint is designed for historical import workflows and can run fully local with
`TABULAR_NLP_PROVIDER=heuristic` (no external providers required).

Authentication for this endpoint supports either:
- `x-inference-api-key` matching `INFERENCE_API_KEY`
- `Authorization: Bearer <supabase_jwt>` verified against Supabase JWKS

**Request:**
```bash
curl -X POST http://localhost:3000/nlp/tabular/analyze \
  -H "Content-Type: application/json" \
  -H "x-inference-api-key: $INFERENCE_API_KEY" \
  -d '{
    "sampleRows": [
      ["ID","Title","RecordedDate","REGO","Note"],
      ["1","Bendigo","10/03/2026","ABC123",""],
      ["2","Lowburn",46091,"XYZ987",""]
    ]
  }'
```

**Response (200):**
```json
{
  "success": true,
  "provider": "heuristic",
  "analysis": {
    "dateFormat": "dd/mm/yyyy",
    "dateFormatConfidence": 0.9,
    "totalRowsAnalyzed": 2,
    "blankDates": 0,
    "blankZones": 0,
    "blankPlates": 0,
    "blankNotes": 2,
    "dataQualityIssues": [],
    "recommendations": []
  }
}
```

### **POST /chat**

User-facing assistant endpoint with local-first behavior.

In strict self-contained mode:
- `CHAT_PROVIDER=heuristic` returns deterministic local responses.
- `CHAT_PROVIDER=ollama` is allowed only when `OLLAMA_BASE_URL` is local.
- Any cloud provider path is blocked by runtime egress policy.

Authentication:
- `x-inference-api-key` matching `INFERENCE_API_KEY`
- `Authorization: Bearer <supabase_jwt>` (if JWKS auth is enabled)
- `Authorization: Bearer <service_role_key>`

**Request:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "x-inference-api-key: $INFERENCE_API_KEY" \
  -d '{
    "message": "What is our current enforcement status?",
    "history": [],
    "context": { "tone": "brief" }
  }'
```

**Response (200):**
```json
{
  "success": true,
  "provider": "heuristic",
  "fallback": false,
  "message": "Service is running in self-contained mode..."
}
```

### **POST /self-heal/bug-report**

Build-aware self-healing planning endpoint for bug report automation.

Enterprise contract:
- Accepts `x-request-id` for trace correlation
- Accepts `x-idempotency-key` for safe client retries
- Returns `request_id`, `idempotency`, and `meta` in the response envelope
- Writes audit entries to `data/self-heal-audit.jsonl`

It returns:
- Bug classification
- Reproduction checklist
- Remediation steps
- Safeguards and rollout recommendations
- NZ compliance guidance note (operational, not legal advice)

**Request:**
```bash
curl -X POST http://localhost:3000/self-heal/bug-report \
  -H "Content-Type: application/json" \
  -H "x-inference-api-key: $INFERENCE_API_KEY" \
  -H "x-request-id: self-heal-demo-001" \
  -H "x-idempotency-key: self-heal-demo-001" \
  -d '{
    "report": {
      "summary": "Inference endpoint intermittently returns 500 on large uploads",
      "severity": "high",
      "stack_trace": "TypeError: Cannot read properties of undefined",
      "service": "inference-service"
    }
  }'
```

### **GET /self-heal/knowledge**

Returns loaded knowledge packs used by the self-healing planner:
- FieldOps build context
- NZ compliance context
- Structured coding/problem-solving context

Enterprise contract:
- Dedicated read rate limit via `SELF_HEAL_READ_RATE_LIMIT_RPM`
- Structured response envelope with `request_id`

### **POST /self-heal/patch-task**

Generates a machine-readable patch task payload for your auto-fix worker.

Enterprise contract:
- Dedicated write rate limit via `SELF_HEAL_WRITE_RATE_LIMIT_RPM`
- Supports `x-idempotency-key` replay protection
- Structured error codes for automation callers

**Request:**
```bash
curl -X POST http://localhost:3000/self-heal/patch-task \
  -H "Content-Type: application/json" \
  -H "x-inference-api-key: $INFERENCE_API_KEY" \
  -H "x-idempotency-key: patch-task-demo-001" \
  -d '{
    "report": {
      "summary": "TypeError in patrol sync route",
      "severity": "medium",
      "stack_trace": "TypeError: Cannot read properties of undefined"
    }
  }'
```

### **POST /intel/ingest-bulletin**

Secure local ingestion endpoint for updates related to:
- NZ laws/policy
- security risks/advisories
- jurisdiction boundary changes
- partner/system operational notices

This endpoint does not fetch external data itself. You push vetted bulletins into it.

If `INTEL_HMAC_KEY` is set, send `x-intel-signature` with SHA-256 HMAC of the raw JSON body.

### **GET /intel/state**

Returns stored intelligence bulletins and category counts for downstream decision logic.

### **Secure Bulletin Feeder Script**

Use the local feeder script to push vetted updates into `/intel/ingest-bulletin`:

```bash
# Dry-run first
npm run intel:push-bulletin -- \
  --file scripts/example-intel-bulletin.json \
  --url https://your-inference-service/intel/ingest-bulletin \
  --api-key "$INFERENCE_API_KEY" \
  --hmac-key "$INTEL_HMAC_KEY" \
  --dry-run true

# Real push
npm run intel:push-bulletin -- \
  --file scripts/example-intel-bulletin.json \
  --url https://your-inference-service/intel/ingest-bulletin \
  --api-key "$INFERENCE_API_KEY" \
  --hmac-key "$INTEL_HMAC_KEY"
```

Environment variable fallback is supported:
- `INTEL_INGEST_URL`
- `INFERENCE_API_KEY`
- `INTEL_HMAC_KEY`

### **Automated Feed Harvester**

Use the scheduled harvester to scan vetted websites/feeds and ingest useful updates:

```bash
INTEL_FEED_URLS="https://example.com/rss,https://example.com/advisories.json" \
INTEL_INGEST_URL="https://your-inference-service/intel/ingest-bulletin" \
INFERENCE_API_KEY="$INFERENCE_API_KEY" \
INTEL_HMAC_KEY="$INTEL_HMAC_KEY" \
npm run intel:harvest-feeds
```

Optional DB sync to Supabase:
- `INTEL_ENABLE_DB_SYNC=true`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTEL_ORGANIZATION_ID`
- `INTEL_DB_TABLE` (default `external_intel_bulletins`)

Safety controls:
- `INTEL_ALLOWED_HOSTS` to restrict scanning to approved domains only.
- `INTEL_DRY_RUN=true` to test harvesting without ingesting or writing to DB.

When explicit identifiers are found, the harvester can also add:
- `persons_of_interest`
- `vehicles_of_interest`

Approval model:
- Harvested bulletins are stored as `approval_status=pending`.
- POI/VOI candidates are stored on the bulletin (`poi_candidate`, `voi_candidate`) and are not auto-promoted.
- Only `master` / `grand_master` should approve and promote via DB function:
  - `approve_external_intel_bulletin(...)`

Emergency/public safety model:
- High-risk events (Amber Alert, active offender, civil defense, severe weather, emergency alerts) create pending rows in `public_safety_alerts`.
- Only `master` / `grand_master` can activate/reject via:
  - `approve_public_safety_alert(...)`
- Active alerts are shown as acknowledgement banners in the app layout for targeted users.
- National scope alerts are shown to all users.
- Regional scope alerts are targeted using `INTEL_REGION_ORG_MAP` and neighboring-region expansion.

### **POST /infer**

Generate vehicle embedding from photo.

**Request:**
```bash
curl -X POST http://localhost:3000/infer \
  -F "photo=@vehicle.jpg"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, 0.456, ...],  // 384 floats
    "embedding_quality": 0.87,
    "embedding_model_version": "yolov8n_mobilenetv3_v1.0",
    "detection": {
      "confidence": 0.92,
      "bbox": { "x": 120, "y": 80, "width": 300, "height": 200 },
      "class": 2
    },
    "metadata": {
      "norm": 8.6,
      "dimension": 384,
      "processing_time_ms": 245
    }
  }
}
```

**Error (404):**
```json
{
  "error": "No vehicle detected",
  "suggestion": "Ensure photo contains a clear vehicle"
}
```

---

### **GET /health**

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "models": {
    "yolo": "loaded",
    "embedding": "loaded"
  },
  "uptime": 12345.67,
  "memory": { ... }
}
```

---

## **Deployment**

### **Option 1: Fly.io (Recommended)**

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly launch --name orc-ai-inference

# Set secrets
fly secrets set ALLOWED_ORIGINS="https://your-project.supabase.co"

# Deploy
fly deploy

# Get URL
fly info
# Example: https://orc-ai-inference.fly.dev
```

**Cost:** ~$5-10/month (shared-cpu-1x, 256MB RAM)

---

### **Option 2: Render**

1. Go to https://render.com
2. Click **New** → **Web Service**
3. Connect GitHub repo
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Add `ALLOWED_ORIGINS`
5. Deploy

**Cost:** $7/month (Starter plan)

---

### **Option 3: Railway**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up

# Get URL
railway domain
```

**Cost:** $5/month (Hobby plan)

---

## **Testing**

### **Pretrain Self-Learning State**

Seed the local self-learning model with a baseline profile before first runtime:

```bash
npm run pretrain:self-learning
```

This writes `data/self-learning-state.json` and improves first-run threshold quality.
In Railway Docker builds, this pretraining step is executed automatically.

### **Local Test**

```bash
# Start service
npm start

# Test with sample image
curl -X POST http://localhost:3000/infer \
  -F "photo=@test-vehicle.jpg" \
  | jq .
```

### **Production Test**

```bash
# Replace with your deployed URL
INFERENCE_URL="https://orc-ai-inference.fly.dev"

curl -X POST $INFERENCE_URL/infer \
  -F "photo=@vehicle.jpg" \
  | jq .
```

---

## **Performance**

**Typical Processing Times:**
- Vehicle detection (YOLOv8n): ~50-100ms
- Embedding generation (MobileNetV3): ~100-150ms
- **Total:** ~200-300ms per photo

**Throughput:**
- Single CPU: ~3-5 requests/second
- With load balancing: ~30-50 requests/second

---

## **Model Details**

### **YOLOv8n (Vehicle Detection)**
- **Size:** 6.2 MB
- **Input:** 640x640 RGB image
- **Output:** Bounding boxes + class probabilities
- **Classes:** Car (2), Motorcycle (3), Bus (5), Truck (7)

### **MobileNetV3-Large (Embeddings)**
- **Size:** 21 MB
- **Input:** 224x224 RGB image (cropped vehicle)
- **Output:** 384D feature vector
- **Normalization:** ImageNet mean/std

---

## **Monitoring**

### **Logs**

```bash
# Fly.io
fly logs

# Render
# Check dashboard

# Railway
railway logs
```

### **Metrics**

- Request count
- Average processing time
- Error rate
- Memory usage

---

## **Troubleshooting**

### **"No vehicle detected" errors**

**Causes:**
- Poor lighting
- Vehicle too small in frame
- Obstructed view

**Solutions:**
- Ask officer to retake photo
- Ensure vehicle fills ≥30% of frame
- Good lighting conditions

### **Slow inference (>1 second)**

**Causes:**
- CPU overload
- Large images (>5MB)

**Solutions:**
- Scale to more instances
- Resize images on client before upload
- Upgrade to CPU-optimized instance

### **Memory errors**

**Causes:**
- Too many concurrent requests
- Memory leak

**Solutions:**
- Add request queue (max 5 concurrent)
- Restart service daily (cron job)

---

## **Security**

### **Authentication in Production (Build-Training Mode)**

> ⚠️ **Known limitation:** When Bob is deployed on RunPod with `SELF_CONTAINED_STRICT_EGRESS=true`
> (locked-down mode), outbound network calls are blocked — including the JWKS fetch required
> to verify Supabase user JWTs.
>
> **In production, Edge Functions must authenticate to Bob using one of:**
> - `x-inference-api-key: <INFERENCE_API_KEY>` header (recommended)
> - `x-inference-api-key: <SUPABASE_SERVICE_ROLE_KEY>` header (accepted as equivalent)
>
> User-issued JWTs (`Authorization: Bearer <supabase_jwt>`) are **not** accepted when strict egress
> is enabled. Set `INFERENCE_API_KEY` on the Bob RunPod pod and in Supabase vault — both must
> have the same value.
>
> See [docs/SECRETS_REGISTRY.md](../docs/SECRETS_REGISTRY.md) for the full secrets setup guide.

### **CORS**

Only allow requests from your Supabase Edge Function:

```env
ALLOWED_ORIGINS=https://your-project.supabase.co
```

### **Rate Limiting**

Self-heal routes now use dedicated enterprise limits:

```env
SELF_HEAL_READ_RATE_LIMIT_RPM=60
SELF_HEAL_WRITE_RATE_LIMIT_RPM=20
SELF_HEAL_IDEMPOTENCY_TTL_MS=86400000
SELF_HEAL_IDEMPOTENCY_MAX_ENTRIES=500
SELF_HEAL_AUDIT_LOG_PATH=./data/self-heal-audit.jsonl
SELF_HEAL_IDEMPOTENCY_PATH=./data/self-heal-idempotency.json
```

Generic inference middleware still uses `express-rate-limit`:

```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

app.use('/infer', rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30 // Max 30 requests per minute
}));
```

---

## **Next Steps**

1. ✅ Deploy this service to Fly.io/Render
2. ✅ Test `/infer` endpoint with sample photos
3. ✅ Note the deployed URL (e.g., `https://orc-ai-inference.fly.dev`)
4. ⏭️ Create `orc-ingest` Edge Function to call this service
5. ⏭️ Update frontend to use `orc-ingest` instead of deleted ALPR

---

**Need help?** Check deployment guide in `PHASE_2_INFERENCE_SERVICE_SETUP.md`

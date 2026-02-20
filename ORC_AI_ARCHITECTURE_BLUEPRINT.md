# 🚀 **ORC/AI Architecture Blueprint**

**Vehicle Fingerprinting System - ALPR Replacement**

---

## 📋 **Executive Summary**

**What**: Replace legacy ALPR (Automatic License Plate Recognition) with **ORC/AI Vehicle Fingerprinting**  
**Why**: Homeless vehicles often lack/obscure plates; ALPR has vendor complexity, CORS issues, 600-3000ms latency  
**How**: Computer vision detects vehicle shape/color/silhouette → generates 256-512D vector embedding → matches via cosine similarity  
**Timeline**: 3-4 weeks (architecture 2-3 days, model selection/training 1-2 weeks, integration 1-2 weeks, testing 1 week)  
**Resources**: ML expertise, GPU infrastructure (~$2000-5000), 500-1000 labeled NZ vehicle images

---

## 🎯 **Core Principle**

**"Fingerprint the vehicle, not the plate"**

- Works without visible plates (dirty, removed, obscured, missing)
- Performs better in poor lighting/angles than OCR
- Enables repeat-offender matching even when plates change
- 30-60ms local inference vs 600-3000ms external API

---

## 🏗️ **High-Level Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│ OFFICER CAPTURE (unchanged)                                      │
│ ┌─────────────────────┐                                          │
│ │ ZoomScan / PlateCapture │ → Watermark + GPS + Timestamp        │
│ └─────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ EDGE FUNCTION: orc-ingest (NEW)                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ 1. Store Evidence (photo + hash + EXIF)                    │  │
│ │ 2. Call Inference Microservice (vehicle detection)         │  │
│ │ 3. Insert Observation + Vehicle Embedding                  │  │
│ │ 4. Match Top-K Similar Vehicles (pgvector cosine)          │  │
│ │ 5. Return: observation_id, embedding_quality, matches      │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ INFERENCE MICROSERVICE (private)                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ POST /infer { imageBytes or dataURL }                      │  │
│ │                                                             │  │
│ │ → YOLO/Detr: Detect vehicle region (bounding box)          │  │
│ │ → Crop to vehicle                                           │  │
│ │ → ONNX Embedder: Generate 256-512D vector                  │  │
│ │ → Quality score (0-1)                                       │  │
│ │                                                             │  │
│ │ ← { embedding: number[], quality: float, model_version }   │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ DATABASE: vehicle_observations_v2 (pgvector)                     │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ + vehicle_embedding vector(384)                            │  │
│ │ + embedding_quality real                                   │  │
│ │ + embedding_model_version text                             │  │
│ │ + embedding_created_at timestamptz                         │  │
│ │                                                             │  │
│ │ INDEX: ivfflat (vehicle_embedding vector_cosine_ops)       │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ RPC: match_vehicle(obs_id, k=5, since=90days)                   │
│  → Returns top-k similar vehicles by cosine similarity          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ UI: Vehicle Match Results                                        │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ "Likely same vehicle as:"                                  │  │
│ │  • ABC123 (similarity: 0.92) - 2 days ago                  │  │
│ │  • XYZ789 (similarity: 0.87) - 1 week ago                  │  │
│ │                                                             │  │
│ │ Quality: ⭐⭐⭐⭐ (0.93)                                      │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧠 **Model Selection Matrix**

### **Recommended Stack (POC)**

| Component | Technology | Why |
|-----------|-----------|-----|
| **Detection** | YOLOv8n (Nano) | Fast (5-10ms), small (6MB), runs on CPU |
| **Embedding** | MobileNetV3 + ArcFace | 256D vectors, proven for vehicle re-identification |
| **Runtime** | ONNX Runtime (Node.js) | Cross-platform, CPU/GPU, 20-40ms inference |
| **Hosting** | Fly.io or Render | Private microservice, ~$10-20/month |
| **Similarity** | pgvector (Supabase) | Native PostgreSQL, cosine distance, IVFFlat index |

### **Alternative Options**

**Production-Grade (Better Accuracy)**:
- Detection: Faster R-CNN (ResNet50 backbone) - slower but more accurate
- Embedding: ResNet50 + Triplet Loss - 512D vectors, better for large-scale
- Runtime: TensorRT (NVIDIA GPU) - 5-15ms inference but requires GPU

**Managed Service (Fastest POC)**:
- Google Cloud Vision API (Vehicle Detection)
- Azure Custom Vision (Vehicle Embeddings)
- ⚠️ **Tradeoff**: Vendor lock-in, recurring cost (~$1.50/1000 images)

---

## 📊 **Database Schema Changes**

### **Add Vector Columns to Observations**

```sql
-- Enable pgvector extension
create extension if not exists vector;

-- Add embedding fields to vehicle_observations_v2
alter table vehicle_observations_v2
  add column if not exists vehicle_embedding vector(384),
  add column if not exists embedding_quality real,
  add column if not exists embedding_model_version text,
  add column if not exists embedding_created_at timestamptz;

-- Similarity index for fast top-k (requires populated table)
create index if not exists idx_obs_embed_ivfflat
  on vehicle_observations_v2 using ivfflat (vehicle_embedding vector_cosine_ops)
  with (lists = 100);

-- Plain index for time filtering
create index if not exists idx_obs_recorded_at 
  on vehicle_observations_v2(recorded_at);
```

### **Match Function (Top-K Similarity)**

```sql
create or replace function match_vehicle(
  p_obs_id uuid,
  p_k int default 5,
  p_since timestamptz default now() - interval '90 days',
  p_org uuid default null,
  p_zone uuid default null
) returns table (
  match_observation_id uuid,
  score real,
  recorded_at timestamptz,
  zone_id uuid
) language sql stable as $$
  with q as (
    select vehicle_embedding emb
    from vehicle_observations_v2
    where id = p_obs_id and vehicle_embedding is not null
  )
  select 
    o.id, 
    1 - (o.vehicle_embedding <=> q.emb) as score,
    o.recorded_at,
    o.zone_id
  from vehicle_observations_v2 o, q
  where o.id <> p_obs_id
    and o.vehicle_embedding is not null
    and o.recorded_at >= p_since
    and (p_org is null or o.organization_id = p_org)
    and (p_zone is null or o.zone_id = p_zone)
  order by o.vehicle_embedding <=> q.emb asc
  limit p_k;
$$;
```

---

## ⚙️ **Edge Function: orc-ingest**

**Path**: `supabase/functions/orc-ingest/index.ts`

```typescript
// Receives image → stores evidence → calls inference → writes embedding
const INFERENCE_URL = Deno.env.get('INFERENCE_SERVICE_URL') ?? '';
const INFERENCE_TOKEN = Deno.env.get('INFERENCE_AUTH_TOKEN') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const { image, zoneId, organizationId, gpsLocation, userId } = await req.json();

    // 1. Hash + store evidence
    const photoHash = await sha256(image);
    const photoUrl = await uploadEvidence(image, photoHash);

    // 2. Call inference microservice
    const inferenceResp = await fetch(`${INFERENCE_URL}/infer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INFERENCE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageDataUrl: image }),
    });

    if (!inferenceResp.ok) throw new Error('Inference failed');
    const { embedding, quality, model_version } = await inferenceResp.json();

    // 3. Insert observation with embedding
    const { data: obs, error: obsError } = await supabaseClient
      .from('vehicle_observations_v2')
      .insert({
        photo: photoUrl,
        photo_hash: photoHash,
        zone_id: zoneId,
        organization_id: organizationId,
        recorded_by: userId,
        recorded_at: new Date().toISOString(),
        gps_latitude: gpsLocation?.lat,
        gps_longitude: gpsLocation?.lng,
        vehicle_embedding: embedding,
        embedding_quality: quality,
        embedding_model_version: model_version,
        embedding_created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (obsError) throw obsError;

    // 4. Find top-3 matches
    const { data: matches } = await supabaseClient
      .rpc('match_vehicle', {
        p_obs_id: obs.id,
        p_k: 3,
        p_org: organizationId,
      });

    return jsonResponse({
      observation_id: obs.id,
      embedding_quality: quality,
      matches: matches || [],
    });

  } catch (error) {
    return errorResponse(error);
  }
});
```

---

## 🖥️ **Inference Microservice (Node.js + ONNX)**

**Path**: `inference-service/server.js`

```javascript
const express = require('express');
const onnx = require('onnxruntime-node');
const sharp = require('sharp');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Load ONNX models (YOLOv8 + MobileNetV3)
let detectorSession, embedderSession;

async function init() {
  detectorSession = await onnx.InferenceSession.create('./models/yolov8n.onnx');
  embedderSession = await onnx.InferenceSession.create('./models/mobilenetv3_arcface.onnx');
  console.log('✅ Models loaded');
}

app.post('/infer', async (req, res) => {
  try {
    const { imageDataUrl } = req.body;
    const imageBuffer = Buffer.from(imageDataUrl.split(',')[1], 'base64');

    // Step 1: Detect vehicle region (YOLO)
    const detections = await detectVehicle(imageBuffer);
    if (!detections || detections.length === 0) {
      return res.status(400).json({ error: 'No vehicle detected' });
    }

    const bbox = detections[0]; // [x, y, w, h]

    // Step 2: Crop to vehicle
    const cropped = await sharp(imageBuffer)
      .extract({ left: bbox[0], top: bbox[1], width: bbox[2], height: bbox[3] })
      .resize(224, 224) // MobileNetV3 input size
      .toBuffer();

    // Step 3: Generate embedding
    const embedding = await generateEmbedding(cropped);

    // Step 4: Quality score (based on detection confidence + embedding norm)
    const quality = Math.min(1.0, bbox.confidence * 1.2);

    res.json({
      embedding: Array.from(embedding),
      quality,
      model_version: 'yolov8n_mobilenetv3_v1.0',
    });

  } catch (error) {
    console.error('Inference error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function detectVehicle(imageBuffer) {
  // Preprocess + run YOLO inference
  // Returns [{ x, y, w, h, confidence, class }]
  // Filter for class 'car', 'truck', 'bus', 'van'
}

async function generateEmbedding(croppedBuffer) {
  // Preprocess + run MobileNetV3 + ArcFace
  // Returns Float32Array of length 256-512
}

init().then(() => {
  app.listen(3001, () => console.log('🚀 Inference service ready on :3001'));
});
```

---

## 🎨 **UI Updates**

### **Officer Capture (ZoomScan/PlateCapture)**

**Current**:
```typescript
const { data } = await supabase.functions.invoke('plate-scanner-photo-first', { ... });
// Shows: "ABC123 detected (92% confidence)"
```

**New ORC/AI**:
```typescript
const { data } = await supabase.functions.invoke('orc-ingest', { ... });
// Shows: 
// "Vehicle fingerprinted (quality: ⭐⭐⭐⭐)"
// "Likely same as: ABC123 (2 days ago, similarity 92%)"
```

### **Admin Portal - Vehicle Matches**

**New Panel**: "Vehicle Signature Matches"

```tsx
<Card>
  <CardHeader>
    <CardTitle>Likely Same Vehicle</CardTitle>
  </CardHeader>
  <CardContent>
    {matches.map(match => (
      <div key={match.id} className="flex items-center justify-between">
        <div>
          <p className="font-bold">{match.plate_number || 'No Plate'}</p>
          <p className="text-sm text-muted-foreground">
            {formatDistanceToNow(match.recorded_at)} ago • {match.zone_name}
          </p>
        </div>
        <Badge variant={match.score >= 0.9 ? 'default' : 'secondary'}>
          {Math.round(match.score * 100)}% match
        </Badge>
      </div>
    ))}
  </CardContent>
</Card>
```

---

## ✅ **Acceptance Tests**

### **Must Pass Before Production**

1. **Ingest Latency**: p95 ≤ 3s (Edge → Inference → DB)
2. **Vector Quality**: ≥80% daytime shots have quality ≥0.8; ≥60% night shots
3. **Repeat Detection**: For seeded repeat vehicles, top-1 match ≥80% accuracy (day); top-3 ≥80% (night)
4. **No Vendor Calls**: Zero requests to ALPR endpoints; no Plate Recognizer secrets
5. **Officer UX**: Capture never spins; errors handled gracefully; results visible ≤5s

### **Test Scenarios**

| Scenario | Expected Result | Status |
|----------|-----------------|--------|
| Same vehicle, same angle, 1 hour apart | Top-1 match ≥0.95 | ⏳ Pending |
| Same vehicle, different angle, 1 day apart | Top-1 match ≥0.85 | ⏳ Pending |
| Same vehicle, different lighting (day→night) | Top-3 match ≥0.80 | ⏳ Pending |
| Different vehicle, similar make/model | Score ≤0.70 | ⏳ Pending |
| No plate visible (obscured/removed) | Embedding quality ≥0.7 | ⏳ Pending |

---

## 🧯 **Rollout & Risk Management**

### **Feature Flags**

```typescript
// supabase/functions/_shared/feature-flags.ts
export const FEATURE_ORC_INGEST = Deno.env.get('FEATURE_ORC_INGEST') === 'true';
export const FEATURE_ORC_MATCHING = Deno.env.get('FEATURE_ORC_MATCHING') === 'true';
```

### **Phased Rollout**

**Phase 1: Pilot** (Week 4)
- 2 officers × 1-2 shifts
- Mixed lighting conditions
- Homeless-focus routes
- Collect 50-100 observations

**Phase 2: Validation** (Week 5)
- Compare ORC vs manual plate entry
- Measure match accuracy
- Tune similarity thresholds

**Phase 3: Full Deploy** (Week 6)
- Enable for all officers
- Monitor inference latency
- Collect feedback

### **Backout Plan**

**Scenario**: ORC quality < 70% OR latency > 5s

**Action**:
1. Toggle `FEATURE_ORC_INGEST=false`
2. Revert to evidence-only ingest (no plate detection, no ALPR fallback)
3. Officers manually enter plate numbers
4. Investigate and fix model/inference issues

---

## 📦 **Deliverables Checklist**

### **Database** ✅
- [x] pgvector extension enabled
- [x] vehicle_embedding column added
- [x] IVFFlat index created
- [x] match_vehicle() RPC created
- [x] Migration tested

### **Inference Service** ⏳
- [ ] YOLO model trained on NZ vehicles (500-1000 images)
- [ ] MobileNetV3 + ArcFace embedder trained
- [ ] Node.js server with /infer endpoint
- [ ] Docker image created
- [ ] Deployed to Fly.io/Render

### **Edge Function** ⏳
- [ ] orc-ingest created
- [ ] Evidence storage implemented
- [ ] Inference API call working
- [ ] Observation + embedding inserted
- [ ] match_vehicle() integration
- [ ] CORS configured

### **UI Updates** ⏳
- [ ] ZoomScan calls orc-ingest
- [ ] PlateCapture calls orc-ingest
- [ ] Match panel added to Admin
- [ ] Quality badge implemented
- [ ] Loading states updated

### **Testing** ⏳
- [ ] Unit tests (inference accuracy)
- [ ] Integration tests (end-to-end flow)
- [ ] Load tests (50 concurrent scans)
- [ ] Pilot with 2 officers
- [ ] Production metrics dashboard

---

## 🚀 **Next Steps**

1. **Review & Approve** this blueprint
2. **Provision Infrastructure**: Fly.io account, GPU if needed
3. **Collect Training Data**: 500-1000 NZ vehicle photos (varied angles, lighting)
4. **Train Models**: YOLOv8 (detection) + MobileNetV3 (embedding)
5. **Deploy Inference Service**: Private microservice on Fly.io
6. **Build orc-ingest**: Edge Function with inference integration
7. **Update UI**: Replace ALPR calls with ORC calls
8. **Test & Iterate**: Pilot → Validation → Full Deploy

---

## 📞 **Questions?**

Ready to begin implementation! Let me know when you're ready to start Phase 1 (Database setup) or if you need any clarification on the architecture.

# Bob Training: Video Generation Automation

**Date:** May 8, 2026  
**Purpose:** Enable Bob to generate briefing videos from natural language requests  
**Target Audience:** Bob AI Agent, FieldOps Manager operators, platform team

---

## Vision

Users should be able to ask Bob conversationally for briefing videos, and Bob will:
1. Parse natural language intent (quality, format, purpose, incident/breach reference)
2. Invoke video generation with proper org scoping
3. Return video URL and metadata to the user
4. Log all actions in immutable audit trail with `provider='bob-ai-agent'`

**Example User Prompt:**  
> "Bob, I need a briefing video for incident 42 at medium quality for the team debrief tomorrow."

**Expected Result:**  
✅ Video generated (9s, mp4, medium bitrate)  
✅ Stored at `https://storage.../briefing-42.mp4`  
✅ Audit logged with incident_id + user context  
✅ Bob responds: "Video created! 9-second briefing for incident 42."

---

## Integration Points

### 1. Bob Mutation Catalog Entry ✅
**Location:** `src/lib/bobMutationCatalog.ts`

```typescript
{
  id: 'generate_briefing_video',
  contract: 'edgeFunctions.generateBriefingVideo',
  writesTo: ['media_generation_log', 'video_briefing_packs'],
  purpose: 'Generate briefing video artifact via FFmpeg or deterministic rendering, with immutable audit trail.',
  allowedExecutionModes: ['owner_full', 'master_balanced', 'officer_assist'],
  approvalLevel: 'review',
  dryRunSupported: true,
  notes: 'Bob can extract video parameters from natural language...',
}
```

**Trigger Keywords:** `briefing video | generate video | create video | video briefing | make video`

### 2. Bob Action Handler Edge Function ✅
**Location:** `supabase/functions/bob-generate-video-action/index.ts`

**Responsibilities:**
- Accept Bob's request (structured or natural language)
- Infer video parameters from context strings
- Extract entity IDs (incident #, breach #) from text
- Validate org scoping with `allowed_org_ids`
- Delegate to `generate-briefing-video` edge function
- Transform response for Bob (with `bob_instruction` for follow-up guidance)

**Interface:**
```typescript
POST /functions/v1/bob-generate-video-action
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "purpose": "briefing",           // optional; inferred if missing
  "quality": "medium",              // optional; inferred from context
  "format": "mp4",                  // optional; inferred if missing
  "incident_id": "uuid",            // optional; extracted from request_context
  "breach_id": "uuid",              // optional; extracted from request_context
  "title": "Incident 42 Briefing",  // optional; auto-generated
  "description": "...",             // optional
  "user_id": "uuid",                // from access_token
  "org_id": "uuid",                 // validated against allowed_org_ids
  "model_used": "claude-3.5-sonnet",
  "request_context": "Create a medium quality briefing video for incident 42",
  "allowed_org_ids": ["uuid-org-1", "uuid-org-2"]
}

Response (200 OK):
{
  "success": true,
  "video_id": "uuid",
  "video_url": "https://storage.../briefing-42.mp4",
  "media_log_id": "uuid",
  "duration_seconds": 9,
  "quality": "medium",
  "format": "mp4",
  "created_at": "2026-05-08T...",
  "bob_instruction": "Video generated successfully. Inform the user..."
}
```

### 3. RunPod Worker Handler ✅
**Location:** `runpod-worker/handler.py` (line ~875)

**Already implemented:**
```python
if action == "generate_briefing_video":
    try:
        return generate_briefing_video_artifact(inp)
    except Exception as exc:
        return {
            "success": False,
            "error": f"Briefing video generation failed: {exc}",
            "provider": "runpod-video"
        }
```

**Bob can invoke this via language like:**  
> "Generate a high-quality video for breach investigation training"

---

## Intent Extraction Rules

Bob should use these heuristics to fill missing video parameters:

### Quality Inference
| Keyword | Inferred Quality | Reasoning |
|---|---|---|
| "low", "lite", "bandwidth" | `low` (6s) | Resource-constrained |
| "high", "HD", "12s", "long" | `high` (12s) | Full detail needed |
| *default* | `medium` (9s) | Balance |

### Format Inference  
| Keyword | Format |
|---|---|
| "webm", "vp9" | `webm` |
| *default* | `mp4` |

### Purpose Inference
| Keyword | Purpose |
|---|---|
| "training", "learning", "teach" | `training` |
| "research", "review", "audit" | `research` |
| *default* | `briefing` |

### Entity ID Extraction
- Regex: `/incident\s+([a-f0-9-]+|\d+)/i` → `incident_id`
- Regex: `/breach\s+([a-f0-9-]+|\d+)/i` → `breach_id`

---

## Security & Validation

### Org Scoping ✅
- All video generation requests must include `allowed_org_ids` (from user's org profile)
- Bob action handler validates `org_id` is in allowed list
- Edge function enforces RLS (Row-Level Security) on `media_generation_log` and `video_briefing_packs`
- If no matching org, operation fails with `403 Forbidden`

### Audit Trail ✅
- All Bob-initiated generations logged to `media_generation_log` with:
  - `actor_user_id` = authenticated user (not Bob)
  - `provider` = 'bob-ai-agent'
  - `model_name` = Claude version used
  - `purpose` = extracted intent
  - `source_entity_type` = 'incident' or 'breach'
  - `source_entity_id` = extracted ID
- Immutable (no DELETE allowed); only revocation via `revoked_at` flag

### Rate Limiting (Optional, Recommended for Future)
- Quota: 10 videos/org/day
- Tracked in metadata `bob_request_quota`
- Bob should check balance before invoking; return user-friendly message if quota exceeded

---

## Bot Prompting Guide

### For Bob (in chat/action mode):

**You capability:**
> "You can generate briefing video artifacts for incident investigations, team debriefings, and compliance training. Users can ask you to 'create a video,' and you will:
> 
> 1. Infer the quality (low/medium/high based on use case)
> 2. Extract incident or breach IDs if mentioned
> 3. Generate a video via FFmpeg rendering or deterministic fallback
> 4. Return a public URL to the user
> 
> All videos are stored securely, org-scoped, and audited immutably."

**When user asks:**
> "Create a briefing video for incident 42 at high quality."

**Your steps:**
1. Confirm: "I'll generate a high-quality briefing video for incident 42. This will take ~15s due to FFmpeg rendering."
2. Call `/bob-generate-video-action` with:
   ```json
   {
     "request_context": "High-quality briefing video for incident 42",
     "quality": "high",
     "incident_id": "42",
     "purpose": "briefing",
     ...standard context...
   }
   ```
3. Await response
4. If success: "✅ Video created! It's a 12-second high-quality briefing. You can download it here: [URL]. All generations are logged for compliance audit."
5. If failure: "❌ Video generation failed: [reason]. This might be temporary; try with lower quality or contact support."

---

## Known Limitations & Future Work

### Current Limitations
1. **Audio:** Video-only (no speech synthesis in current FFmpeg implementation)
2. **Duration:** Fixed to quality tier (low=6s, medium=9s, high=12s); no custom duration
3. **Overlays:** No dynamic text/incident data overlays (planned Q2 2026)
4. **Format List:** mp4 (libx264) + webm (libvpx-vp9) only; no AV1 or HEVC

### Planned Enhancements
| Feature | Timeline | Impact |
|---|---|---|
| Dynamic incident overlays (incident type, severity, location) | Q2 2026 | High — more informative videos |
| Audio synthesis + incident briefing narration | Q2 2026 | High — voice-to-video workflow |
| HLS streaming / multi-bitrate support | Q2 2026 | Medium — large-file streaming |
| Bob cost attribution (FieldOps Manager cost tracker) | Q2 2026 | High — chargeback visibility |
| Automated cleanup job (retention + legal-hold expiry) | Q1 | High — storage cost control |

---

## Monitoring & Troubleshooting

### Metrics to Track
1. **Success Rate:** % of Bob video requests that complete successfully
2. **Latency:** P50/P95/P99 generation time (expected: 5–15s depending on quality)
3. **Storage Usage:** GB total briefing video artifacts; growth/week
4. **Cost:** Video generation cost attribution by org (if RunPod billable)

### Common Failure Modes

| Symptom | Root Cause | Mitigation |
|---|---|---|
| "Video generation failed: HTTP 502" | Inference service unreachable | Check INFERENCE_SERVICE_URL env vars; fallback to JSON manifest |
| "HTTP 403: Org scoping failed" | Bob org_id not in allowed list | Verify user's organization_ids in auth context |
| "Video creation timed out (>30s)" | FFmpeg subprocess hung | Increase timeout; or offer lower quality option |
| "Output file permission denied" | Storage bucket RLS misconfigured | Check media_generation_log and video_briefing_packs RLS policies |

### Debug Commands

```bash
# Check Bob action handler health
curl -X POST https://<supabase-url>/functions/v1/bob-generate-video-action \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "request_context": "test debrief",
    "allowed_org_ids": ["<org-id>"]
  }'

# Check inference service endpoint
curl https://<inference-url>/infer/video/generate -X POST \
  -H "Content-Type: application/json" \
  -d '{"quality": "medium"}'

# Query audit trail for Bob-initiated videos
SELECT org_id, actor_user_id, provider, purpose, created_at
FROM media_generation_log
WHERE provider = 'bob-ai-agent'
  AND created_at > NOW() - INTERVAL 7 days
ORDER BY created_at DESC;
```

---

## Testing & Validation

### E2E Test Sequence (Manual)

1. **Setup:** Log in as admin user with video generation permission
2. **Invoke Bob:** Ask "Create a medium-quality briefing video for testing"
3. **Verify DB:** Query `media_generation_log` for entry with `provider='bob-ai-agent'`
4. **Verify Storage:** Download video URL; confirm mp4/webm artifact plays
5. **Verify Audit:** Check `revoked_at` is NULL (immutable); Bob can revoke if needed
6. **Verify Org Scoping:** Log in as different org user; confirm they cannot see the video (RLS enforced)

### Automated Test Suite

**Location:** `tests/bob-video-generation.spec.ts`

```typescript
describe('Bob Video Generation Automation', () => {
  describe('Intent Extraction', () => {
    test('Infers quality from context')
    test('Extracts incident ID from natural language')
    test('Defaults to medium quality if not specified')
  })

  describe('Org Scoping', () => {
    test('Rejects video if org_id not in allowed list')
    test('Enforces RLS on media_generation_log select')
    test('Prevents cross-org video access')
  })

  describe('Audit Trail', () => {
    test('Logs Bob-generated video with provider="bob-ai-agent"')
    test('Records model_used as Claude version')
    test('Preserves incident_id in media_generation_log')
  })

  describe('Integration', () => {
    test('Handles FFmpeg success path')
    test('Falls back to JSON manifest if FFmpeg unavailable')
    test('Returns bob_instruction for follow-up guidance')
  })
})
```

---

## Deployment Checklist

Before enabling Bob video generation in production:

- [ ] Validate `bob-generate-video-action` edge function deployed
- [ ] Confirm `allowed_org_ids` extraction from user context
- [ ] Test Bob intent extraction (low/medium/high quality, incident ID parsing)
- [ ] Verify org scoping via RLS audit query
- [ ] Run E2E test suite (manual + automated)
- [ ] Monitor first 50 Bob video requests for errors
- [ ] Set up Slack/email alert if success rate < 95%
- [ ] Document for support team: "How users request videos via Bob"

---

## User Documentation

### For Field Officers

**How to request a video from Bob:**

1. Open FieldOps Manager Chat (bottom-right "Ask Bob")
2. Type your request naturally:
   - "Create a briefing video for incident 42"
   - "Generate a high-quality video for training"
   - "Make a video for the breach investigation"
3. Bob will generate the video (typically 5–15 seconds elapsed)
4. Click the video link to download or share

**What gets logged:**
- All videos are recorded in the audit trail
- Your user ID, org, and the video metadata (quality, format, incident #) are stored securely
- Videos can be revoked (marked as deleted) if needed

### For Administrators

**Monitoring video generation:**

1. Go to Admin → Video Generation Suite
2. View: Total videos created, active vs. revoked, provider breakdown
3. Export: Audit log (CSV) for compliance/billing

**Quotas & Rate Limiting:**

- Currently: Unlimited (10 videos/org/day recommended soft limit)
- Future: Cost attribution + chargeback by org

---

## References

- **Video Generation Implementation:** `docs/VIDEO_GENERATION_IMPLEMENTATION.md`
- **Bob Mutation Catalog:** `src/lib/bobMutationCatalog.ts`
- **Edge Function (Manual):** `supabase/functions/generate-briefing-video/index.ts`
- **Edge Function (Bob Action):** `supabase/functions/bob-generate-video-action/index.ts`
- **RunPod Handler:** `runpod-worker/handler.py` (line ~875)
- **React UI:** `src/pages/BriefingVideoSuite.tsx`

---

**Questions or Issues?** Open a ticket or contact the platform team.

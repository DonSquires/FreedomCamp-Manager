# Railway Model + Mapping Gateways

This guide adds two new Railway services:

1. `model-gateway` (Railway-hosted image)
- Primary: proxy requests to RunPod serverless or endpoint URL.
- Secondary: fallback to Ollama-compatible `/api/generate` endpoint.

2. `mapping-gateway` (Railway-hosted image)
- Primary: self-hosted deterministic route planning.
- Secondary: optional Google Directions enrichment for traffic-aware support.

Both services are designed so external providers are support-only and not required for baseline continuity.

## Service 1: model-gateway

Path: `model-gateway/`

### Required env vars

- `RUNPOD_ENDPOINT_URL` or `RUNPOD_ENDPOINT_ID`
- `RUNPOD_ENDPOINT_API_KEY` (or `RUNPOD_API_KEY`)

### Optional env vars

- `RUNPOD_MODEL`
- `OLLAMA_FALLBACK_URL`
- `OLLAMA_FALLBACK_MODEL`
- `MODEL_GATEWAY_TIMEOUT_MS`

### Backend wiring

Set in backend service:

- `MODEL_GATEWAY_URL=https://<model-gateway>.up.railway.app`

Runtime behavior in backend:

1. Try `MODEL_GATEWAY_URL/api/generate`
2. Fallback to `OLLAMA_PROXY_URL/api/generate`
3. Fallback to OpenAI (if configured)

## Service 2: mapping-gateway

Path: `mapping-gateway/`

### Required env vars

No required vars for baseline deterministic routing.

### Optional env vars

- `GOOGLE_SUPPORT_ENABLED=true`
- `GOOGLE_MAPS_API_KEY` or `GOOGLE_API_KEY`
- `OSRM_BACKEND_URL` (reserved for direct matrix/route backend integration)
- `VALHALLA_BACKEND_URL` (reserved for direct backend integration)
- `MAPPING_GATEWAY_TIMEOUT_MS`
- `MAPPING_GATEWAY_STREET_TILE_URL`
- `MAPPING_GATEWAY_STREET_TILE_ATTRIBUTION`
- `MAPPING_GATEWAY_FALLBACK_TILE_URL`
- `MAPPING_GATEWAY_FALLBACK_TILE_ATTRIBUTION`
- `MAPPING_GATEWAY_SATELLITE_TILE_URL`
- `MAPPING_GATEWAY_SATELLITE_TILE_ATTRIBUTION`

### Backend wiring

Set in backend service:

- `MAPPING_GATEWAY_URL=https://<mapping-gateway>.up.railway.app`
- `MAPPING_GATEWAY_TIMEOUT_MS=12000`

Runtime behavior for patrol-route intent:

1. Route plan generated from `mapping-gateway` (self-hosted primary)
2. If unavailable, deterministic inbuilt nearest-neighbor route still returns
3. Google enrichment is optional support and reflected in telemetry/sources

### Tile proxy behavior

The mapping gateway Docker image now also serves internal map tile proxy routes:

- `GET /maps/tiles/street/{z}/{x}/{y}.png`
- `GET /maps/tiles/fallback/{z}/{x}/{y}.png`
- `GET /maps/tiles/satellite/{z}/{x}/{y}.jpg`

Each route proxies to the corresponding internal tile template configured in the mapping-gateway service env.

## Railway deploy sequence

1. Create new Railway service from repo path `model-gateway`.
2. Set model-gateway env vars and deploy.
3. Create new Railway service from repo path `mapping-gateway`.
4. Set mapping-gateway env vars and deploy.
5. Update backend env vars (`MODEL_GATEWAY_URL`, `MAPPING_GATEWAY_URL`) and redeploy backend.
6. Validate:
   - `GET /health` on both gateways
   - `POST /api/heal` patrol-route prompt returns `INTEL_COMPLETE`
   - Response telemetry shows route provider and support providers.

## Example validation commands

```bash
# Health checks
curl -sS https://<model-gateway>.up.railway.app/health | jq
curl -sS https://<mapping-gateway>.up.railway.app/health | jq

# Mapping route plan smoke
curl -sS -X POST https://<mapping-gateway>.up.railway.app/route-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "waypoints": [
      {"label":"A","lat":-41.2706,"lng":173.2840},
      {"label":"B","lat":-41.2788,"lng":173.2857},
      {"label":"C","lat":-41.2698,"lng":173.2960}
    ]
  }' | jq
```

## Operational notes

- Keep RunPod keys only in Railway secrets; do not commit keys.
- Keep Google keys optional and support-only.
- Patrol-route continuity should remain available even when RunPod/Google are unavailable.

## Operational update (2026-05-24)

The following evidence was validated and committed during the 2026-05-24 production update cycle:

1. Railway gateway connectivity is healthy from the runtime test harness.
  - Evidence: `external.check_railway_health` PASS in `tools/human-test-engine/reports/2026-05-24T00-02-31-119Z/report.md`.
2. Mapping continuity is still grounded to deterministic route planning when enrichment providers are unavailable.
  - Contract source: this document's Service 2 fallback path (`mapping-gateway` first, deterministic fallback retained).
3. Production governance and evidence runs were captured and versioned in repository artifacts.
  - Evidence bundle paths:
    - `tools/bob-agentic-test-runs/conductor/2026-05-24T00-23-06-314Z/`
    - `tools/bob-agentic-test-runs/conductor/2026-05-24T00-27-01-076Z/`
4. Mapping/runtime validation remains auth-aware for protected control paths.
  - For `/api/heal` patrol-route/manual instruction checks, continue using authenticated user context and org-scoped headers as required by backend policy.

# Bob Configuration (Egress Enabled)

## Current operating mode

- `BOB_OPERATING_MODE=build-training`
- `SELF_CONTAINED_MODE=false`
- `REQUIRE_SELF_CONTAINED_MODE=false`
- `SELF_CONTAINED_STRICT_EGRESS=false`

This confirms strict egress is OFF and Bob is in learning/build-training mode.

## Learning mode implications

- Bob may call external providers/services configured by runtime env vars.
- Keep API-key scoped endpoints (`x-inference-api-key` / bearer token) mandatory.
- Monitor outbound calls for unexpected destinations.

## Health and integration endpoints

- `GET /health` — service status + model/runtime posture
- `GET /self-heal/knowledge` — knowledge pack visibility (auth required)
- `POST /self-heal/knowledge` — authenticated knowledge upsert for schema/training updates
- `POST /infer` — ONNX inference path

## Example verification commands

```bash
curl -sS "$BOB_SERVICE_URL/health"
curl -sS -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" "$BOB_SERVICE_URL/self-heal/knowledge"
curl -sS -X POST "$BOB_SERVICE_URL/self-heal/knowledge" \
  -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"knowledge":{"schema_provider_grants":{"name":"schema_provider_grants","summary":"Provider-client grant schema update","key_points":["provider_client_access_grants table added","can_access_service helper added","PTT uses can_access_ptt_channel"]}}}'
curl -sS -X POST "$BOB_SERVICE_URL/infer" \
  -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"health-check"}'
```

## Knowledge-base update flow

Push schema and platform updates through Bob self-heal workflows:

1. Build schema change summary payload (tables/functions/policies changed)
2. Submit via `POST /self-heal/knowledge`
3. Validate visibility via `GET /self-heal/knowledge`

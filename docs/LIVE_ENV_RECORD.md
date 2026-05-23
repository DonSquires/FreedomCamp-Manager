# Live Env Record

Snapshot source: workspace `.env` and current service templates in the repo.

## Live non-secret endpoints

| Service | Variable | Current value |
|---|---|---|
| Supabase | `VITE_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| RunPod / Bob inference | `INFERENCE_SERVICE_URL` | `https://api.runpod.ai/v2/n0bp1ifmq01cx2` |
| RunPod / Bob inference | `VITE_INFERENCE_SERVICE_URL` | `https://api.runpod.ai/v2/n0bp1ifmq01cx2` |
| PTT HTTPS endpoint | `PTT_SERVER_URL` | `https://ptt.fcmanager.co.nz` |
| PTT websocket endpoint | `PTT_WS_URL` | `wss://fieldops-railway-stt-production.up.railway.app/ws` |
| Mobile PTT websocket alias | `EXPO_PUBLIC_PTT_SERVER_URL` | `wss://fieldops-railway-stt-production.up.railway.app/ws` |
| Bob translator websocket | `VITE_BOB_TRANSLATOR_WS_URL` | `wss://qnruvetny83ypj-8274.proxy.runpod.net/ws/translate` |
| Bob translator REST | `BOB_TRANSLATOR_REST_URL` | `https://qnruvetny83ypj-8274.proxy.runpod.net` |
| Bob translator pod | `BOB_TRANSLATOR_POD_ID` | `qnruvetny83ypj` |
| Whisper proxy | `VITE_WHISPER_PROXY_URL` | `https://fieldops-railway-stt-production.up.railway.app` |
| Bob manager UI/API | `VITE_BOB_MANAGER_URL` | `https://fieldops-backend-production.up.railway.app` |

## Live secret-bearing variables present in workspace `.env`

These are present in the live workspace environment record but are intentionally not reproduced in full here:

- `VITE_SUPABASE_ANON_KEY`
- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_API_KEY`
- `INFERENCE_API_KEY`
- `VITE_INFERENCE_API_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

## Still required from external services

These values were not available through the repo/workspace tools and must be set in the live services or secret managers:

- `RAILWAY_TOKEN`
- `RAILWAY_PROXY_SERVICE_ID`
- `RAILWAY_INFERENCE_SERVICE_ID`
- `RAILWAY_PTT_SERVICE_ID`
- `BOB_GATEWAY_KEY`

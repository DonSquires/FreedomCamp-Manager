# Model Tier Routing

## Architecture

The inference service uses four distinct Ollama base URLs to allow workload-based routing
to different Ollama instances (or the same instance with different priority/timeout):

| Variable | Workload | Default fallback |
|---|---|---|
| `OLLAMA_PTT_BASE_URL` | Real-time PTT audio → text (speed-critical) | `OLLAMA_BASE_URL` |
| `OLLAMA_TABULAR_BASE_URL` | Tabular NLP (breach descriptions, compliance summaries) | `OLLAMA_BASE_URL` |
| `OLLAMA_CHAT_BASE_URL` | Chat/conversation (non-real-time) | `OLLAMA_BASE_URL` |
| `OLLAMA_BASE_URL` | Fallback for all workloads | localhost:11434 |

Heavy GPU work (ALPR plate detection, face embedding, ONNX inference) always routes to
`RUNPOD_ENDPOINT_URL` / `RUNPOD_ENDPOINT_ID`.

## Routing Function

`getOllamaBaseUrlForWorkload(workload: string)` in `inference-service/server.js`
handles the dispatch. Workload strings: `'ptt'`, `'tabular'`, `'chat'`, `'default'`.

## Recommended Dev Setup (cost-minimal)

```
OLLAMA_PTT_BASE_URL=http://ollama:11434
OLLAMA_TABULAR_BASE_URL=http://ollama:11434
OLLAMA_CHAT_BASE_URL=http://ollama:11434
MOCK_MODE=true           # skips all RunPod calls
```

## CHEAP_MODE Pattern

To run the entire stack without cloud inference costs:
```bash
MOCK_MODE=true OLLAMA_BASE_URL=http://ollama:11434 bun run dev
```
This keeps all UI paths alive but substitutes mock responses for every AI endpoint.
Use for pure UI testing, not for AI accuracy validation.

## Production PTT Latency Target

- PTT end-to-end (audio in → translated text out): < 3000ms P95
- If `OLLAMA_PTT_BASE_URL` host has P95 > 3000ms → move PTT to RunPod serverless
- PTT latency can be simulated in E2E tests via `tests/e2e/fixtures/network-profile.ts`

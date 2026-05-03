# Radio AI Degradation Runbook

**Phase 1 Group E — Trust and Operations**  
Service: `inference-service` (Railway) + `ptt-server` (VPS)

---

## Degradation Modes

| Mode | Trigger | Observable symptom | Expected behaviour |
|---|---|---|---|
| `stub` | `RADIO_PROCESSOR_ENABLED=false` (default) | `/health → radio_pipeline.processor_mode = "stub"` | Events accepted, no segments written |
| `ollama-unreachable` | Ollama pod offline / network fault | `radio-speech-processor` WARN in logs; `transcribeAudio` falls through to stub | Stub segment written if `RADIO_PERSIST_STUB=true`; else silently skipped |
| `processor-disabled` | `RADIO_PROCESSOR_ENABLED` unset or false | Processor returns immediately | No DB writes; queue still drains |
| `supabase-unavailable` | Supabase REST API down | `supabaseInsert` throws; logged as error | Segment lost for that event; transmission `ended_at` not updated |
| `redis-unavailable` | Redis instance gone | `speech-worker.js` exits (BLPOP fails); `radio-router.js` logs `enqueueSpeechEvent` error | Events not queued; audio passthrough unaffected |
| `queue-dlq-filling` | Webhook unreachable or inference down | DLQ key `radio:speech:events:dlq` grows | Inspect DLQ; replay after service restore |

---

## Operational Quick-Checks

### 1. Check processor mode
```
GET https://<inference-host>/health
→ radio_pipeline.processor_enabled
→ radio_pipeline.processor_mode   # "whisper" | "stub"
→ radio_pipeline.ollama_ptt_configured
→ radio_pipeline.active_transmission_counters
```

### 2. Check SFU health
```
GET https://<ptt-host>/radio/health
→ sfuReady (bool)
→ workerCount
→ activeSessions
→ totalRouters
```

### 3. Check transcript coverage (admin/master users only)
```
GET https://<supabase-project>.functions.supabase.co/radio-audit?since_hours=24
Authorization: Bearer <user-jwt>
→ transcript_pipeline.coverage_pct
→ transcript_pipeline.low_confidence_segments_recent
→ synthetic_media.tts_renders_recent
```

### 4. Inspect DLQ
```bash
redis-cli -u $REDIS_URL LLEN radio:speech:events:dlq
redis-cli -u $REDIS_URL LRANGE radio:speech:events:dlq 0 4
```

### 5. Replay DLQ events
```bash
# Move DLQ items back to the work queue for retry:
while redis-cli -u $REDIS_URL RPOPLPUSH radio:speech:events:dlq radio:speech:events; do :; done
```

---

## Recovery Procedures

### Ollama down
1. Check RunPod pod status / Railway Ollama service logs.
2. Verify `OLLAMA_PTT_BASE_URL` in inference-service env matches live endpoint.
3. If using `RADIO_PERSIST_STUB=true`: stub rows will be present — they can be cleaned after Ollama recovers and events are replayed from DLQ.
4. Restart `speech-worker.js` after Ollama is back: `npm run speech:worker` in `ptt-server/`.

### Redis down
1. Verify `REDIS_URL` in `ptt-server` environment.
2. Restart `ptt-server` after Redis is restored — `initRadioRedis()` will reconnect on startup.
3. Any events generated while Redis was down are lost (not durably queued). Log gap in `radio_transmissions.ended_at = NULL` can identify affected window.

### Supabase REST unavailable
1. Segments written during the outage are lost unless replayed via DLQ.
2. Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in inference-service env.
3. `radio_transmissions.ended_at` may remain NULL for transmissions that closed during the outage — run manual patch:
   ```sql
   -- Identify open transmissions older than 2 hours:
   SELECT id, started_at FROM radio_transmissions WHERE ended_at IS NULL AND started_at < now() - interval '2 hours';
   -- Manually close them:
   UPDATE radio_transmissions SET ended_at = now() WHERE ended_at IS NULL AND started_at < now() - interval '2 hours';
   ```

### Low-confidence threshold alert
When `transcript_pipeline.low_confidence_segments_recent` > 20% of recent segment count:
1. Check Ollama pod GPU health — low confidence often indicates resource pressure.
2. Review `RADIO_WHISPER_MODEL` — switch to a smaller/faster model if latency is the cause.
3. Confidence threshold for flagging in audit is 0.5 (non-configurable in Phase 1; Phase 2 will add per-org config).

---

## Synthetic Media Safety

- Every row in `radio_tts_renders` has `is_synthetic = true` enforced by a database CHECK constraint (`radio_tts_renders_is_synthetic_enforced`).
- UI components receiving TTS audio **must** display a synthetic indicator (per ADR 005).
- The `radio-audit` Edge Function exposes `synthetic_media.tagging_enforced: true` as a policy assertion — monitor this field; if it ever returns `false` something has bypassed the constraint.

---

## Phase Progression Notes

| Phase | AI path active | Expected processor_mode | Expected coverage_pct |
|---|---|---|---|
| Phase 1 (current) | Stub only | `stub` | 0% (no real STT) |
| Phase 2 | Ollama Whisper tap | `whisper` | ≥70% target |
| Phase 3 | Translation pipeline | `whisper` | ≥70% |
| Phase 4 | TTS relay | `whisper` | ≥70%; TTS renders appear |

Do not advance to Phase 2 until Phase 1 exit criteria (original audio stable, floor control stable, emergency override implemented) are validated in staging.

---

_Updated: Phase 1 Group E — 2026-07-09_

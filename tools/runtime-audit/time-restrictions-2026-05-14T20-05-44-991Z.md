# Runtime Time Restriction Audit

Generated: 2026-05-14T20:05:44.992Z

Files with time restrictions: 33

## supabase/functions/generate-briefing-video/index.ts

- L63: executionTimeout: 120000,

## supabase/functions/auto-analyse-report/index.ts

- L111: signal: AbortSignal.timeout(10_000),
- L239: signal: AbortSignal.timeout(45_000),
- L401: executionTimeout: 60000,
- L407: signal: AbortSignal.timeout(70_000),
- L413: signal: AbortSignal.timeout(55_000),
- L545: signal: AbortSignal.timeout(30_000),

## supabase/functions/live-session-diagnostics-ingest/index.ts

- L34: return /(error|exception|failed|failure|timeout|crash|panic|unhandled|degraded)/i.test(value)

## supabase/functions/import-historical-data/index.ts

- L522: signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),

## supabase/functions/send-invite-email/index.ts

- L440: const isNetwork = /(failed to fetch|network|timed out|timeout|connection refused)/i.test(rawMessage);

## supabase/functions/bob-multimodal-gateway/index.ts

- L422: signal: AbortSignal.timeout(30_000),

## supabase/functions/process-face-scan/index.ts

- L226: signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
- L432: signal: AbortSignal.timeout(5000),
- L449: signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),

## supabase/functions/bob-code-change-task/index.ts

- L317: const timeoutId = setTimeout(() => controller.abort(), BOB_REQUEST_TIMEOUT_MS)
- L399: const queueTimeoutId = setTimeout(() => queueController.abort(), BOB_REQUEST_TIMEOUT_MS)
- L440: const execTimeoutId = setTimeout(() => execController.abort(), BOB_REQUEST_TIMEOUT_MS)

## supabase/functions/send-report-email/index.ts

- L357: const relayTimer = setTimeout(() => relayController.abort(), REPORT_EMAIL_RELAY_TIMEOUT_MS);

## supabase/functions/process-officer-scan/index.ts

- L258: const res = await fetch(photoUrl, { signal: AbortSignal.timeout(8000) });
- L306: signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
- L394: signal: AbortSignal.timeout(8000),
- L975: timeout: ALPR_BACKUP_TIMEOUT_MS,
- L981: const alprStartTimer = setTimeout(() => {

## supabase/functions/_shared/bobInfer.ts

- L194: executionTimeout: 120000,
- L292: executionTimeout: 120000,
- L393: executionTimeout: 120000,

## supabase/functions/_shared/fetchWithRetry.ts

- L4: return new Promise((resolve) => setTimeout(resolve, ms))
- L26: const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

## supabase/functions/_shared/alpr.ts

- L34: options?: { timeout?: number }
- L39: const timeout      = options?.timeout ?? Number(Deno.env.get("ALPR_TIMEOUT_MS") ?? 10000);
- L60: timeoutMs: timeout,
- L92: console.error("❌ Local ALPR timeout after", timeout, "ms");
- L119: timeout?: number;
- L141: const timeout = options?.timeout ?? Number(Deno.env.get("ALPR_TIMEOUT_MS") ?? 15000);
- L157: const timeoutId = setTimeout(() => controller.abort(), timeout);
- L207: console.error("❌ ALPR timeout after", timeout, "ms");
- L226: timeout?: number;

## supabase/functions/generate-notice-to-vacate/index.ts

- L412: , new Promise<void>((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), SMTP_TIMEOUT_MS)),

## supabase/functions/alpr-process/index.ts

- L89: signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
- L613: signal: AbortSignal.timeout(8000), // 8-second cap — prevent edge fn timeout

## supabase/functions/vehicle-ingest/index.ts

- L227: const response = await fetch(photoRef, { signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS) });
- L355: // timeout chain that caused "Failed to send a request to the Edge Function".
- L574: // re-hash it AND then running Railway inference (5 s timeout) + ALPR backup
- L575: // (3.5 s timeout) sequentially pushes the total edge-function wall-clock
- L868: signal: AbortSignal.timeout(inferenceTimeoutMs),
- L914: timeout: alprTimeoutMs,

## supabase/functions/smoke-assess/index.ts

- L154: signal: AbortSignal.timeout(90_000),

## supabase/functions/manage-user/index.ts

- L71: signal: AbortSignal.timeout(8000),

## supabase/functions/speech-to-intent/index.ts

- L135: const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
- L146: clearTimeout(timeout)
- L172: clearTimeout(timeout)
- L192: signal: AbortSignal.timeout(TIMEOUT_MS),

## supabase/functions/check-services-health/index.ts

- L103: signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
- L140: signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
- L160: signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
- L185: signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),

## supabase/functions/biosecurity-assess/index.ts

- L137: signal: AbortSignal.timeout(90_000),

## supabase/functions/grandmaster-studio/index.ts

- L524: const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
- L536: return { url: base, status: 'down' as const, latencyMs, httpStatus: null, detail: isTimeout ? 'timeout' : String(err), checkedAt: new Date().toISOString() }

## supabase/functions/parkpow-photo-sync/index.ts

- L183: signal: AbortSignal.timeout(30000),
- L384: signal: AbortSignal.timeout(15000),

## supabase/functions/process-tender-document/index.ts

- L238: if (message.includes('AbortError') || message.includes('timeout')) {
- L239: throw new Error(`Inference service timeout after ${Math.floor(BOB_CHAT_TIMEOUT_MS / 1000)}s`)

## supabase/functions/cleanup-and-recalculate/index.ts

- L214: signal: AbortSignal.timeout(NZSCV_RECHECK_TIMEOUT_MS),

## supabase/functions/ptt-assess/index.ts

- L101: signal: AbortSignal.timeout(90_000),
- L116: signal: AbortSignal.timeout(30_000),

## supabase/functions/scrape-vehicle-photos/index.ts

- L106: signal: AbortSignal.timeout(15000),
- L216: signal: AbortSignal.timeout(12000),
- L330: signal: AbortSignal.timeout(20000),
- L400: signal: AbortSignal.timeout(30000),

## supabase/functions/onspace-ai-chat/index.ts

- L496: await new Promise((resolve) => setTimeout(resolve, ms))
- L1001: .slice(-8) // keep recent turns only; helps RunPod runsync complete within timeout under load
- L1024: signal: AbortSignal.timeout(Math.min(10_000, BOB_RUNPOD_STATUS_TIMEOUT_MS)),
- L1052: const timeoutId = setTimeout(() => controller.abort(), BOB_RUNPOD_TIMEOUT_MS)
- L1273: const timeoutId = setTimeout(() => controller.abort(), BOB_INFERENCE_CHAT_TIMEOUT_MS)
- L1363: const timeoutId = setTimeout(() => controller.abort(), BOB_OLLAMA_CHAT_TIMEOUT_MS)
- L1433: const timeoutId = setTimeout(() => controller.abort(), BOB_INFERENCE_CHAT_TIMEOUT_MS)

## supabase/functions/generate-infringement/index.ts

- L640: , new Promise<void>((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), SMTP_TIMEOUT_MS)),

## supabase/functions/generate-tender-sections/index.ts

- L42: // Keep request timeout below platform hard limits so Edge invocations fail fast
- L80: const timeoutId = setTimeout(() => controller.abort(), INFERENCE_REQUEST_TIMEOUT_MS)
- L91: executionTimeout: RUNPOD_EXECUTION_TIMEOUT_MS,
- L161: const timeoutId = setTimeout(() => controller.abort(), INFERENCE_REQUEST_TIMEOUT_MS)
- L169: executionTimeout: RUNPOD_TRAIN_EXECUTION_TIMEOUT_MS,

## supabase/functions/check-ptt-health/index.ts

- L51: signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),

## supabase/migrations/20260511000001_oncall_rostering_and_callout_shifts.sql

- L98: max_duration_hours    NUMERIC(5, 2) DEFAULT 24,

## supabase/migrations/20260510000001_access_control_industry_enhancements.sql

- L42: COMMENT ON COLUMN public.zones.anti_passback_timeout_minutes IS 'Anti-passback timeout (0=strict, >0=timed reset)';
- L725: -- Check for timeout reset


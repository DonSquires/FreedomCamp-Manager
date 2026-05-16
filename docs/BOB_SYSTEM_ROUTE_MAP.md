# Bob System Route Map

Last updated: 2026-05-15

## 1) End-to-end topology (canonical chat path)

```mermaid
flowchart LR
  U[User in Bob Assistant UI] --> FE[React frontend]
  FE --> EF1[Supabase Edge Function: ask-bob]
  EF1 --> EF2[Supabase Edge Function: onspace-ai-chat]
  EF2 --> INF[Inference host]
  INF --> EF2
  EF2 --> DB[(Supabase: bob_conversations + bob_messages)]
  EF2 --> FE
  FE --> MEM[(Supabase: bob_conversation_memory + bob_learning_memory + bob_user_memory)]
```

Primary execution path:
1. User sends prompt from Bob assistant surfaces.
2. Frontend invokes `ask-bob` for action-first/video intents and/or `onspace-ai-chat` via `edgeFunctions.aiChat`.
3. `ask-bob` enforces org access and forwards general inference to `onspace-ai-chat`.
4. `onspace-ai-chat` selects provider path (`/runsync` for RunPod serverless, `/chat` for non-serverless inference host) and persists conversation state.
5. Frontend writes supplemental learning/memory rows to Bob memory tables.

## 2) UI and route surfaces

Canonical Bob routes are defined in App routing and route manifest:
- `/bob-assistant` (main chat/studio)
- `/bob-intake-queue`
- `/live-plan-reviews`
- `/bob-ui-review`
- `/admin/video-generation`
- `/bob-proposals-log`

Alias routes redirect to canonical assistant:
- `/bob` -> `/bob-assistant`
- `/bob-studio` -> `/bob-assistant`
- `/bob/assistant-studio` -> `/bob-assistant`

Navigation + role mapping is wired in:
- `src/App.tsx`
- `src/navigation/routeManifest.ts`
- `src/components/features/AppLayout.tsx`

Primary Bob assistant page and interaction surface:
- `src/pages/BobAssistantStudio.tsx`

## 3) Frontend call graph (Bob)

Main frontend gateway wrappers:
- `src/lib/edgeFunctions.ts`
  - `bobGateway(...)` -> invokes `onspace-ai-chat`
  - `aiChat(...)` -> policy prompt injection + normalization + required section enforcement
  - `grandmasterStudio(...)` -> invokes `grandmaster-studio`
  - `bobResponseFeedback(...)` -> route call to `bob-multimodal-gateway/v1/bob/response`

Primary call sites:
- `src/pages/BobAssistantStudio.tsx`
  - invokes `ask-bob` for video/action path
  - invokes `edgeFunctions.aiChat(...)` for conversational path
  - sends feedback via `edgeFunctions.bobResponseFeedback(...)`
- `src/pages/AiAnalysis.tsx`
- `src/components/features/AiFeedbackChat.tsx`
- `src/pages/GrandmasterCodingStudio.tsx`
- `src/pages/SystemDiagnostics.tsx`

## 4) Edge function route map (backend)

### 4.1 `ask-bob` (action-first orchestrator)
File: `supabase/functions/ask-bob/index.ts`

Responsibilities:
- Auth and organization scope resolution.
- Optional geospatial context fetch (`get_active_context`).
- Video intent confirmation gate.
- Delegates video execution to `bob-generate-video-action`.
- Delegates normal chat to `onspace-ai-chat`.

Internal routing:
- `ask-bob` -> `bob-generate-video-action` (confirmed video intents)
- `ask-bob` -> `onspace-ai-chat` (general chat)

### 4.2 `onspace-ai-chat` (core brain gateway)
File: `supabase/functions/onspace-ai-chat/index.ts`

Responsibilities:
- Auth + role mode enforcement.
- Immutable system policy composition.
- Message history restoration from `bob_conversations` + `bob_messages`.
- Provider selection:
  - RunPod serverless path: `POST <base>/runsync` with `input` envelope
  - Non-serverless path: `POST <base>/chat`
  - Local Ollama path: `POST <OLLAMA_BASE_URL>/api/chat`
- Conversation persistence back to `bob_messages`.

Key behavior:
- RunPod URL normalization strips `/run` and `/runsync` suffixes and reattaches `/runsync`.
- Retry and compatibility fallback for transient `/api/chat` worker errors.

### 4.3 `grandmaster-studio` (privileged control plane)
File: `supabase/functions/grandmaster-studio/index.ts`

Responsibilities:
- Role-gated orchestration for coding studio and diagnostics actions.
- Proxies to inference service endpoints:
  - `/code/task`, `/code/tasks`, `/code/assist`, `/ask-copilot`, `/doctor/health`, `/health`
- Applies mutation contract checks before execution.

### 4.4 `bob-code-change-task` (owner-gated code task executor)
File: `supabase/functions/bob-code-change-task/index.ts`

Responsibilities:
- Grandmaster owner-only guard.
- Policy tiering (`auto_fix_allowed`, `approval_required`, `never_auto_fix`).
- Sends patch-task requests to inference service self-heal endpoint.

### 4.5 `bob-multimodal-gateway` (feedback and multimodal ingress)
File: `supabase/functions/bob-multimodal-gateway/index.ts`

Routes:
- `/v1/bob/interpret`
- `/v1/bob/request_ai`
- `/v1/bob/response`
- `/v1/bob/execution`
- `/v1/bob/privacy/consent`
- `/v1/bob/privacy/delete`

### 4.6 `bob-generate-video-action` (action executor)
File: `supabase/functions/bob-generate-video-action/index.ts`

Responsibilities:
- Org scoping + user session validation.
- Daily org and per-user quotas via `media_generation_log`.
- Delegates actual generation to `generate-briefing-video`.

## 5) Persistence map (brain and memory)

### Conversation state
- `public.bob_conversations`
- `public.bob_messages`
Migration: `supabase/migrations/20260430000001_bob_conversation_memory.sql`

### Session continuity memory
- `public.bob_conversation_memory`
Migration: `supabase/migrations/20260604000006_bob_conversation_memory.sql`

### User memory profile/context
- `public.bob_user_memory`
Migration: `supabase/migrations/20260512000004_bob_user_memory_and_actuation.sql`

### Learning memory
- `public.bob_learning_memory`
Migration: `supabase/migrations/20260604000004_bob_learning_memory.sql`

### Durable intel fallback store
- `public.external_intel_bulletins`
Migration: `supabase/migrations/20260402000100_external_intel_bulletins.sql`

Frontend memory utility entry points:
- `src/lib/bobLearningMemory.ts`

## 6) Host and endpoint resolution matrix

Canonical env aliases used across scripts and functions:
- Base URL aliases:
  - `BOB_SERVICE_URL`
  - `INFERENCE_SERVICE_URL`
- API key aliases:
  - `BOB_INFERENCE_API_KEY`
  - `INFERENCE_API_KEY`
  - `RUNPOD_ENDPOINT_API_KEY` / `RUNPOD_API_KEY`
- RunPod endpoint derivation:
  - `RUNPOD_ENDPOINT_ID` -> `https://api.runpod.ai/v2/<id>/runsync`

Transport mode policy:
- If endpoint matches RunPod serverless shape (`api.runpod.ai/v2/<id>`), use `/runsync` with `input` payload.
- Otherwise use direct `/chat` provider endpoint.

Representative scripts now aligned to this behavior:
- `scripts/talk-with-bob.mjs`
- `scripts/bob-direct-chat.mjs`
- `scripts/broadcast-truth-protocol.mjs`
- `scripts/bob-teach-research-methodology.mjs`
- `scripts/bob-feed-build-context.mjs`
- `scripts/bob-feed-web-research.mjs`
- `scripts/bob-feed-railway-training.mjs`
- `scripts/agentic-ui-shadow-user.mjs`

## 7) Storage bucket grounding and training path

Storage grounding feed script:
- `scripts/bob-feed-storage-bucket-grounding.mjs`

Integrated orchestration:
- `package.json` script `bob:feed-all` includes storage grounding feeder.
- `package.json` script `bob:feed-storage-grounding` available standalone.
- `package.json` script `bob:ask:storage-grounded` uses grounded ask flow.

Grounding policy in feeder includes confirmed bucket list and anti-invention behavior.
Durable fallback path for training intel is via `external_intel_bulletins` when direct ingest endpoint is not available.

## 8) Operational commands (verification and diagnostics)

Core health and capability checks:
- `npm run bob:doctor:any-container`
- `npm run bob:capabilities`
- `npm run test:bob:governance`

Chat smoke paths:
- `node scripts/bob-direct-chat.mjs "ping"`
- `node scripts/talk-with-bob.mjs`
- `node scripts/broadcast-truth-protocol.mjs`

Training/grounding:
- `npm run bob:feed-storage-grounding`
- `npm run bob:feed-all`
- `npm run bob:ask:storage-grounded -- "list verified storage buckets"`

## 9) Remaining caveats

- Some tooling intentionally retains `/chat` for non-serverless backends; this is valid when endpoint is not RunPod serverless.
- RunPod runsync session context may be ephemeral; durable grounding should be written to database-backed tables and/or replayed via grounded prompt prefixes.
- Grandmaster and code-change functions are intentionally high-restriction and role-gated; failed invocations are often policy rejections, not wiring faults.

## 10) Quick answer: is Bob wired end-to-end?

Yes. The current wiring supports:
- Plain-language chat through UI and CLI surfaces.
- Serverless RunPod transport via `/runsync` with proper envelope handling.
- Role-aware policy enforcement at gateway and mutation layers.
- Durable memory and conversation persistence across dedicated Supabase tables.
- Storage bucket grounding feed integrated into Bob training pipelines.

---

## 11) Full System Map — All Bob Pipelines

> Canonical as of 2026-05-15. Cross-reference with `BOB_INSTRUCTIONS.md §15` for the human/app interaction breakdown and role-access matrix.

### 11.1 Inference & Chat

```
User (Web / Mobile)
  └─> React Frontend (BobAssistantStudio.tsx / AiFeedbackChat.tsx)
        └─> edgeFunctions.aiChat() / ask-bob
              └─> ask-bob (edge function)
                    ├─> bob-generate-video-action  [confirmed video intents]
                    └─> onspace-ai-chat             [all other prompts]
                          ├─> RunPod /runsync        [heavy GPU inference]
                          ├─> Ollama /api/chat        [local LLM]
                          └─> bob_conversations + bob_messages  [persistence]
```

### 11.2 Privileged Code / Ops

```
grand_master user
  └─> GrandmasterCodingStudio.tsx
        └─> grandmaster-studio (edge function)
              ├─> inference-service /code/task      [code analysis]
              ├─> inference-service /self-heal       [patch execution]
              └─> inference-service /ask-copilot     [research queue]
                    └─> bob-code-change-task          [policy-gated patch apply]
```

### 11.3 Field Intelligence

```
Field Officer (Mobile/Expo)
  ├─> PTT audio tap
  │     └─> speech-to-intent → STT (Whisper/RunPod) → incidents table
  ├─> Wake word "Hey Bob"
  │     └─> Picovoice → hands-free patrol update
  ├─> Photo capture
  │     └─> biosecurity-assess / smoke-assess / analyze-vehicle-photo
  │           └─> bobVision() → vision model → assessment + checklist
  └─> SOS button
        └─> wearable-sos → push notification → all org supervisors
```

### 11.4 Radio Agent

```
Live audio feed
  └─> radio-audit (edge function)
        ├─> Acoustic model — danger phrase detection
        ├─> False-positive filter (5s window — negations suppressed)
        └─> Risk threshold decision
              ├─> LOW      → Passive (30s window)
              ├─> ELEVATED → Active Listen (10s window)
              └─> CRITICAL → Monitor Ambient Risk
                               └─> Armed Danger Auto-Assist activated
                                     └─> suspend all pending org proposals
```

### 11.5 Approval & Governance

```
Bob generates proposal
  └─> impact classification
        ├─> LOW    → auto-approve → execute → bob_approval_audit
        ├─> MEDIUM → notify admin (2h SLA)
        │     ├─> approved → execute → bob_approval_audit
        │     ├─> rejected → appeal path → master tier
        │     └─> SLA breach → auto-escalate to master
        └─> HIGH   → notify master (1h SLA)
              ├─> approved → execute → bob_approval_audit
              └─> SLA breach → push notification to all masters
```

### 11.6 Multimodal & Memory

```
Any Bob surface
  └─> bob-multimodal-gateway
        ├─> /v1/bob/interpret          [vision / audio interpretation]
        ├─> /v1/bob/request_ai         [AI task dispatch]
        ├─> /v1/bob/response           [feedback → bob_learning_log]
        ├─> /v1/bob/execution          [action execution audit]
        ├─> /v1/bob/privacy/consent    [user data permission]
        └─> /v1/bob/privacy/delete     [right-to-erasure]

Per-session memory tables:
  bob_conversation_memory  (multi-turn context)
  bob_user_memory          (per-user preferences, scoped NOT per-org)
  bob_learning_memory      (adaptive context)
  bob_learning_log         (scored responses, hallucination events)
```

### 11.7 Autonomous Learning

```
Daily schedule
  └─> run-autonomous-learning-cycle.sh
        ├─> summarize-failures.mjs
        │     └─> reads bob_learning_log → failure digest → adjusts system prompt
        ├─> human-test-engine.mjs
        │     └─> 5 standard prompts → quality score → bob-response-scores.jsonl
        ├─> dr-bob-review.mjs
        │     └─> adversarial critique of pending plans → bob_learning_log
        └─> auto-ingest.mjs
              └─> rebuilds docs/BOB_BRAIN_DUMP.md from live source files
```

### 11.8 Notice & Document Generation

```
Officer or breach detection
  └─> Bob evidence gate (Identity + Location + Violation required)
        ├─> pass → generate-infringement / generate-notice-to-vacate /
        │          generate-warning-notice / biosecurity-notice /
        │          smoke-notice / generate-noise-notice / render-infringement-notice
        │          → document stored + linked to incident
        └─> fail → flag "Insufficient Evidence" → route to human review
```

### 11.9 Human Interaction Surface Map

| Surface | Route | Actor | Bob Role |
|---|---|---|---|
| Chat Studio | `/bob-assistant` | Any role | Conversational AI, memory, feedback |
| AI Analysis | `/ai-analysis` | Admin / officer | Document OCR, analysis, routing |
| Bob Intake Queue | `/bob-intake-queue` | Admin | Staged import review |
| Import Data | `/import-data` | Admin / officer | File classify + entity extraction |
| Proposal Log | `/bob-proposals-log` | Admin / master | Approve / reject proposals |
| Proposal Events | `/bob-proposal-events-log` | Admin / master | Audit trail |
| Action Events | `/bob-action-proposal-events-log` | Admin / master | Executed action audit |
| Bob UI Review | `/bob-ui-review` | Developer / master | QA interface modes |
| Video Suite | `/admin/video-generation` | Admin / master | Briefing video confirm + quota |
| Grandmaster Studio | `/grandmaster-code-studio` | `grand_master` | Code tasks, patch plans |
| System Diagnostics | `/system-diagnostics` | Admin / master | Inference health checks |
| Live Plan Reviews | `/live-plan-reviews` | Admin / master | H&S / SOP approval |
| Settings | `/settings` | Any role | Tone, verification, emergency config |
| Pricing Page | `/pricing` | Admin / master | Patrol quote generation |
| Mobile PTT | Expo app | Officer | Speech-to-intent, wake word, SOS |

### 11.10 Role-Access Matrix

| Capability | `officer` | `admin_officer` | `admin` | `master` | `grand_master` |
|---|---|---|---|---|---|
| Conversational chat | ✓ | ✓ | ✓ | ✓ | ✓ |
| PTT speech-to-intent | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notice / SOP generation | ✓ | ✓ | ✓ | ✓ | ✓ |
| View proposals | — | — | ✓ | ✓ | ✓ |
| Approve medium proposals | — | — | ✓ | ✓ | ✓ |
| Approve high proposals | — | — | — | ✓ | ✓ |
| Submit code tasks | — | — | — | — | ✓ |
| Auto-patch execution | — | — | — | — | ✓ (Level 4) |
| Grandmaster Studio | — | — | — | — | ✓ |
| Video generation | — | — | ✓ | ✓ | ✓ |
| System diagnostics | — | — | ✓ | ✓ | ✓ |
| Emergency cancel (verified) | ✓ | ✓ | ✓ | ✓ | ✓ |

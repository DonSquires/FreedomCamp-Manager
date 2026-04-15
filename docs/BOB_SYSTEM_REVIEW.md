# Bob System Review

Last reviewed: 2026-04-15

## Current Fragmentation

Bob currently spans four layers with overlapping responsibilities:

1. `src/pages/BobAssistantStudio.tsx`
   - User-facing chat, voice, memory controls, planning UI, and coding handoff.
2. `supabase/functions/onspace-ai-chat/index.ts`
   - Policy gateway, privacy checks, provider selection, fallback handling, and session/user auth.
3. `inference-service/server.js`
   - Chat runtime, Ollama/OpenAI/local inference, code guidance, UI tracing, platform diagnostics, self-healing, legal context, and learning stores.
4. GitHub/Railway operational workflows
   - Research queue, code-task queue, deployment, pretraining, and platform health checks.

This creates a split-brain system where Bob acts as:

- chat assistant
- code assistant
- ops agent
- UI tracer
- legal/compliance explainer
- training sink
- voice companion scaffold

The capabilities are useful, but the runtime posture has been inconsistent because the deployment model mixed:

- strict air-gapped production rules
- external build/training access
- local Ollama assumptions
- Railway internal networking
- Supabase JWT auth

## Root Cause of Recent Failures

The main runtime failures were caused by the interaction between:

1. `SELF_CONTAINED_MODE=true`
2. `SELF_CONTAINED_STRICT_EGRESS=true`
3. remote JWKS verification being blocked in strict mode
4. edge-function-to-inference auth relying on either service-role auth or Supabase JWT auth
5. Ollama upstream instability returning `502 Application failed to respond`

That meant Bob could be healthy at `/health`, while the user-facing chat still failed over to a local fallback response.

## Consolidation Direction

The system should operate as one assistant platform with distinct modes, not as several half-overlapping assistants.

### Recommended Runtime Shape

Bob should be treated as one platform with these responsibilities:

1. Conversation and voice companion
   - chat, voice, speech scaffolding, memory, collaboration handoff
2. Engineering copilot
   - build/debug guidance, code task planning, workflow triage
3. Data and DB assistant
   - schema-aware help, query/rule reasoning, migration drift support
4. UI and ops health assistant
   - route tracing, platform diagnostics, environment/config audit

### Recommended Modes

Only two supported operating modes should exist:

1. `self-contained`
   - for locked-down production and privacy-sensitive deployments
   - blocks non-local egress
   - keeps cloud providers disabled
2. `build-training`
   - for development, training, external research, and companion-style assistance
   - allows upstream LLMs, JWKS verification, and remote Ollama/OpenAI access

## Changes Implemented In This Review

1. Added explicit `BOB_OPERATING_MODE` support to `inference-service/server.js`.
2. Derived legacy self-contained flags from that single operating mode.
3. Exposed operating mode, JWT runtime status, and external egress status via `/health`.
4. Updated `inference-service/.env.example` to document the new mode.
5. Kept backward compatibility with existing Railway variables.

## Build/Training Mode Recommendation

For now, to unlock Bob for building and training, set these Railway variables on the Bob service:

```env
BOB_OPERATING_MODE=build-training
CHAT_PROVIDER=ollama
TABULAR_NLP_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama.railway.internal:11434
```

If you want external model access beyond Ollama:

```env
OPENAI_API_KEY=...
CHAT_PROVIDER=openai
TABULAR_NLP_PROVIDER=openai
```

Then confirm with `/health`:

- `config.OPERATING_MODE = build-training`
- `config.EXTERNAL_EGRESS_ALLOWED = true`
- `config.SUPABASE_JWT_RUNTIME_ENABLED = true`

## Schema Grounding

The local workspace does not contain the raw artifact for "Database — Schema Extract #9".
The current authoritative schema reference in-repo is [docs/LIVE_SCHEMA.md](LIVE_SCHEMA.md), which is marked as verified by Schema Extract #29. Use that file as the database grounding source until the #9 artifact is restored or downloaded.

## Next Defragmentation Steps

1. Move Bob provider policy to one place.
   - The edge function should own policy/privacy.
   - The inference service should own provider/runtime behavior.
2. Separate companion UX from ops UX.
   - `BobAssistantStudio` currently mixes chat, memory, coding, mapping, live plans, and drawing.
3. Create one provider policy matrix.
   - `chat`, `tabular`, `vision`, `route tracing`, `self-heal`, and `code assist` should share a single capability map.
4. Add a real voice-runtime plan.
   - Today voice is mostly browser speech scaffolding; it is not a full assistant orchestration layer yet.
5. Add a Bob system status panel in the UI.
   - show operating mode, provider, auth status, egress status, and upstream health from `/health`.
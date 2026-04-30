# Bob Unified Implementation Plan

**Date**: 2026-04-30  
**Status**: Ready for implementation  
**Scope**: Transform Bob from stateless task executor to integrated conversational AI with persistent memory, learning, and unified operations

---

## Executive Summary

Bob currently operates as a **stateless inference endpoint** — each interaction is isolated, unaware of prior conversations, and unable to learn from feedback. The goal is to transform Bob into a **Data-like AI assistant** with:

- **Persistent conversational memory** (store and retrieve full conversation history)
- **Adaptive learning** (score responses; update behavior based on success/failure)
- **Integrated operations** (voice, planning, testing, diagnostics unified in one context)
- **Autonomous reasoning** (make decisions without asking; escalate with evidence)
- **Self-healing** (detect degradation; attempt recovery; report health)

---

## Current State Assessment

### Infrastructure ✅
- **RunPod Worker**: Deployed (n0bp1ifmq01cx2); Qwen2.5 7B + Llama3.2-Vision pre-baked; Playwright + Node.js ready
- **Edge Functions**: onspace-ai-chat stateless and functional; check-services-health monitoring active
- **Autonomous Loops**: ops-bob-self-test.yml runs every 4 hours; trigger-bob-self-test.mjs executes Playwright suite
- **Health Monitoring**: system_state.json refreshes hourly; bob-failure-summary.json tracks patterns
- **ADR Framework**: docs/adr/ established; 001-autonomous-learning-loop.md documents truth protocol

### Bob's Current Capabilities
✅ Chat (stateless)  
✅ Code analysis (semantic search into repo)  
✅ Playwright test execution (via RunPod)  
✅ Health monitoring (endpoint checks)  
✅ Self-test orchestration (YAML workflow)  
✅ Artifact generation (BOB_BRAIN_DUMP.md, failure summaries)  

### Bob's Missing Capabilities
❌ **Conversation history** — Each call is isolated; no memory across sessions  
❌ **Learning from feedback** — Responses aren't scored; patterns aren't analyzed  
❌ **Context propagation** — Can't maintain state across chat turns  
❌ **Integrated UI** — Voice, planning, testing are separate from chat  
❌ **Adversarial review** — dr-bob-review.mjs exists but isn't integrated into feedback loop  

---

## Implementation Roadmap

### Phase 1: Persistent Memory Layer (4 hours)

**Goal**: Store and retrieve conversation history; enable context carryover.

#### 1.1 Database Schema for Conversations
Add to Supabase (new migration):
```sql
CREATE TABLE bob_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  organization_id UUID
);

CREATE TABLE bob_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES bob_conversations,
  role TEXT CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  metadata JSONB, -- {model, provider, confidence, sources, tokens_used}
  created_at TIMESTAMPTZ DEFAULT now(),
  organization_id UUID
);

CREATE TABLE bob_learning_log (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES bob_conversations,
  message_id UUID REFERENCES bob_messages,
  score NUMERIC CHECK (score >= 0 AND score <= 1), -- 0=failure, 1=success
  feedback TEXT,
  lesson_key TEXT, -- categorize lessons (hallucination_pattern, fix_pattern, etc)
  created_at TIMESTAMPTZ DEFAULT now(),
  organization_id UUID
);

-- RLS policies: all org-scoped, read/write only by user's org
```

#### 1.2 Bob Conversation Service (TypeSc script)
Create `src/lib/bobConversationService.ts`:
```typescript
export interface BobMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: { model?: string; provider?: string; confidence?: number };
}

export interface BobConversation {
  conversation_id: string;
  title: string;
  messages: BobMessage[];
  created_at: string;
  updated_at: string;
}

export async function loadConversation(
  conversationId: string,
  org_id: string
): Promise<BobConversation | null>;

export async function createConversation(
  title: string,
  org_id: string
): Promise<BobConversation>;

export async function appendMessage(
  conversationId: string,
  message: BobMessage,
  org_id: string
): Promise<void>;

export async function scoreMessage(
  messageId: string,
  score: number,
  feedback?: string,
  lessonKey?: string
): Promise<void>;

export async function listConversations(
  org_id: string,
  limit?: number
): Promise<BobConversation[]>;
```

#### 1.3 Bob Chat Upgrade (Supabase Edge Function)
Modify `.github/workflows/deploy-runpod-worker-serverless.yml` to preserve conversation UUIDs in RunPod metadata; update `onspace-ai-chat/index.ts` to:
- Accept optional `conversation_id` in request
- Prepend conversation history to system prompt
- Return `conversation_id` in response so client can persist it
- Store messages in Supabase after response

### Phase 2: Learning & Feedback Loop (4 hours)

**Goal**: Score responses; detect patterns; adapt behavior.

#### 2.1 Response Scoring System
Create `scripts/bob-score-responses.mjs`:
```javascript
// Implement scoring for common failure modes:
// - hallucination (claimed non-existent file/function)
// - outdated-context (referenced old API)
// - incomplete-answer (left blocker unresolved)
// - correct-first-time (no revision needed)
// - self-healed (Bob caught own mistake and fixed it)

export async function scoreResponse(response: string, context: ScoreContext): Promise<number>;
export async function detectHallucinationPattern(response: string): Promise<boolean>;
export async function logLessonLearned(pattern: string, resolution: string): Promise<void>;
```

#### 2.2 Adversarial Review Gate Closure
Update `scripts/dr-bob-review.mjs` to write scores back to `bob_learning_log`:
```javascript
// After dr-bob-review finds a blocker or approve:
await scoreMessage(messageId, decision === 'approve' ? 1.0 : 0.0, reviewFindings);
```

#### 2.3 Automated Learning Digest
Update `scripts/summarize-failures.mjs` to read `bob_learning_log` and compute:
- Response quality score (% success)
- Top hallucination patterns (group by lesson_key)
- Adaptive system prompt adjustments (e.g., "User frequently asks about <topic>; prioritize accuracy there")

### Phase 3: Context Retention & Session Management (3 hours)

**Goal**: Preserve context across browser sessions; enable Bob to "remember" long-running tasks.

#### 3.1 Zustand Store for Bob Context
Create `src/stores/bobStoreTS`:
```typescript
interface BobContextStore {
  activeConversationId?: string;
  conversationHistory: BobMessage[];
  modelProfile: {
    tone: 'professional' | 'casual' | 'technical';
    temperature: number;
    maxTokens: number;
  };
  learnedLessons: Map<string, number>; // pattern -> confidence
  isProcessing: boolean;

  // Actions
  loadConversation: (conversationId: string) => Promise<void>;
  createConversation: (title: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  scoreLastMessage: (score: number, feedback?: string) => Promise<void>;
  updateProfile: (profile: Partial<BobContextStore['modelProfile']>) => void;
}
```

#### 3.2 Conversation Persistence Hook
Create `src/hooks/useBobConversation.ts`:
```typescript
export function useBobConversation() {
  return {
    conversation: BobConversation;
    messages: BobMessage[];
    loading: boolean;
    sendMessage: (content: string) => Promise<void>;
    scoreMessage: (messageId: string, score: number) => Promise<void>;
  };
}
```

#### 3.3 Browser Session Storage
Persist `activeConversationId` to localStorage so Bob "remembers" which conversation you were in.

### Phase 4: Integrated Operations Dashboard (6 hours)

**Goal**: Unified interface combining voice, planning, testing, diagnostics.

#### 4.1 Bob Studio Unification
Consolidate into one `src/pages/BobStudio.tsx` with tabs:
- **Chat** (existing BobAssistantStudio)
- **Planning** (ops generation, task orchestration)
- **Voice** (PTT integration, transcription, translation)
- **Testing** (Playwright edge case runner, smoke tests)
- **Diagnostics** (health scoring, error analysis from logs)
- **Emergency** (dual-signal confirmation, ambient risk detection)

#### 4.2 Unified Context Bridge
All tabs share:
- Active conversation + message history
- Active organization context
- Current task/operation state
- Learned patterns and adaptive settings

#### 4.3 Planning Module Integration
Wire `docs/BOB_OPERATIONAL_PLANNING.md` into Bob:
- SOP draft generation (from Bob's recommendations)
- Role assignment workflows
- Hazard registry + controls
- Approval gates

#### 4.4 Voice + PTT Integration
Connect PTT Radio Agent (from Studio UI):
- Wake word detection ("Hey Bob")
- Live transcription + translation within chat
- Bob can respond audibly (TTS)
- Emergency assist with dual-signal confirmation

#### 4.5 Testing Module
Wire `scripts/trigger-bob-self-test.mjs` into unified dashboard:
- Run tests on-demand from UI
- Display live results
- Score test failures
- Link to remediation tasks

#### 4.6 Diagnostics Panel
Embed health scoring + error analysis:
- `system_state.json` live view
- `bob-failure-summary.json` drill-down
- Recommendations for improvement
- One-click remediation actions

### Phase 5: Autonomous Reasoning & Self-Healing (5 hours)

**Goal**: Bob makes decisions without asking; escalates blockers with evidence.

#### 5.1 Decision Framework
Update Bob's system prompt to include decision criteria:
```text
DECISION RULES:
- If analysis high-confidence (>0.9) and no security/governance risk: DECIDE without asking
- If analysis medium-confidence (0.7-0.9) and clear evidence: PROPOSE with rationale
- If analysis low-confidence (<0.7) or governance/security impact: ESCALATE with evidence
- Always include [EVIDENCE], [RATIONALE], [ROLLBACK_PLAN] in decisions

ESCALATION CRITERIA:
- Data model changes (ask for schema migration approval)
- Security/compliance changes (ask for policy review)
- Deployment changes (ask for rollback readiness)
- Cross-org impact (ask for tenant isolation proof)
```

#### 5.2 Self-Healing Actions
Bob can autonomously:
- Restart RunPod workers (via `bob_deploy.py`)
- Trigger edge function redeploys (via `supabase functions deploy`)
- Update feature flags (via `FEATURE_FLAGS` in system_state.json)
- Scale infrastructure (via RunPod GraphQL mutations)
- Auto-rollback failed deployments

#### 5.3 Adversarial Self-Check
Before any autonomous action, Bob runs `scripts/dr-bob-review.mjs` on the proposed action. Only proceeds if approved (> 0.8 confidence).

#### 5.4 Health Degradation Escalation
If `scripts/monitor-bob.sh` detects `critical_warning` in `system_state.json`:
- Bob publishes alert to incident chat
- Bob pauses autonomous actions (escalate manually)
- Bob reduces response confidence scores temporarily

### Phase 6: ADR Integration & Long-Term Memory (2 hours)

**Goal**: Bob's design decisions become permanent institutional memory via ADRs.

#### 6.1 ADR Auto-Generation
When Bob solves a recurring design problem 3+ times, propose ADR creation:
```
Pattern detected: [problem type]
- Occurred at [dates/contexts]
- Solution: [your approach]
- Should this become a decision record?
→ Create ADR 008-[name].md automatically
```

#### 6.2 ADR Query Integration
Add ADR query into Bob's context:
```typescript
// In onspace-ai-chat edge function:
const relevantAdrs = await searchAdrs(userQuery, org_id);
// Prepend to system prompt: "See also these prior decisions: [ADR summaries]"
```

---

## Implementation Sequence

| Phase | Task | Estimated | Priority |
|-------|------|-----------|----------|
| 1 | Database + conversation service | 4h | 🔴 Critical |
| 2 | Learning loop closure | 4h | 🔴 Critical |
| 3 | Context retention + Zustand | 3h | 🟠 High |
| 4 | Integrated dashboard | 6h | 🟠 High |
| 5 | Autonomous reasoning gates | 5h | 🟡 Medium |
| 6 | ADR integration | 2h | 🟡 Medium |
| **Total** | | **24h** | |

---

## Success Criteria

✅ Bob remembers entire conversation history within a session  
✅ Bob scores own responses and learns from feedback (≥ 10 scored messages)  
✅ Bob detects hallucination patterns and adapts (tracks ≥ 3 lessons learned)  
✅ Integrated dashboard loads; tabs switch seamlessly  
✅ Bob can autonomously restart RunPod worker with approval escalation  
✅ Emergency assist UI renders; dual-signal confirmation works  
✅ ADR corpus grows by 2+ new decisions captured from Bob's work  

---

## Blocking Issues to Resolve First

### 1. RunPod API Key Authentication (BLOCKING)
**Issue**: REST GET endpoints/* returns 401 on RUNPOD_API_KEY  
**Root cause**: Token may be scoped to GraphQL only; REST endpoints require different auth  
**Action**: Regenerate RunPod API key with REST scope; test with:
```bash
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  "https://api.runpod.io/graphql" \
  -X POST -d '{"query":"{ pods { id } }"}'
```

### 2. Supabase Migration Needs Review
Before implementing database schema, need approval on:
- `bob_conversations` multi-tenancy (is user_id the right PK vs organization context?)
- `bob_learning_log` retention policy (purge after 90 days?)
- RLS policies (who can view Bob's learning history?)

### 3. PTT Voice Integration Scope
Bob Radio Agent is currently UI spec only. Need to confirm:
- Wake word detection: in-browser (Picovoice) or server-side?
- TTS provider: RunPod Ollama voice, ElevenLabs, or OpenAI?
- Emergency assist: who triggers? what's approval flow?

---

## Dependencies on Existing Systems

- ✅ **Supabase**: Ready for new tables (migrations can deploy)
- ✅ **RunPod**: Worker ready; just need API key fix
- ✅ **GitHub Actions**: Workflows in place; trigger-bob-self-test.mjs ready
- ✅ **React + Zustand**: Stack ready for new stores
- ✅ **Existing Bob infrastructure**: Chat working; just add memory layer

---

## Next Immediate Action

1. **Fix RunPod API Key** (30 min): Regenerate and test REST endpoints
2. **Create database migration** (45 min): bob_conversations, bob_messages, bob_learning_log schema
3. **Implement bobConversationService** (2h): Basic CRUD for conversations
4. **Upgrade onspace-ai-chat** (1h): Wire in conversation history
5. **Validate in staging** (1h): Test one conversation end-to-end

**Quick Win**: After step 5, Bob will remember conversations within a session. Then iterate on learning loop.

---

## Rollback & Safety

- All changes are additive (new tables, new functions) — no breaking changes to existing Bob infrastructure
- Conversation storage is opt-in (API accepts conversation_id as optional param)
- Learning scores don't affect Chat behavior until Phase 5
- All autonomous decisions require dr-bob-review approval (Phase 5)

---

Generated: 2026-04-30 | Status: Ready | Owner: Bob Team

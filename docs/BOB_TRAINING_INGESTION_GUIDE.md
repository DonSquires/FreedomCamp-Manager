# Bob Self-Training & Knowledge Ingestion Guide

## Overview

Bob is trained via two main pathways:

1. **External feeding**: Copilot and operators push vetted training bulletins into Bob's `/intel/ingest-bulletin` endpoint
2. **Self-learning**: Bob can capture and store his own training from operational tasks and feedback

This guide explains both, and how to make Bob's training visible and debuggable.

---

## External Training Pathway

### Master Ingestion Script

All Bob training is coordinated through a single master script that runs all individual training feeders in sequence.

**Command:**

```bash
export BOB_SERVICE_URL="https://your-bob-host"
export BOB_INFERENCE_API_KEY="your-api-key"
node scripts/bob-ingest-all-training.mjs
```

**What it runs:**

1. `bob-feed-build-context.mjs` — Build priorities, execution constraints, target files
2. `bob-feed-railway-training.mjs` — Tech stack, platform knowledge, coding conventions
3. `bob-feed-specialized-training.mjs` — Analysis, emulation, visual inspection, physics, interaction style
4. `bob-feed-web-research.mjs` — Web research protocol, NZ procurement sources, tender essentials
5. `bob-feed-nz-business-growth-training.mjs` — NZ business model, commercial packaging, owner/provider/client chain
6. `bob-feed-nz-councils-procurement.mjs` — NZ councils, Freedom Camping Act, procurement patterns, adoption strategy

**Output:**

Displays a summary of what was sent and confirms memory load success.

**Dry-run mode (preview without sending):**

```bash
node scripts/bob-ingest-all-training.mjs --dry-run
```

---

## Self-Training Pathway

Bob can capture training from his own operational interactions and feedback. This requires two things:

1. **Self-learning endpoint** on Bob: `POST /learn/pretrain` (ingest feedback)
2. **Operator-triggered save**: Scripts in `scripts/` that capture Bob's outputs and log them for review

### How Bob's Self-Training Works

When Bob solves a problem, analyzes code, or provides guidance, his response includes metadata:

```json
{
  "response": "...",
  "model": "llama3.1:8b",
  "provider": "runpod-serverless-ollama",
  "metadata": {
    "confidence": 0.85,
    "sources": ["file1.ts", "file2.ts"],
    "reasoning_depth": "detailed"
  }
}
```

Operators can capture this and push it back to Bob's `/learn/pretrain` or `/learn/ingest-feedback` endpoint so Bob **learns from his own performance**.

### Setting Up Self-Training Capture

When Copilot calls Bob and gets a strong response, save it:

```bash
# In scripts/, create a log entry like:
cat > .runtime/bob-self-training.log <<'EOF'
{
  "date": "2026-04-22T12:00:00Z",
  "source": "copilot-task-xyz",
  "query": "How should we architect the tender approval workflow?",
  "response": "...",
  "quality_rating": "high",
  "applies_to_module": ["tender-workflow", "approval-logic"],
  "next_use": "training-bulk-load"
}
EOF
```

Then push to Bob's self-training endpoint:

```bash
node scripts/bob-self-training-ingest.mjs --input .runtime/bob-self-training.log --endpoint /learn/pretrain
```

---

## Knowledge Visibility & Debugging

### Check What Bob Has Learned

```bash
curl -sS \
  -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  https://your-bob-host/intel/state
```

Returns:

```json
{
  "bulletins_loaded": 142,
  "categories": {
    "system": 45,
    "task": 67,
    "feedback": 30
  },
  "last_update": "2026-04-22T12:34:56Z"
}
```

### Check Self-Learning Capture

```bash
curl -sS \
  -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  https://your-bob-host/learn/status
```

Returns:

```json
{
  "self_learning_enabled": true,
  "feedback_items_stored": 48,
  "pretraining_profiles": ["nz-enforcement-v1", "tender-excellence"],
  "last_feedback": "2026-04-22T11:30:00Z"
}
```

### Full Knowledge Pack Visibility

```bash
curl -sS \
  -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  https://your-bob-host/self-heal/knowledge | jq .
```

---

## Making Bob's Training Obvious: Best Practices

### 1. **Label Training Bulletins Clearly**

Every training pack should have:

```markdown
---
title: "NZ Councils & Procurement Growth Training"
version: "1.0"
effective_date: "2026-04-22"
applies_to: ["council-outreach", "tender-response", "market-research"]
priority: "high"
---
```

### 2. **Annotate Each Feeder Script**

```javascript
/**
 * bob-feed-councils-procurement.mjs
 *
 * Scope: NZ council procurement, Freedom Camping Act enforcement, adoption strategy
 * Bulletins: 6
 * Endpoint: /intel/ingest-bulletin
 * Primary Use: Answer council RFP questions, adoption strategy, procurement language
 */
```

### 3. **Provide Training Inventory**

Create a central registry:

```bash
# scripts/bob-training-inventory.md

## Training Inventory

| Feeder | Bulletins | Scope | Sources | Refreshed |
|--------|-----------|-------|---------|-----------|
| bob-feed-build-context | 3 | Build priority, target files | repo docs | 2026-04-22 |
| bob-feed-railway-training | 8 | Tech stack, platform | code + docs | 2026-04-22 |
| bob-feed-specialized-training | 10 | Analysis, visual, physics | docs | 2026-04-22 |
| bob-feed-web-research | 8 | NZ procurement, web protocol | govt sources | 2026-04-20 |
| bob-feed-nz-business-growth | 5 | Commercial model, pricing | market research | 2026-04-22 |
| bob-feed-nz-councils-procurement | 6 | Councils, Freedom Camping Act, adoption | nz govt sources | 2026-04-22 |
| **Total** | **40** | — | — | — |
```

### 4. **Provide a Testing Prompt Set**

After training, ask Bob a standard set of prompts to validate learning:

```bash
# scripts/test-bob-training.mjs

const testPrompts = [
  // Build context
  "What are the current build priorities for FreedomCamp-Manager?",
  
  // Councils & procurement
  "Give me a 3-point NZ council adoption strategy.",
  "What should I emphasize in a council RFP response?",
  
  // Business model
  "Design a 3-tier package structure for FreedomCamp-Manager.",
  "Explain the owner-provider-client revenue chain.",
  
  // Web research
  "Where should I search for NZ council tender opportunities?",
  
  // Integration & architecture
  "How should we architect the PTT integration with field officers?"
]
```

Run after training:

```bash
node scripts/test-bob-training.mjs
```

### 5. **Log All Ingestion Events**

```bash
# Create a log file for transparency:
mkdir -p .runtime/bob-training-logs

# Each ingestion creates an entry:
{
  "timestamp": "2026-04-22T12:15:00Z",
  "action": "ingest-all-training",
  "endpoint": "https://your-bob-host",
  "feeders_run": 6,
  "feeders_succeeded": 6,
  "feeders_failed": 0,
  "total_bulletins": 40,
  "duration_seconds": 23
}
```

---

## Bob's Self-Training Capture Best Practices

### When to Capture Bob's Output

- **High-confidence responses** (confidence > 0.8)
- **Novel or complex advice** (e.g., architecture, strategy, market research)
- **Responses that match training intent** (e.g., Bob gives council-specific advice after councils training was loaded)
- **Multi-source reasoning** (Bob cites multiple docs, sources, or standards)

### How to Tag for Self-Learning

```javascript
// When capturing Bob's response, tag it:
{
  "response": "...",
  "quality": "high",
  "modules_involved": ["council-procurement", "open-api-principles"],
  "suggested_learning_profile": "nz-councils-v2"
}
```

### Pretraining Profile Naming

Bob can build multiple "profiles" for different contexts:

- `nz-enforcement-v1` — Freedom camping, councils, compliance
- `tender-excellence-v1` — RFP drafting, procurement language
- `commercial-strategy-v1` — Pricing, packaging, revenue chains
- `coding-depth-v2` — Architecture, TypeScript patterns, testing

Each profile accumulates feedback and improves Bob's responses in that domain.

---

## Quick Start

**1. Set up Bob host:**

```bash
export BOB_SERVICE_URL="https://your-runpod-bob-host-or-gateway"
export BOB_INFERENCE_API_KEY="your-api-key"
```

**2. Run master training ingestion:**

```bash
node scripts/bob-ingest-all-training.mjs
```

**3. Verify training loaded:**

```bash
curl -sS -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  $BOB_SERVICE_URL/intel/state | jq .
```

**4. Ask Bob a test question:**

```bash
node scripts/ask-bob.mjs "What's the NZ council adoption strategy for FreedomCamp-Manager?"
```

**5. Capture high-quality responses for self-learning:**

```bash
# Add to .runtime/bob-self-learning.log
echo '{...captured response...}' >> .runtime/bob-self-training.log

# Later, push to Bob:
node scripts/bob-self-training-ingest.mjs
```

---

## Troubleshooting

### "Missing required environment variables"

Set `BOB_SERVICE_URL` and `BOB_INFERENCE_API_KEY`:

```bash
export BOB_SERVICE_URL="https://your-host"
export BOB_INFERENCE_API_KEY="your-key"
```

### "HTTP 404: Application not found"

Bob host is unreachable or wrong endpoint. Verify:

```bash
curl -sS $BOB_SERVICE_URL/health
```

Should return `{"status":"healthy",...}`, not 404.

### "Ingestion succeeded but Bob doesn't seem to know about the training"

Bob may need time to index bulletins. Check:

```bash
curl -sS -H "x-inference-api-key: $BOB_INFERENCE_API_KEY" \
  $BOB_SERVICE_URL/intel/state | jq '.bulletins_loaded'
```

If 0, ingestion didn't reach Bob. Verify API key matches.

### "Want to refresh training without reloading everything"

Edit the appropriate `bob-feed-*.mjs` file and change the bulletin content, then run:

```bash
node scripts/bob-feed-nz-councils-procurement.mjs
```

Only that module will update.

---

## Summary

Bob's training is now:

- ✅ **Central**: Master ingestion script runs all feeders
- ✅ **Transparent**: Knowledge inventory and ingestion logs
- ✅ **Testable**: Standard prompt set validates training loading
- ✅ **Self-improving**: Bob can capture and store his own high-quality outputs
- ✅ **Debuggable**: `/intel/state` endpoint shows what Bob has learned

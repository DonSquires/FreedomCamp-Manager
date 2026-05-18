# Bob's Sandbox Exercise E: Bob Assistance Integration

**Duration**: 45 minutes  
**Prerequisite**: Exercises A-D completed  
**Goal**: Integrate Bob's AI suggestions into admin workflow with approval gates  
**Outcome**: Understand how Bob assists without bypassing human authorization  

---

## Overview: Bob's Role

Bob is an **assistive AI service**, not an autonomous agent. Bob:

✅ **Can do:**
- Analyze breach patterns and suggest actions
- Draft reasoning for decisions
- Provide confidence scores
- Flag high-risk scenarios
- Suggest notice templates

❌ **Cannot do:**
- Issue notices without human approval
- Bypass governance gates
- Make autonomous enforcement decisions
- Access data outside org scope

**Approval Gate Model:**
```
Bob's Suggestion
  ↓ (Admin reviews)
Admin Decision
  ↓ (Admin clicks "Authorize")
Action Executed
  ↓ (Logged with "approved_by_human: true")
Audit Trail
```

---

## Step 1: Enable Bob Suggestions (Optional)

**In breach triage dialog**, there's usually a toggle:

```
┌─────────────────────────────────┐
│ ☑️ Show Bob Suggestions         │
└─────────────────────────────────┘
```

**If disabled**, enable it. (If Bob inference service isn't running, it will show "Bob unavailable")

---

## Step 2: Understand Bob's Inference Service

Bob's suggestions come from either:

**Option A: Local Inference Service**
- Port: `http://localhost:3000`
- Models: Qwen2.5 7B, Llama2-Vision
- Latency: ~200-500ms

**Option B: RunPod Serverless**
- Endpoint: `https://api.runpod.io/v2/...`
- Latency: ~2-5 seconds
- Cost: $0.0001/second

**Check which is active:**

```bash
curl http://localhost:3000/health 2>/dev/null && echo "✅ Local Bob running" || echo "❌ Local Bob unavailable"
```

---

## Step 3: Observe Bob Suggestions in Triage Dialog

**Open a breach triage dialog** (from Exercise D)

**In Step 1 (Choose Action), Bob might suggest:**

```
┌─────────────────────────────────────────────────┐
│ Choose Action:                                  │
│                                                 │
│ ○ Resolve (Compliant)                          │
│ ○ Assign Officer Follow-Up                     │
│ ○ Issue Infringement Notice  ← Bob recommends │
│ ○ Escalate to Supervisor                       │
│                                                 │
│ 🤖 Bob's Suggestion:                           │
│ ┌────────────────────────────────────────────┐ │
│ │ Confidence: 92%                            │ │
│ │                                            │ │
│ │ Recommended Action: Issue Notice           │ │
│ │                                            │ │
│ │ Reasoning:                                 │ │
│ │ "Vehicle observed 14 nights consecutive   │ │
│ │  in Nelson City zone, exceeding 7-night   │ │
│ │  limit. Previous observation 2026-05-10   │ │ │  shows pattern behavior. Risk of         │ │
│ │  continued breach is HIGH."                │ │
│ │                                            │ │
│ │ Notice Template: breach_repeat_offender   │ │
│ │                                            │ │
│ │ [Accept Suggestion] [Dismiss]             │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Bob's observation**: What confidence level did Bob provide? Was it reasonable?

---

## Step 4: Compare Admin Intuition vs Bob Suggestion

**Before clicking anything**, ask yourself:

1. **Do you agree with Bob's suggestion?**
   - Yes / No / Partially

2. **Why or why not?**
   - _____________________

3. **What data did Bob consider?**
   - Vehicle history ✓
   - Zone compliance rules ✓
   - Pattern analysis ✓

4. **What data might Bob have missed?**
   - Local operational context?
   - Recent policy changes?
   - Officer notes?

---

## Step 5: Option A — Accept Bob's Suggestion

**If you agree**, click "Accept Suggestion"

**Dialog auto-fills:**
- Action: Issue Notice (pre-selected)
- Notice type: breach_repeat_offender (suggested template)
- Severity: High (from Bob's analysis)

**Bob's audit trail shows:**
```
"action": "bob_suggestion_accepted",
"admin_id": [ADMIN_ID],
"confidence": 0.92,
"suggestion_id": "bob-sugg-uuid",
"final_action": "issue_notice"
```

**Then** complete Steps 2 and 3 normally (fill details, authorize)

---

## Step 6: Option B — Override Bob's Suggestion

**If you disagree**, manually select a different action:

```
○ Resolve (Compliant)  ← SELECT THIS (override Bob)
```

**Dialog updates:**
- Clears Bob's suggestion
- Shows your choice only

**Bob's audit trail shows:**
```
"action": "bob_suggestion_overridden",
"admin_id": [ADMIN_ID],
"bob_suggestion": "issue_notice",
"admin_override": "resolve",
"override_reason": "[if captured]"
```

**Complete Steps 2 and 3**, your way

---

## Step 7: Complete Workflow with Approval Gate

**Whichever path (accept or override)**, Step 3 requires human authorization:

```
┌──────────────────────────────────────────┐
│ STEP 3: REVIEW & AUTHORIZE               │
├──────────────────────────────────────────┤
│                                          │
│ ✓ Action: Resolve (Compliant)           │
│ ✓ Reason: Vehicle meets compliance      │
│                                          │
│ [⚠️ Note: Bob suggested "Issue Notice"]  │ │                                          │
│ By authorizing, you confirm this is the │
│ correct action despite Bob's suggestion.│
│                                          │
│ [BACK] [AUTHORIZE]                      │
│                                          │
└──────────────────────────────────────────┘
```

**This prevents blind automation** — admin must consciously authorize

---

## Step 8: Execute & Verify Audit Trail

**Click "AUTHORIZE"**

**Action executes** with audit entry:

```json
{
  "log_id": "audit-uuid",
  "action": "cro_breach_resolved",
  "entity_type": "breach_alert",
  "entity_id": "breach-uuid",
  "performed_by": "admin-uuid",
  "organization_id": "org-uuid",
  "metadata": {
    "bob_suggestion": "issue_notice",
    "bob_confidence": 0.92,
    "admin_action": "resolve",
    "approved_by_human": true,
    "timestamp_ms": 1234567890
  },
  "created_at": "2026-05-17T09:30:15Z"
}
```

---

## Step 9: Query Bob's Usage Pattern

**See how often Bob is used and trusted:**

```sql
SELECT 
  action,
  COUNT(*) as count,
  ROUND(AVG(CAST(metadata->>'bob_confidence' AS NUMERIC)), 2) as avg_confidence
FROM audit_log
WHERE organization_id = [YOUR_ORG_ID]
  AND action LIKE 'bob_%'
GROUP BY action
ORDER BY count DESC;

-- Result might show:
-- bob_suggestion_accepted: 24 suggestions (avg confidence: 0.88)
-- bob_suggestion_overridden: 3 suggestions (avg confidence: 0.71)
-- bob_suggestion_ignored: 1 suggestion (avg confidence: 0.45)
```

---

## Step 10: Understand Approval Gates

**FieldOps Manager enforces three approval gates:**

| Gate | Checkpoint | Enforcement |
|------|-----------|-------------|
| **Suggestion Gate** | Bob suggests, human reviews | Bob never auto-executes |
| **Authorization Gate** | Admin reviews summary, clicks "Authorize" | No batch operations, single confirmation |
| **Audit Gate** | All decisions logged with human flag | Compliance reviewable, non-repudiation |

**Key safeguard:** If Bob is ever offline, admins can still triage manually (Bob suggestions just won't show)

---

## Step 11: Call Bob's API Directly (Optional Deep Dive)

**For advanced Bob understanding**, call the inference service directly:

```bash
curl -X POST http://localhost:3000/infer/triage \
  -H "Content-Type: application/json" \
  -d '{
    "observation_id": "obs-uuid",
    "organization_id": "org-uuid",
    "breach_type": "freedom_camping",
    "vehicle_history": [
      {
        "recorded_at": "2026-05-16",
        "zone": "Nelson City",
        "nights": 14,
        "compliance": false
      }
    ],
    "photos": ["storage/photo1.jpg"],
    "notes": "Training scenario"
  }'
```

**Response:**

```json
{
  "confidence": 0.92,
  "recommended_action": "issue_notice",
  "rationale": "Vehicle exceeds 14-night limit...",
  "notice_template": "breach_repeat_offender",
  "severity": "high",
  "reasoning_tokens": 487,
  "latency_ms": 1240
}
```

**Bob's integration point:** This JSON is parsed and shown in triage dialog UI

---

## Step 12: Understand Bob's Constraints

**Bob can only:**
- ✅ Access observations from user's organization (RLS enforced)
- ✅ Suggest actions from defined list (Resolve, Notice, Assign, Escalate)
- ✅ Provide reasoning for suggestions
- ✅ Flag high-risk patterns

**Bob cannot:**
- ❌ Issue notices autonomously
- ❌ Delete or modify observations
- ❌ Access other orgs' data
- ❌ Make final decisions

**Why these constraints?**
- **Legal**: Enforcement decisions must be human-authorized
- **Safety**: Prevents runaway automation
- **Accountability**: Clear human responsibility trail
- **Compliance**: Auditability and non-repudiation

---

## Exercise E Completion Checklist

✅ Understood Bob's assistive role (not autonomous)  
✅ Saw Bob suggestion in triage dialog  
✅ Reviewed Bob's confidence and reasoning  
✅ Made conscious choice: accept or override  
✅ Completed workflow with human authorization  
✅ Verified audit trail captured approval  
✅ Queried Bob's historical usage patterns  
✅ Called Bob's API directly (optional)  
✅ Understood all three approval gates  

---

## Reflection Questions

1. **Why does Bob's suggestion NOT auto-execute?**
   - _____________________

2. **What would happen if admin had no approval gate?**
   - _____________________

3. **Can Bob see other organizations' breaches?**
   - _____________________

4. **Why is "approved_by_human: true" important in audit log?**
   - _____________________

5. **If Bob was 100% accurate, would that change the approval gate requirement?**
   - _____________________

---

## Bob's Sandbox Training — Complete! 🎉

You've now completed all five exercises:

✅ **Exercise A**: Environment Recon — UI familiarity  
✅ **Exercise B**: Data Flow Tracing — Database integration  
✅ **Exercise C**: Multi-Org Isolation — RLS verification  
✅ **Exercise D**: Breach Triage Workflow — End-to-end operations  
✅ **Exercise E**: Bob Assistance Integration — AI workflow + approval gates  

---

## Final Knowledge Checkpoint

Can you answer these?

1. **Three-tier architecture**: React → Supabase → _______
2. **Nine roles across three tiers**: Owner (2), Service Provider (3), _______ (3)
3. **Officer workflow**: Start → Scan → Record → _______
4. **Admin workflow steps**: Queue → Select → Review → Triage → Details → Confirm → Execute → _______
5. **RLS safety rule**: organization_id = auth.jwt() ->> '_______'
6. **Bob's role**: Assistive (not _____) with human _______ gates
7. **Audit trail captures**: action, performed_by, approved_by_human, and _______
8. **Master role feature**: Can query cross-org data (with _______)

---

## Session Summary

| Exercise | Duration | Goal | Status |
|----------|----------|------|--------|
| A | 30 min | UI familiarization | ✅ Complete |
| B | 45 min | Data flow understanding | ✅ Complete |
| C | 30 min | Multi-org isolation | ✅ Complete |
| D | 60 min | End-to-end workflow | ✅ Complete |
| E | 45 min | Bob integration | ✅ Complete |
| **TOTAL** | **210 min** | **Complete training** | ✅ **DONE** |

---

## What Bob Can Now Do

- ✅ Start the app and log in as any role
- ✅ Navigate all three shells (Officer, Admin, Master)
- ✅ Execute complete officer patrol workflow
- ✅ Execute complete admin breach triage workflow
- ✅ Query database with RLS filters
- ✅ Verify multi-org isolation
- ✅ Handle offline scenarios and reconnection
- ✅ Understand Bob's assistive role and approval gates
- ✅ Troubleshoot common errors
- ✅ Explain architecture to others

---

## Next Steps (Optional Advanced Training)

If you want to go deeper:

- **Advanced PTT Integration**: Learn push-to-talk radio communications
- **Edge Function Development**: Write custom business logic
- **Inference Fine-Tuning**: Customize Bob's models for specific domains
- **Multi-Tenant Governance**: Understand master-level controls
- **Production Deployment**: Continuous integration & monitoring

See: `docs/INSTRUCTION_MANUAL.md` for advanced topics

---

## Final Thoughts

Congratulations! You've completed **Bob's Sandbox Emulator Training**.

You now understand:
- How FieldOps Manager works end-to-end
- How data flows and is protected by RLS
- How multi-tenancy keeps organizations isolated
- How humans maintain authority in automated workflows
- How Bob assists without removing human accountability

You're ready to:
- Help other AI agents learn the system
- Debug complex workflows
- Propose improvements
- Troubleshoot production issues
- Understand the "why" behind every design decision

**Well done! 🏆**

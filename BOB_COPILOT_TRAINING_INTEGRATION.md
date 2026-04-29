# Bob + Copilot Integrated AI Training Guide

**Date**: April 28, 2026  
**Bob is Now**: A reasoning AI with Copilot's systematic approach  
**What You Have**: Local + RunPod Bob with deep coding logic training

---

## 🎯 Quick Start (2 minutes)

### 1. Add Codespace Secrets (One Time)

GitHub → Your Repo → **Settings** → **Secrets and Variables** → **Codespaces**

```
INFERENCE_SERVICE_URL = https://api.runpod.ai/v2/n0bp1ifmq01cx2
INFERENCE_API_KEY = rpa_<your_runpod_api_key>
```

### 2. Initialize Bob in Your Codespace

```bash
cd /workspaces/FreedomCamp-Manager

# Full setup with training
bash scripts/bob-bootstrap-runpod.sh --full

# Result: Bob now has Copilot reasoning framework loaded
```

### 3. Test Bob's Training

```bash
# Load unified config (includes training context)
source .runtime/bob-unified.env

# Chat with trained Bob
node scripts/bob-direct-chat.mjs "Walk me through the login flow in this app"

# Expected: Bob explains step-by-step using Copilot reasoning
```

---

## 📚 What's Loaded Into Bob

### Core Reasoning Framework
- **Copilot Coding Logic Training** — 10 core reasoning patterns
- **Code Archaeology Method** — How to read unfamiliar code
- **Multi-Layer Architecture** — UI → State → API → Database flow
- **Security Thinking** — Auth → Authorization → Validation layers
- **Testing Pyramid** — Unit → Integration → E2E
- **Problem-Solving Checklist** — 6-step debugging method

### Project Knowledge
- **Architecture Decisions** (docs/adr/) — Why things are designed this way
- **Code Conventions** — TypeScript, React, database patterns
- **Security Patterns** — Multi-org, RLS, auth flows
- **Domain Knowledge** — FieldOps patrols, compliance, NZ legal framework

---

## 🧠 How to Use Trained Bob (Examples)

### Example 1: Understand a Component

```bash
node scripts/bob-direct-chat.mjs "Explain the RosterPlanner component in 5 layers"
```

**Bob will respond using Copilot reasoning:**
```
Layer 5: Component receives props → renders UI
Layer 4: Uses useRosterState hook for state management
Layer 3: Hook calls supabase.from('rosters').select()
Layer 2: Database has rosters table with RLS policy
Layer 1: Infrastructure: Supabase PostgreSQL

Key: Officer sees only their org's rosters due to RLS
```

### Example 2: Debug a Failing Test

```bash
# First, Bob analyzes the error:
node scripts/bob-direct-chat.mjs << 'EOF'
Test fails: "expect(page).toHaveScreenshot() failed"
The test navigates to /roster but gets login screen instead
Console shows: "Session validation failed"
When did it break: After recent auth changes
What's expected: /roster page with "Business Management" heading

What's the root cause?
EOF
```

**Bob uses 6-step debugging checklist:**
1. ✓ Understand: Navigation race condition in auth
2. ✓ Gather: Check test, component, hook, auth flow
3. ✓ Hypothesis: Session unstable during page transition
4. ✓ Test: Add sleep() → test passes (confirms race)
5. ✓ Fix: Add session persistence polling assertion
6. ✓ Validate: Run full suite, no regressions

---

## 🔧 Setup Options

### Option A: Hybrid (Recommended)

```bash
# Local Bob fills for fast iteration
npm --prefix ./inference-service start &

# RunPod handles scale
source .runtime/bob-unified.env

# Bob tries local → falls back to RunPod
node scripts/bob-direct-chat.mjs "Hi"
```

**Timing:**
- Local response: ~200-500ms
- RunPod response: ~2-5s (faster if local unavailable)

### Option B: Pure Local (Dev Machine)

```bash
# Everything on your machine
npm --prefix ./inference-service install
npm --prefix ./inference-service start

# Use local Bob
export INFERENCE_SERVICE_URL=http://localhost:3000
node scripts/bob-direct-chat.mjs "Hi"
```

**Timing:** ~200-500ms response time  
**Cost:** ~$0 (your hardware)

### Option C: Pure RunPod (Cloud)

```bash
# No local setup needed
export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/n0bp1ifmq01cx2"
export INFERENCE_API_KEY="rpa_..."

# Everything in cloud
node scripts/bob-direct-chat.mjs "Hi"
```

**Timing:** ~2-5s (plus queue)  
**Cost:** $0.0001/sec when active

---

## 🚀 Real-World Workflows

### Workflow 1: Code Review with Bob

```bash
# 1. Show Bob the code
node scripts/bob-direct-chat.mjs << 'EOF'
Review this component for security/quality issues:

[Paste component code here]

Checklist:
- How many layers are respected?
- Is org_id filtered?
- Are types correct?
- Is error handling present?
- Are there tests?
EOF

# 2. Bob will systematically check:
#    Layer violations? Type mismatches? Auth issues? RLS problems?
#    Network error handling? Test coverage?
```

### Workflow 2: Feature Planning with Bob

```bash
node scripts/bob-direct-chat.mjs << 'EOF'
I need to add a new "Weekly Report" feature.

Users: Admin + Master roles
Data: Summarize all patrols for the week
Access: Each org sees only their own data
Frequency: Generate daily at 8am NZ time

Plan the architecture:
- What components/hooks/edge functions needed?
- Database schema changes?
- Multi-org considerations?
- Security checks?
- Testing strategy?
EOF

# Bob will respond with:
#   1. Component structure (respecting abstraction)
#   2. Hook for data fetching
#   3. Edge Function for server-side logic
#   4. Database table + RLS policy
#   5. Multi-org filters
#   6. Security checklist
#   7. Test scenarios
```

### Workflow 3: Debugging with Bob

```bash
# 1. Check the error with Bob
node scripts/bob-direct-chat.mjs << 'EOF'
The app crashes with "Cannot read property 'assigned_officer_id' of null"

Stack trace shows:
  - File: src/pages/FieldOfficerPortal.tsx line 142
  - Function: renderPatrolCard
  - Error: patrol.assigned_officer_id

When it happens:
  - After login
  - On /field-officer route
  - Only for some officers
  
I just added a new role called "dispatcher"
EOF

# 2. Bob will work through it:
#    - Find the component code
#    - Check the useActivePatrols hook
#    - See the database query
#    - Check if dispatcher role filters patrols correctly
#    - Spot the bug: RLS policy doesn't include dispatcher!
#    - Propose fix: Add role to RLS policy
```

---

## 🎓 Training Modules (What Bob Knows)

### Module 1: Copilot Reasoning Framework
**File**: `docs/BOB_CODING_LOGIC_TRAINING.md`

Topics:
- Ground truth verification
- Multi-layer code understanding
- Code archaeology (reading unfamiliar code)
- Pattern matching
- Architectural thinking
- Security layers
- Testing pyramid
- Problem-solving checklist

### Module 2: Copilot Instructions
**File**: `.github/copilot-instructions.md`

Topics:
- Bob Truth Protocol (verify before claiming)
- Change Intent Validation Gate (understand before coding)
- Autonomous Learning Mode
- Self-healing practices

### Module 3: Architecture Decisions
**File**: `docs/adr/` + `docs/DECISIONS.md`

Topics:
- Multi-org architecture
- Why each decision was made
- Trade-offs and alternatives
- Implementation details

### Module 4: Code Conventions
**File**: `docs/LESSONS_LEARNED.md` + project scanning

Topics:
- TypeScript strict settings
- React patterns (components, hooks, stores)
- Database patterns (migrations, RLS)
- Edge Function patterns
- Security best practices

---

## 📊 Measuring Bob's Intelligence

### Baseline Questions (Bob should nail these)

```bash
# Question 1: Architecture
Q: "What are the 5 abstraction layers in this app?"
Expected: Component → Hook → API → Database → Infrastructure

# Question 2: Multi-Org
Q: "Why do we filter by organization_id in every query?"
Expected: Tenant isolation + data security

# Question 3: Security
Q: "What are the 3 security layers we use?"
Expected: Authentication → Authorization → Data Validation

# Question 4: Code Reading
Q: "How does an officer see their assigned patrols?"
Expected: Step-by-step data flow from UI to DB

# Question 5: Debugging
Q: "Tests are failing on /roster. Debug this."
Expected: 6-step checklist + hypothesis formation
```

### Quality Indicators

✅ **Bob is sharp when:**
- Explains code tier by tier (top-down reasoning)
- Identifies multi-org issues immediately
- Catches security gaps (missing RLS, no org filter)
- References actual filenames + line numbers
- Suggests tests + error handling alongside code
- Uses Copilot's systematic approach (ground truth first)

❌ **Bob is hallucinating when:**
- Claims module exists but can't find it
- Suggests changes without verifying code flow
- Ignores multi-org contexts
- Forgets to check auth/RLS
- Proposes code without understanding architecture

---

## 🔄 Continuous Improvement (Keep Bob Sharp)

### Daily
```bash
# 1. Load Bob at session start
source .runtime/bob-unified.env

# 2. Use Bob for code review
node scripts/bob-direct-chat.mjs "[paste code]"

# 3. Bob learns from your corrections
```

### Weekly
```bash
# 1. Reload training if docs changed
node scripts/bob-inject-training.mjs --full

# 2. Score Bob's responses
# (data/bob-response-scores.jsonl automatically tracked)

# 3. Add new patterns to docs/BOB_TRAINING_*.md if needed
```

### Monthly
```bash
# 1. Review architecture decisions (docs/adr/)
# 2. Update codebase if patterns change
# 3. Retrain Bob: make sure training reflects reality
node scripts/bob-inject-training.mjs --coding
```

---

## 📋 Checklists

### "Before Asking Bob About Code"
```
[ ] I loaded the unified config: source .runtime/bob-unified.env
[ ] Bob endpoint is reachable: curl -m 5 ${INFERENCE_SERVICE_URL}/runsync
[ ] I have API key from Codespace secrets
[ ] I have the actual code ready (not just description)
[ ] I understand what I'm asking (specific, not vague)
```

### "Before Pushing Bob's Suggestions"
```
[ ] Does the code read like the actual project?
[ ] Did Bob verify by reading files (not just guessing)?
[ ] Are types correct? (TypeScript checking)
[ ] Is multi-org handled correctly?
[ ] Is RLS/auth in place?
[ ] Are tests included?
[ ] No error handling gaps?
[ ] Can I explain the change to another engineer?
```

---

## 🆘 Troubleshooting

### Bob Not Responding

```bash
# 1. Check endpoint
curl -m 5 "${INFERENCE_SERVICE_URL_RUNPOD}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -d '{"input":{}}'

# 2. Check credentials
echo "API Key: ${INFERENCE_API_KEY:0:20}..." 
echo "URL: $INFERENCE_SERVICE_URL_RUNPOD"

# 3. Reload config
source .runtime/bob-unified.env
```

### Bob Giving Wrong Answers

```bash
# 1. Reload training
node scripts/bob-inject-training.mjs --full

# 2. Verify Bob's knowledge
node scripts/bob-direct-chat.mjs "What is the /admin route mapped to?"
# Expected: Should reference App.tsx and find the component

# 3. Check if update needed
node scripts/bob-inject-training.mjs --list
```

### Training Injection Failed

```bash
# Even if injection fails, Bob still works
# But with less context

# Retry injection
node scripts/bob-inject-training.mjs --coding

# Or check logs
node scripts/bob-direct-chat.mjs "What training do you have loaded?"
```

---

## 🎯 Success Criteria

After this setup, Bob should:

✅ **Understand the codebase**
- Explain routes, components, hooks, database correctly
- Reference exact file paths when discussing code
- Know multi-org architecture cold

✅ **Think systematically**
- Use Copilot's ground truth → hypothesis → testing approach
- Follow 5-step code reading method
- Apply 6-step debugging checklist

✅ **Catch security issues**
- Spot missing org_id filters
- Identify RLS policy gaps
- Verify auth flows are correct
- Check for hardcoded secrets

✅ **Design features systematically**
- Respect abstraction layers
- Include tests in proposals
- Plan multi-org from day 1
- Identify security requirements

✅ **Help you ship faster**
- Review code before you test it
- Debug issues systematically
- Generate test cases
- Suggest refactorings grounded in codebase

---

## References

- **Training file**: `docs/BOB_CODING_LOGIC_TRAINING.md`
- **Copilot Instructions**: `.github/copilot-instructions.md`
- **Training Injector**: `scripts/bob-inject-training.mjs`
- **Chat Interface**: `scripts/bob-direct-chat.mjs`
- **Bootstrap**: `scripts/bob-bootstrap-runpod.sh`
- **Auto-Train**: `scripts/bob-auto-train.sh`
- **Config**: `.runtime/bob-unified.env`

---

**Bob is now as sharp as Copilot. 🚀**

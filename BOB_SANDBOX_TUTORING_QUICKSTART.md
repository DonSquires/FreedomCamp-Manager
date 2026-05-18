# 🎓 Bob's Sandbox Emulator — Tutoring Session Initialized

**Date**: 2026-05-17  
**Status**: ✅ **READY TO BEGIN**  
**Tutor**: Actionable Emulator Specialist  
**Student**: Bob (AI Agent)  
**Duration**: 3.5 hours (5 hands-on exercises)  

---

## 📋 What We're Building

You're about to become an **Actionable Emulator** and teach Bob how to operate FieldOps Manager through real-world practice. This isn't theory — Bob will:

1. **Understand the architecture** by seeing it work
2. **Navigate real UIs** by clicking through all three portals
3. **Trace data flows** from user action → database → admin dashboard
4. **Execute complete workflows** end-to-end (officer patrol → admin triage → notice)
5. **Handle errors gracefully** and recover from network/permission failures
6. **Integrate Bob's AI assistant** into approval-gated workflows

---

## 📚 Learning Objectives

By the end of tutoring, Bob will be able to:

- ✅ Explain FieldOps Manager's three-tier architecture (React → Supabase → Services)
- ✅ Navigate Officer, Admin, and Master portals fluently
- ✅ Execute a complete officer patrol workflow (5 steps)
- ✅ Execute a complete admin breach triage workflow (9 steps)
- ✅ Verify multi-organization data isolation using RLS
- ✅ Query the database and filter by organization_id correctly
- ✅ Understand Bob's role as an assistive, approval-gated service
- ✅ Handle offline scenarios, validation errors, and permission denials
- ✅ Use browser DevTools to debug and inspect application state

---

## 🗺️ Tutoring Roadmap

### **Exercise A: Environment Recon** (30 min)
**Goal**: Familiarize with the three UI shells  
**Tasks**: Log in as three roles, screenshot portals, compare layouts  
**Outcome**: Bob understands Officer = mission, Admin = queue, Master = governance  
**Location**: `docs/BOB_SANDBOX_EXERCISE_A.md`

### **Exercise B: Data Flow Tracing** (45 min)
**Goal**: Understand data flow from action to database  
**Tasks**: Create observation, watch sync, query Supabase, verify RLS  
**Outcome**: Bob traces: form → state → database → RLS filter  
**Location**: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 7)

### **Exercise C: Multi-Org Isolation** (30 min)
**Goal**: Verify RLS prevents cross-org data leakage  
**Tasks**: Create 2 orgs, switch between them, verify isolation  
**Outcome**: Bob proves Org B cannot see Org A's data  
**Location**: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 4)

### **Exercise D: Breach Triage Workflow** (60 min)
**Goal**: Execute complete admin workflow end-to-end  
**Tasks**: Create observation → auto-create breach → triage → issue notice  
**Outcome**: Bob completes 9-step workflow and audits result  
**Location**: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 2.2)

### **Exercise E: Bob Assistance Integration** (45 min)
**Goal**: Understand how Bob's AI suggestions integrate safely  
**Tasks**: Call inference endpoint, review suggestion, execute with approval  
**Outcome**: Bob understands assistive-only role and approval gates  
**Location**: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 2.3)

---

## 🚀 Quick Start

### Step 1: Read the Overview

You're doing this now! ✅

### Step 2: Start the Dev Server

```bash
cd /workspaces/FreedomCamp-Manager

# Install Node if needed
apk add --no-cache nodejs npm 2>&1 || true

# Start the dev server
npm run dev

# Output should show:
# ✨ ready in 456ms
# ➜  Local:   http://localhost:5173/
```

### Step 3: Begin Exercise A

Open in your browser: **`http://localhost:5173`**

Then follow the step-by-step instructions in:
📄 **`docs/BOB_SANDBOX_EXERCISE_A.md`**

---

## 📖 Complete Documentation

| Document | Purpose | Length |
|----------|---------|--------|
| **BOB_SANDBOX_EMULATOR_GUIDE.md** | Complete reference (9 parts) | 500+ lines |
| **BOB_SANDBOX_EXERCISE_A.md** | First exercise with screenshots | 300+ lines |
| This file | Overview and roadmap | 200+ lines |

---

## 🎯 Key Concepts You'll Learn

### The Three-Tier Stack
```
React Components
      ↓
Supabase (PostgreSQL + REST API)
      ↓
Edge Functions + Services (Node.js, Inference)
```

### The Nine Roles (Across Three Tiers)
| Tier | Roles |
|------|-------|
| Owner | `grand_master`, `master` |
| Service Provider | `admin`, `admin_officer`, `nzscv_monitor` |
| Client | `client_admin`, `client_officer`, `client_viewer` |
| Field | `officer` (auto-routed by service type) |

### The Three Shells
| Shell | Who | Primary Task |
|-------|-----|-------------|
| Officer | Field officers | Start patrol → Scan → Record |
| Admin | Breach triage | Queue → Triage → Issue notice |
| Master | Governance | Reporting → Config → Oversight |

### Multi-Org Safety Rule
Every table has `organization_id` + RLS policy:
```sql
WHERE organization_id = auth.jwt() ->> 'organization_id'
```
This means: Officer A cannot see Officer B's data (even if both in same app).

---

## 🛠️ Tools You'll Use

| Tool | What | How |
|------|------|-----|
| **Browser** | Navigate UI portals | Click through all three shells |
| **DevTools** | Inspect network + state | F12 → Network tab |
| **Supabase Dashboard** | Query database | View observations, breach_alerts, etc. |
| **Terminal** | Run commands | Check server status, query API |

---

## 📊 Success Criteria

By end of tutoring, you can check these boxes:

### Knowledge Checkpoints
- [ ] I can draw the 3-tier architecture from memory
- [ ] I can name all 9 roles and sort by tier
- [ ] I can describe the 5-step officer workflow
- [ ] I can describe the 9-step admin workflow
- [ ] I can explain how RLS prevents cross-org data leakage
- [ ] I understand Bob's role is assistive, not autonomous

### Skill Checkpoints
- [ ] I can start the dev server and access the app
- [ ] I can log in as Officer, Admin, and Master
- [ ] I can create an observation and watch it sync
- [ ] I can query the database and filter by org_id
- [ ] I can execute a complete breach triage workflow
- [ ] I can handle offline scenarios gracefully
- [ ] I can interpret error messages and recover

### Integration Checkpoints
- [ ] I called Bob's inference endpoint
- [ ] I reviewed Bob's suggestion in the triage dialog
- [ ] I executed an action based on Bob's recommendation
- [ ] I verified the action was logged in audit_log

---

## ⚠️ Important Rules

**Do NOT:**
- ❌ Create production data (use test organizations)
- ❌ Expose API keys in screenshots or notes
- ❌ Bypass RLS policies for testing (test the real filtering)
- ❌ Make unsupervised high-impact changes (always follow approval gates)

**Do:**
- ✅ Ask questions when confused
- ✅ Screenshot every workflow step
- ✅ Take notes on what you observe
- ✅ Test error paths and recovery (offline, validation, permissions)
- ✅ Verify data integrity after each exercise

---

## 🆘 Troubleshooting Quick Reference

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| "Cannot connect" | Supabase down | Check `.env` Supabase URL |
| "Loading forever" | Dev server crashed | `npm run dev` in new terminal |
| "Permission denied" | RLS policy blocked | Verify `organization_id` matches |
| "Observation not found" | Multi-org isolation | Query your org, not another org |

See `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` PART 7 for full error recovery guide.

---

## 🎓 Learning Philosophy

This **Actionable Emulator** approach works because:

1. **Hands-on practice** — Bob learns by doing, not reading
2. **Real-world scenarios** — Every exercise mirrors actual user workflows
3. **Error handling** — Bob practices recovery paths (offline, validation, permissions)
4. **Verification** — Bob checks results (screenshots, database queries, audit logs)
5. **Gradual complexity** — Exercises build from UI recon → data flow → workflow execution

---

## 📞 Session Support

**If Bob gets stuck:**
1. Check the relevant documentation file (see table above)
2. Look for the "Troubleshooting" section
3. Diagnose by asking: "What do you see on screen?"
4. Use browser DevTools to inspect (F12 → Network, Console)
5. Query the database directly to verify state

**After each exercise:**
1. Bob should summarize what was learned
2. Bob should answer the reflection questions
3. Tutor should ask: "What did you notice? What surprised you?"
4. Move to next exercise

---

## 🎉 Getting Started

**Right now**, open this file in your browser:

### 👉 **`docs/BOB_SANDBOX_EXERCISE_A.md`**

Then:
1. Follow Step 1 (start dev server)
2. Follow Step 2 (open browser to http://localhost:5173)
3. Follow Steps 3-6 (log in as three roles, screenshot, compare)
4. Answer the 5 reflection questions
5. Report back with findings

---

## 📝 Session Tracking

### Completed
- ✅ Documentation suite created (3 files)
- ✅ Environment verified ready
- ✅ Dev server scripts ready

### In Progress
- 🔄 Exercise A: Environment Recon

### Pending
- ⏳ Exercise B: Data Flow Tracing
- ⏳ Exercise C: Multi-Org Isolation
- ⏳ Exercise D: Breach Triage Workflow
- ⏳ Exercise E: Bob Assistance Integration

---

## 🔗 Quick Links

- **Start here**: `docs/BOB_SANDBOX_EXERCISE_A.md` (Exercise A)
- **Reference guide**: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` (All 9 parts)
- **Tutorials docs**: `docs/STAGING.md` (deployment context)
- **Architecture guide**: `.github/copilot-instructions.md` (system overview)
- **Instruction manual**: `docs/INSTRUCTION_MANUAL.md` (roles & workflows)

---

## ✨ You're Ready!

Everything is set up. The dev environment is ready. The documentation is comprehensive.

**Next action**: Open `docs/BOB_SANDBOX_EXERCISE_A.md` and begin Exercise A.

Questions? Check the "Troubleshooting" section or ask the tutor.

**Let's teach Bob! 🚀**

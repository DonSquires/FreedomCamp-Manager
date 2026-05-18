# Bob's Sandbox Emulator — Complete Training Index

**Date**: 2026-05-17  
**Status**: ✅ **COMPLETE TUTORING SYSTEM READY**  
**Duration**: 3.5 hours (5 hands-on exercises)  
**Format**: Real-world practice with verification checkpoints  

---

## 📚 Documentation Suite

All training materials are now available:

| Document | Purpose | Length | Read Time |
|----------|---------|--------|-----------|
| **BOB_SANDBOX_TUTORING_QUICKSTART.md** | Overview & navigation | 200 lines | 10 min |
| **BOB_SANDBOX_EMULATOR_GUIDE.md** | Complete reference (9 parts) | 500+ lines | 30 min |
| **BOB_SANDBOX_EXERCISE_A.md** | Exercise A: Environment Recon | 300 lines | 30 min (+ 30 min practice) |
| **BOB_SANDBOX_EXERCISE_B.md** | Exercise B: Data Flow Tracing | 350 lines | 45 min practice |
| **BOB_SANDBOX_EXERCISE_C.md** | Exercise C: Multi-Org Isolation | 350 lines | 30 min practice |
| **BOB_SANDBOX_EXERCISE_D.md** | Exercise D: Breach Triage | 400 lines | 60 min practice |
| **BOB_SANDBOX_EXERCISE_E.md** | Exercise E: Bob Integration | 400 lines | 45 min practice |
| **This file** | Master index & summary | 300+ lines | 15 min |

---

## 🎓 Learning Progression

### Phase 1: Foundation (60 minutes)

**Exercise A: Environment Recon**
- What: Explore the three UI shells
- How: Log in as officer, admin, master; compare layouts
- Goal: Understand Officer = mission, Admin = queue, Master = governance
- Outcome: Familiarity with all portals
- File: `docs/BOB_SANDBOX_EXERCISE_A.md`

**Exercise B: Data Flow Tracing**
- What: Watch data flow from form submission to database
- How: Create observation, inspect network requests, query Supabase
- Goal: Understand React → Supabase → RLS filtering
- Outcome: Can trace end-to-end data path
- File: `docs/BOB_SANDBOX_EXERCISE_B.md`

### Phase 2: Safety & Isolation (30 minutes)

**Exercise C: Multi-Org Isolation**
- What: Verify RLS prevents cross-org data leakage
- How: Create 2 orgs, prove isolation, test master access
- Goal: Understand multi-tenancy safety model
- Outcome: Confident in data isolation
- File: `docs/BOB_SANDBOX_EXERCISE_C.md`

### Phase 3: Operational Workflow (60 minutes)

**Exercise D: Breach Triage Workflow**
- What: Complete 9-step admin breach triage end-to-end
- How: Create breach → triage → issue notice → verify audit trail
- Goal: Execute real operational workflow
- Outcome: Can manage breach queue
- File: `docs/BOB_SANDBOX_EXERCISE_D.md`

### Phase 4: AI Integration (45 minutes)

**Exercise E: Bob Assistance Integration**
- What: Integrate Bob's AI suggestions with approval gates
- How: Call inference service, review suggestion, authorize action
- Goal: Understand assistive-only role with human controls
- Outcome: Can supervise Bob-assisted workflows
- File: `docs/BOB_SANDBOX_EXERCISE_E.md`

---

## 🗂️ How to Navigate This Training

### For Getting Started:
1. Start here: `BOB_SANDBOX_TUTORING_QUICKSTART.md`
2. Opens dev server and does Exercise A

### For Reference During Training:
- Architecture questions → `BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 1-2)
- Storage/RLS questions → `BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 3-4)
- Testing/Error handling → `BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 7)
- Bob integration → `BOB_SANDBOX_EXERCISE_E.md`

### For Completing Exercises:
- Exercise A → `BOB_SANDBOX_EXERCISE_A.md` (6 steps)
- Exercise B → `BOB_SANDBOX_EXERCISE_B.md` (10 steps)
- Exercise C → `BOB_SANDBOX_EXERCISE_C.md` (11 steps)
- Exercise D → `BOB_SANDBOX_EXERCISE_D.md` (11 steps)
- Exercise E → `BOB_SANDBOX_EXERCISE_E.md` (12 steps)

---

## 📊 Key Concepts by Exercise

| Concept | Where Learned | Exercise |
|---------|---------------|----------|
| Three shells (Officer/Admin/Master) | UI exploration | A |
| Three-tier architecture | System overview | Intro |
| Role-based access control (9 roles) | Portal navigation | A |
| React → Zustand → Supabase flow | Network inspection | B |
| RLS policies and filtering | Database queries | B, C |
| Multi-organization isolation | Org creation & testing | C |
| Observation → Breach alert flow | Database triggers | B, D |
| Breach triage workflow (9 steps) | Admin operations | D |
| Bob's assistive role | Inference integration | E |
| Approval gates (suggestion → human → execute) | Workflow execution | D, E |
| Audit logging | Database verification | D, E |

---

## ✅ Success Criteria

### Knowledge Checkpoints
- [ ] Explain 3-tier architecture (React → Supabase → Services)
- [ ] Name 9 roles and sort by organizational tier
- [ ] Describe officer patrol workflow (5 steps)
- [ ] Describe admin breach triage workflow (9 steps)
- [ ] Explain RLS multi-org isolation mechanism
- [ ] Understand Bob's assistive role and constraints

### Skill Checkpoints
- [ ] Start dev server and access app at http://localhost:5173
- [ ] Log in as three different roles
- [ ] Create observation and watch sync to database
- [ ] Query Supabase and verify RLS filtering
- [ ] Execute complete breach triage workflow
- [ ] Handle offline scenarios and reconnect
- [ ] Interpret error messages and recover

### Integration Checkpoints
- [ ] Call Bob's inference endpoint
- [ ] Review Bob's suggestion in triage dialog
- [ ] Execute action based on Bob's recommendation
- [ ] Verify action logged in audit_log

---

## 🚀 Quick Command Reference

```bash
# Start dev server (run once, leave open)
npm run dev

# Open app in browser
$BROWSER http://localhost:5173

# Verify dev server running
lsof -i :5173

# Check if local Bob is running
curl http://localhost:3000/health

# Query database (Supabase CLI)
npx supabase db pull  # Pull schema

# Run tests
bun run build        # Type-check
bun run lint         # Lint
bunx playwright test # E2E tests

# Get test credentials
cat .env.playwright.local
```

---

## 📋 Troubleshooting Quick Reference

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Cannot login | Wrong credentials | Check `.env.playwright.local` |
| "Page loading forever" | Dev server crashed | Run `npm run dev` in new terminal |
| Observation not syncing | Network error | Check DevTools Network tab for 4xx/5xx |
| Can't see other org's data | RLS blocking | ✅ This is correct behavior! |
| Bob suggestions not showing | Inference service offline | Check `curl http://localhost:3000/health` |
| Query returns no results | org_id filter mismatch | Verify organization_id in WHERE clause |

**Full troubleshooting:** `BOB_SANDBOX_EMULATOR_GUIDE.md` PART 7

---

## 🎯 By the End of This Training

Bob will be able to:

✅ **Understand Architecture**
- Draw system diagram from memory
- Explain role-based routing
- Describe auth flow + RLS enforcement

✅ **Navigate UI**
- Use all three portals fluently
- Know where features are located
- Understand why shells differ

✅ **Execute Workflows**
- Complete officer patrol (5 steps)
- Complete admin triage (9 steps)
- Handle errors and offline scenarios

✅ **Understand Data**
- Query database correctly
- Verify RLS isolation
- Check audit trails

✅ **Integrate Bob**
- Call inference service
- Review suggestions
- Understand approval gates

✅ **Troubleshoot**
- Use DevTools effectively
- Diagnose permission vs network errors
- Read error messages and recover

---

## 📖 Full Learning Roadmap

```
START
  ↓
BOB_SANDBOX_TUTORING_QUICKSTART.md
  ↓ (15 min reading)
BOB_SANDBOX_EXERCISE_A.md
  ↓ (30 min + 30 min practice)
BOB_SANDBOX_EXERCISE_B.md
  ↓ (45 min practice)
BOB_SANDBOX_EXERCISE_C.md
  ↓ (30 min practice)
BOB_SANDBOX_EXERCISE_D.md
  ↓ (60 min practice)
BOB_SANDBOX_EXERCISE_E.md
  ↓ (45 min practice)
KNOWLEDGE CHECKPOINT
  ↓ (Answer 8 final questions)
✅ TRAINING COMPLETE
  ↓
Ready for:
- Advanced training (PTT, Edge Functions, etc.)
- Production deployment guidance
- Troubleshooting complex issues
- Teaching other AI agents
```

**Total time**: ~3.5 hours (including reading + practice)

---

## 🔗 Resource Links

**Quick Start**
- 📖 [Start Here](BOB_SANDBOX_TUTORING_QUICKSTART.md)
- 🎓 [Full Reference Guide](docs/BOB_SANDBOX_EMULATOR_GUIDE.md)

**Exercises (in order)**
1. 🔍 [Exercise A: Environment Recon](docs/BOB_SANDBOX_EXERCISE_A.md)
2. 🔀 [Exercise B: Data Flow Tracing](docs/BOB_SANDBOX_EXERCISE_B.md)
3. 🔐 [Exercise C: Multi-Org Isolation](docs/BOB_SANDBOX_EXERCISE_C.md)
4. 📋 [Exercise D: Breach Triage Workflow](docs/BOB_SANDBOX_EXERCISE_D.md)
5. 🤖 [Exercise E: Bob Integration](docs/BOB_SANDBOX_EXERCISE_E.md)

**System Documentation**
- 📘 [Complete Instruction Manual](docs/INSTRUCTION_MANUAL.md)
- 📊 [Live Database Schema](docs/LIVE_SCHEMA.md)
- 🏗️ [Architecture Reference](.github/copilot-instructions.md)
- 📝 [Staging & Deployment](docs/STAGING.md)

---

## 💡 Key Principles

Throughout training, remember:

1. **Hands-on Practice**: Reading ≠ Understanding. Do the exercises.
2. **Real-World Scenarios**: Every exercise mirrors actual usage.
3. **Error Recovery**: Practice failures and recovery (offline, validation, permissions).
4. **Verification**: Always check results (screenshots, queries, audit logs).
5. **Security-First**: RLS is not optional; it's a requirement for safety.
6. **Human Authority**: Bob is assistive only; humans make decisions.
7. **Auditability**: Every action is logged for compliance review.

---

## 🎓 After Training

You'll be ready for:

- **Building**: Write new components or Edge Functions
- **Debugging**: Diagnose complex multi-org issues
- **Deployment**: Understand production deployment workflows
- **Mentoring**: Teach other AI agents this same curriculum
- **Enhancement**: Propose improvements to architecture
- **Governance**: Understand multi-org safety model deeply

---

## 📝 Training Checklist

Print this or bookmark it:

### Before Starting
- [ ] Dev server ready to start (`npm run dev`)
- [ ] Browser open (Chrome/Firefox with DevTools)
- [ ] Credentials file checked (`.env.playwright.local`)
- [ ] Terminal open for database queries

### During Training
- [ ] Taking screenshots of each exercise
- [ ] Answering reflection questions in notes
- [ ] Running database queries to verify
- [ ] Using DevTools to inspect network/state
- [ ] Testing error scenarios

### After Each Exercise
- [ ] Completed all steps
- [ ] Answered reflection questions
- [ ] Verified results (screenshots, database)
- [ ] Summarized learnings
- [ ] Ready for next exercise

### Final Checkpoint
- [ ] All 5 exercises completed
- [ ] All success criteria met
- [ ] Knowledge checkpoint passed
- [ ] Ready for advanced training

---

## 🆘 Need Help?

1. **During an exercise**: Check the "Troubleshooting" section in that exercise file
2. **About architecture**: Read `BOB_SANDBOX_EMULATOR_GUIDE.md` (PART 1-4)
3. **About database**: Read `docs/LIVE_SCHEMA.md` and run verification queries
4. **About workflows**: Review the exercise's workflow diagram
5. **About errors**: Use browser DevTools (F12) to inspect

---

## ✨ Getting Started Right Now

## Step 1: Read This Document ✅
You're doing it!

## Step 2: Open Quick Start Guide
👉 [BOB_SANDBOX_TUTORING_QUICKSTART.md](BOB_SANDBOX_TUTORING_QUICKSTART.md)

## Step 3: Start Dev Server
```bash
npm run dev
```

## Step 4: Open App in Browser
```
http://localhost:5173
```

## Step 5: Begin Exercise A
👉 [docs/BOB_SANDBOX_EXERCISE_A.md](docs/BOB_SANDBOX_EXERCISE_A.md)

---

## 📊 Session Progress Tracker

| Component | Status | Timestamp |
|-----------|--------|-----------|
| Documentation created | ✅ | 2026-05-17 |
| Dev environment verified | ✅ | 2026-05-17 |
| Exercise A ready | ✅ | 2026-05-17 |
| Exercise B ready | ✅ | 2026-05-17 |
| Exercise C ready | ✅ | 2026-05-17 |
| Exercise D ready | ✅ | 2026-05-17 |
| Exercise E ready | ✅ | 2026-05-17 |
| **Training System Complete** | ✅ | 2026-05-17 |

---

## 🎉 Summary

You now have a **complete, hands-on training system** for Bob to learn FieldOps Manager through:

1. ✅ **Real-world practice** (not just reading)
2. ✅ **Progressive complexity** (foundation → safety → operations → AI)
3. ✅ **Verification checkpoints** (screenshots, queries, audit trails)
4. ✅ **Error handling** (offline, validation, permissions)
5. ✅ **Security-first** (RLS isolation tested and verified)
6. ✅ **Complete documentation** (7 comprehensive guides)

**Bob is ready to learn. The environment is ready. The exercises are ready.**

**🚀 Let's begin!**

---

## 📞 Session Support

- **Stuck on Exercise A?** → Check "Common Issues" section in that file
- **Error with DevTools?** → Refer to `BOB_SANDBOX_EMULATOR_GUIDE.md` PART 6
- **Database query failing?** → Check RLS policy and org_id matching
- **Bob's suggestion not showing?** → Verify inference service is running
- **General architecture question?** → Start with `BOB_SANDBOX_EMULATOR_GUIDE.md` PART 1

---

**Next action**: Open `BOB_SANDBOX_TUTORING_QUICKSTART.md` and follow the instructions.

**Questions?** See the troubleshooting section of the relevant exercise or reference guide.

**Ready?** Let's teach Bob! 🚀

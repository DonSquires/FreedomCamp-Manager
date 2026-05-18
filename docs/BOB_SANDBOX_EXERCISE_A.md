# Bob's Sandbox Emulator — Quick Start Checklist

**Date**: 2026-05-17  
**Status**: ✅ Ready to Begin Tutoring  
**Environment**: FieldOps Manager dev server (localhost:5173)  
**Test Credentials**: .env.playwright.local  

---

## Pre-Flight Checklist ✅

| Item | Status | Command to Verify |
|------|--------|-------------------|
| Dependencies installed | ✅ | `ls -la bun.lock` → exists |
| package.json present | ✅ | `cat package.json \| head -10` → contains scripts |
| .env configured | ✅ | `test -f .env && echo "✅ exists"` |
| Node/Bun toolchain | ⚠️ Check | `node --version` / `bun --version` |
| Source code present | ✅ | `ls -la src/` → pages, components, etc. |

**Toolchain Status**: Node not found in Alpine container. Will use Bun or install Node.

---

## SANDBOX EXERCISE A: Environment Recon (30 min)

**Goal**: Understand the physical layout of the FieldOps Manager UI

**Materials**: Browser, keyboard, dev server (not yet started)

---

### Step 1: Start the Dev Server

```bash
cd /workspaces/FreedomCamp-Manager

# Install node if not present
apk add --no-cache nodejs npm

# Start dev server
npm run dev
# Expected output:
# ✨ ready in 123ms
# 
#   ➜  Local:   http://localhost:5173/
#   ➜  press h to show help

# Leave this terminal open
```

**What Bob should see:**
- Green checkmark ✅ showing "ready"
- URL: http://localhost:5173
- No errors in terminal

---

### Step 2: Open App in Browser

```bash
# In a new terminal (don't close dev server)
$BROWSER http://localhost:5173
# Or manually navigate to http://localhost:5173
```

**What Bob should see:**

```
┌────────────────────────────────────────┐
│  FieldOps Manager — Login Portal       │
├────────────────────────────────────────┤
│                                        │
│  Email:     [________________]         │
│  Password:  [________________]         │
│                                        │
│  [Sign In]  [Forgot Password?]        │
│                                        │
│  © 2026 Iron Eagle Security            │
└────────────────────────────────────────┘
```

---

### Step 3: Log In as Field Officer

Open `.env.playwright.local` to find test credentials:

```bash
cat .env.playwright.local
# Output should show:
# OFFICER_EMAIL=officer_ncc_001@example.com
# OFFICER_PASSWORD=...
```

**Action**: Enter these credentials in login form:
- Email: `officer_ncc_001@example.com`
- Password: (from .env.playwright.local)
- Click "Sign In"

**What Bob should see after login:**

```
┌────────────────────────────────────────┐
│ Home │ Patrol │ Records │ Profile │ ... │
├────────────────────────────────────────┤
│                                        │
│  OFFICER PORTAL                        │
│                                        │
│  Welcome, Officer                      │
│                                        │
│  [Start Patrol] [Resume Shift]         │
│  [View Records] [History]              │
│                                        │
│  Recent Observations:                  │
│  • 2026-05-17 09:15 - Vehicle ABC123   │
│  • 2026-05-17 08:30 - Vehicle XYZ789   │
│                                        │
└────────────────────────────────────────┘
```

**Bob's Task**: Screenshot this screen and note:
- Top navigation items
- Main action buttons
- Panel layout
- Available actions

---

### Step 4: Log Out and Log In as Admin

**Action**: Click profile → "Sign Out"

**Login as Admin**:
```
Email:    admin_ncc_001@example.com
Password: (from .env.playwright.local)
```

**What Bob should see (Admin Portal)**:

```
┌────────────────────────────────────────┐
│ Dashboard │ Breaches │ Reports │ ... │
├────────────────────────────────────────┤
│                                        │
│  ADMIN PORTAL                          │
│                                        │
│  📋 Breach Queue                       │
│  47 open breaches                      │
│                                        │
│  Breach #1: Plate XYZ123               │
│  Zone: Nelson City                     │
│  Status: 14+ nights / Requires action  │
│  [Open]                                │
│                                        │
│  Recent Notices:                       │
│  • Notice #2026-0517-001 (issued)      │
│  • Notice #2026-0517-002 (pending)     │
│                                        │
└────────────────────────────────────────┘
```

**Bob's Task**: Screenshot this screen and note:
- Queue-first design
- Breach cards
- Actions available per breach
- Difference from Officer Portal layout

---

### Step 5: Log Out and Log In as Master/Admin

```
Email:    master_ncc_001@example.com
Password: (from .env.playwright.local)
```

**What Bob should see (Master Portal)**:

```
┌────────────────────────────────────────┐
│ Governance │ Reporting │ Config │ ...  │
├────────────────────────────────────────┤
│                                        │
│  MASTER PORTAL                         │
│                                        │
│  📊 System Overview                    │
│  Organizations: 3                      │
│  Active Officers: 12                   │
│  Breaches This Month: 156              │
│                                        │
│  Org-Level Controls:                   │
│  • Nelson City Council                 │
│    - 8 officers                        │
│    - 45 breaches                       │
│    [Manage]                            │
│                                        │
└────────────────────────────────────────┘
```

**Bob's Task**: Screenshot this screen and note:
- Enterprise governance focus
- Multi-org visibility
- Reporting dashboards
- Configuration options

---

### Step 6: Compare the Three Shells

**Bob's Analysis Task**:

Create a table comparing the three shells you just saw:

| Element | Officer | Admin | Master |
|---------|---------|-------|--------|
| Primary Focus | __________ | __________ | __________ |
| Top Nav Items | __________ | __________ | __________ |
| Main Content | __________ | __________ | __________ |
| Key Metric | __________ | __________ | __________ |

**Expected answers:**

| Element | Officer | Admin | Master |
|---------|---------|-------|--------|
| Primary Focus | Mission execution | Breach triage | Governance |
| Top Nav Items | Patrol, Records | Breaches, Reports | Governance, Config |
| Main Content | Shift status | Breach queue | Org metrics |
| Key Metric | Active patrol | Open breaches | System KPIs |

---

## EXERCISE A Completion Criteria

✅ Bob successfully logged in as three different roles  
✅ Bob took screenshots of each portal  
✅ Bob can describe visual differences between shells  
✅ Bob understands Officer shell = mission; Admin = queue; Master = governance  
✅ Bob noted key UI elements (buttons, cards, status indicators)  

---

## Common Issues & Troubleshooting

### Issue: "Network Error" when logging in

**Diagnosis**:
1. Check if Supabase is reachable
2. Check .env has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

**Fix**:
```bash
# Verify .env
cat .env | grep VITE_SUPABASE

# If missing, get credentials from Supabase dashboard and update .env
# Then restart dev server: npm run dev
```

### Issue: "Page shows 'Loading...' forever"

**Diagnosis**:
1. Dev server might have crashed
2. Browser cache might be stale

**Fix**:
```bash
# 1. Check dev server is still running
lsof -i :5173
# Should show vite process

# 2. Hard refresh browser
# Windows/Linux: Ctrl+Shift+R
# Mac: Cmd+Shift+R

# 3. If still stuck, restart dev server:
npm run dev
```

### Issue: ".env.playwright.local not found"

**Diagnosis**: Test credentials file doesn't exist

**Fix**:
```bash
# Create a dummy version for now
cat > .env.playwright.local << 'EOF'
OFFICER_EMAIL=officer_ncc_001@example.com
OFFICER_PASSWORD=test_password_123
ADMIN_EMAIL=admin_ncc_001@example.com
ADMIN_PASSWORD=test_password_456
MASTER_EMAIL=master_ncc_001@example.com
MASTER_PASSWORD=test_password_789
EOF
```

Then use these credentials with the app. (In production, these would come from Supabase auth.)

---

## Next: EXERCISE B

Once Exercise A is complete, proceed to **Data Flow Tracing**:

1. Create a test observation (scan a vehicle)
2. Watch it flow to database
3. Verify RLS filtering
4. Query via Supabase REST API

See `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` PART 7 for Exercise B instructions.

---

## Session Tracking

### Exercise A Progress
- [ ] Step 1: Start dev server ✅
- [ ] Step 2: Open app in browser
- [ ] Step 3: Log in as Officer
- [ ] Step 4: Log in as Admin
- [ ] Step 5: Log in as Master
- [ ] Step 6: Compare shells & fill table
- [ ] **A Complete** ✅

### Next Up
- [ ] Exercise B: Data Flow Tracing (45 min)
- [ ] Exercise C: Multi-Org Isolation (30 min)
- [ ] Exercise D: Breach Triage Workflow (60 min)
- [ ] Exercise E: Bob Assistance Integration (45 min)

---

## Questions for Bob

After Exercise A, answer these reflection questions:

1. **What is the primary purpose of each shell?**
   - Officer: _____________
   - Admin: _____________
   - Master: _____________

2. **Which buttons did you see in the Officer portal?**
   - __________, __________, __________

3. **What information is shown in the breach queue (Admin)?**
   - __________

4. **How many organizations were visible from the Master portal?**
   - __________

5. **Why do you think each shell has a different layout?**
   - __________________________________________

---

**Bob's Assignment**: Complete Exercise A, answer the 5 questions, then report back. We'll move to Exercise B next.

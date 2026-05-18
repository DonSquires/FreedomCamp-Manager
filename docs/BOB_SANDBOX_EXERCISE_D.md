# Bob's Sandbox Exercise D: Breach Triage Workflow

**Duration**: 60 minutes  
**Prerequisite**: Exercises A, B, C completed  
**Goal**: Execute complete 9-step admin breach triage workflow end-to-end  
**Outcome**: Issue infringement notice and verify audit trail  

---

## Complete Workflow Overview

```
Admin logs in
  ↓ (Step 1: Auth + Portal Load)
Breach queue visible
  ↓ (Step 2: Load breaches)
Select breach
  ↓ (Step 3: Load detail + history)
Review evidence
  ↓ (Step 4: Analyze compliance snapshot)
Open triage dialog
  ↓ (Step 5: Choose action)
Capture details
  ↓ (Step 6: Fill decision form)
Confirm & authorize
  ↓ (Step 7: Review summary)
Execute action
  ↓ (Step 8: Save to database)
View confirmation
  ↓ (Step 9: Audit trail + handoff)
```

---

## Setup: Create Test Breach

**First**, if you haven't already, create a test observation that will trigger a breach alert.

**Using Exercise B approach**:
1. Log in as officer
2. Start patrol
3. Record observation: plate `BREACH_TEST_001`
4. Submit

**Verify breach alert was created**:

```sql
SELECT alert_id, status, created_at
FROM breach_alerts
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT 1;
```

---

## Step 1: Admin Logs In

**Log out** of current user, then:

```
Email:    admin_ncc_001@example.com
Password: (from .env.playwright.local)
```

**What you should see:**
- Admin Portal
- Navigation: Dashboard | Breaches | Reports | Settings
- Breach queue visible

---

## Step 2: Navigate to Breach Queue

**Click** "Breaches" or "Breach Queue" in navigation

**You should see:**
```
┌─────────────────────────────────────────────┐
│ BREACH QUEUE                                │
│ ✋ 47 open breaches                         │
├─────────────────────────────────────────────┤
│                                             │
│ [Sort] [Filter] [Search]                  │
│                                             │
│ ┌────────────────────────────────────────┐ │
│ │ BREACH #1                              │ │
│ │ Plate: BREACH_TEST_001                 │ │
│ │ Zone: Nelson City                      │ │
│ │ Observation: 2026-05-17 09:15          │ │
│ │ Status: ⚠️ Requires Triage             │ │
│ │ [OPEN TRIAGE]                          │ │
│ └────────────────────────────────────────┘ │
│                                             │
│ ┌────────────────────────────────────────┐ │
│ │ BREACH #2                              │ │
│ │ ... (more breaches)                    │ │
│ └────────────────────────────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

**Bob's observation**: How many breaches are in queue? What's the status of each?

---

## Step 3: Click "Open Triage" on Your Test Breach

**Find** the breach for BREACH_TEST_001

**Click** the "Open Triage" or "Triage" button

**Detail panel opens:**
```
┌─────────────────────────────────────────────┐
│ BREACH DETAIL                               │
├─────────────────────────────────────────────┤
│                                             │
│ Vehicle: BREACH_TEST_001                    │
│ Make: [from NZSCV] (if available)          │
│ Color: [from observation]                   │
│ Photo: [thumbnail]                          │
│                                             │
│ Location: Nelson City                       │
│ Recorded: 2026-05-17 09:15:33               │
│ Recorded By: Officer Name                   │
│                                             │
│ Compliance Status:                          │
│ ⚠️ 14+ nights in zone (exceeds limit)      │
│                                             │
│ Previous Observations:                      │
│ • 2026-05-10 (9 nights)                    │
│ • 2026-05-03 (8 nights)                    │
│                                             │
│ [OPEN TRIAGE DIALOG]                       │
│                                             │
└─────────────────────────────────────────────┘
```

**Bob's task**: Screenshot and note:
- What data is available? (photo, history, compliance status)
- What could the admin see before deciding?

---

## Step 4: Open Triage Dialog

**Click** "Open Triage Dialog" or "Start Triage"

**3-Step Dialog appears:**

```
┌────────────────────────────────────────────────┐
│ BREACH TRIAGE DIALOG — STEP 1 of 3            │
├────────────────────────────────────────────────┤
│                                                │
│ Choose Action:                                │
│                                                │
│ ○ Resolve (Compliant)                        │
│ ○ Assign Officer Follow-Up                   │
│ ○ Issue Infringement Notice  ← SELECT THIS  │
│ ○ Escalate to Supervisor                     │
│ ○ Investigate Further                        │
│                                                │
│ [BACK]  [NEXT]                               │
│                                                │
└────────────────────────────────────────────────┘
```

---

## Step 5: Select Action

**Click** "Issue Infringement Notice" (or appropriate action for your scenario)

**Click** "Next"

---

## Step 6: Fill Decision Details (Step 2)

**Dialog updates to Step 2:**

```
┌────────────────────────────────────────────────┐
│ BREACH TRIAGE DIALOG — STEP 2 of 3            │
├────────────────────────────────────────────────┤
│                                                │
│ Notice Type:                                  │
│ [Dropdown: Breach of Bylaw 5.2.1]           │
│                                                │
│ Severity:                                     │
│ [Dropdown: High]                             │
│                                                │
│ Admin Notes:                                  │
│ [Large text area]                            │
│                                                │
│ [Example note:]                              │
│ "Vehicle observed 14 consecutive nights in  │
│  zone. Second breach in 30 days. Pattern    │
│  suggests intentional non-compliance.        │
│  Recommend immediate notice service."        │
│                                                │
│ Attachments:                                  │
│ [Upload photo / document]                    │
│                                                │
│ [BACK]  [NEXT]                               │
│                                                │
└────────────────────────────────────────────────┘
```

**Bob's task**: Fill the form:

```
Notice Type: (select from dropdown)
Severity: High
Admin Notes: "Training exercise — test notice for Bob's sandbox emulator"
```

**Click** "Next"

---

## Step 7: Review & Confirm (Step 3)

**Dialog shows summary:**

```
┌────────────────────────────────────────────────┐
│ BREACH TRIAGE DIALOG — STEP 3 of 3            │
│ REVIEW & AUTHORIZE                            │
├────────────────────────────────────────────────┤
│                                                │
│ ✓ Action: Issue Infringement Notice          │
│ ✓ Vehicle: BREACH_TEST_001                   │
│ ✓ Notice Type: Breach of Bylaw 5.2.1         │
│ ✓ Severity: High                             │
│ ✓ Recipient: Vehicle Owner (from NZSCV)    │
│ ✓ Delivery: Email + Post                     │
│                                                │
│ By clicking "AUTHORIZE", you authorize       │
│ issuance of this infringement notice.         │
│                                                │
│ This action will be logged for audit.         │
│                                                │
│ [BACK]  [AUTHORIZE]                          │
│                                                │
└────────────────────────────────────────────────┘
```

**Bob's task**: Review everything is correct, then:

**Click** "AUTHORIZE"

---

## Step 8: Execute & Confirmation

**Behind the scenes**, the system:

1. Updates breach_alert status to 'resolved'
2. Creates infringement_notice record
3. Generates PDF from notice template
4. Queues email/postal delivery
5. Logs audit event
6. Triggers webhook (if configured)

**You should see:**

```
┌────────────────────────────────────────────────┐
│ ✅ SUCCESS!                                   │
├────────────────────────────────────────────────┤
│                                                │
│ Notice issued successfully.                   │
│                                                │
│ Notice ID: NTC-2026-0517-001234               │
│ Recipient: Vehicle Owner                      │
│ Delivery: Queued (Email + Post)              │
│                                                │
│ [View Notice] [Close] [Next Breach]           │
│                                                │
└────────────────────────────────────────────────┘
```

**Bob's task**: Screenshot this success state

---

## Step 9: Verify Audit Trail

**Query audit log to confirm everything was recorded:**

```sql
SELECT 
  log_id,
  action,
  entity_type,
  entity_id,
  performed_by,
  organization_id,
  created_at
FROM audit_log
WHERE action LIKE 'cro_%'  -- CRO = Conversion Rate Optimization (or Compliance operations)
ORDER BY created_at DESC
LIMIT 5;

-- Expected result:
-- action: cro_issue_notice
-- entity_type: infringement_notice
-- entity_id: [NOTICE_ID]
-- performed_by: [ADMIN_ID]
```

---

## Step 10: Verify Notice Was Created

```sql
SELECT 
  notice_id,
  alert_id,
  notice_type,
  recipient_email,
  served_date,
  status,
  created_at
FROM infringement_notices
WHERE notice_id LIKE 'NTC-2026-0517%'
ORDER BY created_at DESC
LIMIT 1;

-- Expected result:
-- notice_id: NTC-2026-0517-001234
-- alert_id: [BREACH_ALERT_ID]
-- notice_type: breach_notice
-- recipient_email: [VEHICLE_OWNER_EMAIL]
-- status: queued_for_delivery
```

---

## Step 11: Return to Queue

**Click** "Next Breach" or close dialog and return to breach queue

**Notice:**
- Original breach is now marked "Resolved" (not in open queue)
- Notice appears in "Recent Notices" section
- Queue count decreased by 1

---

## Exercise D Completion Checklist

✅ Logged in as admin  
✅ Navigated to breach queue  
✅ Selected test breach  
✅ Reviewed breach detail  
✅ Opened triage dialog  
✅ Selected "Issue Notice" action  
✅ Filled decision form  
✅ Reviewed summary  
✅ Authorized notice issuance  
✅ Saw success confirmation  
✅ Verified audit log entry  
✅ Verified notice record created  

---

## Reflection Questions

1. **How many steps are in the triage workflow?**
   - _________________

2. **What data was available to help admin make decision?**
   - _________________

3. **What happens if admin clicks "Back" in Step 3?**
   - _________________

4. **Can an officer see the issued notice?**
   - _________________

5. **How would you know if the notice was delivered?**
   - _________________

---

## Next Up

Exercise E: Bob Assistance Integration
- 45 minutes  
- Call Bob's inference service for triage suggestion
- Review suggestion in triage dialog
- Execute action based on Bob's recommendation
- Understand approval gates

See: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` PART 2.3 for detailed integration

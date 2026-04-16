# Officer Field Guide — Enforcement Documents

> **Who is this for?** Field officers, admin officers, and supervisors who issue enforcement documents using FreedomCamp Manager.
>
> This guide tells you **which document to issue, when, and exactly how** to produce it in the system. Refer to `LEGAL_BASIS_REFERENCE.md` for the NZ legislation behind each notice type.

---

## 1. Document Types at a Glance

| Document | When | Legal Basis | App Page |
|---|---|---|---|
| Warning Notice | First offence — no prior history | FCA 2011 s.20 (pre-infringement) | Breach Alerts → print from scan |
| **Infringement Notice** | Confirmed FCA breach, prior warning ignored or serious first breach | FCA 2011 s.20 | `/infringement-notices` |
| **Notice to Vacate (NTV)** | Vehicle exceeded stay limit; must leave zone | FCA 2011 s.32 / council bylaws | `/notice-to-vacate` |
| **Abatement Notice (AN)** | First noise complaint, occupant has not yet been directed | RMA 1991 s.326 | `/noise-officer-portal` |
| **Direction Notice (DN)** | Prior AN exists, noise has recurred | RMA 1991 s.326 | `/noise-officer-portal` |
| **Enforcement Notice (END)** | Serious, persistent, or uncooperative occupant | RMA 1991 s.327 | `/noise-officer-portal` |

---

## 2. Warning Notice

### When to issue
- Vehicle is in breach for the **first time** in a zone with **no prior observation or warning history**.
- Occupant is cooperative and does not appear to be deliberately evading rules.

### How to issue (step by step)
1. Complete the vehicle scan — the scan result card shows a red **Breach** badge.
2. From the Recent Scans panel, click **Warning** on the relevant scan row.
3. Confirm the action in the dialog (add a note if needed).
4. A warning is recorded against the vehicle and zone.
5. (Optional) Click **Print Ticket** to generate a printable notice if a physical copy is required.

### After issuing
- The vehicle's history in the zone is updated immediately.
- The next scan of the same plate will show the prior warning in the scan result.
- If the vehicle appears again in breach, proceed to Infringement Notice.

---

## 3. Infringement Notice

### When to issue
- Vehicle has a confirmed FCA breach (exceeded consecutive nights, exceeded monthly nights, or lacks a required self-contained certification).
- A prior Warning Notice has been issued and the vehicle has returned in breach, **or** the breach is serious enough to warrant an immediate fine (e.g. a commercial vehicle, repeated rapid return).
- Default fine: **NZD $200** (FCA 2011 s.20). Your organisation's bylaw schedule may specify a different amount for specific offences — check with your supervisor.

### How to issue (step by step)
1. Navigate to **Infringement Notices** in the admin menu.
2. Click **Issue From Evidence Only** — notices must be linked to a scan or breach record.
3. Alternatively, from the **Breach Alerts** page, open the alert and click **Issue Infringement**.
4. The form pre-fills the plate, zone, and breach details from the linked record.
5. Fill in:
   - **Offence description** — be specific and accurate (e.g. "Vehicle exceeded maximum 3 consecutive nights in Matau Reserve Zone").
   - **Legal basis** — defaults to `FCA 2011 s.20(1)(a)`. Update if issuing under a different sub-section or bylaw.
   - **Fine amount** — default $200. Only change with supervisor approval.
   - **Service method** — select how you will deliver the notice:
     - **Hand**: Give directly to the occupant. They sign acknowledgement if possible.
     - **Post**: Address to the registered owner. Allow 7 working days for deemed service.
     - **Email**: Requires recipient's prior written consent to receive notices electronically.
   - **Recipient name and address** — required for postal or email service.
6. Click **Issue Notice**. The system generates a unique notice number and produces a print-ready HTML document.
7. Click **Print** to open the notice in the browser print dialog. Print two copies: one for the vehicle/recipient, one for your records.
8. The notice status is set to `issued`. Track payment via the **Infringement Notices** list.

### After issuing
- If unpaid after **28 days**, the status progresses to `reminder_sent`. The system (or admin) sends a reminder.
- If still unpaid, escalate to `court_referred` with evidence package.
- To withdraw or cancel a notice (with supervisor approval), use the status dropdown on the notice detail view.

---

## 4. Notice to Vacate (NTV)

### When to issue
- A vehicle has exceeded the zone's maximum stay limits (consecutive nights or monthly nights).
- The compliance engine has marked the vehicle as **Breach** (not just At Risk).
- You have confirmed the vehicle is still present at the zone.

### How to issue (step by step)
1. Navigate to **Notices to Vacate**.
2. Click **Issue Notice**.
3. In the dialog:
   - Select the **breach alert** that triggered the NTV — this links the evidence.
   - Enter the **plate number** (auto-filled from the breach alert).
   - Enter the **zone** and **reason for the notice** (e.g. "Vehicle has stayed 5 consecutive nights, exceeding the 3-night zone limit").
   - Set the **vacate deadline** — typically 24 to 48 hours from issue. Check your organisation's policy; some councils require 24 hours minimum.
   - Select **delivery method**: Printed on-site, Hand-delivered, or Email.
4. Click **Issue Notice**. A printable HTML document with a unique reference number is generated.
5. Click **Print** to open the print dialog. Attach the notice to the vehicle's windscreen if the occupant is absent, or hand it directly to the occupant.

### After issuing
- Monitor the status. If the vehicle has left by the deadline, mark as `complied`.
- If the vehicle has **not** moved by the deadline, escalate: change the status to `escalated` and consult your supervisor.
- Escalation options: Infringement Notice, tow request, or referral to council enforcement.
- **Homeless-flagged vehicles**: Do not escalate to tow without explicit supervisor authorisation. A welfare check may be required first.

---

## 5. Abatement Notice (AN) — Noise Control

> Use the **Noise Control Officer Portal** (`/noise-officer-portal`) for all noise enforcement actions.

### When to issue
- You are attending a noise complaint.
- This is the **first contact** with this address, or a prior verbal warning was given but ignored.
- The noise is unreasonable under the Resource Management Act and the occupant has not been formally directed.

### How to issue (step by step)
1. Open your dispatched job in the **My Jobs** tab of the Noise Control Officer Portal.
2. Complete the **Assessment** tab:
   - Enter the decibel reading (if you have a meter), noise source, and description.
   - Upload photos if available (recommended for evidence).
3. In the **Action** section, select **Abatement Notice (AN)**.
4. Review the pre-filled form fields:
   - **Recipient name and address** (the occupant or property owner).
   - **Offence description** — describe the noise and its unreasonable nature.
   - **RMA section** — auto-populated as `RMA s.326(1)(a)`.
   - **Comply by** — defaults to **24 hours**. Only extend with supervisor approval.
5. Click **Issue Notice** to save the record. Click **Print** to produce the printed AN.
6. Hand the notice to the occupant or affix it to the property entrance.

### After issuing
- If you return to the same address and the noise has stopped: close the job — no further action.
- If you return and noise continues: escalate to Direction Notice (DN) or Enforcement Notice (END).

---

## 6. Direction Notice (DN) — Noise Control

### When to issue
- A prior Abatement Notice (AN) was issued at this address and noise has **recurred**.
- The assessment context panel in the portal will show the prior AN and may suggest DN escalation.

### How to issue (step by step)
Same process as for AN, but in the **Action** section select **Direction Notice (DN)**.

The comply-by period for a DN is immediate in most cases. If the occupant is present, direct them verbally first before printing the DN.

---

## 7. Enforcement Notice (END) — Noise Control

### When to issue
- The address has a prior AN or DN **and** noise has continued.
- The occupant is uncooperative or obstructive.
- The situation is serious (loud parties affecting multiple neighbours, commercial operation, or the address has a **Permanent END** flag already set).
- A Permanent Abatement Notice is in place — any noise in breach may be **seized immediately** without a new notice.

### Legal effect
An END issued under **RMA s.327** gives you authority to seize equipment that is producing the noise if the occupant does not comply within the **72-hour** window specified in the notice. This is significant enforcement power — use it with care and document thoroughly.

### How to issue (step by step)
1. Open the dispatched job. The assessment context panel will show a red **Prior END** or **PERMANENT END** banner if applicable.
2. In the **Action** section, select **Enforcement Notice (END)**.
3. Review the form:
   - **Offence description** — be precise and comprehensive; this document may be used in court.
   - **RMA section** — auto-populated as `Section 327 Resource Management Act 1991`.
   - **Comply by** — defaults to **72 hours**.
   - If issuing a Permanent END, check the **Permanent END** box.
4. Click **Issue Notice** and then **Print**. Deliver in person where possible.
5. If the situation requires **immediate equipment seizure** (Permanent END in place or END is in force and noise continues after the window):
   - Complete the **Equipment Seizure** section that appears after issuing an END.
   - Record all items seized (make, model, serial if available).
   - Upload photos of each item.
   - Contact your supervisor to arrange secure storage of seized items.

### After issuing
- Update the job status when the noise has stopped.
- If the occupant challenges the notice, preserve the full job record including photos and dB readings as evidence.

---

## 8. Offline Behaviour

FreedomCamp Manager is a Progressive Web App (PWA) that functions when mobile data is unavailable.

| Action | Offline behaviour |
|---|---|
| Scan a vehicle | Queued locally. The scan shows **amber "Queued (offline)"** badge. Once connectivity resumes, the scan is submitted automatically. |
| Issue a notice (NTV, Infringement) | The action is queued. The notice number is generated client-side as a temporary reference. Full notice is finalised on sync. |
| Print a notice | If the notice was already generated (HTML is cached), printing works offline. If the notice has not yet been generated, you must reconnect first. |
| Update job status (noise) | Status change is queued and synced on reconnection. |

**Important:** Always check the sync queue (amber badge in the top navigation) before ending your shift to confirm all queued actions have been uploaded.

---

## 9. Record Keeping Requirements

All notices produced by this system are automatically recorded in the database with:
- A unique notice number
- The issuing officer's ID
- The date and time of issue (NZ timezone)
- The zone and organisation
- The linked breach alert or observation (where applicable)
- The delivery method

**For court proceedings**: Export the full enforcement history for the relevant vehicle or address from the **Reports** page or **Infringement Notices** list. See `DOCUMENT_MANAGEMENT_GUIDE.md` for export steps.

---

## 10. Quick Reference Card

```
Vehicle scan → Breach?
  No  → No action needed
  Yes → First time at this zone? 
          Yes → Issue Warning Notice (record in system)
          No  → Prior warning exists?
                  Yes → Issue Infringement Notice ($200 fine)
                  No  → Is the vehicle over the stay limit?
                          Yes → Issue Notice to Vacate (24–48hr deadline)

Noise job → First contact?
  Yes → Verbal warning → if ignored → Issue Abatement Notice (24hr)
  No  → Prior AN? → Issue Direction Notice
        Prior END? → Escalate to new END or seize equipment
```

See `ENFORCEMENT_ESCALATION_DECISION_TREE.md` for the full Mermaid flowchart.

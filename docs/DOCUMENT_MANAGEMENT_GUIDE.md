# Document Management Guide — Finding, Reprinting, and Exporting Notices

> **Who is this for?** Admins and admin officers who need to locate issued enforcement documents, reprint notices, track delivery status, and export enforcement history for audits or court proceedings.

---

## 1. Where Issued Notices Are Stored

All enforcement documents produced in FreedomCamp Manager are stored in the database immediately on issuance and can be accessed at any time. There is no separate filing system — the system is the record.

| Document Type | Page | Database Table |
|---|---|---|
| Infringement Notices | `/infringement-notices` | `infringement_notices` |
| Notices to Vacate | `/notice-to-vacate` | `notices_to_vacate` |
| Warning Notices | Breach Alerts → notice history | `enforcement_actions` |
| Noise Notices (AN / DN / END) | `/noise-officer-portal` → History tab | `noise_notices` |

---

## 2. Finding a Specific Notice

### 2.1 By Notice Number

Every notice has a unique system-generated reference number:
- Infringement Notices: format `INF-YYYY-XXXXXX` (e.g. `INF-2026-000042`)
- Notices to Vacate: format `NTV-YYYY-XXXXXX`
- Noise Notices: format `NOISE-YYYY-XXXXXX`

**To find by notice number:**
1. Go to the relevant page (e.g. **Infringement Notices**).
2. Use the **search bar** at the top — it accepts notice number or plate number.
3. The matching notice appears in the list below.

### 2.2 By Plate Number

All notices are indexed by plate number.

1. Go to the relevant notices page.
2. Enter the plate number in the search bar.
3. All notices for that plate are shown, newest first.

### 2.3 By Date Range

1. Use the **Global Filter Ribbon** at the top of the page.
2. Set **Date From** and **Date To**.
3. The list automatically filters to notices issued within that window.

### 2.4 By Status

Use the **Status filter tabs** at the top of the Infringement Notices list:
- **All**: shows every notice.
- **Issued**: active, not yet paid.
- **Paid**: fine received.
- **Court**: referred to the Disputes Tribunal or District Court.

Notices to Vacate have status: `issued`, `complied`, `expired`, `escalated`, `voided`.

---

## 3. Reprinting a Notice

You can reprint any notice at any time — the original document is stored in the database.

### 3.1 Reprinting an Infringement Notice

1. Navigate to **Infringement Notices**.
2. Find the notice (by search or scroll).
3. Click the **Reprint** (printer icon) button on the notice row.
4. The original HTML document is fetched from the edge function and displayed in a preview dialog.
5. Click **Print** to open the browser print dialog, or **Download** to save as an `.html` file.
   - To convert to PDF: in the print dialog, choose **Save as PDF** as the destination.

### 3.2 Reprinting a Notice to Vacate

Same process:
1. Navigate to **Notices to Vacate**.
2. Find the notice and click the **Printer** icon.
3. Print or download.

### 3.3 Reprinting a Noise Notice

1. Navigate to **Noise Control Officer Portal** (`/noise-officer-portal`).
2. Click the **History** tab.
3. Find the job and expand it to see all notices issued.
4. Click **Print** next to the notice you need.

---

## 4. Tracking Delivery Status

### 4.1 Infringement Notices — Payment Tracking

The Infringement Notices page shows the current status of every notice. The workflow is:

```
draft → issued → reminder_sent → paid
                               → court_referred
                               → withdrawn
                               → cancelled
```

**Updating status:**
- When a payment is received, open the notice detail and change status to `paid`.
- If the payment deadline passes, update to `reminder_sent` and resend the notice.
- If still unpaid, change to `court_referred` and prepare the evidence package (see Section 6).

### 4.2 Notices to Vacate — Compliance Tracking

```
issued → complied   (vehicle has left)
       → expired    (deadline passed with no action)
       → escalated  (deadline passed, supervisor notified)
       → voided     (notice withdrawn)
```

**Updating status:** Open the notice detail from the Notices to Vacate list and use the status dropdown.

### 4.3 Noise Notices — Job Tracking

Noise jobs are tracked in the **Noise Control Officer Portal** job list. Each job shows its current status and the notices issued against it. View the full history by expanding the job row in the **History** tab.

---

## 5. Exporting Enforcement History

### 5.1 Exporting All Notices for a Given Period

1. Navigate to **Infringement Notices**.
2. Set the date filter in the Global Filter Ribbon to your required period.
3. (Optional) Apply a status or zone filter.
4. The resulting list is the filtered dataset.
5. To export: navigate to **Reports Hub** → **Enforcement Report** → set the same date range → **Export CSV**.

The CSV will contain all enforcement actions (infringement notices, warnings, NTVs) for the period.

### 5.2 Exporting for a Specific Vehicle

1. Navigate to **Infringement Notices** and search for the plate number.
2. Note all notice numbers for that plate.
3. Navigate to **Custom Reports** → build a report on the `enforcement` data source with a filter `plate_number = [plate]`.
4. Export as CSV or Excel.

Repeat with the `observations` data source to export the full observation history.

### 5.3 Full Data Export (Bulk / Audit)

For a full database export covering all document types at once:

1. Navigate to **Admin → Export Data** (Data Export Wizard).
2. Select **Excel** format.
3. Select all data types: Observations, Vehicles, Breaches, Enforcement Actions, Zones, Users.
4. Set the date range if needed.
5. Click **Export Now**. A multi-sheet `.xlsx` workbook downloads to your device.

---

## 6. Court and Legal Evidence Packages

When preparing evidence for a court hearing or enforcement tribunal:

### Required Documents

1. **Original Notice PDF** — reprint via the process in Section 3.
2. **Observation History CSV** — all scans of the vehicle at the relevant zone (Custom Report Builder → Observations source → filter by plate and zone).
3. **Infringement Register CSV** — all notices issued against the plate (Custom Report Builder → Enforcement source → filter by plate).
4. **Audit Log Extract** — Admin → Audit Log → search by the notice ID or officer. Export to CSV.
5. **ALPR scan photo** (if available) — accessible from the observation detail record.
6. **Zone rule configuration** — confirm the zone's applicable rules (max nights, etc.) from Admin → Zones.

### How to Export the Audit Log

1. Navigate to **Admin → Audit Log**.
2. Use the search and date filters to narrow to the relevant events.
3. Click **Export CSV** (top right of the audit log page).
4. The CSV is timestamped and includes the actor, action, and record affected.

### Chain of Custody Notes

- All notice generation events are logged with the officer's user ID and the exact timestamp.
- All status changes are logged in the audit trail.
- Notice HTML is generated server-side by a Supabase Edge Function and stored against the notice record — it cannot be edited after issue.
- The `notice_number` is generated by a database function (`generate_infringement_number()`) and is guaranteed unique per organisation.

---

## 7. Voiding or Withdrawing a Notice

Only admin and master users can void or withdraw an issued notice.

### Voiding a Notice to Vacate

1. Open the notice from **Notices to Vacate**.
2. Click the status dropdown and select **Voided**.
3. Add a reason in the notes field (required for audit purposes).

### Withdrawing an Infringement Notice

1. Open the notice from **Infringement Notices**.
2. Click the status dropdown and select **Withdrawn** or **Cancelled**.
3. Add a reason in the notes field.

> **Important**: Voiding or withdrawing a notice does not delete it from the database. The original notice and all associated audit events are retained permanently. This is required for legal compliance.

---

## 8. Common Troubleshooting

| Problem | Solution |
|---|---|
| Notice number not found in search | Check you are on the correct page (infringement vs NTV vs noise). Notice numbers include a prefix. |
| Reprint button not generating the document | The HTML generation requires the edge function to be online. Check the system health indicator in the top navigation. |
| Export CSV is empty | Confirm the date range and zone filter. The current user's organisation scope determines which records are visible. |
| Status change not saving | Ensure you have `admin` or `admin_officer` role. Officers cannot update notice status directly. |
| Audit log entry missing | The audit log may have a short delay (up to 30 seconds) before new entries appear. Refresh the page. |

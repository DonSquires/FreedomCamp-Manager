# Admin Guide — Reports & Data Export

> **Who is this for?** Admins, admin officers, and master users who need to generate, schedule, or export enforcement and compliance data from FreedomCamp Manager.

---

## 1. Standard Reports

### 1.1 Reports Hub

Navigate to **Reports Hub** (`/reports-hub`) from the admin menu. This is the entry point for all standard report types.

Available report types from the hub:

| Report | Contents | Delivered To |
|---|---|---|
| Compliance Report | Zone-by-zone compliance rates, breach counts, observation volume | PDF (printable) |
| Enforcement Report | All notices, warnings, and infringements in the period | PDF + CSV |
| Vehicle Activity Report | Unique plates, visit frequency, compliance history | CSV |
| Zone Statistics | Nightly occupancy per zone, trend over selected period | PDF + chart |
| Officer Activity | Scans per officer, patrol hours, notices issued | PDF |

### 1.2 Running a Standard Report

1. Open **Reports Hub** and click the report card you need.
2. Set the **date range** using the From / To date pickers. Default is the last 30 days.
3. Select the **zone** (optional — leave blank for all zones your account can access).
4. Click **Generate PDF** or **Export CSV** depending on the format you need.
5. The system queries the database and produces the output.
   - **PDF**: Opens a print-ready HTML page. Use your browser's print function (Ctrl+P / Cmd+P) to save as PDF or send to a printer.
   - **CSV**: Downloads immediately to your device. Compatible with Excel, Google Sheets, and any data tool.

### 1.3 What Each Export Contains

**Compliance Report (PDF)**
- Organisation name, zone list, date range
- Compliance rate per zone (percentage and counts)
- Breach count by breach type
- 7-day trend chart
- Top offending plates (if >3 visits in period)

**Enforcement Report (CSV)**
- One row per enforcement action
- Columns: date, officer, zone, plate, action type, notice number, amount, status

**Vehicle Activity Report (CSV)**
- One row per unique plate seen in the period
- Columns: plate, total visits, compliant visits, breach visits, last seen, zone list

---

## 2. Custom Report Builder

Navigate to **Custom Reports** (`/custom-reports`).

The Custom Report Builder lets you create a fully configured report from any data source in the system, save it as a reusable template, and export in CSV, PDF, or Excel format.

### 2.1 Selecting a Data Source

Available data sources:

| Source | Table | Common use |
|---|---|---|
| Vehicle Observations | `vehicle_observations` | Compliance history, zone occupancy |
| Vehicles | `vehicles` | NZSCV status, self-contained fleet |
| Breach Alerts | `breach_alerts` | Outstanding breaches by zone |
| Officers | `user_profiles` | Officer activity, warrant expiry |
| Patrols | `patrols` | Patrol coverage, hours |
| Enforcement Actions | `infringement_notices` | Council billing, fine tracking |
| Assets | `officer_assets` | Equipment register |
| Keys | `key_custody` | Key checkout history |
| Allowances | `officer_allowances` | Allowance payments |
| Incidents | `incident_reports` | Incident volume |
| Roster Shifts | `roster_shifts` | Scheduling analysis |

### 2.2 Building a Report

**Step 1: Select Data Source**
Click the data source tile that matches what you need to report on.

**Step 2: Choose Fields**
Tick the fields you want as columns in your report. Drag to reorder. Common selections:
- Observations: `plate_number`, `zone_name`, `recorded_at`, `is_compliant`
- Breaches: `plate_number`, `breach_type`, `status`, `detected_at`, `zone_name`
- Enforcement: `notice_number`, `plate_number`, `offence_description`, `amount_cents`, `status`, `issued_at`

**Step 3: Add Filters**
Click **Add Filter** to restrict the data. Examples:
- `is_compliant = false` — show only breaches
- `recorded_at >= 2026-01-01` — date range
- `zone_id in [zone-uuid-1, zone-uuid-2]` — specific zones

Supported operators: `=`, `≠`, `>`, `≥`, `<`, `≤`, `contains`, `is null`, `in list`.

**Step 4: Group and Sort (Optional)**
- **Group by**: Aggregate rows by a field (e.g. group by zone to get a per-zone summary).
- **Sort by**: Select a field and direction (ascending/descending).

**Step 5: Preview**
Click **Run Preview** to see a live sample of the first 50 rows. Check that the data looks correct before exporting.

**Step 6: Export**
Select the output format and click **Export**:

| Format | When to use |
|---|---|
| **CSV** | Large datasets, further analysis in Excel, data submission to council |
| **PDF** | Formal reports for management or council meetings |
| **Excel (.xlsx)** | Multi-sheet workbooks for auditing; preserves data types |

### 2.3 Excel Export

The Excel export produces a `.xlsx` workbook. Each report is output as a **Data** sheet. If you use the full Data Export Wizard (see Section 4), multiple data types are exported as separate sheets in a single workbook.

The workbook includes:
- A header row in the first row
- Auto-width columns
- All field values formatted as they appear in the preview (NZ timezone for dates)

### 2.4 Saving a Template

After building a report, click **Save as Template**:
- Give the template a clear name (e.g. "Weekly Breach Summary — Waitaki Zones").
- Add a description so colleagues understand its purpose.
- Select a **category** (Compliance, Enforcement, Officers, Finance, General).
- Choose whether to make it **public** (visible to all admins in your org) or private.

Templates appear in the **Saved Templates** panel on the right side of the report builder. Click a template to reload its configuration.

### 2.5 Reports Expected by Councils

Most councils require the following on a weekly or monthly basis:

| Report | Format | Frequency | Notes |
|---|---|---|---|
| Compliance Summary | PDF | Monthly | Compliance rates per zone; include trend chart |
| Breach List | CSV | Weekly | All breach alerts with status — for council review |
| Infringement Register | CSV | Monthly | All notices issued, amounts, payment status |
| Patrol Activity | PDF | Monthly | Hours patrolled, officer names, zones covered |
| Zone Occupancy | PDF | Monthly | Average nightly occupancy per zone |

Build these as saved templates using the Custom Report Builder and use the schedule feature (Section 3) to auto-generate and email them.

---

## 3. Scheduled Reports

### 3.1 Setting Up a Schedule

Admins and master users can schedule reports to run automatically and be delivered by email.

**Requirements**: You must first create a saved template (see Section 2.4).

To schedule a report:
1. Navigate to **Custom Reports** → **Saved Templates** panel.
2. Find your template and click the **Schedule** icon (clock).
3. In the schedule form, set:
   - **Frequency**: daily, weekly, biweekly, monthly, quarterly, or yearly.
   - **Schedule day**: for weekly schedules, choose the day (e.g. Monday).
   - **Schedule time**: choose a time in NZ timezone (e.g. 06:00 for early Monday morning).
   - **Date range type**: `previous_week`, `previous_month`, `rolling_30_days`, etc.
   - **Output format**: PDF, CSV, or Excel.
   - **Delivery method**: email, storage, or both.
   - **Email recipients**: list of email addresses separated by commas.
   - **Email subject**: supports `{{date_from}}` and `{{date_to}}` tokens.
4. Click **Save Schedule**.

The `report_schedules` table stores the schedule and the `next_run_at` timestamp. The platform's automated job runner checks for due schedules and triggers report generation + email delivery.

### 3.2 Monitoring Deliveries

Scheduled report runs are logged in the **Report History** section of the Reports Hub. Each run shows:
- Template name
- Date/time generated
- Row count and file size
- Delivery status (completed / failed)
- Download link (valid for 90 days)

If a delivery fails, the status shows `failed` with an error message. Common causes:
- SMTP credentials not configured in Supabase project settings.
- Recipient email address is invalid.
- Template references a data source no longer available.

---

## 4. Full Data Export Wizard

The **Data Export Wizard** is accessible from Admin → Export Data. It provides a 3-step export for bulk data extraction.

**Step 1: Choose format** — CSV, JSON, or Excel (multi-sheet workbook).

**Step 2: Select data types** — choose any combination of: Observations, Vehicles, Breaches, Enforcement Actions, Zones, Users.

**Step 3: Options** — set an optional date range and toggle whether to include deleted/archived records.

**Excel output** (multi-sheet): One Excel sheet per selected data type in a single `.xlsx` workbook. This is the recommended format for council audits and data sovereignty requirements.

**JSON output**: Full structured export suitable for database migration or integration. Includes all fields for each selected data type.

---

## 5. Delivering Reports to Councils

### 5.1 Email Delivery

Set up a **scheduled report** (Section 3) with the council representative's email address as a recipient. Use a clear subject line that includes the date range:

```
Weekly Breach Summary — {{date_from}} to {{date_to}}
```

### 5.2 Manual Delivery

1. Run the report from the Reports Hub or Custom Report Builder.
2. For CSV or Excel: the file downloads to your device. Attach it to an email to the council.
3. For PDF: use the print dialog to save as PDF first.

### 5.3 Court or Legal Proceedings

For evidence packages required by courts or enforcement hearings:
1. Export the **Infringement Register** (CSV) for the relevant plate and time period.
2. Export the **Vehicle Observations** (CSV) for the same plate and zone.
3. From the Infringement Notices page, reprint the original notice PDF for each relevant notice.
4. From Admin → Audit Log, export the audit trail for the relevant actions (CSV).
5. Bundle all documents and submit as directed by your legal team.

See `DOCUMENT_MANAGEMENT_GUIDE.md` for how to find, reprint, and export specific notices.

---

## 6. Report Retention

- Generated report files are stored in Supabase Storage for **90 days** by default.
- After 90 days, the status changes to `expired` and the file is removed.
- If you need to retain a report longer, download it immediately after generation and store it in your organisation's document management system.

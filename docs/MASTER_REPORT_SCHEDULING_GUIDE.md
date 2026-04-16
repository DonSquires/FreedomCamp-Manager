# Master & Grand Master Guide — Report Scheduling and Org-Level Exports

> **Who is this for?** Master and Grand Master users who oversee multiple organisations on the platform and need to manage automated reporting, cross-org analytics, and bulk data exports.

---

## 1. Your Scope vs Admin Scope

| Capability | Admin | Master | Grand Master |
|---|---|---|---|
| View own org's data | ✅ | ✅ | ✅ |
| View all child org data | Limited | ✅ | ✅ |
| View all orgs on platform | ❌ | ❌ | ✅ |
| Create report schedules | ✅ | ✅ | ✅ |
| Full data export (org) | ✅ | ✅ | ✅ |
| Full data export (all orgs) | ❌ | ✅ | ✅ |
| Platform-level statistics | ❌ | ❌ | ✅ |

---

## 2. Scheduled Reports — Setup and Management

### 2.1 What Scheduled Reports Do

Scheduled reports run automatically at a configured time and either:
- Send a PDF or CSV to a list of email addresses, or
- Save the file to Supabase Storage (with a time-stamped path), or
- Both.

This is the recommended approach for delivering weekly compliance summaries to councils, monthly enforcement registers to management, and quarterly audit packages.

### 2.2 Creating a Schedule (Step by Step)

**Prerequisites:** You must have a saved report template. See `ADMIN_REPORTS_EXPORT_GUIDE.md` Section 2.4 for how to create one.

1. Navigate to **Custom Reports** (`/custom-reports`).
2. In the **Saved Templates** panel (right side), find the template you want to schedule.
3. Click the **clock / Schedule** icon.
4. Complete the schedule form:

**Frequency options:**
- `daily` — runs every day at the specified time
- `weekly` — runs on the specified day of the week
- `biweekly` — runs every two weeks
- `monthly` — runs on the specified day of the month
- `quarterly` — runs every three months
- `yearly` — runs once per year

**Date range types** (automatically applied to the report):
- `previous_day` — yesterday
- `previous_week` — last 7 days
- `previous_month` — the calendar month before the run date
- `previous_quarter` — the last 3-month quarter
- `rolling_7_days` — always the last 7 days from today
- `rolling_30_days` — always the last 30 days
- `rolling_90_days` — always the last 90 days
- `year_to_date` — 1 January to today
- `month_to_date` — first of the month to today

**Delivery options:**
- `email` — generates the report and sends it via SMTP to the specified recipients
- `storage` — saves the file to Supabase Storage (`reports/` bucket)
- `both` — does both

**Email subject tokens:**
Use `{{date_from}}` and `{{date_to}}` in the subject line to include the report date range automatically. Example:
```
Weekly Compliance Summary — {{date_from}} to {{date_to}}
```

5. Click **Save Schedule**.

### 2.3 Editing or Disabling a Schedule

1. Navigate to **Custom Reports** → **Saved Templates**.
2. Click the clock icon on the template that has a schedule.
3. Edit the fields as needed, or toggle **Active** to off to pause the schedule without deleting it.

### 2.4 Monitoring Schedule Runs

All scheduled report deliveries are logged in **Report History** (navigate to **Reports Hub** → **History** tab or `/report-history`).

Each run entry shows:
- Template name and the schedule that triggered it
- Date/time generated
- Date range covered
- Row count and file size
- Delivery status (`completed`, `failed`, `expired`)
- Download link (active for 90 days)

If a run fails, inspect the `error_message` field in the history row. Common issues:
- SMTP not configured (contact your infrastructure admin to set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` in Supabase project secrets)
- Invalid recipient email
- Report template references a field that no longer exists in the data source

### 2.5 Example: Setting Up a Weekly Council Report

**Goal:** Every Monday at 6 AM, send the Christchurch City Council a PDF compliance summary for the previous week.

**Steps:**
1. Build a template using the Custom Report Builder with source `observations`, fields: zone name, total observations, compliance rate, breach count. Add a filter: `is_compliant = false` for a breach-focused view. Save as "CCC Weekly Breach Summary".
2. Schedule it:
   - Frequency: `weekly`, Day: Monday, Time: `06:00`
   - Date range: `previous_week`
   - Format: `pdf`
   - Delivery: `email`
   - Recipients: `enforcement@ccc.govt.nz`
   - Subject: `CCC Breach Summary — {{date_from}} to {{date_to}}`
3. Save. The first run occurs on the following Monday.

---

## 3. Multi-Organisation Analytics (Master Users)

As a master user, your data scope includes your own organisation and all child organisations in your hierarchy.

### 3.1 The Global Filter

The **Global Filter Ribbon** at the top of every admin page includes an organisation selector. Master users see a dropdown showing all orgs in their hierarchy. Selecting an org scopes all page data to that org.

To view data across all child orgs simultaneously, leave the org filter set to **All**.

### 3.2 Cross-Org Compliance Report

1. Navigate to **Compliance Dashboard** (`/compliance`).
2. Leave the organisation filter on **All**.
3. The dashboard shows compliance metrics aggregated across all orgs in your hierarchy.
4. Click **Export PDF** or **Export CSV** for a cross-org compliance package.

### 3.3 Cross-Org Enforcement Register

1. Navigate to **Custom Reports**.
2. Create a template using the `enforcement` data source.
3. Add no organisation filter (your master scope will automatically include all child orgs).
4. Run and export.

---

## 4. Full Data Export — Org-Level

Use the **Data Export Wizard** (Admin → Export Data) for a full extraction of all data belonging to your organisation.

### 4.1 Standard Bulk Export

1. Open the Data Export Wizard.
2. Select **Excel** for a structured multi-sheet workbook, or **JSON** for developer-friendly output.
3. Select **all data types**: Observations, Vehicles, Breaches, Enforcement Actions, Zones, Users.
4. Set a date range (optional — leave blank to export all time).
5. Toggle **Include deleted records** and **Include archived records** if you need a complete picture.
6. Click **Export Now**.

The Excel workbook will contain one sheet per data type. For large datasets, this may take 20–40 seconds.

### 4.2 Data Sovereignty Export

If a client organisation or council requests a copy of all data held about their sites:

1. Set the Global Filter to the specific client organisation.
2. Run the full Data Export Wizard with all data types selected and no date restriction.
3. The resulting file contains only records scoped to that organisation (RLS is enforced even on bulk exports).
4. Deliver the file securely — do not send via unencrypted email. Use a secure file sharing link or SFTP.

### 4.3 Migration Export (Moving to Another System)

If you need to migrate an organisation's data to a different platform:

1. Use the Data Export Wizard in JSON format for maximum data fidelity.
2. Export all data types.
3. The JSON includes full UUID foreign keys so relationships between records can be reconstructed.

The `fullExport.ts` library (located at `src/lib/fullExport.ts` if it exists in your build) provides programmatic access to the full export for developer-level integrations.

---

## 5. Grand Master — Platform-Level Reporting

Grand Master users have access to additional platform-wide reporting via the **Platform** page (`/platform`).

### 5.1 Platform Statistics

The Platform page shows:
- Total organisations on the platform
- Total users (by role)
- Total observations, breaches, and enforcement actions (all-time)
- Storage usage
- Edge function health status

### 5.2 Cross-All-Org Exports

Grand Master users can run the Data Export Wizard without an organisation filter to export data across **all organisations**. Use this only for:
- Platform-level audits
- Data backup
- Support investigations

**Caution**: All-org exports may contain data from multiple unrelated clients. Handle with strict access controls.

### 5.3 Bob AI Studio Reporting

The **Grandmaster Coding Studio** (`/grandmaster-code-studio`) includes a **Service Health** tab that shows the health of all backend services (inference service, proxy service, edge functions). This is the primary tool for platform-level diagnostic reporting.

---

## 6. Scheduled Report Infrastructure

### How the Delivery Pipeline Works

```
report_schedules table
        │
        │ next_run_at <= NOW()
        │
        ▼
Supabase pg_cron job (or external cron via GitHub Actions)
        │
        │ calls
        ▼
send-report-email Edge Function
        │
        ├─ Generates report data (execute_report RPC or direct query)
        ├─ Builds HTML/CSV/Excel
        ├─ Saves to Supabase Storage (reports/ bucket)  ← if storage delivery
        ├─ Sends via SMTP  ← if email delivery
        └─ Logs to report_history table
```

### Required Supabase Secrets

For email delivery to work, the following secrets must be set in your Supabase project (Settings → Edge Functions → Secrets):

| Secret | Example Value |
|---|---|
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USERNAME` | `reports@yourcompany.co.nz` |
| `SMTP_PASSWORD` | *(your SMTP password)* |
| `SMTP_FROM_EMAIL` | `reports@yourcompany.co.nz` |
| `SMTP_FROM_NAME` | `FreedomCamp Manager Reports` |

If these are not configured, scheduled email delivery will fail silently and the report history will show status `failed`.

### Configuring the Cron Schedule

The `report_schedules` table stores the next run time for each schedule. For the cron runner to work:
- If using **Supabase pg_cron**: set up a cron job in the database that calls the `send-report-email` edge function every 15–30 minutes to process due schedules.
- If using **GitHub Actions**: the workflow `.github/workflows/ops-report-scheduler.yml` (if present) handles this via a `schedule:` trigger.

Consult your infrastructure setup documentation (`DEPLOYMENT_GUIDE.md` or `RAILWAY_DEPLOYMENT_GUIDE.md`) for the specific configuration in your environment.

---

## 7. Data Retention Policy

| Data Type | Default Retention | Location |
|---|---|---|
| Generated report files | 90 days | Supabase Storage `reports/` bucket |
| Report history records | Permanent | `report_history` table |
| Scheduled report configs | Permanent (unless deleted) | `report_schedules` table |
| Enforcement records | Permanent | `infringement_notices`, `notices_to_vacate`, etc. |
| Audit log | Permanent | `audit_log` table |

After 90 days, the Storage file is cleaned up and the history record status changes to `expired`. The history record itself remains and shows the run metadata (row count, date generated) but the download link is no longer valid.

If longer retention is required (e.g. for legal hold), download reports immediately after generation and store in an external document management system.

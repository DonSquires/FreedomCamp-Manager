# Comprehensive Reporting System

## Executive Summary

The Comprehensive Reporting System provides administrators with flexible tools to:

1. **Build custom reports** from any data source in the system
2. **Save report templates** for reuse across the organization
3. **Schedule automatic reports** with email delivery
4. **Export to multiple formats** (CSV, PDF, Excel)
5. **Track report history** with download links

---

## 1. System Architecture

### 1.1 Database Schema

```
report_data_sources          report_templates           report_schedules
       │                            │                          │
       │ defines                    │ uses                     │ runs
       ▼                            ▼                          ▼
┌─────────────────┐         ┌─────────────────┐        ┌─────────────────┐
│ code            │◄────────│ data_source_id  │        │ template_id     │
│ name            │         │ name            │        │ frequency       │
│ source_table    │         │ config (JSONB)  │        │ schedule_time   │
│ available_fields│         │ default_format  │        │ email_recipients│
│ available_filters         │ created_by      │        │ next_run_at     │
│ available_joins │         │ is_public       │        └─────────────────┘
└─────────────────┘         └─────────────────┘                │
                                    │                          │
                                    └──────────┬───────────────┘
                                               │
                                               ▼
                                       ┌─────────────────┐
                                       │ report_history  │
                                       │ template_id     │
                                       │ schedule_id     │
                                       │ storage_path    │
                                       │ status          │
                                       └─────────────────┘
```

### 1.2 Data Flow

```
┌──────────────────┐
│  Admin User      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Report Builder   │────▶│ Select Data      │
│ (CustomReport    │     │ Source           │
│  Builder.tsx)    │     └────────┬─────────┘
└────────┬─────────┘              │
         │                        ▼
         │              ┌──────────────────┐
         │              │ Configure Fields,│
         │              │ Filters, Groups  │
         │              └────────┬─────────┘
         │                       │
         ▼                       ▼
┌──────────────────┐     ┌──────────────────┐
│ Preview Data     │────▶│ Save Template    │
│ (Live Query)     │     │ (Optional)       │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│ Export           │     │ Schedule         │
│ (CSV/PDF/Excel)  │     │ (Auto-generate)  │
└──────────────────┘     └──────────────────┘
```

---

## 2. Available Data Sources

### 2.1 System Data Sources

| Code | Name | Description |
|------|------|-------------|
| `observations` | Vehicle Observations | All vehicle observation records |
| `vehicles` | Vehicles | Canonical vehicle records |
| `breaches` | Breach Alerts | Compliance breach records |
| `officers` | Officers | Officer profiles and activity |
| `patrols` | Patrols | Patrol records |
| `enforcement` | Enforcement Actions | Notices and actions |
| `assets` | Officer Assets | Equipment assigned to officers |
| `keys` | Key Custody | Key checkout/return records |
| `allowances` | Officer Allowances | Allowance assignments |
| `incidents` | Incidents | Incident reports |
| `roster_shifts` | Roster Shifts | Scheduled shifts |

### 2.2 Adding Custom Data Sources

Organizations can add their own data sources by inserting into `report_data_sources`:

```sql
INSERT INTO report_data_sources (
  code, name, description, source_table,
  available_fields, available_filters, organization_id
)
VALUES (
  'custom_audits', 'Custom Audits', 'Organization audit records',
  'custom_audit_logs',
  '[
    {"key": "id", "label": "ID", "type": "uuid"},
    {"key": "audit_date", "label": "Audit Date", "type": "date"},
    {"key": "auditor_name", "label": "Auditor", "type": "text"},
    {"key": "score", "label": "Score", "type": "number"}
  ]'::JSONB,
  '[
    {"key": "audit_date", "label": "Date Range", "type": "daterange"}
  ]'::JSONB,
  'org-uuid'
);
```

---

## 3. Report Configuration

### 3.1 Configuration Structure

Report templates use JSONB configuration for maximum flexibility:

```json
{
  "selectedFields": ["plate_number", "zone_name", "recorded_at", "is_compliant"],
  
  "filters": [
    { "field": "is_compliant", "operator": "eq", "value": false },
    { "field": "recorded_at", "operator": "gte", "value": "$date_from" },
    { "field": "recorded_at", "operator": "lte", "value": "$date_to" }
  ],
  
  "groupBy": ["zone_id"],
  
  "aggregations": [
    { "field": "id", "function": "count", "alias": "total_count" },
    { "field": "is_compliant", "function": "sum", "alias": "compliant_count" }
  ],
  
  "sortBy": [
    { "field": "total_count", "direction": "desc" }
  ],
  
  "joins": [
    { "source": "zones", "on": "zone_id" }
  ],
  
  "displayOptions": {
    "showTotals": true,
    "showCharts": true,
    "chartType": "bar",
    "pageSize": 50
  }
}
```

### 3.2 Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `{"field": "status", "operator": "eq", "value": "active"}` |
| `neq` | Not equals | `{"field": "status", "operator": "neq", "value": "deleted"}` |
| `gt` | Greater than | `{"field": "count", "operator": "gt", "value": 10}` |
| `gte` | Greater than or equal | `{"field": "date", "operator": "gte", "value": "$date_from"}` |
| `lt` | Less than | `{"field": "count", "operator": "lt", "value": 100}` |
| `lte` | Less than or equal | `{"field": "date", "operator": "lte", "value": "$date_to"}` |
| `in` | In list | `{"field": "status", "operator": "in", "value": ["new", "active"]}` |
| `contains` | Text contains | `{"field": "name", "operator": "contains", "value": "Smith"}` |
| `isnull` | Is null | `{"field": "resolved_at", "operator": "isnull", "value": true}` |

### 3.3 Aggregation Functions

| Function | Description |
|----------|-------------|
| `count` | Count of rows |
| `sum` | Sum of values |
| `avg` | Average value |
| `min` | Minimum value |
| `max` | Maximum value |
| `count_distinct` | Count of distinct values |

---

## 4. Export Formats

### 4.1 CSV Export

- Comma-separated values
- UTF-8 encoding with BOM for Excel compatibility
- Handles special characters (quotes, commas, newlines)
- Ideal for large datasets and data analysis

### 4.2 PDF Export

- Professional A4 layout with branding
- Table formatting with headers
- Summary statistics at top
- Page numbers and generation timestamp
- Ideal for sharing with stakeholders

### 4.3 Excel Export (.xlsx)

- Native Excel format with multiple sheets
- Data sheet with full records
- Summary sheet with aggregations
- Formatted headers and column widths
- Ideal for further analysis in Excel

---

## 5. Scheduled Reports

### 5.1 Frequency Options

| Frequency | Description |
|-----------|-------------|
| `daily` | Every day at specified time |
| `weekly` | Every week on specified day |
| `biweekly` | Every two weeks |
| `monthly` | Monthly on specified day |
| `quarterly` | Every 3 months |
| `yearly` | Once per year |

### 5.2 Date Range Types

| Type | Description |
|------|-------------|
| `previous_day` | Yesterday |
| `previous_week` | Last 7 days |
| `previous_month` | Last calendar month |
| `previous_quarter` | Last 3 months |
| `previous_period` | Based on frequency |
| `rolling_7_days` | Last 7 days from now |
| `rolling_30_days` | Last 30 days from now |
| `rolling_90_days` | Last 90 days from now |
| `year_to_date` | January 1 to today |
| `quarter_to_date` | Quarter start to today |
| `month_to_date` | Month start to today |

### 5.3 Delivery Options

- **Email**: Send PDF/CSV to specified recipients
- **Storage**: Save to Supabase Storage bucket
- **Both**: Email + storage archive

### 5.4 Example: Weekly Compliance Report

```sql
INSERT INTO report_schedules (
  organization_id, template_id, name,
  frequency, schedule_day, schedule_time,
  date_range_type, output_format, delivery_method,
  email_recipients, email_subject,
  created_by
)
VALUES (
  'org-uuid', 'template-uuid', 'Weekly Compliance Report',
  'weekly', 1, '06:00',  -- Monday at 6 AM
  'previous_week', 'pdf', 'email',
  ARRAY['manager@example.com', 'council@example.com'],
  'Weekly Compliance Report - {{date_from}} to {{date_to}}',
  'admin-uuid'
);
```

---

## 6. Report History

### 6.1 Tracking

Every report generation is logged with:

- Configuration snapshot
- Row count and file size
- Generation time
- Storage location
- Delivery status

### 6.2 Retention

- Reports are stored for 90 days by default
- Status changes to `expired` after retention period
- Storage files are automatically cleaned up

### 6.3 Re-download

Users can re-download any report within the retention period:

```sql
SELECT 
  name,
  generated_at,
  storage_path,
  download_url,
  url_expires_at
FROM report_history
WHERE organization_id = 'org-uuid'
  AND status = 'completed'
ORDER BY generated_at DESC
LIMIT 20;
```

---

## 7. API Reference

### 7.1 List Data Sources

```typescript
const { data: sources } = await supabase
  .from('report_data_sources')
  .select('*')
  .eq('is_active', true)
  .order('name')
```

### 7.2 Create Template

```typescript
const { data: template } = await supabase
  .from('report_templates')
  .insert({
    organization_id: orgId,
    name: 'My Custom Report',
    category: 'compliance',
    data_source_id: sourceId,
    config: {
      selectedFields: ['plate_number', 'zone_name'],
      filters: [...],
      sortBy: [{ field: 'recorded_at', direction: 'desc' }]
    },
    default_format: 'csv',
    created_by: userId
  })
  .select()
  .single()
```

### 7.3 Run Report

```typescript
// Execute report query
const { data: results } = await supabase
  .rpc('execute_report', {
    template_id: templateId,
    date_from: '2026-01-01',
    date_to: '2026-01-31'
  })

// Log to history
await supabase.from('report_history').insert({
  organization_id: orgId,
  template_id: templateId,
  name: template.name,
  data_source_code: source.code,
  config_snapshot: template.config,
  output_format: 'csv',
  row_count: results.length,
  status: 'completed',
  generated_by: userId
})
```

### 7.4 Export to CSV

```typescript
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'

const csv = arrayToCSV(results, [
  { key: 'plate_number', label: 'Plate Number' },
  { key: 'zone_name', label: 'Zone' },
  { key: 'recorded_at', label: 'Date/Time', format: formatDate }
])

downloadCSV(csv, 'compliance-report.csv')
```

### 7.5 Export to PDF

```typescript
import { generateReportHTML, exportReportPDF } from '@/lib/pdfExport'

const config = {
  title: 'Compliance Report',
  subtitle: 'Monthly Summary',
  organizationName: org.name,
  generatedBy: user.email,
  generatedAt: new Date(),
  dateRange: { from: dateFrom, to: dateTo }
}

const sections = [
  { heading: 'Summary', content: summaryText, type: 'text' },
  { heading: 'Details', content: results, type: 'table' }
]

exportReportPDF(config, sections)
```

---

## 8. Frontend Components

### 8.1 Report Builder Page

Located at `/custom-reports`, the builder provides:

- **Data source selector** with descriptions
- **Field picker** with drag-and-drop ordering
- **Filter builder** with dynamic operators
- **Group by** and aggregation options
- **Sort configuration**
- **Live preview** of results
- **Save as template** functionality

### 8.2 My Reports Page

Located at `/my-reports`, showing:

- Saved templates with last run info
- Quick run buttons
- Edit/delete options
- Sharing settings

### 8.3 Report History

Located at `/report-history`, showing:

- Recent generations
- Download links
- Re-run options
- Status indicators

---

## 9. Security

### 9.1 Row Level Security

- Users can only see data sources available to their organization
- Templates are scoped to organization
- History tracks who generated each report
- Storage bucket uses organization-based paths

### 9.2 Role Requirements

| Action | Required Role |
|--------|--------------|
| View data sources | Any authenticated |
| Create template | admin, admin_officer |
| Run any template | admin, admin_officer |
| Create schedule | admin |
| View all history | admin |
| View own history | Any authenticated |

---

## 10. Best Practices

### 10.1 Performance

- Limit date ranges to reasonable periods
- Use filters to reduce dataset size
- Avoid selecting unnecessary fields
- Use aggregations instead of raw data when possible

### 10.2 Templates

- Give templates clear, descriptive names
- Add descriptions explaining the report purpose
- Set appropriate default format
- Test with preview before saving

### 10.3 Schedules

- Schedule reports during off-peak hours
- Use appropriate date ranges (don't overlap)
- Verify email recipients are correct
- Monitor delivery status

---

## 11. Migration Summary

| Table | Purpose |
|-------|---------|
| `report_data_sources` | Available data sources (11 default) |
| `report_templates` | User-created report definitions |
| `report_schedules` | Automatic report generation |
| `report_history` | Generation tracking and downloads |

### Helper Functions

- `calculate_next_report_run()` — Calculate next scheduled run time
- `increment_report_template_run()` — Update template usage stats

### Views

- `v_recent_reports` — Recent reports with template info
- `v_template_usage_stats` — Template usage statistics

### Storage

- `reports` bucket for generated report files

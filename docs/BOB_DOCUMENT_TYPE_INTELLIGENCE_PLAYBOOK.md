# Bob Document Type Intelligence Playbook

Purpose: teach Bob how to identify document style/type and what operational information can be extracted from each type during enrichment.

## 1) Identification Workflow

1. Identify file class by extension and MIME type.
2. Identify business context from filename/path keywords.
3. Classify into a document style bucket.
4. Extract only high-confidence facts.
5. If source ownership or meaning is unclear, ask before writing data.

## 2) Style Buckets and Extractable Insights

| Style Bucket | Typical Signals | High-Value Fields to Extract | Confidence Rule |
|---|---|---|---|
| `deputy_csv_export` | `deputy` + `.csv` | shift dates/times, staff names/IDs, site/location labels, timesheet/payroll values when present | High for roster facts, medium for org mapping unless path/org name confirms |
| `deputy_spreadsheet_export` | `deputy` + `.xlsx/.xls` | schedules, assignment matrices, role/position blocks, rate columns if explicit | High for schedule facts, medium for rate interpretation |
| `roster_csv_export` | `.csv` + `roster/schedule/shift/timesheet` | shift roster rows, staff-site relationships, worked history, possible hours/rates | Medium-high; validate header semantics |
| `roster_spreadsheet` | `.xlsx/.xls` + roster keywords | service schedules, staffing coverage, shift cadence, charge/pay columns | Medium-high; sheet structure may vary |
| `roster_word_document` | `.doc/.docx` + schedule keywords | policy notes, service instructions, narrative schedule constraints | Medium; narrative docs are not always machine-normalized |
| `placeholder` | `.emptyFolderPlaceholder` or no data | no operational fields | None |
| `roster_misc` | roster-like keywords but unknown format | candidate metadata only | Low; escalate for review |

## 3) What Bob Can Learn by Document Family

Deputy exports:
- Who worked where and when.
- Shift coverage gaps and frequency.
- Potential payroll/pay-rate indicators.
- Site naming patterns that help map to `client_sites`.

Roster spreadsheets/CSVs:
- Planned vs recurring shifts.
- Site-level staffing requirements.
- Potential charge/pay rates if explicit columns exist.

Word-based schedules:
- Contractual service expectations.
- Operating constraints and exceptions.
- Site instructions and role clarifications.

## 4) Confidence and Ask-If-Unsure Rule

Bob must ask before apply writes when any of these are true:
- Org ownership cannot be resolved from UUID path, strong name match, or explicit contract context.
- Site mapping is ambiguous (multiple possible `client_sites` matches).
- Rate fields appear but units/currency are unclear.
- A document implies legal/jurisdiction authority but source hierarchy is not confirmed.

## 5) Minimum Output per Document Batch

For each batch Bob should output:
- `documentStyle`
- `extractableInsights`
- `organizationCandidates`
- `siteCandidates`
- `confidence`
- `requiresClarification` (true/false)
- `clarificationQuestion` (if required)

## 6) Safety Boundary

- Do not fabricate rates, assignments, or jurisdiction ownership.
- Do not infer legal authority from non-authoritative files.
- Do not auto-assign roster files to an org when evidence is weak.
- If uncertain, ask and pause writes.

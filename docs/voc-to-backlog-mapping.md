# VOC-to-Backlog Mapping

**Sprint 0 Artifact** | Generated: 2026-05-03 | Grounded from: VOC signals, `docs/COMPETITIVE_ANALYSIS_2024.md`, `docs/UI_UX_ENTERPRISE_FORWARD_PLAN_2026-05-03.md`

## Purpose

Map Voice of the Customer (VOC) signals to concrete backlog items with acceptance criteria. This ensures user needs directly drive sprint work rather than internal assumptions.

---

## VOC Signal Sources

| Source | Method | Confidence |
|---|---|---|
| Competitive analysis user reviews/benchmarks | Desk research (March 2024) | Medium |
| Operator role pain points (patrol, dispatch) | Session-derived heuristics | Medium |
| Officer welfare gap (safety critical) | Industry standard analysis | High |
| Multi-org admin pain points | Architecture review sessions | Medium |
| Public-facing camper portal demand | NZ freedom camping regulation compliance | High |

> **Note**: Direct user interviews not yet conducted. Sprint 1 should include a structured VOC session with at least 2 operators and 1 officer. This artifact will be updated post-interview.

---

## VOC Signal → Backlog Mapping

### Theme 1: Officer Safety

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Officers working alone at 2am with no automatic check-in" | Derived (welfare audit) | Man-down / fall detection alert | Officer inactivity > 10 min triggers supervisor SMS + push alert; officer can cancel within 60s | 🔴 Critical | S1 |
| "Manual welfare calls take supervisor time" | Derived | Automated welfare check cadence | System sends timed welfare ping; officer confirms via one-tap; non-response escalates after 2 minutes | 🟠 High | S1 |
| "Wearables (Apple Watch) not supported" | Competitor gap | Wearable integration | Officer can receive job dispatch alerts and send SOS from Apple Watch | 🟠 High | S2 |

---

### Theme 2: Dispatch Efficiency

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Dispatch takes too long — we have to manually find the nearest officer" | Derived (dispatch module) | AI-recommended unit assignment | On new job creation, system suggests top-3 officers ranked by proximity + skill + current load; dispatcher can accept in 1 click | 🟠 High | S1 |
| "No offline mode for officers in rural zones" | Derived (NZ geography) | Offline job map downloads | Officer can pre-download zone map tiles; jobs queued offline sync when connectivity returns | 🟠 High | S1 |
| "ETA to site is guesswork" | Derived | In-app ETA calculation | Job card shows real-time ETA using officer GPS + routing API; updates every 30s | 🟡 Medium | S1 |

---

### Theme 3: Public Compliance (Freedom Camping)

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Campers don't know the rules — enforcement is reactive" | NZ regulatory requirement | Public-facing zone compliance map | Public web page shows zones, status (open/closed/restricted), and rules; no login required; updated within 5 min of enforcement change | 🟠 High | S2 |
| "Non-English speaking campers (Chinese, Hindi tourists) don't understand notices" | NZ tourism stats | Multi-language public portal | Zone map and enforcement notices available in English, Māori, Mandarin, Hindi; language auto-detected from browser | 🟠 High | S2 |
| "DOC data syncs manually — always out of date" | Officer feedback (derived) | Automated DOC / council data sync | Nightly job pulls approved site data from DOC API / council feed; admin notified of changes; manual override available | 🟠 High | S2 |

---

### Theme 4: Noise & Complaint Management

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Residents don't know if their noise complaint was acted on" | Derived (public portal gap) | Public complaint portal | Resident submits complaint online; receives case reference; can check status without phoning | 🟠 High | S2 |
| "Evidence bundles for prosecutions lack structure" | Derived (legal process) | Structured evidence bundles | Officer can generate a signed PDF bundle of photos, notes, and GPS track per incident with one action | 🟡 Medium | S1 |

---

### Theme 5: Multi-Org Administration

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Master user sees all org data — no way to scope a report to just one council" | Architecture review | Org-scoped reporting filters | Every report has org-id filter; master can select one or all; admin sees only own org; filter persists per session | 🟠 High | S1 |
| "CRM contacts bleed between client orgs in search" | Architecture review | CRM org isolation | Search results in `/crm`, `/crm/client/:orgId`, `/crm/contractor/:orgId` scoped strictly to session org; RLS policy verified in test | 🔴 Critical | S1 |
| "No audit trail when master switches context between orgs" | Architecture review | Org-context switch log | Every org-context change logged in `audit_log` with previous org, new org, timestamp, user ID | 🟡 Medium | S1 |

---

### Theme 6: Parking Enforcement UX

| VOC Signal | Verbatim / Derived | Backlog Item | Acceptance Criteria | Impact | Sprint |
|---|---|---|---|---|---|
| "Motorists dispute tickets but can't do it online" | Competitor benchmark | Self-serve appeals portal | Public lookup by plate or citation number; online appeal form with photo upload; status tracked in real time | 🟡 Medium | S2 |
| "Parking occupancy dashboard is basic — can't see real-time fill rate" | Competitor benchmark | Real-time occupancy dashboard | Admin dashboard shows parking zone fill %, updated < 2 min; colour-coded zones on map | 🟡 Medium | S2 |

---

## Backlog Summary (Prioritised)

| # | Backlog Item | Theme | Impact | Sprint |
|---|---|---|---|---|
| B-01 | CRM org isolation (RLS + test) | Multi-org | 🔴 Critical | S1 |
| B-02 | Man-down / fall detection | Officer Safety | 🔴 Critical | S1 |
| B-03 | AI unit recommendation (dispatch) | Dispatch | 🟠 High | S1 |
| B-04 | Automated welfare check cadence | Officer Safety | 🟠 High | S1 |
| B-05 | Offline map tile download | Dispatch | 🟠 High | S1 |
| B-06 | Org-scoped reporting filters | Multi-org | 🟠 High | S1 |
| B-07 | In-app ETA calculation | Dispatch | 🟡 Medium | S1 |
| B-08 | Structured evidence bundles | Noise | 🟡 Medium | S1 |
| B-09 | Org-context switch audit log | Multi-org | 🟡 Medium | S1 |
| B-10 | Public freedom camping zone map | Public Compliance | 🟠 High | S2 |
| B-11 | Multi-language public portal | Public Compliance | 🟠 High | S2 |
| B-12 | Automated DOC / council sync | Public Compliance | 🟠 High | S2 |
| B-13 | Public noise complaint portal | Noise | 🟠 High | S2 |
| B-14 | Wearable (Apple Watch) integration | Officer Safety | 🟠 High | S2 |
| B-15 | Self-serve parking appeals portal | Parking | 🟡 Medium | S2 |
| B-16 | Real-time parking occupancy dashboard | Parking | 🟡 Medium | S2 |

---

## Sprint 0 Actions

- [ ] Conduct structured VOC session with ≥2 operators + ≥1 officer; update derived signals with verbatim quotes
- [ ] Validate B-01 (CRM RLS) against `supabase/migrations/` before S1 kickoff
- [ ] Add B-02 (man-down) to `docs/MODULE_ROADMAP.md` if not already present
- [ ] Review B-10/B-11 against NZ Privacy Act and Ministry of Business guidance before public portal build

---

## Evidence Basis

- Competitive analysis: `docs/COMPETITIVE_ANALYSIS_2024.md` (March 2024, v1.0)
- Forward plan: `docs/UI_UX_ENTERPRISE_FORWARD_PLAN_2026-05-03.md`
- Commit: `8cc8c4f3`

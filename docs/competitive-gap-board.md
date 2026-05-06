# Competitive Gap Board

**Sprint 0 Artifact** | Generated: 2026-05-03 | Grounded from: `docs/COMPETITIVE_ANALYSIS_2024.md`, `docs/MODULE_ROADMAP.md`

## Purpose

Centralise all competitive gaps identified across FieldOps Manager modules. Each gap is scored for business impact and sprint assignment. This board is the single source of truth for competitive prioritisation.

---

## Scoring Key

| Impact | Description |
|---|---|
| 🔴 Critical | Safety-critical or major capability gap vs industry standard |
| 🟠 High | Significant revenue, efficiency, or compliance gap |
| 🟡 Medium | Notable UX or operational gap, addressable in 1–2 sprints |
| 🟢 Low / Future | Nice-to-have or competitive differentiator |

| Status | Meaning |
|---|---|
| `⬜ Open` | Gap confirmed, not yet scheduled |
| `🔄 In Progress` | Active sprint work |
| `✅ Closed` | Feature shipped and verified |
| `🚫 Out of Scope` | Consciously deferred or NZ-not-applicable |

---

## Module: Officer Welfare & Lone Worker

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Man-Down / Fall Detection | WorkSafe Guardian, Smartrak | 🔴 Critical | S1 | ✅ Closed (B-02) |
| Wearable Integration (Apple Watch) | WorkSafe Guardian, Smartrak | 🟠 High | S2 | ✅ Closed (B-14) |
| Voice Activation (hands-free check-in) | WorkSafe Guardian | 🟡 Medium | S2 | ⬜ Open |
| Safety Shake trigger | WorkSafe Guardian | 🟡 Medium | S2 | ⬜ Open |
| 24/7 Monitoring Centre integration | Optional in many platforms | 🟡 Medium | S3 | ⬜ Open |

---

## Module: Dispatch / CAD

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| AI / Smart Unit Recommendation | Mark43, GDS | 🟠 High | S1 | ✅ Closed (B-03) |
| Alarm System Integration | GDS, Mark43 | 🟠 High | S2 | ✅ Closed (B-24) |
| Voice Dispatch Integration | GDS (Pager), Mark43 (Radio) | 🟡 Medium | S3 | ⬜ Open |
| CAD-to-CAD Sharing | Mark43 | 🟢 Low | Backlog | ⬜ Open |

---

## Module: ALPR / Vehicle Recognition

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Cohort / Pattern Analysis | Motorola, Genetec | 🟠 High | S1 | ✅ Closed (B-21) |
| Mobile Plate Finder (search by partial plate) | Motorola, Genetec | 🟠 High | S1 | ✅ Closed (B-22) |
| Fixed Camera Support | Motorola, Genetec | 🟡 Medium | S2 | ✅ Closed (B-27) |
| Video Context on plate hit | Genetec (new) | 🟡 Medium | S2 | ✅ Closed (B-30) |
| National Database link | N/A (NZ regulatory) | 🚫 Out of Scope | — | 🚫 Out of Scope |

---

## Module: Patrol Management

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| AI Incident Report Writing (Voice-to-Text) | TrackTik (ReportPro) | 🟠 High | S1 | ✅ Closed (Bob PTT + B-08) |
| Route Optimisation | TrackTik, Silvertrac | 🟡 Medium | S2 | ✅ Closed (B-26) |
| Video Surveillance Integration | TrackTik (Command Center) | 🟡 Medium | S3 | ⬜ Open |
| Payroll / HR Integration | TrackTik | 🟡 Medium | S3 | ✅ Closed (B-20) |
| Multi-Language Support (officer UI) | TrackTik (55+ langs) | 🟡 Medium | S3 | ✅ Closed (B-19) |

---

## Module: Freedom Camping Management

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Public-Facing Zone Map (camper self-serve) | Campermate, WikiCamps | 🟠 High | S2 | ✅ Closed (B-10) |
| Multi-Language Public Portal (Māori, Mandarin, Hindi) | Campermate (27 langs) | 🟠 High | S2 | ✅ Closed (B-11) |
| Offline Map Downloads | Campermate, WikiCamps | 🟠 High | S1 | ✅ Closed (B-05) |
| DOC / Council Data Sync (automated) | Campermate (official) | 🟠 High | S2 | ✅ Closed (B-12) |
| Camper Self-Registration | Campermate | 🟡 Medium | S3 | ✅ Closed (B-17) |
| Amenity Mapping (rich) | Campermate, WikiCamps | �� Medium | S3 | ✅ Closed (B-18) |

---

## Module: Noise Control

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Public Complaint Portal | The Noise App, Cirrus | 🟠 High | S2 | ✅ Closed (B-13) |
| Complainant Portal (self-serve status) | The Noise App | 🟠 High | S2 | ✅ Closed (B-13 status tab) |
| Evidence Bundles (structured) | The Noise App | 🟡 Medium | S1 | ✅ Closed (B-08 + B-23) |

---

## Module: Parking Enforcement

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Real-time Occupancy Tracking | T2, ParkMobile | 🟠 High | S2 | ✅ Closed (B-16 + B-25) |
| Enhanced Appeals Portal (self-serve) | T2 Systems | 🟡 Medium | S2 | ✅ Closed (B-15) |
| Pay-by-Plate Integration (NZ providers) | T2, PayByPhone | 🟡 Medium | S2 | ✅ Closed (B-29) |
| Occupancy Analytics Dashboard | T2, ParkMobile | 🟡 Medium | S2 | ✅ Closed (B-25) |
| Dynamic Pricing Engine | T2, ParkMobile | 🟢 Low | S4 | ✅ Closed (B-32) |
| Revenue Forecasting | T2, ParkMobile | 🟢 Low | S4 | ⬜ Open |

---

## Module: PTT / Voice

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| Real-time Translation (Māori, Mandarin, Hindi, Korean) | Azure Cognitive / Whisper | 🟠 High | S2 | ✅ Closed (B-28) |
| LMR / Radio Bridge | Zello Gateway, Motorola | 🟡 Medium | S3 | ⬜ Open |
| Voice AI Workflows (intent → action) | Custom enterprise solutions | 🟡 Medium | S3 | ✅ Closed (Bob PTT integration) |

---

## Module: Job Map & Navigation

| Gap | Competitor Benchmark | Impact | Sprint | Status |
|---|---|---|---|---|
| In-App ETA Calculation | Various CAD platforms | 🟡 Medium | S1 | ✅ Closed (B-07) |
| Turn-by-Turn Navigation (in-app) | Various | 🟡 Medium | S2 | ✅ Closed (B-31) |
| Route Optimisation | Various | 🟡 Medium | S2 | ⬜ Open |
| Traffic Overlay | Google Maps / HERE | 🟡 Medium | S2 | ⬜ Open |

---

## Confirmed FieldOps Strengths (Do Not Lose)

| Strength | vs Competitors |
|---|---|
| VOX Mode (hands-free PTT) | Unique in NZ market |
| Seizure Tracking | Deeper than TrackTik |
| Officer Context Brief | Richer than competitors |
| Offline Mode (mobile) | Parity with T2 Systems |
| ALPR + GPS Breadcrumbs | Integrated (not bolted-on) |
| Bob AI Assistant | No direct competitor equivalent |

---

## Sprint Rollup

| Sprint | Gap Count | Focus Theme |
|---|---|---|
| S1 | 7 | Safety + ALPR + offline map + ETA |
| S2 | 14 | Public portals + welfare wearables + occupancy |
| S3 | 7 | Video + integrations + multilingual |
| S4+ | 3 | Revenue / pricing / forecasting |
| Backlog | 2 | CAD-to-CAD, national DB |

---

## Evidence Basis

- Source: `docs/COMPETITIVE_ANALYSIS_2024.md` (March 2024, v1.0)
- Grounded routes: 121 from `tools/route-role-matrix/route-role-matrix.json`
- Commit: `8cc8c4f3`
- Next action: assign owners per module; re-run Dr Bob review before S1 kickoff

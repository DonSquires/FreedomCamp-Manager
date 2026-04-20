# Legal Basis Reference Card

> **Who is this for?** Officers, admin officers, and supervisors. This card documents the specific New Zealand legislation authorising each enforcement action in FreedomCamp Manager.
>
> **Disclaimer:** This reference is intended to help officers understand the legal context of each enforcement tool. It is a summary only. Always consult your organisation's legal team or your council's enforcement policy for authoritative interpretation.

---

## 1. Freedom Camping Enforcement

### 1.1 Freedom Camping Act 2011 (FCA)

**Offences and Infringement Notices — s.20**

Section 20 of the Freedom Camping Act 2011 creates infringement offences for freedom camping in breach of the Act or a bylaw made under it.

| Sub-section | Offence | Default Fine |
|---|---|---|
| s.20(1)(a) | Freedom camping in a prohibited area | NZD $200 |
| s.20(1)(b) | Freedom camping in a restricted area not in accordance with restrictions | NZD $200 |
| s.20(1)(c) | Failure to comply with a bylaw requirement | NZD $200 |
| s.20(2) | Obstructing or failing to comply with a direction | NZD $200 |

Fines are currently set at NZD $200 per offence per notice. Local authorities may by bylaw set a **higher** fine (up to the maximum in the Act). Always confirm the applicable amount in your organisation's configuration.

**Notices — General**

The FCA and associated bylaws may also authorise:
- **Notice to Vacate** — requiring the occupant to leave a site by a specified time.
- **Direction** — an officer's verbal or written direction to cease freedom camping.

Refer to your council's bylaw schedule for the exact wording and authority for Notices to Vacate in your jurisdiction.

**Self-contained Certification**

A vehicle is "self-contained" under the FCA if it holds a current **NZSCV warrant** (New Zealand Self-Contained Vehicle warrant) issued by a certified inspector. Officers can check the warrant status via the vehicle profile in the system (NZSCV data is integrated via the proxy service). An expired or absent warrant in a restricted-to-self-contained zone is a breach under s.20(1)(b).

---

### 1.2 Local Government Act 2002 (LGA) and Bylaws

Local authorities derive their enforcement powers under the **Local Government Act 2002** and the specific bylaws they have made under it.

**Notice to Vacate** is primarily authorised by:
- The council's **Camping or Freedom Camping Bylaw**, which typically empowers an enforcement officer to direct a person to vacate a site.
- LGA s.164 — delegation of authority to enforcement officers.

When issuing a Notice to Vacate, the **legal basis field** in the system should reference the specific bylaw section applicable in your council's area (e.g. "Waitaki District Council Freedom Camping Bylaw 2019 cl.7(2)"). Update this with your council's specific reference.

---

## 2. Noise Control Enforcement

All noise control enforcement in New Zealand is governed by the **Resource Management Act 1991 (RMA)** and the council's **district plan**.

### 2.1 RMA s.326 — Abatement Notice and Direction

**Section 326** authorises a local authority enforcement officer to issue an **Abatement Notice** requiring a person to:
- Cease or avoid certain noise, or
- Do something to reduce the noise.

Key points:
- The noise must be **unreasonable** having regard to the time of day, the nature of the noise, and the circumstances.
- The notice specifies a time by which the person must comply (default: **24 hours** in this system).
- Failure to comply with an Abatement Notice is an offence under the RMA.

**Direction** (verbal or written): An enforcement officer may direct a person to cease noise immediately. This is less formal than an AN but can be given in the field while preparing a written notice.

### 2.2 RMA s.327 — Enforcement Notice (END)

**Section 327** authorises a local authority enforcement officer to issue an **Enforcement Notice** requiring immediate or short-term compliance.

Key points:
- Used for **serious, persistent, or deliberate** noise breaches.
- The comply-by period in this system defaults to **72 hours** from issue.
- After an END is issued and the compliance window has passed, the officer **may seize equipment** that is producing the noise without a further court order, if the noise continues.
- Equipment seized must be stored securely, and the occupant must be given a receipt. A return procedure applies; consult your council's enforcement policy.
- A **Permanent Abatement Notice** or **Permanent END** — once recorded in the system — means any future breach at that address may proceed directly to seizure.

### 2.3 RMA s.325A — Excessive Noise Direction (END)

Some councils refer to the excessive noise enforcement power under **s.325A** of the RMA rather than s.327. The key distinction is:
- **s.325A** applies to "excessive noise" as defined in the district plan.
- **s.327** applies to Enforcement Notices generally.

Both sections may be cited in an Enforcement Notice depending on your council's practice. The `generate-noise-notice` edge function currently defaults to `Section 327 Resource Management Act 1991`. Amend the `rma_section` field in the notice form if your council uses a different reference.

---

## 3. Enforcement Officer Authorisation

**Warrant of Authority**

Officers must hold a current warrant of authority issued by the territorial authority to exercise enforcement powers under the FCA and RMA. The system tracks warrant expiry dates on each officer's profile.

- An expired warrant is flagged on the officer's record.
- Before issuing any formal notice (infringement, AN, DN, END), confirm your warrant is current.

**Delegation**

Delegations from the Chief Executive or Council to enforcement officers are managed under LGA s.130 and s.164. If you are unsure whether you have the authority to issue a particular notice type, consult your supervisor before acting.

---

## 4. Privacy and Evidence

**Privacy Act 2020**

Personal information collected during enforcement (name, address, vehicle details) must be collected lawfully, held securely, and used only for the enforcement purpose. The system's RLS policies enforce organisation-level data isolation. Officers must not share enforcement records outside their organisation without proper authority.

**Evidence Standards**

All enforcement actions are logged with the officer's identity, timestamp, and linked evidence (scan photos, breach records). For court proceedings:
- Export the full evidence package from the **Reports** page or the notice detail view.
- Include the ALPR scan photo, zone entry/exit observation history, and the notice PDF.
- The system's audit log (Admin → Audit Log) provides a tamper-evident record of all system actions.

---

## 5. Quick Reference: Which Act Applies?

| Enforcement Action | Legislation | System Page |
|---|---|---|
| Warning Notice | FCA 2011 s.20 (pre-infringement step) | Breach Alerts / Scan result |
| Infringement Notice | FCA 2011 s.20 | `/infringement-notices` |
| Notice to Vacate | Council Bylaw / LGA 2002 | `/notice-to-vacate` |
| Abatement Notice (AN) | RMA 1991 s.326 | `/noise-officer-portal` |
| Direction Notice (DN) | RMA 1991 s.326 | `/noise-officer-portal` |
| Enforcement Notice (END) | RMA 1991 s.327 | `/noise-officer-portal` |
| Equipment Seizure | RMA 1991 s.327 (after END window) | `/noise-officer-portal` → Seizure tab |

---

## 7. Cross-Organisation Safety Flags — Privacy Framework

> **Implemented in migration `20260424000002_global_safety_flags.sql`**

### 7.1 Stolen Vehicles — Global, No Redaction

**Legal basis: Privacy Act 2020 IPP 11(1)(e)** — disclosure necessary to avoid prejudice to the maintenance of the law, including the prevention, detection, investigation, prosecution, and punishment of offences.

Stolen vehicle status is already shared cross-agency by NZ Police and Waka Kotahi (NZTA) by convention. The `is_stolen` flag on `canonical_vehicles`, together with `stolen_reported_at` and `stolen_source`, is globally visible to all authenticated officers with no redaction requirement. Officers should not approach a stolen vehicle without Police support.

### 7.2 High-Risk Persons/Vehicles (Violence, Aggression, Weapon) — Global Flag, Details Redacted

**Legal basis: Privacy Act 2020 IPP 11(1)(c)** — disclosure necessary to prevent or lessen a serious and imminent threat to the life or health of an individual.

When a vehicle or person is assigned `risk_level = 'high'` or `'critical'` AND `risk_category IN ('violence', 'aggression', 'weapon')`, a safety warning travels globally across all organisations. This satisfies the officer safety justification under IPP 11(1)(c).

**Two-tier display:**

| Role | What is shown |
|---|---|
| `officer` | ⚠️ HIGH RISK — exercise caution. Do not approach alone. Contact supervisor. |
| `admin`, `admin_officer`, `master`, `grand_master` | Risk level, risk category, full flagged_reason/notes |

The underlying `flagged_reason`, `flagged_notes`, and `flagged_by` fields contain personal information and case details. Exposing these cross-organisation would exceed the IPP 11(1)(c) exception — only the safety signal (the flag itself) is necessary to protect officer safety. Details remain with the recording organisation.

### 7.3 Homeless Status — Org-Scoped, NOT Global

**Decision: Homeless status does NOT propagate globally.**

Homelessness and housing status is **sensitive personal information** under the Privacy Act 2020. It may reveal health status, welfare needs, and personal vulnerability. The IPP 11(c) serious-threat exception does not apply to routine freedom camping enforcement — it does not meet the "serious, likely, imminent" threshold. The IPP 11(e) law enforcement exception also does not apply because homelessness is not an offence.

`canonical_homeless` records and `homeless_records` remain accessible only within the recording organisation (org-scoped RLS). If a homeless individual is **also** assessed as high-risk (violence/aggression), the high-risk flag travels globally per §7.2 — but the homeless designation does not.

This position should be reviewed if:
- The organisation establishes an Approved Information Sharing Agreement (AISA) under Privacy Act 2020 Part 7 with other councils for a specific cross-agency purpose.
- Legal counsel confirms a specific statutory authority exists for inter-council sharing of housing/welfare status.

### 7.4 General Interest Flags (Low/Medium Risk) — Org-Scoped

General `is_flagged` flags with `risk_level IN ('low', 'medium')` or no `risk_category` are operational intelligence. They are not subject to an IPP exception for cross-org sharing and remain visible only within the organisation that created them.

---

*References:*
- [Privacy Act 2020 IPP 11](https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html#LMS23376) — Limits on disclosure of personal information
- [Office of the Privacy Commissioner — Serious Threat](https://privacy.org.nz/resources-2/guidance-resources/serious-threat-guideline/)
- [Approved Information Sharing Agreements](https://privacy.org.nz/privacy-act-2020/approved-information-sharing-agreements/)

---

## 6. Useful External References

- [Freedom Camping Act 2011](https://www.legislation.govt.nz/act/public/2011/0061/latest/DLM3175418.html) — New Zealand Parliamentary Counsel Office
- [Resource Management Act 1991 s.326](https://www.legislation.govt.nz/act/public/1991/0069/latest/DLM234371.html)
- [Resource Management Act 1991 s.327](https://www.legislation.govt.nz/act/public/1991/0069/latest/DLM234372.html)
- [Local Government Act 2002](https://www.legislation.govt.nz/act/public/2002/0084/latest/DLM170873.html)
- [Privacy Act 2020](https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html)

---

*Last updated: April 2026. Review this document whenever relevant legislation changes.*

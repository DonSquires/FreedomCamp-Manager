# Training App Competitor Matrix (2026-05-08)

## Purpose

Compare the training-platform patterns most relevant to FieldOps Manager's target state:
- reusable training libraries
- automated assignment before work starts
- competency and compliance evidence
- mobile-friendly delivery
- AI-assisted authoring or personalization

This is a product-positioning matrix, not a procurement-grade certification. It is grounded in:
- live public vendor page checks performed in this workspace on 2026-05-08
- the repo's existing external UX benchmark in `docs/uiux-master-redesign/external-pattern-matrix-2026.md`
- FieldOps' actual implementation goals in `docs/TRAINING_ECOSYSTEM_RESEARCH_AND_INTEGRATION_PLAN_2026-05-08.md`

## Evidence Quality

- `Emphasized`: clearly stated in current public vendor messaging or page metadata.
- `Directional`: commonly positioned by the vendor/category, but not fully verified in this pass.
- `FieldOps target`: capability we should explicitly support in-product.

## Vendor Signals Observed

### TalentLMS
- URL checked: `https://www.talentlms.com/features`
- Result quality: partial page text extraction; dynamic markup was noisy.
- Signal retained: positioned as a feature-rich LMS, included in the directional benchmark set for enterprise LMS comparison.

### Docebo
- URL checked: `https://www.docebo.com/learning-platform/`
- Public page metadata indicated: interactive learning courses and hyper-personalized experiences.

### Moodle Workplace
- URL checked: `https://moodle.com/solutions/workplace/`
- Result quality: blocked by Cloudflare/JS challenge during this pass.
- Signal retained: directional only for enterprise workplace learning, automation, and multi-tenant org use.

### 360Learning
- URL checked: `https://360learning.com/platform/`
- Result quality: partial page extraction due to heavy client rendering.
- Signal retained: directional only; platform is consistently positioned in the market around collaborative learning workflows.

### Cornerstone
- URL checked: `https://www.cornerstoneondemand.com/platform/learning/`
- Public page metadata indicated: automates compliance, accelerates workforce readiness, and supports self-directed training for enterprise organizations.

### Absorb LMS
- URL checked: `https://www.absorblms.com/learning-management-system/`
- Public page title confirmed LMS product positioning.
- Detailed capability verification was not completed in this pass.

## Capability Matrix

| Capability | TalentLMS | Docebo | Moodle Workplace | 360Learning | Cornerstone | Absorb LMS | FieldOps target |
|---|---|---|---|---|---|---|---|
| Reusable content library | Emphasized | Emphasized | Directional | Directional | Emphasized | Directional | Approved reusable modules with lineage |
| Automated assignment by role/audience | Emphasized | Emphasized | Directional | Directional | Emphasized | Directional | Auto-assign from roster, site, and skill gap |
| Learning paths and prerequisites | Emphasized | Emphasized | Directional | Directional | Emphasized | Directional | Pre-shift pathways and remediation loops |
| Assessments and completion tracking | Emphasized | Emphasized | Directional | Directional | Emphasized | Directional | Attempts, pass/fail, score, evidence |
| Compliance and workforce readiness framing | Directional | Directional | Directional | Directional | Emphasized | Directional | NZ legal/compliance-ready training evidence |
| Competency or certification state | Directional | Directional | Directional | Directional | Emphasized | Directional | Grant or renew `officer_skills` on pass |
| Mobile or microlearning delivery | Directional | Emphasized | Directional | Directional | Directional | Directional | Short targeted pre-shift learning packs |
| AI or personalization positioning | Directional | Emphasized | Not verified | Directional | Directional | Not verified | Bob composer, verifier, and tutor workflow |
| Multi-org or enterprise governance | Directional | Directional | Directional | Directional | Emphasized | Directional | Org-scoped RLS with legal approval gate |
| Reporting and manager visibility | Emphasized | Emphasized | Directional | Directional | Emphasized | Directional | Readiness, overdue, recompletion dashboards |

## What Other Training Apps Are Doing That Matters Most

1. They separate authoring from assignment. Training content is reusable, while assignment is contextual and user-specific.
2. They treat completion evidence as a first-class data model, not just a UI state.
3. They connect learning to readiness or compliance outcomes, not only course completion.
4. They support manager visibility into overdue, required, and expiring training.
5. They optimize for short, targeted learning journeys instead of only long course catalogs.

## Implications For FieldOps

FieldOps should not try to clone a generic LMS. The competitive advantage is operational coupling:

1. Training assigned from actual roster shifts, site induction needs, and required skills.
2. Bob-generated training grounded in NZ legal references and org-specific source material.
3. Immediate competency updates into `officer_skills` when an officer passes.
4. Pre-shift readiness dashboards instead of generic completion percentages only.
5. Targeted remediation loops when a trainee answers incorrectly, rather than just marking a failed quiz.

## Recommended Build Order

1. Lifecycle and legal approval gate for modules.
2. Attempts and completion evidence model.
3. Competency grant bridge into `officer_skills`.
4. Scheduled assignment automation and escalation.
5. Manager readiness and compliance dashboards.

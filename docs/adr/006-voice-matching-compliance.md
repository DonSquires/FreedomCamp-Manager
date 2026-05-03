# ADR 006: Legal and Compliance Position — Voice Matching and Synthetic Audio

## Status

Accepted

## Context

The PTT Radio platform will introduce:

1. **Live transcription** of officer radio transmissions.
2. **Translated audio relay** — officer speech synthesized as audio in another language.
3. **Consented voice-twin** (Phase 5) — translated audio rendered in the speaker's biometric voice profile.

These capabilities introduce obligations under:

- **NZ Privacy Act 2020** — biometric voice data is personal information. Collection, use, and offshore transfer require a lawful basis.
- **Employment agreements** — officers' voice recordings may be subject to employment terms. Enforcement use in disciplinary proceedings requires chain-of-custody integrity.
- **Human Rights Act 1993** — surveillance of individuals' speech patterns requires justification.
- **Contractual obligations** — Iron Eagle Security / OnSpace AI operates under client contracts that may restrict data processing scope.

## Decision

The following positions are adopted as binding constraints on all Phase 1–5 implementation work:

### 1. Transcript Data — Permitted with Controls

Live transcripts of radio transmissions are permitted under the NZ Privacy Act 2020 **legitimate interest** and **enforcement purpose** provisions, subject to:

- Transcripts are **org-scoped and RLS-enforced** — no cross-org access at any layer.
- Transcripts are **retained for the minimum period** required by client contracts (default: 90 days unless contract specifies otherwise).
- Transcripts are **never used for individual performance assessment** without explicit HR policy approval.
- Transcript access is **audited** via the `radio_transmissions` table.

### 2. Voice Data — Restricted

Raw audio recordings stored as replay artifacts are treated as biometric-adjacent personal information:

- **Recording is opt-in per channel**, not default. Channels without a `recording_enabled` flag do not fork audio.
- Recordings are **encrypted at rest** and **access-logged**.
- Emergency channel recordings are the exception — they are always recorded for operational safety and accountability.

### 3. Voice-Twin Enrollment — Explicit Consent Required

Phase 5 voice-twin synthesis is subject to:

- **Written informed consent** via the `radio_voice_consents` workflow before any voice sample is captured.
- Consent records must include: purpose, retention period, right to revoke, and the specific synthesis provider.
- **Revocation is immediate** — a revocation event in `radio_voice_consents` must block all future Tier 2 synthesis for that officer within 60 seconds of the event.
- **No offshore transfer of voice profiles** — Coqui XTTS (ADR 005) must run on NZ-data-resident infrastructure.
- Voice-twin synthesis is **never used for law enforcement evidence** without a separate formal chain-of-custody process.

### 4. Synthetic Audio Disclosure

Translated and synthesized audio must be:

- **Clearly marked as synthetic** in the receiver's UI (visual indicator).
- Tagged in the `radio_tts_renders` metadata with `is_synthetic: true` and the synthesis provider.
- **Never substituted silently** for original audio — receivers must be able to access original audio at any time.

### 5. Data Residency

All radio session data (transcripts, translations, TTS renders, voice profiles) must remain in the NZ Supabase region (`ap-southeast-2` or equivalent). Third-party synthesis providers (ElevenLabs, OpenAI TTS) are rejected for officer audio data — see ADR 005.

### 6. Risk Escalation Gate

Before Phase 5 (voice-twin) launches to any production tenant:

- Legal review by Iron Eagle Security / OnSpace AI's legal counsel or appointed privacy officer.
- Client contract amendment for tenants whose officers will be enrolled.
- Privacy impact assessment documented and approved.

## Consequences

- Phase 4 (neutral translated audio) can proceed without legal review — Piper TTS uses no biometric data.
- Phase 5 is **hard-blocked** until the risk escalation gate is completed for each tenant.
- The `radio_voice_consents` table and revocation flow must be implemented and tested before Phase 5 enrollment opens.
- Any future provider change for voice-twin synthesis requires this ADR to be revised and re-approved.
- The `inference-service/` must never log raw audio samples to a file system accessible outside the NZ-resident deployment.

## Verification

- `radio_voice_consents` table includes fields: `officer_id`, `consented_at`, `purpose`, `retention_days`, `revoked_at`, `provider`, `tenant_id`.
- Revocation integration test: revoke consent → attempt synthesis → receive rejection within 60s.
- Recording-disabled channel produces no audio artifacts in storage.
- RLS policy test confirms no cross-org transcript access at the DB level.

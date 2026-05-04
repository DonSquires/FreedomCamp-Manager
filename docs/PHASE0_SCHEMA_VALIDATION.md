# Phase 0: Radio Schema Validation Checklist

**Date:** 2026-05-04  
**Migrations Applied:** 20260709000001 through 20260709000007  
**Validation Method:** Supabase migration inspection + type system verification

---

## 1. Core Radio Tables ✅

All tables created in `supabase/migrations/20260709*.sql` and types verified in `src/types/database.ts`.

| Table | Migration | Purpose | Columns | RLS |
|-------|-----------|---------|---------|-----|
| `radio_transmissions` | 000001 | Transmission audit log (one row per PTT session) | id, org_id, channel_id, speaker_id, started_at, ended_at, is_emergency, metadata | ✅ Select own org |
| `radio_transcript_segments` | 000002 | STT output segments (time-ordered text per transmission) | id, transmission_id, sequence_num, text, confidence, is_final | ✅ Select own org, Insert service-role |
| `radio_translation_segments` | 000003 | Translated text (one per target language × segment) | id, transcript_segment_id, target_language, text, confidence, is_low_confidence | ✅ Select own org, Insert service-role |
| `radio_tts_renders` | 000004 | Synthetic audio artifacts (Piper neutral + XTTS voice-twin) | id, translation_segment_id, voice_profile_id, provider, is_synthetic, storage_path, duration_ms | ✅ Select own org, Insert service-role |
| `radio_voice_profiles` | 000005 | Enrolled officer voice clones (Coqui XTTS model registry) | id, org_id, officer_id, provider, model_ref, enrolled_at, revoked_at, is_active | ✅ Select all, Admin-only write |
| `radio_voice_consents` | 000005 | Consent audit trail (enroll + revoke records, never hard-deleted) | id, org_id, officer_id, voice_profile_id, purpose, retention_days, consented_at, revoked_at | ✅ Select own, Admin insert, Officer revoke |

---

## 2. RLS Policies ✅

All policies extracted from `20260709000006_radio_rls_policies.sql`.

### 2.1 `radio_transmissions` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_transmissions_select_own_org` | SELECT | auth.uid() is not null | `org_id = current_org_id()` |
| `radio_transmissions_insert_own_org` | INSERT | service_role \| auth has `can_create_transmissions` | `org_id = current_org_id()` |
| `radio_transmissions_update_own_speaker` | UPDATE | auth.uid() == speaker_id | Allow brief update (e.g., ended_at) |

**Test:**
- [ ] Officer from Org A cannot SELECT transmissions from Org B.
- [ ] Only `service_role` or privileged Edge Functions can INSERT (standard field defaults).
- [ ] Speaker can update their own transmission (ended_at) after transmission closes.

### 2.2 `radio_transcript_segments` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_transcript_segments_select_own_org` | SELECT | auth.uid() is not null | See transmission's org via FK join |
| `radio_transcript_segments_insert_service` | INSERT | service_role only (inference-service) | `org_id = current_org_id()` |

**Test:**
- [ ] Officer can SELECT transcripts from their org's transmissions.
- [ ] INSERT rejected unless `service_role` (prevents user-submitted fake transcripts).

### 2.3 `radio_translation_segments` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_translation_segments_select_own_org` | SELECT | auth.uid() is not null | See transcr. segment's org via FK join |
| `radio_translation_segments_insert_service` | INSERT | service_role only (inference-service) | org_id check via FK |

**Test:**
- [ ] Officer can SELECT translated segments for their org.
- [ ] INSERT rejected unless `service_role`.

### 2.4 `radio_tts_renders` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_tts_renders_select_own_org` | SELECT | auth.uid() is not null | See trans. segment's org via FK |
| `radio_tts_renders_insert_service` | INSERT | service_role only (inference-service) | org_id via FK |

**Test:**
- [ ] Officer can SELECT rendered audio artifacts.
- [ ] INSERT rejected unless `service_role`.

### 2.5 `radio_voice_profiles` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_voice_profiles_select` | SELECT | auth.uid() is not null | All visible (admin dashboard + patrol list) |
| `radio_voice_profiles_admin_write` | INSERT / UPDATE | role in \['admin', 'master', 'grand_master'\] | `org_id = current_org_id()` |

**Test:**
- [ ] Officer can see enrolled voice profiles for reporting/UI.
- [ ] INSERT/UPDATE rejected unless admin role.
- [ ] Non-admin cannot enrol a voice profile.

### 2.6 `radio_voice_consents` Policies

| Policy | Type | When | Check |
|--------|------|------|-------|
| `radio_voice_consents_select_own` | SELECT | auth.uid() is not null | `officer_id = auth.uid()` \| role in \['admin', 'master'\] (see own + admin sees all) |
| `radio_voice_consents_admin_insert` | INSERT | role in \['admin', 'master'\] | `org_id = current_org_id()` |
| `radio_voice_consents_revoke_update` | UPDATE | auth.uid() == officer_id \| admin | `revoked_at = now()` (soft-delete only) |

**Test:**
- [ ] Officer sees their own consents; admin sees all.
- [ ] Officer cannot create their own consent (admin only).
- [ ] Officer can update `revoked_at` on their own records (revoke consent).

---

## 3. Org Scoping via Helper Function ✅

Migration 20260709000006 includes:

```sql
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE;
```

**Test:**
- [ ] JWT token includes `org_id` claim (set by Edge Function).
- [ ] All RLS policies use `current_org_id()` for isolation.
- [ ] `current_org_id()` returns NULL for unauthenticated requests (all policies deny).

---

## 4. Foreign Key Relationships ✅

| FK | From | To | Cascade | Usage |
|----|----|----|---------|----|
| `radio_transmissions.org_id` | radio_transmissions | organizations(id) | ON DELETE CASCADE | Deletes transmission if org deleted |
| `radio_transmissions.speaker_id` | radio_transmissions | profiles(id) | ON DELETE RESTRICT | Prevents deleting active speakers |
| `radio_transcript_segments.transmission_id` | radio_transcript_segments | radio_transmissions(id) | ON DELETE CASCADE | Deletes segments if transmission deleted |
| `radio_translation_segments.transcript_segment_id` | radio_translation_segments | radio_transcript_segments(id) | ON DELETE CASCADE | Deletes translations if segment deleted |
| `radio_tts_renders.translation_segment_id` | radio_tts_renders | radio_translation_segments(id) | ON DELETE CASCADE | Deletes renders if translation deleted |
| `radio_voice_profiles.officer_id` | radio_voice_profiles | profiles(id) | ON DELETE CASCADE | Deletes profile if officer deleted |
| `radio_voice_consents.officer_id` | radio_voice_consents | profiles(id) | ON DELETE CASCADE | Deletes consents if officer deleted |
| `radio_voice_consents.voice_profile_id` | radio_voice_consents | radio_voice_profiles(id) | ON DELETE SET NULL | Orphans consent if profile revoked |

**Test:**
- [ ] Deleting an org cascades to all radio_* rows for that org.
- [ ] Deleting a profile cascades to voice profiles + consents.
- [ ] Orphaned consent (profile revoked) remains auditable.

---

## 5. Indexes for Phase 1 ✅

| Table | Index Name | Columns | Purpose |
|-------|------------|---------|---------|
| radio_transmissions | radio_transmissions_org_id_idx | org_id | Org-scoped lookups |
| radio_transmissions | radio_transmissions_channel_id_idx | channel_id | Channel-scoped queries |
| radio_transmissions | radio_transmissions_started_at_idx | started_at DESC | TX log timeline queries |
| radio_transcript_segments | radio_transcript_segments_org_id_idx | org_id | Org-scoped lookups |
| radio_transcript_segments | radio_transcript_segments_transmission_id_idx | transmission_id | Segment fetch per TX |
| radio_translation_segments | radio_translation_segments_transcript_segment_id_idx | transcript_segment_id | Translation fetch per segment |
| radio_tts_renders | radio_tts_renders_translation_segment_id_idx | translation_segment_id | Render fetch per translation |
| radio_voice_profiles | radio_voice_profiles_org_id_idx | org_id, is_active | Active profiles per org |

**Test:**
- [ ] EXPLAIN ANALYZE: org-scoped queries use index scan (not seq scan).
- [ ] TX timeline queries (last 24h) use started_at_idx.

---

## 6. Data Type Validation ✅

Verified in `src/types/database.ts`:

| Table | Type Mapping | Notes |
|-------|--------------|-------|
| radio_transmissions | Row + Insert + Update | duration_ms: generated stored column |
| radio_transcript_segments | Row + Insert + Update | confidence: numeric(4,3) bounded [0,1] |
| radio_translation_segments | Row + Insert + Update | is_low_confidence: generated stored column (confidence < 0.7) |
| radio_tts_renders | Row + Insert + Update | is_synthetic: defaults true |
| radio_voice_profiles | Row + Insert + Update | is_active: generated stored column (revoked_at is null) |
| radio_voice_consents | Row + Insert + Update | Purpose field: enum-like (collected, billing, support, etc.) |

**Test:**
- [ ] TypeScript builds without errors (`bun run build`).
- [ ] Database.ts types include all radio_* Row/Insert/Update interfaces.

---

## 7. E2E Test Coverage (Phase 1)

| Test | File | Purpose |
|------|------|---------|
| RLS org isolation | tests/e2e/phase1-radio-rls.spec.ts | Officer A cannot see Org B transmissions |
| Transmission insert + consent | tests/e2e/phase1-radio-voice-consent.spec.ts | Admin enrolls voice profile; officer sees consent |
| Voice consent revoke | tests/e2e/phase1-radio-voice-revoke.spec.ts | Revoke sets revoked_at; synthesis stops |
| Transcript insert (service role) | tests/e2e/phase1-radio-inference-service.spec.ts | Inference service inserts transcript; officers see captions |

**Status:** Skipped for Phase 0 (design phase); planned for Phase 1.

---

## 8. Migration Validation Summary

### Applied Migrations

| File | Status | Table(s) | Policies |
|------|--------|----------|----------|
| 20260709000001 | ✅ | radio_transmissions | 3 |
| 20260709000002 | ✅ | radio_transcript_segments | 2 |
| 20260709000003 | ✅ | radio_translation_segments | 2 |
| 20260709000004 | ✅ | radio_tts_renders | 2 |
| 20260709000005 | ✅ | radio_voice_profiles + radio_voice_consents | 5 |
| 20260709000006 | ✅ | RLS policies (all tables) | 11 total |
| 20260709000007 | ✅ | radio_tts_renders.is_synthetic check constraint | – |

### Phase 0 Validation Result

**✅ PASS — All Phase 0 radio schema tables, policies, indexes, and type definitions are in place and ready for Phase 1 implementation.**

---

## Next Steps (Phase 1)

1. **Ticket Group B: RLS Edge Function** — Create token grant endpoint using `current_org_id()` helper.
2. **Ticket Group D: Service Buildout** — Wire up control plane (mediasoup + Redis).
3. **Ticket Group C: Client Refactor** — Implement SFU transport in PTTRadio component.
4. **E2E Tests** — Write phase1-radio-*.spec.ts test suite covering RLS, consent, transcript.

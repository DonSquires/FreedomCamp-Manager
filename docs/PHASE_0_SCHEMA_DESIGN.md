# Phase 0 Schema Design & Feature Flag Map

**Date**: 2026-05-15  
**Status**: Proposed for Phase 0 entry gate review  
**Purpose**: Define data model and feature flags for radio platform rebuild (Phases 1–5)

---

## Schema Addition Summary

All new tables maintain org-level isolation via Row-Level Security (RLS) and `current_setting('request.jwt.claims.org_id')::uuid`.

### Core Radio Tables

#### `radio_transmissions` (Phase 1)
```sql
CREATE TABLE radio_transmissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  channel_id TEXT NOT NULL,
  room_id TEXT NOT NULL,  -- Livekit room ID
  speaker_id UUID NOT NULL REFERENCES auth.users(id),
  session_id UUID NOT NULL,  -- Livekit session ID
  started_at TIMESTAMP DEFAULT now(),
  ended_at TIMESTAMP,
  duration_seconds INT,
  participant_count INT DEFAULT 0,
  metadata JSONB,  -- Custom fields (e.g., zone_id, incident_ref)
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, channel_id, started_at)
);
```

#### `radio_floor_events` (Phase 1)
```sql
CREATE TABLE radio_floor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  channel_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  operator_id UUID,
  reason TEXT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, channel_id, created_at)
);
```

#### `radio_transcript_segments` (Phase 2)
```sql
CREATE TABLE radio_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  transmission_id UUID NOT NULL REFERENCES radio_transmissions(id),
  segment_index INT NOT NULL,
  transcript_text TEXT NOT NULL,
  confidence NUMERIC(3, 2),  -- 0.0–1.0
  speaker_name TEXT,
  language_code TEXT DEFAULT 'en-NZ',
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, transmission_id, started_at)
);
```

#### `radio_translation_segments` (Phase 3)
```sql
CREATE TABLE radio_translation_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  transcript_segment_id UUID NOT NULL REFERENCES radio_transcript_segments(id),
  target_language_code TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  confidence NUMERIC(3, 2),
  provider TEXT,  -- 'google', 'azure', 'deepl', etc.
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, target_language_code, created_at)
);
```

#### `radio_tts_renders` (Phase 4)
```sql
CREATE TABLE radio_tts_renders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  transmission_id UUID NOT NULL REFERENCES radio_transmissions(id),
  translation_segment_id UUID REFERENCES radio_translation_segments(id),
  target_language_code TEXT NOT NULL,
  voice_profile_id UUID REFERENCES radio_voice_profiles(id),
  is_synthetic BOOLEAN DEFAULT TRUE,
  provider TEXT,
  audio_url TEXT,  -- S3 or CDN link
  duration_seconds INT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, transmission_id, created_at)
);
```

#### `radio_voice_profiles` (Phase 5)
```sql
CREATE TABLE radio_voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider TEXT NOT NULL,
  provider_voice_id TEXT,
  enrollment_date TIMESTAMP DEFAULT now(),
  is_revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP,
  revoked_by UUID,
  consent_text TEXT NOT NULL,
  consent_accepted_at TIMESTAMP NOT NULL,
  consent_version TEXT NOT NULL,
  UNIQUE (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (revoked_by) REFERENCES auth.users(id)
);
```

#### `radio_voice_twin_events` (Phase 5)
```sql
CREATE TABLE radio_voice_twin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  channel_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  speaker_id UUID NOT NULL,
  provider TEXT NOT NULL,
  voice_profile_id UUID REFERENCES radio_voice_profiles(id),
  transmission_segment_id UUID REFERENCES radio_transcript_segments(id),
  is_emergency_bypass BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, user_id, created_at)
);
```

#### Supporting Tables

**`radio_floor_events`** (already listed above)

**`user_radio_preferences`** (Phase 5)
```sql
CREATE TABLE user_radio_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  voice_twin_enabled BOOLEAN DEFAULT FALSE,
  caption_enabled BOOLEAN DEFAULT TRUE,
  translation_language_code TEXT,  -- User's preferred translation language
  audio_playback_mode TEXT DEFAULT 'original',  -- 'original', 'translated', 'both'
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

**`organization_radio_settings`** (Phases 1–5)
```sql
CREATE TABLE organization_radio_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  emergency_override_enabled BOOLEAN DEFAULT TRUE,
  voice_twin_disabled BOOLEAN DEFAULT FALSE,
  transcript_retention_days INT DEFAULT 90,
  audit_logging_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

---

## Feature Flags

All feature flags follow the pattern `FF_PHASE_0_*` and are defined in `src/stores/globalFiltersStore.ts` or via Supabase RLS.

### Phase 1: Core SFU + Floor Control

| Flag | Default | Purpose |
|------|---------|---------|
| `FF_PHASE_0_SFU_ENABLED` | FALSE | Enable Livekit SFU connection |
| `FF_PHASE_0_FLOOR_CONTROL` | FALSE | Enable floor acquire/release functions |
| `FF_PHASE_0_EMERGENCY_OVERRIDE` | FALSE | Enable supervisor override path |
| `FF_PHASE_0_RECONNECT_HANDLING` | FALSE | Enable offline-to-online replay |

**Canary progression**: 5% → 25% → 50% → 100% (aligned with Phase B strategy)

### Phase 2: Streaming STT + Captions

| Flag | Default | Purpose |
|------|---------|---------|
| `FF_PHASE_0_TRANSCRIPT_INGESTION` | FALSE | Enable streaming STT via media tap |
| `FF_PHASE_0_LIVE_CAPTIONS` | FALSE | Display live captions in UI |
| `FF_PHASE_0_CAPTION_LATENCY_THRESHOLD_MS` | 2000 | Hide captions if latency exceeds (ms) |

### Phase 3: Translation Layer

| Flag | Default | Purpose |
|------|---------|---------|
| `FF_PHASE_0_TRANSLATION_ENABLED` | FALSE | Enable multi-language translation |
| `FF_PHASE_0_TRANSLATION_CONFIDENCE_THRESHOLD` | 0.80 | Hide low-confidence translations |
| `FF_PHASE_0_DUAL_CAPTION_LANES` | FALSE | Show original + translated side-by-side |

### Phase 4: Translated Audio Relay

| Flag | Default | Purpose |
|------|---------|---------|
| `FF_PHASE_0_TTS_RELAY_ENABLED` | FALSE | Enable translated audio synthesis |
| `FF_PHASE_0_TTS_FALLBACK_TO_ORIGINAL` | TRUE | Use original audio if TTS unavailable |
| `FF_PHASE_0_TTS_PRIORITY_USERS` | [] | Users who get translated audio first (empty = all) |

### Phase 5: Voice-Twin Enrollment

| Flag | Default | Purpose |
|------|---------|---------|
| `FF_PHASE_0_VOICE_TWIN_ENROLLMENT` | FALSE | Enable enrollment UI and consent flow |
| `FF_PHASE_0_VOICE_TWIN_SYNTHESIS` | FALSE | Enable voice-twin relay in playback |
| `FF_PHASE_0_VOICE_TWIN_AUDIT_DASHBOARD` | FALSE | Show voice-twin audit reports |

---

## Rollout Strategy

### Phase 1 Canary (Week 1–2)

- Deploy Livekit SFU integration to `staging` environment
- Enable `FF_PHASE_0_SFU_ENABLED` for 5% of orgs (Iron Eagle + 1 customer)
- Monitor: latency, disconnects, org isolation violations
- Gate: **All orgs must report < 2% audio drops for > 1 week before 25% rollout**

### Phase 2 Canary (Week 3–4)

- If Phase 1 gate passes:
  - Enable `FF_PHASE_0_TRANSCRIPT_INGESTION` for same 5% cohort
  - Monitor: STT accuracy, latency, caption sync
  - Gate: **Captions must arrive < 1000ms after speech ends for > 5 days**

### Phase 3–5 Progression

- Similar canary progression; each phase gates on prior phase's metrics
- If any metric regresses, rollback to previous flag percentage
- Final deployment when all 5 phases reach 100% and audit pass complete

---

## Migration Path from PTT

1. **Phase 1 gate passes** → PTT remains active alongside SFU
2. **Phase 4 gate passes** → Encourage new users to onboard to radio; PTT deprecated (still available)
3. **Compliance gate passes** → Retire PTT infrastructure; radio is mandatory
4. **Archive phase** → PTT recordings moved to cold storage; radio logs retained per policy

---

## Backlog (Post-Phase 5)

- **Phase 6**: Multi-channel radio banks (manage 5+ channels simultaneously)
- **Phase 7**: Custom radio profiles (user-defined channel presets)
- **Phase 8**: Integration with external radio networks (P25, DMR)
- **Phase 9**: AI floor arbitration (Bob-driven priority management)

---

**Approval**: Pending Phase 0 entry gate. All phases subject to Dr Bob audit before implementation.

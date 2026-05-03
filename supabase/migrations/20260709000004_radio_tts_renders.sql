-- Migration: radio_tts_renders
-- Phase 1 Group A — Radio Core schema
-- Synthetic-audio render artifacts for translated audio relay (Phase 4).
-- is_synthetic is always true; used for UI disclosure and audit.

create table if not exists radio_tts_renders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  translation_segment_id uuid not null references radio_translation_segments(id) on delete cascade,
  target_language       text not null,
  voice_profile_id      uuid,  -- null for neutral dispatch voice (Piper TTS)
  provider              text not null,  -- 'piper' | 'coqui-xtts'
  is_synthetic          boolean not null default true,
  storage_path          text,  -- Supabase Storage path for the audio artifact
  duration_ms           integer,
  render_latency_ms     integer,
  created_at            timestamptz not null default now()
);

create index if not exists radio_tts_renders_org_id_idx           on radio_tts_renders (org_id);
create index if not exists radio_tts_renders_translation_id_idx   on radio_tts_renders (translation_segment_id);

comment on table radio_tts_renders is
  'TTS render artifacts for translated audio. is_synthetic always true. Org-scoped. Receiver UI must display synthetic indicator.';

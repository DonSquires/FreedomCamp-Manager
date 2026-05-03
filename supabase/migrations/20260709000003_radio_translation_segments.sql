-- Migration: radio_translation_segments
-- Phase 1 Group A — Radio Core schema
-- Translated transcript segments linked to a transcript segment and target language.
-- Populated by the AI speech plane translation path (Phase 3).

create table if not exists radio_translation_segments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  transcript_segment_id uuid not null references radio_transcript_segments(id) on delete cascade,
  target_language       text not null,
  text                  text not null,
  confidence            numeric(4,3) check (confidence between 0 and 1),
  is_low_confidence     boolean not null generated always as (confidence < 0.7) stored,
  provider              text,
  created_at            timestamptz not null default now(),
  unique (transcript_segment_id, target_language)
);

create index if not exists radio_translation_segments_org_id_idx    on radio_translation_segments (org_id);
create index if not exists radio_translation_segments_segment_id_idx on radio_translation_segments (transcript_segment_id);

comment on table radio_translation_segments is
  'Translated captions per transcript segment. is_low_confidence drives UI flag. Org-scoped.';

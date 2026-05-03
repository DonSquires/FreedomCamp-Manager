-- Migration: radio_transcript_segments
-- Phase 1 Group A — Radio Core schema
-- Time-ordered transcript segments linked to a radio_transmission.
-- Populated by the AI speech plane (inference-service STT path).

create table if not exists radio_transcript_segments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  transmission_id   uuid not null references radio_transmissions(id) on delete cascade,
  sequence_num      integer not null,
  segment_start_ms  integer not null,  -- offset from transmission started_at
  segment_end_ms    integer not null,
  text              text not null,
  language          text not null default 'en',
  confidence        numeric(4,3) check (confidence between 0 and 1),
  is_final          boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (transmission_id, sequence_num)
);

create index if not exists radio_transcript_segments_org_id_idx         on radio_transcript_segments (org_id);
create index if not exists radio_transcript_segments_transmission_id_idx on radio_transcript_segments (transmission_id);
create index if not exists radio_transcript_segments_created_at_idx     on radio_transcript_segments (created_at desc);

comment on table radio_transcript_segments is
  'Streaming STT transcript segments for a radio transmission. Org-scoped. Low-confidence segments must be visibly flagged in the UI.';

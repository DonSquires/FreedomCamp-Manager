-- Migration: add external-source columns to zones table (B-12)
--
-- Adds columns required to track which zones originated from the DOC API
-- or council feeds, and creates the unique constraint used by the
-- doc-council-sync edge function upsert.

alter table public.zones
  add column if not exists zone_type           text,
  add column if not exists external_id         text,
  add column if not exists external_source     text,
  add column if not exists bylaw_reference     text,
  add column if not exists bylaw_clause        text,
  add column if not exists bylaw_source_url    text,
  add column if not exists land_manager        text,
  add column if not exists land_managing_agency text,
  add column if not exists seasonal_open_month  integer check (seasonal_open_month between 1 and 12),
  add column if not exists seasonal_close_month integer check (seasonal_close_month between 1 and 12),
  add column if not exists zone_features       text[];

-- Unique constraint needed for the ON CONFLICT upsert in doc-council-sync
create unique index if not exists uq_zones_external_id_source
  on public.zones (external_id, external_source)
  where external_id is not null and external_source is not null;

comment on column public.zones.zone_type is
  'e.g. freedom_camp, freedom_camping, camping, restricted_area';
comment on column public.zones.external_id is
  'Zone identifier in the external DOC or council system.';
comment on column public.zones.external_source is
  'Source system: doc_api | council_feed | manual';

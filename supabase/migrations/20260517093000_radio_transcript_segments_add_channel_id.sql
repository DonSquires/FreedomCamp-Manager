-- Migration: add channel_id to radio_transcript_segments for staging/runtime compatibility
-- Aligns transcript segment schema with edge function/runtime contract checks.

alter table if exists public.radio_transcript_segments
  add column if not exists channel_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'radio_transcript_segments'
  ) then
    update public.radio_transcript_segments rts
    set channel_id = rt.channel_id
    from public.radio_transmissions rt
    where rts.transmission_id = rt.id
      and (rts.channel_id is null or btrim(rts.channel_id) = '');
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'radio_transcript_segments'
  ) then
    create index if not exists radio_transcript_segments_channel_id_idx
      on public.radio_transcript_segments (channel_id);
  end if;
end;
$$;

-- Migration: radio_* RLS policies
-- Phase 1 Group A — Radio Core RLS
-- Org-scoped tenant isolation for all radio tables per ADR 006.
-- Pattern: officers read/write own-org rows; admins read own-org rows; no cross-org access.

-- ============================================================
-- radio_transmissions
-- ============================================================
alter table public.radio_transmissions enable row level security;

create policy "radio_transmissions_select_own_org"
  on public.radio_transmissions for select
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_transmissions.org_id
    )
  );

create policy "radio_transmissions_insert_own_org"
  on public.radio_transmissions for insert
  with check (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_transmissions.org_id
    )
  );

create policy "radio_transmissions_update_own_speaker"
  on public.radio_transmissions for update
  using (
    speaker_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_transmissions.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- ============================================================
-- radio_transcript_segments
-- ============================================================
alter table public.radio_transcript_segments enable row level security;

create policy "radio_transcript_segments_select_own_org"
  on public.radio_transcript_segments for select
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_transcript_segments.org_id
    )
  );

create policy "radio_transcript_segments_insert_service"
  on public.radio_transcript_segments for insert
  with check (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_transcript_segments.org_id
    )
  );

-- ============================================================
-- radio_translation_segments
-- ============================================================
alter table public.radio_translation_segments enable row level security;

create policy "radio_translation_segments_select_own_org"
  on public.radio_translation_segments for select
  using (
    exists (
      select 1 from public.radio_transcript_segments rts
      join public.user_profiles up on up.organization_id = rts.org_id
      where rts.id = radio_translation_segments.transcript_segment_id
        and up.id = auth.uid()
    )
  );

create policy "radio_translation_segments_insert_service"
  on public.radio_translation_segments for insert
  with check (
    exists (
      select 1 from public.radio_transcript_segments rts
      join public.user_profiles up on up.organization_id = rts.org_id
      where rts.id = radio_translation_segments.transcript_segment_id
        and up.id = auth.uid()
    )
  );

-- ============================================================
-- radio_tts_renders
-- ============================================================
alter table public.radio_tts_renders enable row level security;

create policy "radio_tts_renders_select_own_org"
  on public.radio_tts_renders for select
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_tts_renders.org_id
    )
  );

create policy "radio_tts_renders_insert_service"
  on public.radio_tts_renders for insert
  with check (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_tts_renders.org_id
    )
  );

-- ============================================================
-- radio_voice_profiles
-- ============================================================
alter table public.radio_voice_profiles enable row level security;

-- Officers can only read their own profile; admins read all in org
create policy "radio_voice_profiles_select"
  on public.radio_voice_profiles for select
  using (
    officer_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_voice_profiles.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- Only admins can insert/update voice profiles (enrollment is admin-initiated after consent)
create policy "radio_voice_profiles_admin_write"
  on public.radio_voice_profiles for all
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_voice_profiles.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- ============================================================
-- radio_voice_consents
-- ============================================================
alter table public.radio_voice_consents enable row level security;

-- Officers can read their own consent records
create policy "radio_voice_consents_select_own"
  on public.radio_voice_consents for select
  using (
    officer_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_voice_consents.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- Admins insert consent on behalf of consenting officer
create policy "radio_voice_consents_admin_insert"
  on public.radio_voice_consents for insert
  with check (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_voice_consents.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- Officers can revoke their own consent; admins can revoke any in org
create policy "radio_voice_consents_revoke_update"
  on public.radio_voice_consents for update
  using (
    officer_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_voice_consents.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

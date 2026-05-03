-- Migration: radio_tts_renders_synthetic_check
-- Phase 1 Group E — Trust and Operations
--
-- Adds a database-level CHECK constraint to enforce that every TTS render row
-- is always marked synthetic and has a non-empty provider.
--
-- This pairs with the application-layer is_synthetic flag and the UI disclosure
-- requirement (ADR 004 / ADR 005). The schema already has DEFAULT TRUE; this
-- constraint makes the invariant unbreakable at the storage layer.

alter table radio_tts_renders
  add constraint radio_tts_renders_is_synthetic_enforced
  check (is_synthetic = true);

alter table radio_tts_renders
  add constraint radio_tts_renders_provider_nonempty
  check (provider is not null and trim(provider) <> '');

comment on constraint radio_tts_renders_is_synthetic_enforced on radio_tts_renders is
  'Every TTS render artifact must declare itself synthetic. Supports ADR 005 voice-twin disclosure requirement.';

comment on constraint radio_tts_renders_provider_nonempty on radio_tts_renders is
  'TTS provider must always be identified for audit purposes (piper, coqui-xtts, etc).';

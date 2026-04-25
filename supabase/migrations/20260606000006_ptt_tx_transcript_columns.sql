-- PTT transmission log enrichment for Phase 2:
-- adds clip URL and transcript persistence fields.

ALTER TABLE IF EXISTS public.ptt_transmission_log
  ADD COLUMN IF NOT EXISTS clip_url text,
  ADD COLUMN IF NOT EXISTS transcript text;

CREATE INDEX IF NOT EXISTS idx_ptt_tx_log_created_with_clip
  ON public.ptt_transmission_log (organization_id, created_at DESC)
  WHERE clip_url IS NOT NULL;

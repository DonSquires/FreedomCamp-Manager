-- ============================================================================
-- Add attachments JSONB column to enforcement_actions
-- Enables storing evidence photos and documents alongside enforcement records.
-- Each element: { url: string, type: string, uploaded_at: string }
-- ============================================================================

ALTER TABLE enforcement_actions
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN enforcement_actions.attachments IS
  'Array of attachment objects { url, type, uploaded_at } for evidence photos and documents.';

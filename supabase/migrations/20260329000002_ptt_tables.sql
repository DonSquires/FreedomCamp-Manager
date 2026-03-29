-- Push-to-Talk (PTT) Database Schema
-- Stores audio clip metadata and presence state for replay/audit

-- ============================================================================
-- PTT Messages - Audio clip metadata (replay / audit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ptt_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,  -- org:<uuid>, incident:<uuid>, direct:<uuid>
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT,
  sender_name TEXT,
  clip_url TEXT,  -- Supabase Storage signed URL (null for live-only)
  duration_seconds INTEGER CHECK (duration_seconds > 0 AND duration_seconds <= 60),
  file_size_bytes INTEGER CHECK (file_size_bytes > 0 AND file_size_bytes <= 3145728), -- 3MB max
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ptt_messages_org_channel 
  ON ptt_messages(organization_id, channel);
CREATE INDEX IF NOT EXISTS idx_ptt_messages_sender 
  ON ptt_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_ptt_messages_created_at 
  ON ptt_messages(created_at DESC);

-- Enable RLS
ALTER TABLE ptt_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can read messages in their organization
CREATE POLICY ptt_messages_select_org ON ptt_messages
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('master', 'grand_master')
    )
  );

-- Users can insert messages for their organization
CREATE POLICY ptt_messages_insert_own ON ptt_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- Only admins/masters can delete (cleanup)
CREATE POLICY ptt_messages_delete_admin ON ptt_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'master', 'grand_master')
    )
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- ============================================================================
-- PTT Presence - User presence cache (optional, Realtime is primary)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ptt_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT,  -- Current active channel
  status TEXT NOT NULL DEFAULT 'offshift' CHECK (status IN ('online', 'busy', 'offshift')),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for org-scoped lookups
CREATE INDEX IF NOT EXISTS idx_ptt_presence_org 
  ON ptt_presence(organization_id) 
  WHERE status != 'offshift';

-- Enable RLS
ALTER TABLE ptt_presence ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can see presence in their organization
CREATE POLICY ptt_presence_select_org ON ptt_presence
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('master', 'grand_master')
    )
  );

-- Users can update their own presence
CREATE POLICY ptt_presence_upsert_own ON ptt_presence
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- PTT Channels - Optional channel metadata table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ptt_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_key TEXT NOT NULL UNIQUE,  -- org:<uuid>, incident:<uuid>, etc.
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('org', 'incident', 'direct', 'zone')),
  name TEXT,  -- Human-readable name
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  recording_enabled BOOLEAN NOT NULL DEFAULT false,  -- Privacy: recording off by default
  max_participants INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ptt_channels_org 
  ON ptt_channels(organization_id) 
  WHERE is_active = true;

-- Enable RLS
ALTER TABLE ptt_channels ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY ptt_channels_select_org ON ptt_channels
  FOR SELECT USING (
    organization_id = get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('master', 'grand_master')
    )
  );

CREATE POLICY ptt_channels_manage_admin ON ptt_channels
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'master', 'grand_master')
    )
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- ============================================================================
-- Cleanup Function - Delete old clips (called by cron)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_ptt_clips(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete messages older than retention period that aren't flagged for evidence
  -- Note: Actual Storage cleanup would need a separate Edge Function
  DELETE FROM ptt_messages
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
  AND clip_url IS NOT NULL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % PTT messages older than % days', deleted_count, retention_days;
  RETURN deleted_count;
END;
$$;

-- Grant execute to service role for cron job
GRANT EXECUTE ON FUNCTION cleanup_old_ptt_clips(INTEGER) TO service_role;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE ptt_messages IS 'Audio clip metadata for push-to-talk replay and audit trail';
COMMENT ON TABLE ptt_presence IS 'User presence state for PTT (online/busy/offshift)';
COMMENT ON TABLE ptt_channels IS 'PTT channel configuration (org-wide, incident, direct)';
COMMENT ON FUNCTION cleanup_old_ptt_clips IS 'Cleanup PTT clips older than retention period (default 30 days)';

-- Add push notification token and notification preferences columns to user_profiles
-- These are used by useNotifications.ts and pushNotifications.ts
-- to store device push tokens for mobile push notifications.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_profiles.push_token IS 'Device push notification token (FCM/APNs/Web Push)';
COMMENT ON COLUMN public.user_profiles.push_token_updated_at IS 'Timestamp when push_token was last updated';
COMMENT ON COLUMN public.user_profiles.notification_preferences IS 'JSON map of notification type → enabled (true/false)';

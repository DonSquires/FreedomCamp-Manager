/**
 * send-push-notification - Reusable Expo Push Notification Service
 * 
 * Sends push notifications to mobile app users via Expo Push Notification API
 * Supports automatic notification for breaches, investigations, flagged vehicles, etc.
 * 
 * USAGE:
 * - Called by database triggers (breach_alerts, investigation_jobs)
 * - Invoked by Edge Functions (scan-breaches, create-investigation)
 * - Manual invocation from admin portal
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

interface PushNotificationPayload {
  user_id: string;                    // Target user UUID
  title: string;                      // Notification title (max 50 chars)
  body: string;                       // Notification body (max 200 chars)
  data?: Record<string, any>;         // Additional data for app routing
  priority?: 'default' | 'high';      // Notification priority
  sound?: 'default' | null;           // Notification sound
  badge?: number;                     // App badge count
  category_id?: string;               // iOS category for actions
}

interface ExpoMessage {
  to: string;           // Expo push token
  title: string;
  body: string;
  data?: any;
  priority?: 'default' | 'high';
  sound?: 'default' | null;
  badge?: number;
  categoryId?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📲 Push notification request received');

    // Authenticate request (allow both user auth and service role)
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify caller (either authenticated user or service role)
    let callerUserId: string | null = null;
    
    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (!authError && user) {
        callerUserId = user.id;
        console.log('✅ Authenticated request from user:', user.id);
      } else {
        console.log('⚙️ Service role request (no user auth)');
      }
    }

    // Parse request body
    const payload: PushNotificationPayload = await req.json();

    if (!payload.user_id || !payload.title || !payload.body) {
      console.error('Missing required fields:', { 
        has_user_id: !!payload.user_id,
        has_title: !!payload.title,
        has_body: !!payload.body
      });
      return new Response(
        JSON.stringify({ error: 'Missing user_id, title, or body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📤 Sending notification to user ${payload.user_id}: "${payload.title}"`);

    // Get user's push token and notification preferences
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('push_token, notification_preferences, first_name, last_name')
      .eq('id', payload.user_id)
      .single();

    if (profileError) {
      console.error('Failed to fetch user profile:', profileError);
      return new Response(
        JSON.stringify({ error: 'User not found', details: profileError.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.push_token) {
      console.warn('User has no push token registered');
      return new Response(
        JSON.stringify({ 
          success: false, 
          reason: 'no_push_token',
          message: 'User has not enabled push notifications'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check notification preferences (if provided)
    const prefs = profile.notification_preferences || {};
    const notifType = payload.data?.notification_type;
    
    if (notifType && prefs[notifType] === false) {
      console.warn(`User has disabled ${notifType} notifications`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          reason: 'disabled_by_user',
          message: `User has disabled ${notifType} notifications`
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate Expo push token format
    if (!profile.push_token.startsWith('ExponentPushToken[') && 
        !profile.push_token.startsWith('ExpoPushToken[')) {
      console.error('Invalid Expo push token format:', profile.push_token);
      return new Response(
        JSON.stringify({ 
          success: false, 
          reason: 'invalid_token',
          message: 'Invalid Expo push token format'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build Expo push message
    const message: ExpoMessage = {
      to: profile.push_token,
      title: payload.title.substring(0, 50), // Truncate to 50 chars
      body: payload.body.substring(0, 200),  // Truncate to 200 chars
      data: payload.data || {},
      priority: payload.priority || 'high',
      sound: payload.sound === null ? null : 'default',
      badge: payload.badge,
    };

    if (payload.category_id) {
      message.categoryId = payload.category_id;
    }

    console.log('📨 Sending to Expo Push API:', JSON.stringify(message, null, 2));

    // Send to Expo Push API
    const response = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const responseData = await response.json();
    console.log('📬 Expo API response:', JSON.stringify(responseData, null, 2));

    if (!response.ok) {
      console.error('Expo Push API error:', responseData);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send push notification',
          expo_error: responseData
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for Expo-specific errors
    const data = responseData.data?.[0];
    
    if (data?.status === 'error') {
      console.error('Expo returned error:', data);
      
      // If token is invalid, clear it from database
      if (data.details?.error === 'DeviceNotRegistered') {
        console.warn('Push token no longer valid - clearing from database');
        await supabase
          .from('user_profiles')
          .update({ push_token: null, push_token_updated_at: null })
          .eq('id', payload.user_id);
      }
      
      return new Response(
        JSON.stringify({ 
          success: false,
          reason: 'expo_error',
          expo_error: data.details
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Push notification sent successfully to ${profile.first_name} ${profile.last_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        ticket_id: data?.id,
        user_name: `${profile.first_name} ${profile.last_name}`,
        notification_type: notifType,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Push notification error:', error);
    return new Response(
      JSON.stringify({
        error: 'Push notification failed',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

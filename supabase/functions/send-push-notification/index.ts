/**
 * send-push-notification - Unified Push Notification Service
 *
 * Routes to:
 *   • VAPID Web Push  — when push_subscription (jsonb) is present on user_profiles
 *   • Expo Push API   — when push_token starts with ExponentPushToken[ / ExpoPushToken[
 *
 * REQUIRED SUPABASE SECRETS (for web push):
 *   VAPID_PUBLIC_KEY   — base64url uncompressed P-256 point
 *   VAPID_PRIVATE_KEY  — base64url raw P-256 scalar
 *   VAPID_SUBJECT      — mailto: contact URI
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

// ─── Shared web-push helpers (mirror of send-welfare-reminders) ───────────────

function base64urlDecode(str: string): Uint8Array {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const b64 = btoa(String.fromCharCode(...arr));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function buildVapidAuthHeader(
  endpoint: string,
  vapidPublicKeyB64u: string,
  vapidPrivateKeyB64u: string,
  subject: string
): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600;
  const enc = new TextEncoder();
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp, sub: subject };
  const headerB64  = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pubKeyBytes = base64urlDecode(vapidPublicKeyB64u);
  const privKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      d: vapidPrivateKeyB64u,
      x: base64urlEncode(pubKeyBytes.slice(1, 33)),
      y: base64urlEncode(pubKeyBytes.slice(33, 65)),
      key_ops: ['sign'],
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    enc.encode(signingInput)
  );
  return `vapid t=${signingInput}.${base64urlEncode(sig)}, k=${vapidPublicKeyB64u}`;
}

async function encryptWebPushPayload(
  keys: { p256dh: string; auth: string },
  plaintext: string
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(plaintext);

  const senderKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );
  const senderPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeys.publicKey));
  const receiverPublicKey = await crypto.subtle.importKey(
    'raw', base64urlDecode(keys.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey }, senderKeys.privateKey, 256
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const authBytes = base64urlDecode(keys.auth);

  const hkdf = async (ikm: Uint8Array, saltH: Uint8Array, info: Uint8Array, len: number) => {
    const km = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: saltH, info }, km, len * 8
    ));
  };
  const concat = (...b: Uint8Array[]) => {
    const out = new Uint8Array(b.reduce((n, x) => n + x.length, 0));
    let o = 0; for (const x of b) { out.set(x, o); o += x.length; }
    return out;
  };

  const receiverPublicRaw = base64urlDecode(keys.p256dh);
  const prk  = await hkdf(new Uint8Array(sharedBits), authBytes,
    concat(enc.encode('WebPush: info\0'), receiverPublicRaw, senderPublicRaw), 32);
  const cek   = await hkdf(prk, salt, enc.encode('Content-Encoding: aes128gcm\0'),  16);
  const nonce = await hkdf(prk, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  const padded = new Uint8Array(2 + plaintextBytes.length + 1);
  padded.set(plaintextBytes, 2);
  padded[padded.length - 1] = 0x02;

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded);

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const rs = 4096;
  header[16] = (rs >>> 24) & 0xff; header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8)  & 0xff; header[19] = rs          & 0xff;
  header[20] = 65; header.set(senderPublicRaw, 21);
  return concat(header, new Uint8Array(ct));
}

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject: string
): Promise<Response> {
  const json = JSON.stringify(payload);
  const ciphertext = await encryptWebPushPayload(subscription.keys, json);
  const auth = await buildVapidAuthHeader(subscription.endpoint, vapidPublicKey, vapidPrivateKey, subject);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    auth,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length':   String(ciphertext.length),
      'TTL':              '86400',
      'Urgency':          'high',
    },
    body: ciphertext,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

interface PushPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'default' | 'high';
  sound?: 'default' | null;
  badge?: number;
  category_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: PushPayload = await req.json();
    if (!payload.user_id || !payload.title || !payload.body) {
      return new Response(
        JSON.stringify({ error: 'Missing user_id, title, or body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('push_token, push_subscription, notification_preferences, first_name, last_name')
      .eq('id', payload.user_id)
      .single();

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prefs = profile.notification_preferences ?? {};
    const notifType = payload.data?.notification_type;
    if (notifType && prefs[notifType] === false) {
      return new Response(
        JSON.stringify({ success: false, reason: 'disabled_by_user' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Route: Web Push (preferred) ───────────────────────────────────────────
    const webSub = profile.push_subscription as { endpoint: string; keys: { p256dh: string; auth: string } } | null;
    if (webSub?.endpoint && webSub?.keys) {
      const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
      const vapidSubject    = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@fcmanager.co.nz';

      if (!vapidPublicKey || !vapidPrivateKey) {
        console.warn('VAPID keys not set, cannot send web push');
      } else {
        const pushPayload = {
          title:   payload.title,
          body:    payload.body,
          url:     payload.data?.url ?? '/',
          icon:    '/iron-eagle-security-logo.jpg',
          badge:   '/iron-eagle-security-logo.jpg',
          tag:     notifType ?? 'general',
          data:    payload.data ?? {},
        };

        const resp = await sendWebPush(webSub, pushPayload, vapidPublicKey, vapidPrivateKey, vapidSubject);
        if (resp.ok || resp.status === 201) {
          return new Response(
            JSON.stringify({ success: true, channel: 'web_push' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (resp.status === 410) {
          // Subscription expired
          await supabase.from('user_profiles')
            .update({ push_subscription: null })
            .eq('id', payload.user_id);
        }
        console.warn(`Web push failed (${resp.status}), falling back to Expo`);
      }
    }

    // ── Route: Expo Push Token (fallback) ─────────────────────────────────────
    if (!profile.push_token) {
      return new Response(
        JSON.stringify({ success: false, reason: 'no_push_token' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.push_token.startsWith('ExponentPushToken[') &&
        !profile.push_token.startsWith('ExpoPushToken[')) {
      return new Response(
        JSON.stringify({ success: false, reason: 'invalid_token' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const expoMessage = {
      to:       profile.push_token,
      title:    payload.title.substring(0, 50),
      body:     payload.body.substring(0, 200),
      data:     payload.data ?? {},
      priority: payload.priority ?? 'high',
      sound:    payload.sound === null ? null : 'default',
      badge:    payload.badge,
      ...(payload.category_id ? { categoryId: payload.category_id } : {}),
    };

    const response = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(expoMessage),
    });

    const responseData = await response.json();
    const data = responseData.data?.[0];
    if (data?.status === 'error') {
      if (data.details?.error === 'DeviceNotRegistered') {
        await supabase.from('user_profiles')
          .update({ push_token: null, push_token_updated_at: null })
          .eq('id', payload.user_id);
      }
      return new Response(
        JSON.stringify({ success: false, reason: 'expo_error', expo_error: data.details }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, channel: 'expo', ticket_id: data?.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Push notification error:', error);
    return new Response(
      JSON.stringify({ error: 'Push notification failed', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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

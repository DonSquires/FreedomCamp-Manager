/**
 * send-welfare-reminders
 *
 * Called by pg_cron every 2 minutes (or by the client when entering background).
 * Scans welfare_push_schedule for rows where next_reminder_at is imminent and
 * sends VAPID web-push notifications at 10-min, 5-min, and overdue thresholds.
 *
 * Also processes the notifications table for shift_posted rows that have
 * a web push subscription registered.
 *
 * REQUIRED SUPABASE SECRETS:
 *   VAPID_PUBLIC_KEY   — base64url-encoded uncompressed P-256 point (65 bytes)
 *   VAPID_PRIVATE_KEY  — base64url-encoded raw P-256 scalar (32 bytes)
 *   VAPID_SUBJECT      — mailto: or https: contact URI, e.g. mailto:admin@example.com
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

// ─── VAPID helpers ────────────────────────────────────────────────────────────

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
  let b64 = btoa(String.fromCharCode(...arr));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Build a VAPID Authorization header value for a given endpoint origin. */
async function buildVapidAuthHeader(
  endpoint: string,
  vapidPublicKeyB64u: string,
  vapidPrivateKeyB64u: string,
  subject: string
): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600; // 12h

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp, sub: subject };

  const enc = new TextEncoder();
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256', d: vapidPrivateKeyB64u,
      x: base64urlEncode(base64urlDecode(vapidPublicKeyB64u).slice(1, 33)),
      y: base64urlEncode(base64urlDecode(vapidPublicKeyB64u).slice(33, 65)),
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

  const token = `${signingInput}.${base64urlEncode(sig)}`;
  return `vapid t=${token}, k=${vapidPublicKeyB64u}`;
}

// ─── AES-128-GCM Web Push Payload Encryption (RFC 8291 / RFC 8188) ───────────

async function encryptWebPushPayload(
  subscriptionKeys: { p256dh: string; auth: string },
  plaintext: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(plaintext);

  // 1. Generate ephemeral sender key pair
  const senderKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );
  const senderPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeys.publicKey));

  // 2. Import receiver public key
  const receiverPublicRaw = base64urlDecode(subscriptionKeys.p256dh);
  const receiverPublicKey = await crypto.subtle.importKey(
    'raw', receiverPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // 3. ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey }, senderKeys.privateKey, 256
  );

  // 4. Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. HKDF to derive IKM, CEK, and nonce (RFC 8291)
  const authBytes = base64urlDecode(subscriptionKeys.auth);

  const hkdf = async (ikm: Uint8Array, salt2: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> => {
    const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt2, info },
      keyMaterial,
      len * 8
    );
    return new Uint8Array(bits);
  };

  const concat = (...bufs: Uint8Array[]) => {
    const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const b of bufs) { out.set(b, offset); offset += b.length; }
    return out;
  };

  const keyInfo = enc.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = enc.encode('Content-Encoding: nonce\0');
  const prk = await hkdf(
    new Uint8Array(sharedBits),
    authBytes,
    concat(
      enc.encode('WebPush: info\0'),
      receiverPublicRaw,
      senderPublicRaw
    ),
    32
  );
  const cek   = await hkdf(prk, salt, keyInfo,  16);
  const nonce = await hkdf(prk, salt, nonceInfo, 12);

  // 6. Pad plaintext (RFC 8291 §4: 2-byte big-endian length of padding then padding then data then 0x02 delimiter)
  const paddedLen = 2 + plaintextBytes.length + 1;
  const padded = new Uint8Array(paddedLen);
  padded[0] = 0; padded[1] = 0; // 0 bytes of padding
  padded.set(plaintextBytes, 2);
  padded[paddedLen - 1] = 0x02; // delimiter

  // 7. AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded);

  // 8. Build RFC 8188 content-encoding header (86-byte header prepended to ciphertext)
  const rs = 4096; // record size
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8)  & 0xff;
  header[19] = rs          & 0xff;
  header[20] = 65; // keyid length (uncompressed P-256)
  header.set(senderPublicRaw, 21);

  const ciphertext = concat(header, new Uint8Array(ct));
  return { ciphertext, salt, serverPublicKey: senderPublicRaw };
}

// ─── Send a single web push message ──────────────────────────────────────────

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

async function sendWebPush(
  subscription: PushSubscription,
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const json = JSON.stringify(payload);
  const { ciphertext } = await encryptWebPushPayload(subscription.keys, json);

  const authHeader = await buildVapidAuthHeader(
    subscription.endpoint, vapidPublicKey, vapidPrivateKey, vapidSubject
  );

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':      authHeader,
      'Content-Type':       'application/octet-stream',
      'Content-Encoding':   'aes128gcm',
      'Content-Length':     String(ciphertext.length),
      'TTL':                '86400',
      'Urgency':            'high',
    },
    body: ciphertext,
  });

  const body = await response.text().catch(() => '');
  return { ok: response.ok, status: response.status, body };
}

// ─── Edge Function handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const vapidSubject    = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:admin@fcmanager.co.nz';

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: 'VAPID keys not configured' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date();

    // ── 1. Fetch active welfare schedules due for a reminder ─────────────────
    const { data: schedules, error: schedErr } = await supabase
      .from('welfare_push_schedule')
      .select(`
        id, officer_id, interval_minutes, last_checkin_at,
        next_reminder_at, alert_10min_sent, alert_5min_sent, overdue_sent
      `)
      .eq('is_active', true)
      .not('next_reminder_at', 'is', null);

    if (schedErr) {
      console.error('[welfare-reminders] fetch error:', schedErr.message);
      return new Response(
        JSON.stringify({ error: schedErr.message }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    let sent = 0;

    for (const sched of (schedules ?? [])) {
      const dueAt = new Date(sched.next_reminder_at);
      const secondsUntilDue = (dueAt.getTime() - now.getTime()) / 1000;
      const isOverdue = secondsUntilDue < 0;
      const isDueSoon5  = secondsUntilDue <= 5 * 60  && secondsUntilDue > 0;
      const isDueSoon10 = secondsUntilDue <= 10 * 60 && secondsUntilDue > 0;

      // Determine what alert to send (if any)
      let alertType: 'overdue' | '5min' | '10min' | null = null;
      if (isOverdue && !sched.overdue_sent) {
        alertType = 'overdue';
      } else if (isDueSoon5 && !sched.alert_5min_sent) {
        alertType = '5min';
      } else if (isDueSoon10 && !sched.alert_10min_sent) {
        alertType = '10min';
      }

      if (!alertType) continue;

      // Fetch officer push subscription
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('push_subscription, notification_preferences, first_name')
        .eq('id', sched.officer_id)
        .single();

      if (!profile?.push_subscription) continue;

      // Check if welfare alerts are enabled
      const prefs = profile.notification_preferences ?? {};
      if (prefs.welfare_alerts === false) continue;

      const subscription = profile.push_subscription as PushSubscription;
      if (!subscription?.endpoint || !subscription?.keys) continue;

      // Build notification payload
      const name = profile.first_name ?? 'Officer';
      const payloads: Record<string, { title: string; body: string; tag: string }> = {
        '10min': {
          title: '⏱ Welfare Check-in Due Soon',
          body: `${name} — check-in due in 10 minutes. Tap "I'm OK" to confirm you're safe.`,
          tag: 'welfare-10min',
        },
        '5min': {
          title: '⚠️ Welfare Check-in Due in 5 Minutes',
          body: `${name} — please tap "I'm OK" on your app soon.`,
          tag: 'welfare-5min',
        },
        'overdue': {
          title: '🚨 WELFARE CHECK-IN OVERDUE',
          body: `${name} — your welfare check-in is OVERDUE. Open FieldOps Manager NOW.`,
          tag: 'welfare-overdue',
        },
      };

      const notif = payloads[alertType];
      const pushPayload = {
        title: notif.title,
        body:  notif.body,
        tag:   notif.tag,
        url:   '/field-officer',
        icon:  '/iron-eagle-security-logo.jpg',
        badge: '/iron-eagle-security-logo.jpg',
        vibrate: alertType === 'overdue' ? [500, 200, 500, 200, 500] : [200, 100, 200],
        requireInteraction: alertType === 'overdue',
        data: { url: '/field-officer', type: 'welfare', alertType },
      };

      const result = await sendWebPush(
        subscription, pushPayload, vapidPublicKey, vapidPrivateKey, vapidSubject
      );

      if (result.ok || result.status === 201) {
        sent++;
        // Mark alert as sent
        const updates: Record<string, boolean> = {};
        if (alertType === 'overdue')  updates.overdue_sent     = true;
        if (alertType === '5min')     updates.alert_5min_sent  = true;
        if (alertType === '10min')    updates.alert_10min_sent = true;

        await supabase
          .from('welfare_push_schedule')
          .update(updates)
          .eq('id', sched.id);

        console.log(`[welfare-reminders] sent ${alertType} to officer ${sched.officer_id}`);
      } else if (result.status === 410) {
        // Subscription expired — clear it
        console.warn(`[welfare-reminders] subscription expired for officer ${sched.officer_id}, clearing`);
        await supabase
          .from('user_profiles')
          .update({ push_subscription: null })
          .eq('id', sched.officer_id);
      } else {
        console.error(`[welfare-reminders] push failed (${result.status}): ${result.body}`);
      }
    }

    // ── 2. Send pending shift-posted push notifications ───────────────────────
    const { data: shiftNotifs } = await supabase
      .from('notifications')
      .select('id, user_id, title, body, data')
      .eq('type', 'shift_posted')
      .eq('read', false)
      .is('push_sent_at', null)
      .limit(50);

    for (const notif of (shiftNotifs ?? [])) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('push_subscription, notification_preferences')
        .eq('id', notif.user_id)
        .single();

      if (!profile?.push_subscription) continue;
      const prefs = profile.notification_preferences ?? {};
      if (prefs.shift_alerts === false) continue;

      const subscription = profile.push_subscription as PushSubscription;
      const pushPayload = {
        title: notif.title,
        body:  notif.body,
        url:   (notif.data as any)?.url ?? '/roster',
        icon:  '/iron-eagle-security-logo.jpg',
        badge: '/iron-eagle-security-logo.jpg',
        tag:   `shift-${notif.id}`,
        data:  { url: (notif.data as any)?.url ?? '/roster', type: 'shift_posted' },
      };

      const result = await sendWebPush(
        subscription, pushPayload, vapidPublicKey, vapidPrivateKey, vapidSubject
      );

      if (result.ok || result.status === 201) {
        sent++;
        await supabase
          .from('notifications')
          .update({ push_sent_at: new Date().toISOString() } as any)
          .eq('id', notif.id);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('[send-welfare-reminders] error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const safeErrorText = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const proxyBaseUrl = Deno.env.get('PROXY_BASE_URL') || Deno.env.get('RAILWAY_PROXY_URL');
    const proxySecret = Deno.env.get('PROXY_SECRET') || Deno.env.get('NZSCV_PROXY_SECRET');

    if (!proxyBaseUrl || !proxySecret) {
      return new Response(
        JSON.stringify({
          error: 'Invite relay is not configured. Missing PROXY_BASE_URL/RAILWAY_PROXY_URL or PROXY_SECRET/NZSCV_PROXY_SECRET.',
          code: 'PROXY_NOT_CONFIGURED',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, first_name, invite_url } = await req.json();

    if (!email || !invite_url) {
      return new Response(
        JSON.stringify({ error: 'email and invite_url are required', code: 'INVALID_PAYLOAD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const relayUrl = `${proxyBaseUrl.replace(/\/$/, '')}/api/email/send-invite`;

    const relayResponse = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': proxySecret,
      },
      body: JSON.stringify({ email, first_name, invite_url }),
    });

    if (!relayResponse.ok) {
      let relayPayload: any = null;
      try {
        relayPayload = await relayResponse.json();
      } catch {
        relayPayload = null;
      }

      const fallback = `Invite relay failed with HTTP ${relayResponse.status}`;
      const relayMessage = relayPayload?.message || relayPayload?.error || fallback;
      const relayCode = relayPayload?.code || 'INVITE_RELAY_FAILED';

      console.error('send-invite-email relay error:', {
        relayUrl,
        status: relayResponse.status,
        code: relayCode,
        message: safeErrorText(relayMessage),
      });

      return new Response(
        JSON.stringify({ error: relayMessage, code: relayCode }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Invite email relayed successfully for ${email}`);
    return new Response(
      JSON.stringify({ message: 'Invite email sent' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    const rawMessage = safeErrorText(error?.message || error);
    const isNetwork = /(failed to fetch|network|timed out|timeout|connection refused)/i.test(rawMessage);
    const code = isNetwork ? 'INVITE_RELAY_UNREACHABLE' : 'INVITE_RELAY_ERROR';
    const message = isNetwork
      ? 'Could not reach invite relay service. Check PROXY_BASE_URL and Railway availability.'
      : 'Failed to send invite email via relay service.';

    console.error('send-invite-email unexpected error:', {
      code,
      message,
      raw: rawMessage,
      stack: safeErrorText(error?.stack),
    });

    return new Response(
      JSON.stringify({ error: message, code }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// test-alpr-credentials
// ============================================================================
// Tests whether ALPR (Plate Recognizer) API credentials are configured and
// valid by making a lightweight API call.
//
// Called by:
//   - src/pages/ALPRDiagnostic.tsx  (admin diagnostic tool — deprecated page)
//
// No request body required.
//
// Response (JSON):
//   success   boolean
//   api       string   Name of the ALPR provider
//   message   string   Human-readable status
//   config    object   Which env vars are set (values redacted)
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";

const PLATE_RECOGNIZER_API_URL =
  Deno.env.get("ALPR_API_URL") ??
  Deno.env.get("PLATE_RECOGNIZER_API_URL") ??
  "https://api.platerecognizer.com/v1/plate-reader/";

const API_TOKEN =
  Deno.env.get("PLATERECOGNIZER_TOKEN") ??
  Deno.env.get("ALPR_API_TOKEN") ??
  Deno.env.get("PLATE_RECOGNIZER_TOKEN");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Auth guard
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  const config = {
    PLATERECOGNIZER_TOKEN: !!Deno.env.get("PLATERECOGNIZER_TOKEN"),
    ALPR_API_TOKEN:        !!Deno.env.get("ALPR_API_TOKEN"),
    ALPR_API_URL:          !!Deno.env.get("ALPR_API_URL"),
  };

  if (!API_TOKEN) {
    return new Response(
      JSON.stringify({
        success: false,
        api: "Plate Recognizer",
        message: "No ALPR API token configured. Set PLATERECOGNIZER_TOKEN or ALPR_API_TOKEN in Supabase secrets.",
        config,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  try {
    // Call the statistics endpoint — lightweight, no image required
    const statsUrl = "https://api.platerecognizer.com/v1/statistics/";
    const resp = await fetch(statsUrl, {
      method: "GET",
      headers: { Authorization: `Token ${API_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 401 || resp.status === 403) {
      return new Response(
        JSON.stringify({
          success: false,
          api: "Plate Recognizer",
          message: `API key rejected (HTTP ${resp.status}). Check that the key is correct and active.`,
          config,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    if (!resp.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          api: "Plate Recognizer",
          message: `Unexpected response from Plate Recognizer API (HTTP ${resp.status}).`,
          config,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    const stats = await resp.json();

    return new Response(
      JSON.stringify({
        success: true,
        api: "Plate Recognizer",
        message: "API key is valid.",
        config,
        usage: {
          calls_this_month: stats.usage?.calls ?? null,
          calls_remaining:  stats.usage?.calls_remaining ?? null,
          plan:             stats.plan ?? null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("❌ test-alpr-credentials error:", msg);
    return new Response(
      JSON.stringify({
        success: false,
        api: "Plate Recognizer",
        message: `Connection error: ${msg}`,
        config,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
});

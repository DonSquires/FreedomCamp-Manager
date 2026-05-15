/**
 * collect-canary-metrics
 * 
 * Collects per-flag error rates and p95 latency metrics for Phase B canary monitoring.
 * Called hourly by scheduled function or manually for monitoring checkpoints.
 * 
 * Returns structured metrics for each active Phase B flag with comparison against thresholds.
 * 
 * Usage: POST /functions/v1/collect-canary-metrics
 * Returns: { metrics: CanaryMetricSnapshot[], timestamp, window_seconds }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.3";
import { corsHeaders } from "../_shared/cors.ts";

interface CanaryMetricSnapshot {
  flag_name: string;
  flag_id: string;
  current_rollout_percentage: number;
  window_seconds: number;
  phase_b_events_total: number;
  error_count: number;
  error_rate_percent: number;
  error_rate_threshold_percent: number;
  error_rate_status: "healthy" | "warning" | "critical";
  p95_latency_ms: number;
  p95_latency_threshold_ms: number;
  p95_latency_status: "healthy" | "warning" | "critical";
  affected_users_count: number;
  affected_orgs_count: number;
  last_metric_collection_at: string;
  recommendation: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase credentials");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query all active Phase B flags
    const { data: flags, error: flagError } = await supabase
      .from("feature_flags")
      .select("id, name, rollout_percentage, phase, canary_error_rate_threshold, canary_p95_latency_threshold_ms")
      .eq("phase", "B")
      .eq("enabled", true);

    if (flagError) throw flagError;

    if (!flags || flags.length === 0) {
      return new Response(
        JSON.stringify({
          metrics: [],
          timestamp: new Date().toISOString(),
          window_seconds: 3600,
          message: "No active Phase B flags found",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Metric collection window: last 1 hour
    const windowSeconds = 3600;
    const windowStart = new Date(Date.now() - windowSeconds * 1000);

    const metrics: CanaryMetricSnapshot[] = [];

    for (const flag of flags) {
      // Query event counts from all Phase B event tables
      const eventTables = ["patrol_events", "dispatch_events", "enforcement_events"];
      let totalEvents = 0;
      let totalErrors = 0;
      let latencies: number[] = [];

      for (const table of eventTables) {
        // Count events with flag context in last window
        const { data: events, error: evtErr } = await supabase
          .from(table)
          .select("id, created_at, response_time_ms, error_code")
          .gte("created_at", windowStart.toISOString())
          .eq("feature_flag_id", flag.id);

        if (evtErr) {
          console.warn(`Error querying ${table}:`, evtErr);
          continue;
        }

        if (events) {
          totalEvents += events.length;
          totalErrors += events.filter((e) => e.error_code).length;
          latencies = latencies.concat(
            events.map((e) => e.response_time_ms || 0).filter((m) => m > 0)
          );
        }
      }

      // Calculate p95 latency
      let p95Latency = 0;
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        const p95Index = Math.ceil(latencies.length * 0.95) - 1;
        p95Latency = latencies[p95Index] || 0;
      }

      // Calculate error rate
      const errorRate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : 0;
      const errorThreshold = flag.canary_error_rate_threshold || 1.0;
      const latencyThreshold = flag.canary_p95_latency_threshold_ms || 500;

      // Determine health status
      const errorStatus =
        errorRate > errorThreshold * 1.5
          ? "critical"
          : errorRate > errorThreshold
            ? "warning"
            : "healthy";

      const latencyStatus =
        p95Latency > latencyThreshold * 1.5
          ? "critical"
          : p95Latency > latencyThreshold
            ? "warning"
            : "healthy";

      // Count affected users and orgs
      const { data: evals, error: evalErr } = await supabase
        .from("feature_flag_evaluations")
        .select("user_id, organization_id")
        .eq("flag_id", flag.id)
        .eq("enabled", true)
        .gte("created_at", windowStart.toISOString());

      const affectedUsers = new Set(evals?.map((e) => e.user_id) || []).size;
      const affectedOrgs = new Set(evals?.map((e) => e.organization_id) || []).size;

      // Generate recommendation
      let recommendation = "✅ Monitoring nominal — no action required";
      if (errorStatus === "critical" || latencyStatus === "critical") {
        recommendation = "🚨 CRITICAL — Consider emergency rollback";
      } else if (errorStatus === "warning" || latencyStatus === "warning") {
        recommendation = "⚠️ WARNING — Monitor closely; prepare rollback if worsens";
      } else if (flag.rollout_percentage < 100) {
        recommendation = "✅ Ready to promote — thresholds passing";
      }

      metrics.push({
        flag_name: flag.name,
        flag_id: flag.id,
        current_rollout_percentage: flag.rollout_percentage,
        window_seconds: windowSeconds,
        phase_b_events_total: totalEvents,
        error_count: totalErrors,
        error_rate_percent: parseFloat(errorRate.toFixed(2)),
        error_rate_threshold_percent: errorThreshold,
        error_rate_status: errorStatus,
        p95_latency_ms: Math.round(p95Latency),
        p95_latency_threshold_ms: latencyThreshold,
        p95_latency_status: latencyStatus,
        affected_users_count: affectedUsers,
        affected_orgs_count: affectedOrgs,
        last_metric_collection_at: new Date().toISOString(),
        recommendation,
      });
    }

    // Store metrics snapshot for historical tracking
    const snapshotId = crypto.randomUUID();
    const { error: insertErr } = await supabase
      .from("canary_metric_snapshots")
      .insert({
        id: snapshotId,
        metrics_json: metrics,
        collected_at: new Date().toISOString(),
        window_seconds: windowSeconds,
      });

    if (insertErr) {
      console.warn("Could not store metric snapshot:", insertErr);
      // Continue — snapshot storage is non-critical
    }

    return new Response(
      JSON.stringify({
        metrics,
        timestamp: new Date().toISOString(),
        window_seconds: windowSeconds,
        snapshot_id: snapshotId,
        summary: {
          total_flags_monitored: metrics.length,
          critical_flags: metrics.filter((m) => m.error_rate_status === "critical" || m.p95_latency_status === "critical").length,
          warning_flags: metrics.filter(
            (m) =>
              (m.error_rate_status === "warning" || m.p95_latency_status === "warning") &&
              m.error_rate_status !== "critical" &&
              m.p95_latency_status !== "critical"
          ).length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("collect-canary-metrics error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

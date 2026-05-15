#!/usr/bin/env node

/**
 * check-canary-thresholds.mjs
 * 
 * Daily monitoring script for Phase B canary observation window (May 16-17).
 * Checks current metric status against configured thresholds.
 * Generates daily report and alerts if thresholds are approached/breached.
 * 
 * Usage:
 *   node scripts/check-canary-thresholds.mjs                    # Generate report
 *   node scripts/check-canary-thresholds.mjs --alert-only       # Only show alerts
 *   node scripts/check-canary-thresholds.mjs --save-report      # Save to file
 * 
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
 *   ALERT_SLACK_WEBHOOK (optional, for notifications)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slackWebhook = process.env.ALERT_SLACK_WEBHOOK;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const args = process.argv.slice(2);
const alertOnly = args.includes("--alert-only");
const saveReport = args.includes("--save-report");

async function checkThresholds() {
  console.log(`\n📊 Phase B Canary Monitoring Report`);
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`───────────────────────────────────────\n`);

  try {
    // Call the Edge Function to collect metrics
    const response = await fetch(`${supabaseUrl}/functions/v1/collect-canary-metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Edge Function error: ${response.status}`);
    }

    const { metrics, summary, timestamp } = await response.json();

    // Organize alerts
    const critical = metrics.filter(
      (m) => m.error_rate_status === "critical" || m.p95_latency_status === "critical"
    );
    const warnings = metrics.filter(
      (m) =>
        (m.error_rate_status === "warning" || m.p95_latency_status === "warning") &&
        m.error_rate_status !== "critical" &&
        m.p95_latency_status !== "critical"
    );
    const healthy = metrics.filter(
      (m) => m.error_rate_status === "healthy" && m.p95_latency_status === "healthy"
    );

    // Display alerts if any
    if (critical.length > 0) {
      console.log(`🚨 CRITICAL ALERTS (${critical.length})`);
      console.log(`─────────────────────────────────────`);
      critical.forEach((m) => {
        console.log(`\n  ${m.flag_name}`);
        console.log(`    Rollout: ${m.current_rollout_percentage}%`);
        if (m.error_rate_status === "critical") {
          console.log(`    ❌ Error Rate: ${m.error_rate_percent}% (threshold: ${m.error_rate_threshold_percent}%)`);
        }
        if (m.p95_latency_status === "critical") {
          console.log(`    ❌ P95 Latency: ${m.p95_latency_ms}ms (threshold: ${m.p95_latency_threshold_ms}ms)`);
        }
        console.log(`    📋 Events: ${m.phase_b_events_total} (${m.error_count} errors)`);
        console.log(`    👥 Affected: ${m.affected_users_count} users, ${m.affected_orgs_count} orgs`);
        console.log(`    💡 ${m.recommendation}`);
      });
      console.log();
    }

    if (warnings.length > 0 && !alertOnly) {
      console.log(`⚠️  WARNINGS (${warnings.length})`);
      console.log(`─────────────────────────────────────`);
      warnings.forEach((m) => {
        console.log(`\n  ${m.flag_name}`);
        console.log(`    Rollout: ${m.current_rollout_percentage}%`);
        if (m.error_rate_status === "warning") {
          console.log(`    ⚠️  Error Rate: ${m.error_rate_percent}% (threshold: ${m.error_rate_threshold_percent}%)`);
        }
        if (m.p95_latency_status === "warning") {
          console.log(`    ⚠️  P95 Latency: ${m.p95_latency_ms}ms (threshold: ${m.p95_latency_threshold_ms}ms)`);
        }
        console.log(`    📋 Events: ${m.phase_b_events_total} (${m.error_count} errors)`);
        console.log(`    💡 ${m.recommendation}`);
      });
      console.log();
    }

    if (healthy.length > 0 && !alertOnly) {
      console.log(`✅ HEALTHY (${healthy.length})`);
      console.log(`─────────────────────────────────────`);
      healthy.forEach((m) => {
        console.log(
          `\n  ${m.flag_name} @ ${m.current_rollout_percentage}% — Error: ${m.error_rate_percent}% | Latency: ${m.p95_latency_ms}ms`
        );
        if (m.phase_b_events_total === 0) {
          console.log(`    ℹ️  No events in observation window`);
        } else {
          console.log(`    📊 ${m.phase_b_events_total} events, ${m.affected_users_count} users, ${m.affected_orgs_count} orgs`);
        }
      });
      console.log();
    }

    // Summary
    if (!alertOnly) {
      console.log(`📈 Summary`);
      console.log(`─────────────────────────────────────`);
      console.log(`  Total Flags Monitored:  ${summary.total_flags_monitored}`);
      console.log(`  🚨 Critical:            ${summary.critical_flags}`);
      console.log(`  ⚠️  Warning:             ${summary.warning_flags}`);
      console.log(`  ✅ Healthy:             ${healthy.length}`);
      console.log();
    }

    // If critical, send Slack alert
    if (critical.length > 0 && slackWebhook) {
      await sendSlackAlert(critical, warnings, summary);
    }

    // Save report if requested
    if (saveReport) {
      const reportPath = path.join(__dirname, `../data/canary-report-${new Date().toISOString().split("T")[0]}.json`);
      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            timestamp,
            summary,
            critical,
            warnings,
            healthy,
          },
          null,
          2
        )
      );
      console.log(`💾 Report saved to ${reportPath}\n`);
    }

    // Exit with error code if critical issues
    if (critical.length > 0) {
      console.log(`\n🚨 Critical issues detected. Please investigate and consider rollback.\n`);
      process.exit(1);
    }

    console.log(`\n✅ Monitoring complete. All thresholds nominal.\n`);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error during threshold check:`, error.message);
    process.exit(1);
  }
}

async function sendSlackAlert(critical, warnings, summary) {
  try {
    const criticalList = critical.map((m) => `• ${m.flag_name}: ${m.recommendation}`).join("\n");
    const message = {
      text: "🚨 Phase B Canary Alert",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🚨 Phase B Canary Alert",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Critical Issues Detected*\n\`\`\`${criticalList}\`\`\``,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Flags Monitored*\n${summary.total_flags_monitored}`,
            },
            {
              type: "mrkdwn",
              text: `*Critical*\n${summary.critical_flags}`,
            },
            {
              type: "mrkdwn",
              text: `*Warnings*\n${summary.warning_flags}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `_${new Date().toISOString()}_`,
          },
        },
      ],
    };

    const response = await fetch(slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.warn(`⚠️  Slack alert send failed: ${response.status}`);
    }
  } catch (error) {
    console.warn(`⚠️  Could not send Slack alert:`, error.message);
  }
}

checkThresholds();

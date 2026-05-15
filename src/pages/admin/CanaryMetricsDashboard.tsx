/**
 * CanaryMetricsDashboard.tsx
 * 
 * Real-time Phase B canary monitoring dashboard.
 * Shows per-flag metrics against configured thresholds.
 * Allows manual promotion and rollback with metric review.
 * 
 * Route: /admin/canary-metrics (Master role only)
 */

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, TrendingDown, TrendingUp, RefreshCw, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

interface CanaryMetric {
  flag_name: string;
  flag_id: string;
  current_rollout_percentage: number;
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
  recommendation: string;
}

interface MetricSnapshot {
  metrics: CanaryMetric[];
  timestamp: string;
  summary: {
    total_flags_monitored: number;
    critical_flags: number;
    warning_flags: number;
  };
}

export function CanaryMetricsDashboard() {
  const [snapshot, setSnapshot] = useState<MetricSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const response = await supabase.functions.invoke("collect-canary-metrics", {
        method: "POST",
      });

      if (response.data) {
        setSnapshot(response.data);
        setLastRefresh(new Date());
      }
    } catch (error) {
      console.error("Failed to fetch canary metrics:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-96">
        <Button onClick={fetchMetrics} disabled={loading}>
          {loading ? "Loading..." : "Load Canary Metrics"}
        </Button>
      </div>
    );
  }

  const { metrics, summary, timestamp } = snapshot;
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Phase B Canary Metrics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Observation Window: May 16–17, 2026 | Last Updated: {new Date(timestamp).toLocaleTimeString("en-NZ")}
          </p>
        </div>
        <Button onClick={fetchMetrics} disabled={loading} size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Monitored</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total_flags_monitored}</div>
          </CardContent>
        </Card>

        <Card className={critical.length > 0 ? "border-red-200 bg-red-50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              Critical
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${critical.length > 0 ? "text-red-600" : ""}`}>
              {summary.critical_flags}
            </div>
          </CardContent>
        </Card>

        <Card className={warnings.length > 0 ? "border-yellow-200 bg-yellow-50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${warnings.length > 0 ? "text-yellow-600" : ""}`}>
              {summary.warning_flags}
            </div>
          </CardContent>
        </Card>

        <Card className={healthy.length === metrics.length ? "border-green-200 bg-green-50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Healthy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${healthy.length === metrics.length ? "text-green-600" : ""}`}>
              {healthy.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Alerts */}
      {critical.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              🚨 Critical Alerts ({critical.length})
            </CardTitle>
            <CardDescription className="text-red-700">
              Flags have exceeded thresholds. Immediate action may be required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {critical.map((metric) => (
              <MetricRow key={metric.flag_id} metric={metric} isCritical />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Warning Alerts */}
      {warnings.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-900 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              ⚠️ Warnings ({warnings.length})
            </CardTitle>
            <CardDescription className="text-yellow-700">Flags are approaching thresholds. Monitor closely.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {warnings.map((metric) => (
              <MetricRow
                key={metric.flag_id}
                metric={metric}
                isExpanded={expandedFlag === metric.flag_id}
                onToggleExpand={() =>
                  setExpandedFlag(expandedFlag === metric.flag_id ? null : metric.flag_id)
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Healthy Flags */}
      {healthy.length > 0 && (
        <Card className="border-green-300 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              ✅ Healthy ({healthy.length})
            </CardTitle>
            <CardDescription className="text-green-700">All metrics nominal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {healthy.map((metric) => (
              <MetricRow
                key={metric.flag_id}
                metric={metric}
                isExpanded={expandedFlag === metric.flag_id}
                onToggleExpand={() =>
                  setExpandedFlag(expandedFlag === metric.flag_id ? null : metric.flag_id)
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Observation Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Monitoring Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-gray-600">
            📋 Use the{" "}
            <a
              href="/docs/PHASE_B_MONITORING_CHECKLIST_MAY_16_17.md"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              daily monitoring checklist
            </a>{" "}
            for structured observation and alert response procedures.
          </p>
          <p className="text-sm text-gray-600">
            🚨 If critical alerts appear, follow the "Critical Alert Response" section for immediate actions.
          </p>
          <p className="text-sm text-gray-600">
            📊 Save daily reports: <code className="bg-gray-100 px-2 py-1 rounded">node scripts/check-canary-thresholds.mjs --save-report</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface MetricRowProps {
  metric: CanaryMetric;
  isCritical?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function MetricRow({ metric, isCritical, isExpanded, onToggleExpand }: MetricRowProps) {
  const statusColor = (status: string) => {
    if (status === "critical") return "text-red-600";
    if (status === "warning") return "text-yellow-600";
    return "text-green-600";
  };

  const statusIcon = (status: string) => {
    if (status === "critical") return "🚨";
    if (status === "warning") return "⚠️";
    return "✅";
  };

  const getTrendIcon = (current: number, threshold: number) => {
    if (current > threshold) return <TrendingUp className="w-4 h-4 text-red-600" />;
    return <TrendingDown className="w-4 h-4 text-green-600" />;
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between cursor-pointer" onClick={onToggleExpand}>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{metric.flag_name}</h3>
          <p className="text-sm text-gray-600">Rollout: {metric.current_rollout_percentage}%</p>
        </div>
        <div className="text-right">
          <div className="text-2xl mb-1">{statusIcon(metric.error_rate_status === "critical" || metric.p95_latency_status === "critical" ? "critical" : metric.error_rate_status === "warning" || metric.p95_latency_status === "warning" ? "warning" : "healthy")}</div>
          {onToggleExpand && <ChevronDown className={`w-4 h-4 transition ${isExpanded ? "rotate-180" : ""}`} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Error Rate */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Error Rate</span>
            {getTrendIcon(metric.error_rate_percent, metric.error_rate_threshold_percent)}
          </div>
          <p className={`text-lg font-bold ${statusColor(metric.error_rate_status)}`}>
            {metric.error_rate_percent}%
          </p>
          <p className="text-xs text-gray-600">Threshold: {metric.error_rate_threshold_percent}%</p>
        </div>

        {/* P95 Latency */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">P95 Latency</span>
            {getTrendIcon(metric.p95_latency_ms, metric.p95_latency_threshold_ms)}
          </div>
          <p className={`text-lg font-bold ${statusColor(metric.p95_latency_status)}`}>
            {metric.p95_latency_ms}ms
          </p>
          <p className="text-xs text-gray-600">Threshold: {metric.p95_latency_threshold_ms}ms</p>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t pt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-gray-600">Total Events:</span>
              <p className="font-semibold">{metric.phase_b_events_total}</p>
            </div>
            <div>
              <span className="text-gray-600">Errors:</span>
              <p className="font-semibold text-red-600">{metric.error_count}</p>
            </div>
            <div>
              <span className="text-gray-600">Affected Users:</span>
              <p className="font-semibold">{metric.affected_users_count}</p>
            </div>
            <div>
              <span className="text-gray-600">Affected Orgs:</span>
              <p className="font-semibold">{metric.affected_orgs_count}</p>
            </div>
          </div>
          <div className="pt-2 border-t">
            <span className="text-gray-600">Recommendation:</span>
            <p className="font-semibold mt-1">{metric.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

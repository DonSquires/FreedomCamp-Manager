/**
 * Compliance Metrics Summary
 * 
 * Shows detailed stay metrics with color-coded status:
 * - Nights per month: allowed vs stayed
 * - Consecutive nights: allowed vs stayed
 * - Self-contained compliance
 * - Status: Compliant | At Risk | Breach | Breach (Homeless Exempt)
 * 
 * Color coding:
 * - GREEN: Compliant
 * - AMBER: At Risk (reached limit)
 * - RED: Breach (exceeded limit)
 * - PURPLE: Breach but Homeless Exempt
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, Home, Loader2, TrendingUp, Moon, Calendar } from 'lucide-react';

interface ComplianceMetrics {
  // Zone rules
  nights_per_month_allowed: number;
  max_consecutive_nights_allowed: number;
  self_contained_required: boolean;
  
  // Vehicle stats
  nights_stayed_this_month: number;
  consecutive_nights_stayed: number;
  is_self_contained: boolean;
  self_contained_expiry: string | null;
  
  // Compliance status
  overall_status: 'compliant' | 'at_risk' | 'breach' | 'breach_homeless_exempt';
  is_homeless_exempt: boolean;
  homeless_status: string;
  
  // Specific breaches
  exceeds_monthly_limit: boolean;
  exceeds_consecutive_limit: boolean;
  sc_required_but_missing: boolean;
  sc_expired: boolean;
  
  // Breach details
  breach_type: string | null;
  violation_summary: string | null;
}

const STATUS_CONFIG = {
  compliant: {
    color: 'bg-emerald-600 text-white border-emerald-700',
    icon: CheckCircle2,
    label: 'Compliant',
    description: 'All zone requirements met',
  },
  at_risk: {
    color: 'bg-amber-500 text-white border-amber-600',
    icon: AlertTriangle,
    label: 'At Risk',
    description: 'Approaching limits - monitor closely',
  },
  breach: {
    color: 'bg-red-600 text-white border-red-700',
    icon: XCircle,
    label: 'Breach',
    description: 'Zone requirements exceeded',
  },
  breach_homeless_exempt: {
    color: 'bg-violet-600 text-white border-violet-700',
    icon: Home,
    label: 'Breach (Homeless Exempt)',
    description: 'Breach but protected under FCA homeless exemption',
  },
};

export function ComplianceMetricsSummary({ observationId }: { observationId: string }) {
  const [metrics, setMetrics] = useState<ComplianceMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadMetrics() {
      setIsLoading(true);
      setError(null);
      
      try {
        console.log('📊 [Compliance Metrics] Loading for observation:', observationId);
        
        // Query observation with compliance data, zone rules, and monthly stays
        const { data: obs, error: obsError } = await supabase
          .from('observations')
          .select(`
            id,
            plate_number,
            zone_id,
            recorded_at,
            self_contained,
            self_contained_expiry,
            is_compliant,
            breach_type,
            breach_details,
            has_homeless_claim,
            compliance:compliance_results!compliance_results_observation_id_fkey(
              is_homeless_exempt,
              violation_reasons,
              matrix_snapshot
            ),
            zone:zones(
              id,
              name,
              matrix:zone_compliance_matrix!zone_compliance_matrix_zone_id_fkey(
                nights_per_month,
                max_consecutive_nights,
                self_contained_required:requires_csc,
                homeless_exemption
              )
            ),
            canonical:canonical_vehicles(
              homeless_status,
              self_contained,
              self_contained_expiry
            )
          `)
          .eq('id', observationId)
          .is('zone.matrix.effective_to', null)
          .single();

        if (obsError) throw obsError;
        if (!obs) throw new Error('Observation not found');

        console.log('📊 [Compliance Metrics] Observation data:', obs);

        // Get monthly stays for this plate in this zone
        const recordedMonth = new Date(obs.recorded_at).toISOString().slice(0, 7) + '-01';
        
        const { data: stayData, error: stayError } = await supabase
          .from('vehicle_monthly_stays')
          .select('nights_stayed, consecutive_nights')
          .eq('plate_number', obs.plate_number)
          .eq('zone_id', obs.zone_id)
          .eq('calendar_month', recordedMonth)
          .maybeSingle();

        if (stayError) {
          console.error('⚠️ [Compliance Metrics] Failed to load stays:', stayError);
        }

        console.log('📊 [Compliance Metrics] Stay data:', stayData);

        // Extract zone rules from matrix (use active matrix)
        const matrix = obs.zone?.matrix?.[0] || obs.compliance?.[0]?.matrix_snapshot;
        const nightsPerMonth = matrix?.nights_per_month || 28;
        const maxConsecutive = matrix?.max_consecutive_nights || 3;
        const scRequired = matrix?.self_contained_required ?? matrix?.requires_csc ?? true;
        const homelessExemption = matrix?.homeless_exemption ?? true;

        // Get actual stats
        const nightsStayed = stayData?.nights_stayed || 0;
        const consecutiveStayed = stayData?.consecutive_nights || 0;
        const isSC = obs.canonical?.self_contained || obs.self_contained || false;
        const scExpiry = obs.canonical?.self_contained_expiry || obs.self_contained_expiry;
        
        // Check if SC expired
        const scExpired = scExpiry ? new Date(scExpiry) < new Date() : false;

        // Determine homeless status
        const homelessStatus = obs.canonical?.homeless_status || 'none';
        const isHomelessExempt = obs.compliance?.[0]?.is_homeless_exempt || 
                                 (homelessStatus === 'confirmed' && homelessExemption);

        // Check specific violations
        const exceedsMonthly = nightsStayed > nightsPerMonth;
        const exceedsConsecutive = consecutiveStayed > maxConsecutive;
        const scRequiredButMissing = scRequired && !isSC;
        
        // Determine overall status
        let overallStatus: 'compliant' | 'at_risk' | 'breach' | 'breach_homeless_exempt' = 'compliant';
        
        if (exceedsMonthly || exceedsConsecutive || (scRequiredButMissing && !scExpired)) {
          overallStatus = isHomelessExempt ? 'breach_homeless_exempt' : 'breach';
        } else if (nightsStayed === nightsPerMonth || consecutiveStayed === maxConsecutive) {
          overallStatus = 'at_risk';
        }

        if (mounted) {
          setMetrics({
            nights_per_month_allowed: nightsPerMonth,
            max_consecutive_nights_allowed: maxConsecutive,
            self_contained_required: scRequired,
            nights_stayed_this_month: nightsStayed,
            consecutive_nights_stayed: consecutiveStayed,
            is_self_contained: isSC,
            self_contained_expiry: scExpiry,
            overall_status: overallStatus,
            is_homeless_exempt: isHomelessExempt,
            homeless_status: homelessStatus,
            exceeds_monthly_limit: exceedsMonthly,
            exceeds_consecutive_limit: exceedsConsecutive,
            sc_required_but_missing: scRequiredButMissing,
            sc_expired: scExpired,
            breach_type: obs.breach_type,
            violation_summary: obs.breach_details?.violation_summary || null,
          });
        }

      } catch (err: any) {
        console.error('❌ [Compliance Metrics] Failed to load:', err);
        if (mounted) {
          setError(err.message || 'Failed to load compliance metrics');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadMetrics();

    return () => {
      mounted = false;
    };
  }, [observationId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading compliance metrics...</span>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {error || 'Compliance data not available'}
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[metrics.overall_status];
  const StatusIcon = statusConfig.icon;

  return (
    <Card className="border-2 border-primary/20 overflow-hidden">
      {/* Status Header */}
      <div className={`${statusConfig.color} px-4 py-3`}>
        <div className="flex items-center gap-2">
          <StatusIcon className="h-5 w-5" />
          <div>
            <div className="font-bold text-lg">{statusConfig.label}</div>
            <div className="text-sm opacity-90">{statusConfig.description}</div>
          </div>
        </div>
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Nights Per Month */}
          <div className="p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase text-muted-foreground">
                Nights Per Month
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${
                metrics.exceeds_monthly_limit ? 'text-red-600' :
                metrics.nights_stayed_this_month === metrics.nights_per_month_allowed ? 'text-amber-500' :
                'text-emerald-600'
              }`}>
                {metrics.nights_stayed_this_month}
              </span>
              <span className="text-lg text-muted-foreground">/ {metrics.nights_per_month_allowed}</span>
            </div>
            {metrics.exceeds_monthly_limit && (
              <div className="mt-2 text-xs text-red-600 font-semibold">
                ⚠️ EXCEEDED BY {metrics.nights_stayed_this_month - metrics.nights_per_month_allowed} NIGHTS
              </div>
            )}
            {metrics.nights_stayed_this_month === metrics.nights_per_month_allowed && !metrics.exceeds_monthly_limit && (
              <div className="mt-2 text-xs text-amber-600 font-semibold">
                ⚠️ AT LIMIT - Monitor closely
              </div>
            )}
          </div>

          {/* Consecutive Nights */}
          <div className="p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <Moon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase text-muted-foreground">
                Consecutive Nights
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${
                metrics.exceeds_consecutive_limit ? 'text-red-600' :
                metrics.consecutive_nights_stayed === metrics.max_consecutive_nights_allowed ? 'text-amber-500' :
                'text-emerald-600'
              }`}>
                {metrics.consecutive_nights_stayed}
              </span>
              <span className="text-lg text-muted-foreground">/ {metrics.max_consecutive_nights_allowed}</span>
            </div>
            {metrics.exceeds_consecutive_limit && (
              <div className="mt-2 text-xs text-red-600 font-semibold">
                ⚠️ EXCEEDED BY {metrics.consecutive_nights_stayed - metrics.max_consecutive_nights_allowed} NIGHTS
              </div>
            )}
            {metrics.consecutive_nights_stayed === metrics.max_consecutive_nights_allowed && !metrics.exceeds_consecutive_limit && (
              <div className="mt-2 text-xs text-amber-600 font-semibold">
                ⚠️ AT LIMIT - Monitor closely
              </div>
            )}
          </div>

          {/* Self-Contained Status */}
          <div className="p-3 bg-muted/50 rounded-lg border md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase text-muted-foreground">
                Self-Contained Status
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={
                metrics.self_contained_required
                  ? metrics.is_self_contained
                    ? metrics.sc_expired
                      ? 'bg-red-600 text-white'
                      : 'bg-emerald-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-gray-500 text-white'
              }>
                {metrics.self_contained_required ? 'Required' : 'Not Required'}
              </Badge>
              <span className="text-sm">
                Vehicle: {metrics.is_self_contained ? (
                  <>
                    <span className="font-semibold text-emerald-600">Self-Contained</span>
                    {metrics.self_contained_expiry && (
                      <span className="text-muted-foreground ml-2">
                        (Expiry: {new Date(metrics.self_contained_expiry).toLocaleDateString()})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-semibold text-red-600">Not Self-Contained</span>
                )}
              </span>
            </div>
            {metrics.sc_required_but_missing && (
              <div className="mt-2 text-xs text-red-600 font-semibold">
                ⚠️ BREACH: Self-contained certification required but missing
              </div>
            )}
            {metrics.sc_expired && (
              <div className="mt-2 text-xs text-red-600 font-semibold">
                ⚠️ BREACH: Self-contained certification expired
              </div>
            )}
          </div>
        </div>

        {/* Homeless Exemption Notice */}
        {metrics.is_homeless_exempt && (
          <div className="p-3 bg-violet-50 dark:bg-violet-950/20 border-2 border-violet-300 dark:border-violet-700 rounded-lg">
            <div className="flex items-start gap-2">
              <Home className="h-5 w-5 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold text-violet-900 dark:text-violet-100 mb-1">
                  Homeless Exemption Applied
                </div>
                <div className="text-sm text-violet-800 dark:text-violet-200">
                  This vehicle has confirmed homeless status. While technically in breach of zone requirements,
                  enforcement is restricted under the Freedom Camping Act 2011. Focus on welfare pathways and support services.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Violation Summary */}
        {metrics.violation_summary && (
          <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
            <div className="text-xs font-bold uppercase text-red-900 dark:text-red-100 mb-1">
              Breach Details
            </div>
            <div className="text-sm text-red-800 dark:text-red-200">
              {metrics.violation_summary}
            </div>
          </div>
        )}

        {/* Color Legend */}
        <div className="pt-3 border-t text-xs text-muted-foreground">
          <div className="font-semibold mb-2">Color Coding:</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-emerald-600"></div>
              <span><strong>GREEN:</strong> Compliant</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-amber-500"></div>
              <span><strong>AMBER:</strong> At Risk (at limit)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-600"></div>
              <span><strong>RED:</strong> Breach (exceeded)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-violet-600"></div>
              <span><strong>PURPLE:</strong> Homeless Exempt</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

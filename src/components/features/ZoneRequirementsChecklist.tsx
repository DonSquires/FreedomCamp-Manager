/**
 * Zone Requirements Checklist
 * 
 * Shows color-coded requirement-by-requirement breakdown for each observation
 * Statuses: YES (green), NO (amber), BREACH (red), BREACH_EXEMPT (purple)
 * 
 * Court-ready transparency: explains why each requirement passed/failed
 * Homeless exemptions shown clearly for welfare pathway routing
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, XCircle, Home, Loader2 } from 'lucide-react';

interface Requirement {
  observation_id: string;
  requirement_code: string;
  requirement_label: string;
  status: 'yes' | 'no' | 'breach' | 'breach_exempt';
  reason: string;
  sort_order: number;
}

const STATUS_CONFIG = {
  yes: {
    color: 'bg-emerald-600 text-white border-emerald-700',
    icon: CheckCircle2,
    label: 'YES',
  },
  no: {
    color: 'bg-amber-500 text-white border-amber-600',
    icon: AlertTriangle,
    label: 'NO',
  },
  breach: {
    color: 'bg-red-600 text-white border-red-700',
    icon: XCircle,
    label: 'BREACH',
  },
  breach_exempt: {
    color: 'bg-violet-600 text-white border-violet-700',
    icon: Home,
    label: 'BREACH (EXEMPT)',
  },
};

export function ZoneRequirementsChecklist({ 
  observationId,
  compact = false 
}: { 
  observationId: string;
  compact?: boolean;
}) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadRequirements() {
      setIsLoading(true);
      try {
        console.log('🔍 [Zone Requirements] Loading for observation:', observationId);
        
        const { data, error } = await supabase
          .rpc('evaluate_observation_requirements', { p_obs_id: observationId });

        if (error) {
          console.error('❌ [Zone Requirements] RPC failed:', error);
          throw error;
        }

        console.log('✅ [Zone Requirements] Received data:', data);

        if (mounted) {
          const sorted = (data || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
          console.log('📊 [Zone Requirements] Setting requirements:', sorted);
          setRequirements(sorted);
        }
      } catch (error: any) {
        console.error('❌ [Zone Requirements] Failed to load:', error);
        console.error('   Error details:', error.message, error.details, error.hint);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadRequirements();

    return () => {
      mounted = false;
    };
  }, [observationId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading zone requirements...</span>
      </div>
    );
  }

  if (!requirements.length) {
    return null;
  }

  if (compact) {
    // Compact view: just show status chips in a row
    return (
      <div className="flex flex-wrap gap-1">
        {requirements.map((req) => {
          const config = STATUS_CONFIG[req.status];
          const Icon = config.icon;
          return (
            <Badge 
              key={req.requirement_code} 
              className={`${config.color} text-xs gap-1`}
              title={`${req.requirement_label}: ${req.reason}`}
            >
              <Icon className="h-3 w-3" />
              {config.label}
            </Badge>
          );
        })}
      </div>
    );
  }

  // Full view: detailed list with reasons
  return (
    <Card className="border-2 border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-bold uppercase text-primary">Zone Requirements</div>
          <Badge variant="outline" className="text-xs">
            {requirements.filter(r => r.status === 'yes').length}/{requirements.length} Met
          </Badge>
        </div>

        <ul className="space-y-3">
          {requirements.map((req) => {
            const config = STATUS_CONFIG[req.status];
            const Icon = config.icon;

            return (
              <li 
                key={req.requirement_code} 
                className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg border"
              >
                <Badge className={`${config.color} shrink-0 gap-1 mt-0.5`}>
                  <Icon className="h-3 w-3" />
                  {config.label}
                </Badge>
                
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm mb-1">
                    {req.requirement_label || req.requirement_code}
                  </div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {req.reason || '(No details available)'}
                  </div>
                  
                  {req.status === 'breach_exempt' && (
                    <div className="mt-2 p-2 bg-violet-50 dark:bg-violet-950/20 border border-violet-300 dark:border-violet-700 rounded text-xs text-violet-900 dark:text-violet-100">
                      <strong>Note:</strong> This breach qualifies for homeless exemption under the Freedom Camping Act 2011. 
                      Enforcement should focus on welfare pathways and support services.
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
          <div className="font-semibold mb-2">Status Legend:</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-emerald-600"></div>
              <span><strong>YES:</strong> Requirement met</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-amber-500"></div>
              <span><strong>NO:</strong> Not met (non-breach)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-600"></div>
              <span><strong>BREACH:</strong> Infringement applicable</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-violet-600"></div>
              <span><strong>BREACH (EXEMPT):</strong> Homeless exemption</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

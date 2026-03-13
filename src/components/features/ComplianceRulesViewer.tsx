/**
 * ComplianceRulesViewer Component
 * Display zone compliance rules and requirements
 */

import { formatDate } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  Shield,
  Calendar,
  Moon,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
} from 'lucide-react'

interface ComplianceRulesViewerProps {
  zoneId: string
  showVersion?: boolean
  compact?: boolean
}

export function ComplianceRulesViewer({
  zoneId,
  showVersion = true,
  compact = false,
}: ComplianceRulesViewerProps) {
  // Fetch current active compliance matrix directly from zone_compliance_matrix
  // (get_active_matrix RPC was replaced in 20260318_fix_schema_functions.sql)
  const { data: matrix, isLoading } = useQuery({
    queryKey: ['compliance-matrix', zoneId],
    queryFn: async () => {
      // Try zone_compliance_matrix first (highest version, no effective_to)
      const { data: matrixRows, error: matrixError } = await supabase
        .from('zone_compliance_matrix' as any)
        .select('*')
        .eq('zone_id', zoneId)
        .is('effective_to', null)
        .order('version', { ascending: false })
        .limit(1)

      if (!matrixError && matrixRows && matrixRows.length > 0) {
        return matrixRows[0]
      }

      // Fallback: read compliance rules directly from zones table
      const { data: zone, error: zoneError } = await (supabase as any)
        .from('zones')
        .select('id, nights_per_month, max_consecutive_nights, self_contained_required, day_visit_only, allowed_days')
        .eq('id', zoneId)
        .single()

      if (zoneError) throw zoneError
      if (!zone) return null

      return {
        zone_id:                (zone as any).id,
        version:                1,
        nights_per_month:       (zone as any).nights_per_month,
        max_consecutive_nights: (zone as any).max_consecutive_nights,
        self_contained_required: (zone as any).self_contained_required,
        requires_csc:           (zone as any).self_contained_required,
        day_visit_only:         (zone as any).day_visit_only,
        allowed_days:           (zone as any).allowed_days,
        homeless_exemption:     true,
        // Fields only on zone_compliance_matrix rows – absent in fallback
        accepted_warrant:                null,
        accepted_warrant_effective_from: null,
        accepted_warrant_effective_to:   null,
        allows_overnight:                !((zone as any).day_visit_only),
        enforcement_basis:               null,
        csc_register_uri:                null,
        effective_from:                  null,
        effective_to:                    null,
        change_reason:                   null,
      } as any
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            Loading compliance rules...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!matrix) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No compliance rules configured</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (compact) {
    return (
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Self-Contained Required</span>
            {matrix.requires_csc ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Max Nights/Month</span>
            <span className="font-medium">{matrix.nights_per_month || 'Unlimited'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Max Consecutive</span>
            <span className="font-medium">{matrix.max_consecutive_nights || 'Unlimited'}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Compliance Rules
            </CardTitle>
            <CardDescription className="mt-1">
              Current enforcement criteria for this zone
            </CardDescription>
          </div>
          {showVersion && matrix.version && (
            <Badge variant="outline">Version {matrix.version}</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Self-contained requirement */}
        <div className="p-4 rounded-lg border">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Self-Contained Certificate</span>
            </div>
            {matrix.requires_csc ? (
              <Badge className="bg-green-600">Required</Badge>
            ) : (
              <Badge variant="secondary">Not Required</Badge>
            )}
          </div>
          
          {matrix.requires_csc && (
            <div className="space-y-2 mt-3 text-sm">
              {matrix.accepted_warrant && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Accepted warrant: <strong>{matrix.accepted_warrant}</strong></span>
                </div>
              )}
              {matrix.accepted_warrant_effective_from && (
                <div className="text-muted-foreground">
                  Valid from: {formatDate(matrix.accepted_warrant_effective_from)}
                  {matrix.accepted_warrant_effective_to && 
                    ` to ${formatDate(matrix.accepted_warrant_effective_to)}`
                  }
                </div>
              )}
            </div>
          )}
        </div>

        {/* Overnight stays */}
        <div className="p-4 rounded-lg border">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Moon className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Overnight Stays</span>
            </div>
            {matrix.allows_overnight ? (
              <Badge variant="secondary">Allowed</Badge>
            ) : (
              <Badge variant="destructive">Prohibited</Badge>
            )}
          </div>

          {matrix.allows_overnight && (
            <div className="space-y-3 mt-3">
              {/* Monthly limit */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Maximum nights per month</span>
                <span className="font-medium">
                  {matrix.nights_per_month || 'Unlimited'}
                </span>
              </div>

              {/* Consecutive limit */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Maximum consecutive nights</span>
                <span className="font-medium">
                  {matrix.max_consecutive_nights || 'Unlimited'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Day visit only */}
        {matrix.day_visit_only && (
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-900 dark:text-blue-100">
              <div className="font-medium">Day Visit Only Zone</div>
              <div className="mt-1">
                Overnight parking prohibited. Vehicles must depart before designated time.
              </div>
            </div>
          </div>
        )}

        {/* Allowed days */}
        {matrix.allowed_days && (
          <div className="p-4 rounded-lg border">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Allowed Days</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const).map(
                (day) => {
                  const isAllowed = matrix.allowed_days?.includes(day)
                  return (
                    <Badge
                      key={day}
                      variant={isAllowed ? 'default' : 'outline'}
                      className={isAllowed ? '' : 'opacity-50'}
                    >
                      {day.substring(0, 3)}
                    </Badge>
                  )
                }
              )}
            </div>
          </div>
        )}

        {/* Homeless exemption */}
        {matrix.homeless_exemption && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
            <div className="text-sm text-yellow-900 dark:text-yellow-100">
              <div className="font-medium">Homeless Exemption Active</div>
              <div className="mt-1">
                Confirmed homeless persons may be exempt from certain restrictions.
              </div>
            </div>
          </div>
        )}

        {/* Enforcement basis */}
        {matrix.enforcement_basis && (
          <div className="p-4 rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Legal Basis</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {matrix.enforcement_basis}
            </div>
            {matrix.csc_register_uri && (
              <a
                href={matrix.csc_register_uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-2 inline-block"
              >
                View CSC Register →
              </a>
            )}
          </div>
        )}

        {/* Effective dates */}
        {matrix.effective_from && (
          <div className="text-xs text-muted-foreground pt-3 border-t">
            Effective from: {formatDate(matrix.effective_from)}
            {matrix.effective_to && ` until ${formatDate(matrix.effective_to)}`}
            {matrix.change_reason && (
              <div className="mt-1">Reason: {matrix.change_reason}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

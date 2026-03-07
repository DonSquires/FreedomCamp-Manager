import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useOrganizations } from '@/hooks/useOrganizations'
import { useZones } from '@/hooks/useZones'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Database,
  TrendingUp,
  Info
} from 'lucide-react'

interface RecalculationResult {
  observations_processed: number
  compliance_changed: number
  drift_events_created: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

export default function ComplianceRecalculation() {
  const { user } = useAuthStore()
  const [scope, setScope] = useState<'organization' | 'zone' | 'date_range'>('organization')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [selectedZoneId, setSelectedZoneId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [result, setResult] = useState<RecalculationResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  const effectiveOrgId = selectedOrgId || (user?.role !== 'master' ? user?.organization_id || '' : '')

  const { data: organizations } = useOrganizations()
  const { data: zones } = useZones({ 
    organizationId: effectiveOrgId || undefined 
  })

  useEffect(() => {
    if (!selectedOrgId && user?.role !== 'master' && user?.organization_id) {
      setSelectedOrgId(user.organization_id)
    }
  }, [selectedOrgId, user?.organization_id, user?.role])

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const params: any = {}

      if (scope === 'organization' && effectiveOrgId) {
        params.organization_id = effectiveOrgId
      } else if (scope === 'zone' && selectedZoneId) {
        params.zone_id = selectedZoneId
      } else if (scope === 'date_range') {
        params.date_from = dateFrom
        params.date_to = dateTo
      }

      // Use the comprehensive recalculation function
      const { data, error } = await edgeFunctions.recalculateCompliance(params)
      
      if (error) throw new Error(error)
      return data as RecalculationResult
    },
    onMutate: () => {
      setIsRunning(true)
      setProgress(0)
      setResult(null)
      
      // Simulate progress (since we don't have real-time updates yet)
      const interval = setInterval(() => {
        setProgress(prev => Math.min(prev + 5, 90))
      }, 1000)
      
      return { interval }
    },
    onSuccess: (data) => {
      setProgress(100)
      setResult(data)
      toast.success('Compliance recalculation completed successfully')
    },
    onError: (error: any) => {
      setProgress(0)
      toast.error(error.message || 'Recalculation failed')
    },
    onSettled: (_, __, context: any) => {
      setIsRunning(false)
      if (context?.interval) {
        clearInterval(context.interval)
      }
    },
  })

  const handleRecalculate = () => {
    if (scope === 'organization' && !effectiveOrgId) {
      toast.error('Please select an organization')
      return
    }
    if (scope === 'zone' && !selectedZoneId) {
      toast.error('Please select a zone')
      return
    }
    if (scope === 'date_range' && (!dateFrom || !dateTo)) {
      toast.error('Please select both start and end dates')
      return
    }

    recalculateMutation.mutate(undefined as any)
  }

  return (
    <AppLayout 
      title="Compliance Recalculation" 
      description="Recalculate compliance status for observations"
      showBackButton
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Warning Banner */}
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                  Important: Recalculation Impact
                </h3>
                <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">
                  This operation will reprocess all observations in the selected scope and may:
                </p>
                <ul className="text-sm text-orange-700 dark:text-orange-200 mt-2 space-y-1 list-disc list-inside">
                  <li>Change compliance status for vehicles</li>
                  <li>Create or resolve breach alerts</li>
                  <li>Trigger enforcement notifications</li>
                  <li>Generate drift event logs if rules changed</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Recalculation Scope
            </CardTitle>
            <CardDescription>
              Select the scope for compliance recalculation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Scope Selection */}
            <div>
              <Label>Recalculation Scope</Label>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <Button
                  variant={scope === 'organization' ? 'default' : 'outline'}
                  onClick={() => setScope('organization')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Organization</div>
                    <div className="text-xs opacity-70">All zones</div>
                  </div>
                </Button>
                <Button
                  variant={scope === 'zone' ? 'default' : 'outline'}
                  onClick={() => setScope('zone')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Single Zone</div>
                    <div className="text-xs opacity-70">Specific area</div>
                  </div>
                </Button>
                <Button
                  variant={scope === 'date_range' ? 'default' : 'outline'}
                  onClick={() => setScope('date_range')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Date Range</div>
                    <div className="text-xs opacity-70">Time period</div>
                  </div>
                </Button>
              </div>
            </div>

            {/* Organization Selection */}
            {scope === 'organization' && (
              <div>
                <Label htmlFor="organization">Organization</Label>
                <select
                  id="organization"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  disabled={isRunning}
                  className="w-full mt-2 px-3 py-2 border rounded-md"
                >
                  <option value="">Select organization...</option>
                  {organizations?.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Zone Selection */}
            {scope === 'zone' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="org-for-zone">Organization</Label>
                  <select
                    id="org-for-zone"
                    value={selectedOrgId}
                    onChange={(e) => {
                      setSelectedOrgId(e.target.value)
                      setSelectedZoneId('')
                    }}
                    disabled={isRunning}
                    className="w-full mt-2 px-3 py-2 border rounded-md"
                  >
                    <option value="">Select organization...</option>
                    {organizations?.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedOrgId && (
                  <div>
                    <Label htmlFor="zone">Zone</Label>
                    <select
                      id="zone"
                      value={selectedZoneId}
                      onChange={(e) => setSelectedZoneId(e.target.value)}
                      disabled={isRunning || !selectedOrgId}
                      className="w-full mt-2 px-3 py-2 border rounded-md"
                    >
                      <option value="">Select zone...</option>
                      {zones?.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Date Range Selection */}
            {scope === 'date_range' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="date-from">Start Date</Label>
                  <Input
                    id="date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    disabled={isRunning}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="date-to">End Date</Label>
                  <Input
                    id="date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    disabled={isRunning}
                    className="mt-2"
                  />
                </div>
              </div>
            )}

            {/* Action Button */}
            <div className="pt-4 border-t">
              <Button
                onClick={handleRecalculate}
                disabled={isRunning}
                className="w-full"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Recalculating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2" />
                    Start Recalculation
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Progress Indicator */}
        {isRunning && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 animate-pulse" />
                Processing...
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-gray-600 text-center">
                {progress < 30 && "Loading observations..."}
                {progress >= 30 && progress < 60 && "Evaluating compliance rules..."}
                {progress >= 60 && progress < 90 && "Detecting breaches..."}
                {progress >= 90 && "Finalizing results..."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results Display */}
        {result && (
          <Card className="border-green-200 bg-green-50 dark:bg-green-900/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-900 dark:text-green-100">
                <CheckCircle className="h-5 w-5" />
                Recalculation Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Observations</div>
                  <div className="text-2xl font-bold mt-1">
                    {result.observations_processed.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Changed</div>
                  <div className="text-2xl font-bold text-orange-600 mt-1">
                    {result.compliance_changed.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Drift Events</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {result.drift_events_created.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="text-2xl font-bold text-purple-600 mt-1">
                    {result.duration_seconds}s
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
                  <p className="font-semibold">What happens next?</p>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Breach alerts have been updated or created</li>
                    <li>Vehicle compliance status has been refreshed</li>
                    <li>Monthly stay counts have been recalculated</li>
                    <li>Check the Breach Alerts page to review actions needed</li>
                  </ul>
                </div>
              </div>

              {result.drift_events_created > 0 && (
                <div className="flex items-start gap-3 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1 text-sm text-yellow-900 dark:text-yellow-100">
                    <p className="font-semibold">Compliance Drift Detected</p>
                    <p className="mt-1">
                      {result.drift_events_created} drift event(s) were created because compliance rules changed.
                      Review these in the Admin Portal to understand what changed and why.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

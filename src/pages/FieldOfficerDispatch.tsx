import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useOperationalCases } from '@/hooks/useOperationalCases'
import { Clock, ExternalLink, MapPin, Radio } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { buildSpecialtyPortalLink, getSpecialtyMeta, SpecialtyType } from '@/lib/officerPortalRouting'

export default function FieldOfficerDispatch() {
  const navigate = useNavigate()
  const { data: cases = [], isLoading, isError } = useOperationalCases({
    caseType: 'patrol_dispatch',
    limit: 50,
  })

  function openSpecialtyPortal(caseId: string, specialtyType: string) {
    const path = buildSpecialtyPortalLink({ specialtyType }, { dispatch: caseId })
    if (path) {
      navigate(path)
    }
  }

  return (
    <AppLayout title="Patrol Dispatch" description="Field officer dispatch queue and updates">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Patrol Dispatch
          </h1>
          <Badge variant="outline">{cases.length} cases</Badge>
        </div>

        <div data-testid="dispatch-form" className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Route-level dispatch intake is active. Select a case card to continue in full field workflow.
        </div>

        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading dispatch cases...</div>
        )}

        {isError && (
          <div className="text-sm text-destructive">Unable to load operational cases for dispatch.</div>
        )}

        {!isLoading && !isError && cases.length === 0 && (
          <Card data-testid="case-empty-state">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No active patrol dispatch cases for your organization.
            </CardContent>
          </Card>
        )}

        {cases.map((c) => {
          const specialtyType = (c as any).specialty_type as SpecialtyType | null
          const specialtyMeta = getSpecialtyMeta(specialtyType)

          return (
            <Card key={c.id} data-testid="case-card" className="border-l-4 border-l-blue-400">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{c.title || c.case_type || 'Dispatch Case'}</CardTitle>
                  {specialtyMeta && (
                    <Badge
                      className="shrink-0 text-xs"
                      style={{ backgroundColor: specialtyMeta.color + '33', color: specialtyMeta.color, borderColor: specialtyMeta.color }}
                      variant="outline"
                    >
                      {specialtyMeta.label}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{formatDateTime(c.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{c.status || 'pending'}</span>
                </div>
                {specialtyMeta && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 gap-1.5 text-xs"
                    onClick={() => openSpecialtyPortal(c.id, specialtyType!)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open {specialtyMeta.label} Portal
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </AppLayout>
  )
}

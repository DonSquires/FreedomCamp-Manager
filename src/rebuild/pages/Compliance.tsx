import { useMemo, useState } from 'react'
import CompliancePage from '@/pages/CompliancePage'
import ComplianceDashboard from '@/pages/ComplianceDashboard'
import ComplianceAnalytics from '@/pages/ComplianceAnalytics'

type ComplianceView = 'overview' | 'analytics' | 'operations'

export default function RebuildCompliancePage() {
  const [view, setView] = useState<ComplianceView>('overview')

  const title = useMemo(() => {
    if (view === 'overview') return 'Compliance Overview'
    if (view === 'analytics') return 'Compliance Analytics'
    return 'Compliance Operations'
  }, [view])

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Compliance</h1>
          <p className="text-sm text-muted-foreground">Unified clean-rebuild surface for compliance workflows.</p>
        </div>
        <div className="flex gap-2">
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'overview' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('overview')}>Overview</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'analytics' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('analytics')}>Analytics</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'operations' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('operations')}>Operations</button>
        </div>
      </div>

      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      {view === 'overview' && <ComplianceDashboard />}
      {view === 'analytics' && <ComplianceAnalytics />}
      {view === 'operations' && <CompliancePage />}
    </div>
  )
}

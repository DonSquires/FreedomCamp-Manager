import { useState } from 'react'
import BreachAlerts from '@/pages/BreachAlerts'
import BreachNotices from '@/pages/BreachNotices'

type BreachView = 'alerts' | 'notices'

export default function RebuildBreachesPage() {
  const [view, setView] = useState<BreachView>('alerts')

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Breaches</h1>
          <p className="text-sm text-muted-foreground">Unified alerts and notices workflow.</p>
        </div>
        <div className="flex gap-2">
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'alerts' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('alerts')}>Alerts</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'notices' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('notices')}>Notices</button>
        </div>
      </div>

      {view === 'alerts' && <BreachAlerts />}
      {view === 'notices' && <BreachNotices />}
    </div>
  )
}

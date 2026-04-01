import { useState } from 'react'
import EnforcementCommandCenter from '@/pages/EnforcementCommandCenter'
import EnforcementActions from '@/pages/EnforcementActions'
import EnforcementReview from '@/pages/EnforcementReview'

type EnforcementView = 'command' | 'actions' | 'review'

export default function RebuildEnforcementPage() {
  const [view, setView] = useState<EnforcementView>('command')

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enforcement</h1>
          <p className="text-sm text-muted-foreground">Consolidated command, actions, and review workflows.</p>
        </div>
        <div className="flex gap-2">
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'command' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('command')}>Command</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'actions' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('actions')}>Actions</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'review' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('review')}>Review</button>
        </div>
      </div>

      {view === 'command' && <EnforcementCommandCenter />}
      {view === 'actions' && <EnforcementActions />}
      {view === 'review' && <EnforcementReview />}
    </div>
  )
}

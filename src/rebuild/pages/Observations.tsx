import { useState } from 'react'
import ObservationRecords from '@/pages/ObservationRecords'
import ObservationsView from '@/pages/ObservationsView'
import ObservationsReport from '@/pages/ObservationsReport'

type ObservationView = 'records' | 'map' | 'report'

export default function RebuildObservationsPage() {
  const [view, setView] = useState<ObservationView>('records')

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Observations</h1>
          <p className="text-sm text-muted-foreground">Merged records, map view, and reporting in one surface.</p>
        </div>
        <div className="flex gap-2">
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'records' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('records')}>Records</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'map' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('map')}>Map</button>
          <button className={`rounded-md px-3 py-2 text-sm ${view === 'report' ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView('report')}>Report</button>
        </div>
      </div>

      {view === 'records' && <ObservationRecords />}
      {view === 'map' && <ObservationsView />}
      {view === 'report' && <ObservationsReport />}
    </div>
  )
}

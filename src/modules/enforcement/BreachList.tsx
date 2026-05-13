import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useBreaches } from '@/hooks/useBreaches'
import type { BreachStatus } from '@/types'

interface BreachListProps {
  selectedBreachId?: string | null
  onSelectBreach: (breachId: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  acknowledged: 'bg-blue-100 text-blue-800',
  enforcement_started: 'bg-red-100 text-red-800',
  resolved: 'bg-gray-100 text-gray-800',
  dismissed: 'bg-slate-100 text-slate-800',
}

export default function BreachList({ selectedBreachId, onSelectBreach }: BreachListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<BreachStatus | 'all'>('all')
  const { data: breaches, isLoading } = useBreaches({ searchQuery, statusFilter })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Breach Queue</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <input
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Search by plate"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="enforcement_started">Enforcement Started</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading breach queue...</p>
        ) : breaches && breaches.length > 0 ? (
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {breaches.map((breach) => {
              const status = breach.status || 'pending'
              const isSelected = breach.id === selectedBreachId

              return (
                <button
                  key={breach.id}
                  type="button"
                  onClick={() => onSelectBreach(breach.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{breach.plate_number || 'Unknown Plate'}</p>
                      <p className="text-xs text-muted-foreground">{breach.zone?.name || 'Unassigned zone'}</p>
                    </div>
                    <Badge className={STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}>{status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{breach.breach_type || 'Unknown breach type'}</p>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No breaches found for current filters.</p>
        )}
      </CardContent>
    </Card>
  )
}
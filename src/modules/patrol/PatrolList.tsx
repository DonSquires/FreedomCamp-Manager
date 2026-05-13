/**
 * PatrolList - Patrols with advanced filtering and status management
 * 
 * Uses UnifiedListView for config-driven list rendering.
 * Consolidates multiple old patrol list pages into one.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePatrols } from './hooks'
import type { Patrol, PatrolFilter } from './types'

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
}

export function PatrolList() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<PatrolFilter>({})
  const { data: patrols, isLoading, error } = usePatrols(filter)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-muted rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">Failed to load patrols</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Patrols</h1>
          <p className="text-muted-foreground text-sm">
            Manage and monitor all patrols
          </p>
        </div>
        <Button onClick={() => navigate('/patrol/new')}>
          + New Patrol
        </Button>
      </div>

      {/* Simple table for patrol list */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b">
            <tr>
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-left font-medium">Officer</th>
              <th className="px-4 py-2 text-left font-medium">Zone</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Scheduled Start</th>
              <th className="px-4 py-2 text-left font-medium">Duration (min)</th>
            </tr>
          </thead>
          <tbody>
            {patrols?.map((patrol: Patrol) => (
              <tr 
                key={patrol.id} 
                className="border-b hover:bg-muted/50 cursor-pointer"
                onClick={() => navigate(`/patrols/${patrol.id}`)}
              >
                <td className="px-4 py-2 font-mono text-xs">
                  {patrol.id.slice(0, 8)}
                </td>
                <td className="px-4 py-2">{patrol.officer_name}</td>
                <td className="px-4 py-2">{patrol.zone_name}</td>
                <td className="px-4 py-2">
                  <Badge className={STATUS_COLORS[patrol.status || ''] || 'bg-gray-100 text-gray-800'}>
                    {patrol.status || '—'}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {patrol.scheduled_start_time 
                    ? new Date(patrol.scheduled_start_time).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-2">
                  {patrol.duration_minutes || '—'}
                </td>
              </tr>
            ))}
            {(!patrols || patrols.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No patrols found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PatrolList

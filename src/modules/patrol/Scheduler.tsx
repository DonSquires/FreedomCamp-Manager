import { FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useZones } from '@/hooks/useZones'
import { useCreatePatrol, usePatrols, useUpdatePatrolStatus } from './hooks'

export default function Scheduler() {
  const [zoneId, setZoneId] = useState('')
  const [patrolDate, setPatrolDate] = useState('')
  const [shift, setShift] = useState('day')
  const [scheduledStartTime, setScheduledStartTime] = useState('')
  const [scheduledEndTime, setScheduledEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const { data: zones, isLoading: zonesLoading } = useZones()
  const { data: patrols, isLoading } = usePatrols({ status: 'scheduled' })
  const createPatrol = useCreatePatrol()
  const updateStatus = useUpdatePatrolStatus()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    await createPatrol.mutateAsync({
      zone_id: zoneId,
      patrol_date: patrolDate,
      shift,
      scheduled_start_time: scheduledStartTime || null,
      scheduled_end_time: scheduledEndTime || null,
      notes: notes || null,
    })

    setZoneId('')
    setPatrolDate('')
    setShift('day')
    setScheduledStartTime('')
    setScheduledEndTime('')
    setNotes('')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Create Scheduled Patrol</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="zoneId">Zone</label>
              <select
                id="zoneId"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={zoneId}
                onChange={(event) => setZoneId(event.target.value)}
                required
                disabled={zonesLoading || !zones?.length}
              >
                <option value="">{zonesLoading ? 'Loading zones...' : 'Select a zone'}</option>
                {(zones || []).map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
              {!zonesLoading && !zones?.length && (
                <p className="mt-1 text-xs text-muted-foreground">No active zones available for scheduling.</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="patrolDate">Patrol Date</label>
              <input
                id="patrolDate"
                type="date"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={patrolDate}
                onChange={(event) => setPatrolDate(event.target.value)}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="shift">Shift</label>
              <select
                id="shift"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={shift}
                onChange={(event) => setShift(event.target.value)}
              >
                <option value="day">Day</option>
                <option value="swing">Swing</option>
                <option value="night">Night</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="scheduledStart">Scheduled Start</label>
              <input
                id="scheduledStart"
                type="datetime-local"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={scheduledStartTime}
                onChange={(event) => setScheduledStartTime(event.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="scheduledEnd">Scheduled End</label>
              <input
                id="scheduledEnd"
                type="datetime-local"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={scheduledEndTime}
                onChange={(event) => setScheduledEndTime(event.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional dispatch notes"
              />
            </div>

            <Button className="w-full" disabled={createPatrol.isPending} type="submit">
              {createPatrol.isPending ? 'Scheduling...' : 'Schedule Patrol'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Patrol Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading scheduled patrols...</p>
          ) : patrols && patrols.length > 0 ? (
            <div className="space-y-2">
              {patrols.slice(0, 20).map((patrol) => (
                <div key={patrol.id} className="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium">{patrol.officer_name}</p>
                    <p className="text-xs text-muted-foreground">{patrol.zone_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {patrol.scheduled_start_time ? new Date(patrol.scheduled_start_time).toLocaleString() : 'No time set'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Scheduled</Badge>
                    <Button
                      size="sm"
                      onClick={() => updateStatus.mutate({ patrolId: patrol.id, status: 'active' })}
                      disabled={updateStatus.isPending}
                    >
                      Start
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus.mutate({ patrolId: patrol.id, status: 'cancelled' })}
                      disabled={updateStatus.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scheduled patrols found.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

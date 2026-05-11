export interface DispatchParityJob {
  status?: string | null
  title?: string | null
  priority?: string | null
  address?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  assigned_to?: string | null
  client_site_id?: string | null
  zone_id?: string | null
  dispatched_at?: string | null
  acknowledged_at?: string | null
  en_route_at?: string | null
  on_scene_at?: string | null
  completed_at?: string | null
}

export interface ParityCheck {
  key: string
  label: string
  required: boolean
  mapped: boolean
}

export interface DispatchParitySummary {
  coveragePercent: number
  mappedRequired: number
  totalRequired: number
  readyJobs: number
  totalJobs: number
  missingByKey: Array<{
    key: string
    label: string
    count: number
  }>
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  dispatched: 1,
  acknowledged: 2,
  en_route: 3,
  on_scene: 4,
  completed: 5,
  cancelled: 5,
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function hasLocation(job: DispatchParityJob) {
  return (
    hasValue(job.address) ||
    hasValue(job.zone_id) ||
    hasValue(job.client_site_id) ||
    (typeof job.gps_lat === 'number' && typeof job.gps_lng === 'number')
  )
}

function statusRank(status: string | null | undefined) {
  return STATUS_RANK[status ?? 'pending'] ?? 0
}

export function getDispatchParityChecks(job: DispatchParityJob): ParityCheck[] {
  const rank = statusRank(job.status)
  const isActive = rank > 0 && job.status !== 'completed' && job.status !== 'cancelled'

  return [
    {
      key: 'title',
      label: 'Job title',
      required: true,
      mapped: hasValue(job.title),
    },
    {
      key: 'priority',
      label: 'Priority',
      required: true,
      mapped: hasValue(job.priority),
    },
    {
      key: 'status',
      label: 'Lifecycle status',
      required: true,
      mapped: hasValue(job.status),
    },
    {
      key: 'location_context',
      label: 'Location/site context',
      required: true,
      mapped: hasLocation(job),
    },
    {
      key: 'assignment_context',
      label: 'Assigned officer',
      required: isActive,
      mapped: hasValue(job.assigned_to),
    },
    {
      key: 'dispatched_at',
      label: 'Dispatch timestamp',
      required: rank >= 1,
      mapped: hasValue(job.dispatched_at),
    },
    {
      key: 'acknowledged_at',
      label: 'Acknowledged timestamp',
      required: rank >= 2,
      mapped: hasValue(job.acknowledged_at),
    },
    {
      key: 'en_route_at',
      label: 'En route timestamp',
      required: rank >= 3,
      mapped: hasValue(job.en_route_at),
    },
    {
      key: 'on_scene_at',
      label: 'On scene timestamp',
      required: rank >= 4,
      mapped: hasValue(job.on_scene_at),
    },
    {
      key: 'completed_at',
      label: 'Completed timestamp',
      required: job.status === 'completed',
      mapped: hasValue(job.completed_at),
    },
  ]
}

export function summarizeDispatchParity(jobs: DispatchParityJob[]): DispatchParitySummary {
  const requiredChecks = jobs.flatMap((job) => getDispatchParityChecks(job).filter((check) => check.required))
  const mappedRequired = requiredChecks.filter((check) => check.mapped).length
  const totalRequired = requiredChecks.length
  const coveragePercent = totalRequired === 0 ? 100 : Math.round((mappedRequired / totalRequired) * 100)

  const missingByKeyMap = new Map<string, { key: string; label: string; count: number }>()

  let readyJobs = 0

  for (const job of jobs) {
    const missingChecks = getDispatchParityChecks(job).filter((check) => check.required && !check.mapped)

    if (missingChecks.length === 0) {
      readyJobs += 1
      continue
    }

    for (const check of missingChecks) {
      const existing = missingByKeyMap.get(check.key)
      if (existing) {
        existing.count += 1
      } else {
        missingByKeyMap.set(check.key, {
          key: check.key,
          label: check.label,
          count: 1,
        })
      }
    }
  }

  return {
    coveragePercent,
    mappedRequired,
    totalRequired,
    readyJobs,
    totalJobs: jobs.length,
    missingByKey: [...missingByKeyMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }
}

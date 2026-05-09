import { supabase } from '@/lib/supabase'

export type TrainingLibraryItem = {
  id: string
  title: string
  topic: string | null
  content_type: string
  status: string
  skill_tags: string[] | null
  site_id: string | null
  is_active: boolean
  generated_by_bob: boolean
  source_text: string | null
  created_at: string
}

export type TrainingAssignmentRow = {
  id: string
  officer_id: string
  title: string
  assignment_type: string
  status: string
  due_at: string | null
  completed_at: string | null
  required_skill: string | null
  assignment_reason: string | null
  officer?: {
    first_name: string
    last_name: string
  }
}

export type TrainingCompletionResult = {
  assignment_id: string
  officer_id: string
  attempt_no: number
  score: number
  passed: boolean
  competency_granted: boolean
  skill_name: string | null
  status: string
  completed_at: string
}

export type TrainingAssignmentAuditRow = {
  id: string
  officer_id: string
  title: string
  assignment_type: string
  status: string
  due_at: string | null
  completed_at: string | null
  required_skill: string | null
  assignment_reason: string | null
  created_at: string
  officer?: {
    first_name: string
    last_name: string
  }
  attempt_count: number
  last_attempt_score: number | null
  last_attempt_passed: boolean | null
  last_attempt_at: string | null
  reminder_count: number
  last_reminder_at: string | null
  last_reminder_delivery_status: 'queued' | 'sent' | 'failed' | null
  reminder_sent_count: number
  reminder_failed_count: number
  reminder_queued_count: number
}

export type TrainingReminderResult = {
  reminder_id: string
  assignment_id: string
  officer_id: string
  reminder_type: string
  message: string
  sent_at: string
  delivery_status: 'queued' | 'sent' | 'failed'
}

export type TrainingBulkReminderResult = {
  reminders_created: number
  assignments_targeted: number
  reminder_type: string
}

export type AutoAssignResult = {
  shift_id: string
  officer_id: string
  assignments_created: number
  missing_skills: string[]
  site_induction_assigned: boolean
}

export async function listTrainingLibrary(organizationId: string): Promise<TrainingLibraryItem[]> {
  if (!organizationId) return []

  const { data, error } = await (supabase as any)
    .from('training_material_library')
    .select('id, title, topic, content_type, status, skill_tags, site_id, is_active, generated_by_bob, source_text, created_at')
    .eq('organization_id', organizationId)
    .neq('status', 'retired')
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    if (error.code === '42P01' || error.code === '42703') return []
    throw error
  }

  return (data ?? []) as TrainingLibraryItem[]
}

export async function listTrainingAssignmentQueue(organizationId: string): Promise<TrainingAssignmentRow[]> {
  if (!organizationId) return []

  const { data, error } = await (supabase as any)
    .from('training_assignments')
    .select('id, officer_id, title, assignment_type, status, due_at, completed_at, required_skill, assignment_reason, officer:user_profiles!officer_id(first_name, last_name)')
    .eq('organization_id', organizationId)
    .in('status', ['assigned', 'in_progress', 'overdue'])
    .order('due_at', { ascending: true })
    .limit(40)

  if (error) {
    if (error.code === '42P01') return []
    throw error
  }

  return (data ?? []) as TrainingAssignmentRow[]
}

export async function saveTrainingModuleToLibrary(payload: Record<string, unknown>): Promise<void> {
  const { error } = await (supabase as any).from('training_material_library').insert(payload)
  if (error) throw error
}

export async function recordTrainingCompletionAttempt(params: {
  assignmentId: string
  score: number
  evidence?: string
  notes?: string
  passed?: boolean
  actorId: string | null
}): Promise<TrainingCompletionResult> {
  const { data, error } = await (supabase as any).rpc('record_training_completion_attempt', {
    p_assignment_id: params.assignmentId,
    p_score: Math.max(0, Math.min(100, params.score)),
    p_evidence: params.evidence || null,
    p_notes: params.notes || null,
    p_passed: typeof params.passed === 'boolean' ? params.passed : null,
    p_actor_id: params.actorId,
  })

  if (error) throw error
  const result = Array.isArray(data) ? data[0] : data
  if (!result) {
    throw new Error('Training completion attempt returned no result')
  }

  return result as TrainingCompletionResult
}

export async function listTrainingAssignmentAudit(organizationId: string): Promise<TrainingAssignmentAuditRow[]> {
  if (!organizationId) return []

  const { data: assignments, error: assignmentError } = await (supabase as any)
    .from('training_assignments')
    .select('id, officer_id, title, assignment_type, status, due_at, completed_at, required_skill, assignment_reason, created_at, officer:user_profiles!officer_id(first_name, last_name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (assignmentError) {
    if (assignmentError.code === '42P01') return []
    throw assignmentError
  }

  const rows = Array.isArray(assignments) ? assignments : []
  if (!rows.length) return []

  const assignmentIds = rows.map((row: any) => row.id).filter(Boolean)

  const [attemptRes, reminderResInitial] = await Promise.all([
    (supabase as any)
      .from('training_completion_attempts')
      .select('assignment_id, attempt_no, score, passed, completed_at')
      .eq('organization_id', organizationId)
      .in('assignment_id', assignmentIds)
      .order('attempt_no', { ascending: false }),
    (supabase as any)
      .from('training_assignment_reminders')
      .select('assignment_id, sent_at, delivery_status')
      .eq('organization_id', organizationId)
      .in('assignment_id', assignmentIds)
      .order('sent_at', { ascending: false }),
  ])

  let reminderRes = reminderResInitial
  if (reminderResInitial.error?.code === '42703') {
    reminderRes = await (supabase as any)
      .from('training_assignment_reminders')
      .select('assignment_id, sent_at')
      .eq('organization_id', organizationId)
      .in('assignment_id', assignmentIds)
      .order('sent_at', { ascending: false })
  }

  if (attemptRes.error && attemptRes.error.code !== '42P01') {
    throw attemptRes.error
  }
  if (reminderRes.error && reminderRes.error.code !== '42P01') {
    throw reminderRes.error
  }

  const attemptMap = new Map<string, {
    count: number
    latestScore: number | null
    latestPassed: boolean | null
    latestAt: string | null
  }>()

  for (const attempt of attemptRes.data ?? []) {
    const key = String(attempt.assignment_id || '')
    if (!key) continue
    const current = attemptMap.get(key)
    if (!current) {
      attemptMap.set(key, {
        count: 1,
        latestScore: typeof attempt.score === 'number' ? attempt.score : null,
        latestPassed: typeof attempt.passed === 'boolean' ? attempt.passed : null,
        latestAt: attempt.completed_at || null,
      })
      continue
    }
    current.count += 1
  }

  const reminderMap = new Map<string, {
    count: number
    latestAt: string | null
    latestDeliveryStatus: 'queued' | 'sent' | 'failed' | null
    sentCount: number
    failedCount: number
    queuedCount: number
  }>()
  for (const reminder of reminderRes.data ?? []) {
    const key = String(reminder.assignment_id || '')
    if (!key) continue
    const status = ['queued', 'sent', 'failed'].includes(String(reminder.delivery_status || ''))
      ? (String(reminder.delivery_status) as 'queued' | 'sent' | 'failed')
      : null

    const current = reminderMap.get(key)
    if (!current) {
      reminderMap.set(key, {
        count: 1,
        latestAt: reminder.sent_at || null,
        latestDeliveryStatus: status,
        sentCount: status === 'sent' ? 1 : 0,
        failedCount: status === 'failed' ? 1 : 0,
        queuedCount: status === 'queued' ? 1 : 0,
      })
      continue
    }
    current.count += 1
    if (status === 'sent') current.sentCount += 1
    if (status === 'failed') current.failedCount += 1
    if (status === 'queued') current.queuedCount += 1
  }

  return rows.map((row: any) => {
    const attempt = attemptMap.get(String(row.id || ''))
    const reminder = reminderMap.get(String(row.id || ''))

    return {
      id: String(row.id || ''),
      officer_id: String(row.officer_id || ''),
      title: String(row.title || ''),
      assignment_type: String(row.assignment_type || ''),
      status: String(row.status || ''),
      due_at: row.due_at || null,
      completed_at: row.completed_at || null,
      required_skill: row.required_skill || null,
      assignment_reason: row.assignment_reason || null,
      created_at: row.created_at || new Date(0).toISOString(),
      officer: row.officer,
      attempt_count: attempt?.count ?? 0,
      last_attempt_score: attempt?.latestScore ?? null,
      last_attempt_passed: attempt?.latestPassed ?? null,
      last_attempt_at: attempt?.latestAt ?? null,
      reminder_count: reminder?.count ?? 0,
      last_reminder_at: reminder?.latestAt ?? null,
      last_reminder_delivery_status: reminder?.latestDeliveryStatus ?? null,
      reminder_sent_count: reminder?.sentCount ?? 0,
      reminder_failed_count: reminder?.failedCount ?? 0,
      reminder_queued_count: reminder?.queuedCount ?? 0,
    }
  }) as TrainingAssignmentAuditRow[]
}

export async function sendTrainingAssignmentReminder(params: {
  assignmentId: string
  reminderType?: 'in_app' | 'email' | 'sms' | 'escalation'
  message?: string
  actorId: string | null
}): Promise<TrainingReminderResult> {
  const { data, error } = await (supabase as any).rpc('send_training_assignment_reminder', {
    p_assignment_id: params.assignmentId,
    p_reminder_type: params.reminderType || 'in_app',
    p_message: params.message || null,
    p_actor_id: params.actorId,
  })

  if (error) throw error

  const result = Array.isArray(data) ? data[0] : data
  if (!result) {
    throw new Error('Reminder call returned no result')
  }

  return result as TrainingReminderResult
}

export async function sendBulkTrainingAssignmentReminders(params: {
  organizationId: string
  statusFilter: Array<'assigned' | 'in_progress' | 'overdue' | 'cancelled'>
  dueBefore?: string | null
  reminderType?: 'in_app' | 'email' | 'sms' | 'escalation'
  messageTemplate?: string
  actorId: string | null
}): Promise<TrainingBulkReminderResult> {
  const { data, error } = await (supabase as any).rpc('send_bulk_training_assignment_reminders', {
    p_organization_id: params.organizationId,
    p_status_filter: params.statusFilter,
    p_due_before: params.dueBefore || null,
    p_reminder_type: params.reminderType || 'in_app',
    p_message_template: params.messageTemplate || null,
    p_actor_id: params.actorId,
  })

  if (error) throw error

  const result = Array.isArray(data) ? data[0] : data
  if (!result) {
    throw new Error('Bulk reminder call returned no result')
  }

  return result as TrainingBulkReminderResult
}

export async function runAutoAssignTraining(params: {
  organizationId: string
  hoursAhead: number
  actorId: string | null
}): Promise<AutoAssignResult[]> {
  const { data, error } = await (supabase as any).rpc('auto_assign_training_for_upcoming_shifts', {
    p_organization_id: params.organizationId,
    p_hours_ahead: Math.max(1, params.hoursAhead),
    p_actor_id: params.actorId,
  })

  if (error) throw error
  return Array.isArray(data) ? (data as AutoAssignResult[]) : []
}

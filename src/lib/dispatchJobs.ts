import { supabase } from '@/lib/supabase'

const DISPATCH_JOB_ALARM_TYPE_ERROR = 'dispatch_jobs.alarm_type'
const DISPATCH_JOB_ALARM_TYPE_SCHEMA_CACHE_ERROR = "'alarm_type' column of 'dispatch_jobs'"

const SITE_CODE_TYPES = ['alarm', 'gate', 'door', 'key_box'] as const

function codeTypeLabel(codeType: string) {
  if (codeType === 'alarm') return 'Alarm code'
  if (codeType === 'gate') return 'Gate code'
  if (codeType === 'door') return 'Door code'
  if (codeType === 'key_box') return 'Key box code'
  return codeType
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function buildDispatchSiteDetails(
  organizationId: string,
  clientSiteId: string,
): Promise<string[]> {
  const lines: string[] = []

  const { data: codeRows, error: codesError } = await (supabase as any)
    .from('site_access_codes')
    .select('code_type, name, location, code_value, instructions')
    .eq('organization_id', organizationId)
    .eq('client_site_id', clientSiteId)
    .eq('is_active', true)
    .in('code_type', [...SITE_CODE_TYPES])
    .order('code_type', { ascending: true })
    .order('name', { ascending: true })

  if (!codesError) {
    for (const row of codeRows || []) {
      const typeLabel = codeTypeLabel(String(row.code_type || '').trim())
      const value = String(row.code_value || '').trim()
      const location = String(row.location || '').trim()
      const name = String(row.name || '').trim()
      if (!value) continue
      lines.push(`${typeLabel}: ${value}${location ? ` (${location})` : ''}${name ? ` - ${name}` : ''}`)
    }
  }

  const { data: keySets, error: keyError } = await (supabase as any)
    .from('key_sets')
    .select('id, name, status, storage_location, custom_data, keys(key_number, name, key_code, is_active)')
    .eq('organization_id', organizationId)
    .eq('client_site_id', clientSiteId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (!keyError && Array.isArray(keySets) && keySets.length > 0) {
    const preferred = keySets.find((set) => set.status === 'available') || keySets[0]

    if (preferred) {
      const customData = toRecord(preferred.custom_data)
      const chainBarcode = String(customData.chain_barcode || customData.barcode || '').trim()
      const candidateKeys = Array.isArray(preferred.keys)
        ? preferred.keys.filter((key) => key && key.is_active)
        : []
      const selectedKey = candidateKeys.find((key) => key.key_code) || candidateKeys[0] || null
      const keyBarcode = String(selectedKey?.key_code || customData.key_barcode || '').trim()

      lines.push(`Patrol key chain: ${String(preferred.name || '').trim() || preferred.id}`)
      if (chainBarcode) lines.push(`Chain barcode: ${chainBarcode}`)
      if (keyBarcode) lines.push(`Key barcode: ${keyBarcode}`)
      if (selectedKey) {
        const keyNumber = String(selectedKey.key_number || '').trim()
        const keyName = String(selectedKey.name || '').trim()
        const keyLabel = `${keyNumber} ${keyName}`.trim()
        if (keyLabel) lines.push(`Key detail: ${keyLabel}`)
      }
      const storage = String(preferred.storage_location || '').trim()
      if (storage) lines.push(`Key storage: ${storage}`)
    }
  }

  return lines
}

async function enrichDispatchPayloadWithSiteDetails(payload: Record<string, unknown>) {
  const organizationId = String(payload.organization_id || '').trim()
  const clientSiteId = String(payload.client_site_id || '').trim()

  if (!organizationId || !clientSiteId) {
    return payload
  }

  const siteDetails = await buildDispatchSiteDetails(organizationId, clientSiteId)
  if (!siteDetails.length) {
    return payload
  }

  const existingDescription = String(payload.description || '').trim()
  const autoBlock = `Auto site details:\n${siteDetails.join('\n')}`

  if (existingDescription.includes('Auto site details:')) {
    return payload
  }

  return {
    ...payload,
    description: [existingDescription, autoBlock].filter(Boolean).join('\n\n'),
  }
}

export function isDispatchJobAlarmTypeMissing(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || ''
  const isPostgresUndefinedColumn = error?.code === '42703' && message.includes(DISPATCH_JOB_ALARM_TYPE_ERROR)
  const isPostgrestSchemaCacheMiss =
    (error?.code === 'PGRST204' || message.toLowerCase().includes('schema cache')) &&
    message.includes(DISPATCH_JOB_ALARM_TYPE_SCHEMA_CACHE_ERROR)

  return isPostgresUndefinedColumn || isPostgrestSchemaCacheMiss
}

export async function runDispatchJobsQueryWithAlarmTypeFallback<T>(
  buildQuery: (includeAlarmType: boolean) => Promise<{ data: T | null; error: { code?: string; message?: string } | null }>,
) {
  const initialResult = await buildQuery(true)
  if (!isDispatchJobAlarmTypeMissing(initialResult.error)) {
    return initialResult
  }

  return buildQuery(false)
}

export async function insertDispatchJobWithAlarmTypeFallback<T>(
  payload: Record<string, unknown>,
  selectClause: string,
) {
  const enrichedPayload = await enrichDispatchPayloadWithSiteDetails(payload)

  const initialResult = await (supabase as any)
    .from('dispatch_jobs')
    .insert({
      ...enrichedPayload,
      organization_id: (enrichedPayload as any).organization_id ?? null,
    })
    .select(selectClause)
    .single()

  if (!isDispatchJobAlarmTypeMissing(initialResult.error)) {
    return initialResult as { data: T | null; error: { code?: string; message?: string } | null }
  }

  const { alarm_type: _alarmType, ...fallbackPayload } = enrichedPayload
  return await (supabase as any)
    .from('dispatch_jobs')
    .insert({
      ...fallbackPayload,
      organization_id: (fallbackPayload as any).organization_id ?? null,
    })
    .select(selectClause)
    .single() as { data: T | null; error: { code?: string; message?: string } | null }
}
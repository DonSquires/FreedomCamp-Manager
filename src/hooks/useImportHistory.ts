/**
 * Custom Hook: useImportHistory
 * Data import tracking and validation
 *
 * NOTE: The original `import_history` table never existed in migrations.
 * Historical imports are tracked in the `import_batches` table.
 * Column mapping:  imported_by → uploaded_by
 *                  records_imported → successful_records
 *                  import_type → import_config->>'import_type'
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface ImportRecord {
  id: string
  organization_id: string
  imported_by: string
  import_type: string
  file_name: string | null
  records_imported: number
  duplicates_skipped: number
  failed_records: number
  status: 'completed' | 'failed' | 'partial' | 'pending' | 'processing'
  error_log: any[]
  created_at: string
  importer: {
    first_name: string
    last_name: string
    email: string
  }
}

interface ImportStats {
  total_imports: number
  total_records: number
  total_duplicates: number
  total_failures: number
  success_rate: number
  by_type: Record<string, number>
  recent_imports: ImportRecord[]
}

// Raw row shape returned by import_batches (not in generated types)
interface ImportBatchRow {
  id: string
  organization_id: string
  uploaded_by: string
  batch_name: string
  file_name: string | null
  status: string
  successful_records: number
  failed_records: number
  import_config: Record<string, string> | null
  error_summary: string | null
  created_at: string
  importer: { first_name: string; last_name: string; email: string } | null
}

// Map an import_batches row to the ImportRecord shape
function mapBatchToRecord(row: ImportBatchRow): ImportRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    imported_by: row.uploaded_by,
    import_type: row.import_config?.import_type || 'historical',
    file_name: row.file_name,
    records_imported: row.successful_records || 0,
    duplicates_skipped: 0,
    failed_records: row.failed_records || 0,
    status: row.status === 'completed' ? 'completed'
          : row.status === 'failed'    ? 'failed'
          : row.status === 'processing' || row.status === 'enriching' ? 'processing'
          : row.status === 'pending'   ? 'pending'
          : 'partial',
    error_log: row.error_summary ? [row.error_summary] : [],
    created_at: row.created_at,
    importer: row.importer || { first_name: '', last_name: '', email: '' },
  }
}

export function useImportHistory(options?: {
  organizationId?: string
  importType?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}) {
  const { user } = useAuthStore()

  const query = useQuery({
    queryKey: ['import-history', options],
    queryFn: async () => {
      let query = (supabase.from('import_batches') as any)
        .select(`
          *,
          importer:user_profiles!import_batches_uploaded_by_fkey(first_name, last_name, email)
        `)
        .order('created_at', { ascending: false })
        .limit(options?.limit || 50)

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Filters
      if (options?.status) {
        // 'partial' maps to 'processing'/'enriching' in import_batches
        const dbStatus = options.status === 'partial' ? 'processing' : options.status
        query = query.eq('status', dbStatus)
      }
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load import history')
        throw error
      }

      const rows = (data || []) as ImportBatchRow[]

      // Optional client-side filter by import_type (stored in JSONB)
      const filtered = options?.importType
        ? rows.filter(r => (r.import_config?.import_type || 'historical') === options.importType)
        : rows

      return filtered.map(mapBatchToRecord) as ImportRecord[]
    },
  })

  return {
    imports: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

// Hook for import statistics
export function useImportStats(options?: {
  organizationId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['import-stats', options],
    queryFn: async () => {
      let query = (supabase.from('import_batches') as any)
        .select('*')

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Date filters
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) throw error

      const rows = (data || []) as ImportBatchRow[]
      const mapped = rows.map(mapBatchToRecord)

      // Calculate statistics
      const total_imports = mapped.length
      const total_records = mapped.reduce((sum, imp) => sum + imp.records_imported, 0)
      const total_duplicates = 0 // not tracked in import_batches
      const total_failures = mapped.reduce((sum, imp) => sum + imp.failed_records, 0)
      const success_rate = total_records > 0
        ? ((total_records - total_failures) / total_records * 100)
        : 0

      const by_type = mapped.reduce((acc: Record<string, number>, imp) => {
        acc[imp.import_type] = (acc[imp.import_type] || 0) + imp.records_imported
        return acc
      }, {})

      return {
        total_imports,
        total_records,
        total_duplicates,
        total_failures,
        success_rate: Math.round(success_rate * 10) / 10,
        by_type,
        recent_imports: mapped.slice(0, 10),
      } as ImportStats
    },
  })
}

// Hook for single import record
export function useImportRecord(id: string | null) {
  return useQuery({
    queryKey: ['import-record', id],
    queryFn: async () => {
      if (!id) return null

      const { data, error } = await (supabase.from('import_batches') as any)
        .select(`
          *,
          importer:user_profiles!import_batches_uploaded_by_fkey(first_name, last_name, email)
        `)
        .eq('id', id)
        .single()

      if (error) {
        toast.error('Failed to load import record')
        throw error
      }

      return mapBatchToRecord(data) as ImportRecord
    },
    enabled: !!id,
  })
}

// Hook for recent imports
export function useRecentImports(limit: number = 10) {
  return useImportHistory({ limit })
}

// Hook for failed imports
export function useFailedImports() {
  return useImportHistory({ status: 'failed', limit: 20 })
}

// Hook for import validation
export function useValidateImport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const fileContent = await file.text()

      const { data, error } = await supabase.functions.invoke('import-data', {
        body: {
          fileContent,
          fileName: file.name,
          isImage: file.type.startsWith('image/'),
        },
      })

      if (error) {
        toast.error('Failed to validate import file')
        throw error
      }

      return data
    },
    onSuccess: (data) => {
      if (data.errors && data.errors.length > 0) {
        toast.warning(`Validation found ${data.errors.length} issues`)
      } else {
        toast.success('File validation passed')
      }
    },
  })
}

// Hook for triggering imports
export function useImportData() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      file,
      importType
    }: {
      file: File
      importType: 'observations' | 'vehicles' | 'zones' | 'users' | 'historical'
    }) => {
      const fileContent = await file.text()

      const { data, error } = await supabase.functions.invoke('import-data', {
        body: {
          fileContent,
          fileName: file.name,
          isImage: file.type.startsWith('image/'),
          importType,
          organizationId: user?.organization_id || undefined,
        },
      })

      if (error) {
        toast.error('Import failed')
        throw error
      }

      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['import-history'] })
      queryClient.invalidateQueries({ queryKey: ['import-stats'] })

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['observations'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['zones'] })

      toast.success(`Imported ${data.records_imported} records`)

      if (data.duplicates_skipped > 0) {
        toast.info(`Skipped ${data.duplicates_skipped} duplicates`)
      }
      if (data.failed_records > 0) {
        toast.warning(`Failed to import ${data.failed_records} records`)
      }
    },
    onError: () => {
      toast.error('Import failed')
    },
  })
}

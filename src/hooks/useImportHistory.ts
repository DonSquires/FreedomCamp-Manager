/**
 * Custom Hook: useImportHistory
 * Data import tracking and validation
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface ImportRecord {
  id: string
  organization_id: string
  imported_by: string
  import_type: 'observations' | 'vehicles' | 'zones' | 'users' | 'historical'
  file_name: string | null
  records_imported: number
  duplicates_skipped: number
  failed_records: number
  status: 'completed' | 'failed' | 'partial'
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
      let query = supabase
        .from('import_history')
        .select(`
          *,
          importer:user_profiles!import_history_imported_by_fkey(first_name, last_name, email)
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
      if (options?.importType) {
        query = query.eq('import_type', options.importType)
      }
      if (options?.status) {
        query = query.eq('status', options.status)
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

      return data as ImportRecord[]
    },
  })

  return {
    imports: query.data,
    isLoading: query.isLoading,
    error: query.error,
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
      let query = supabase
        .from('import_history')
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

      // Calculate statistics
      const total_imports = data?.length || 0
      const total_records = data?.reduce((sum, imp) => sum + imp.records_imported, 0) || 0
      const total_duplicates = data?.reduce((sum, imp) => sum + imp.duplicates_skipped, 0) || 0
      const total_failures = data?.reduce((sum, imp) => sum + imp.failed_records, 0) || 0
      const success_rate = total_records > 0 
        ? ((total_records - total_failures) / total_records * 100)
        : 0

      const by_type = (data || []).reduce((acc: Record<string, number>, imp) => {
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
        recent_imports: data?.slice(0, 10) || [],
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

      const { data, error } = await supabase
        .from('import_history')
        .select(`
          *,
          importer:user_profiles!import_history_imported_by_fkey(first_name, last_name, email)
        `)
        .eq('id', id)
        .single()

      if (error) {
        toast.error('Failed to load import record')
        throw error
      }

      return data as ImportRecord
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
      // Preview import file without committing
      const formData = new FormData()
      formData.append('file', file)
      formData.append('validate_only', 'true')

      const { data, error } = await supabase.functions.invoke('import-data', {
        body: formData,
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
      const formData = new FormData()
      formData.append('file', file)
      formData.append('import_type', importType)
      formData.append('organization_id', user?.organization_id || '')

      const { data, error } = await supabase.functions.invoke('import-data', {
        body: formData,
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

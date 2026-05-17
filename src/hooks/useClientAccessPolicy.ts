import { useOrgModules } from '@/hooks/useOrgModules'
import { useAuthStore } from '@/stores/authStore'

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function useClientAccessPolicy() {
  const { user } = useAuthStore()
  const { moduleConfig, isLoading } = useOrgModules()

  const isClientRole = ['client_viewer', 'client_officer', 'client_admin'].includes(user?.role ?? '')

  const reportingConfig = moduleConfig('reporting')
  const crmConfig = moduleConfig('crm')

  const clientPortalAccessMode =
    readString(crmConfig.client_portal_access_mode) ??
    readString(crmConfig.access_mode) ??
    'transparency_only'

  const reportsEnabled = readBoolean(
    reportingConfig.client_portal_reports_enabled ?? reportingConfig.reports_enabled,
    true
  )

  const financeEnabled = readBoolean(
    crmConfig.client_portal_finance_enabled ?? crmConfig.finance_enabled,
    true
  )

  const contractProfileCode =
    readString(reportingConfig.contract_profile_code) ??
    readString(crmConfig.contract_profile_code)

  const monthlyReportTemplateCode =
    readString(reportingConfig.monthly_report_template_code) ??
    readString(crmConfig.monthly_report_template_code)

  return {
    isClientRole,
    isLoading,
    clientPortalAccessMode,
    reportsEnabled,
    financeEnabled,
    contractProfileCode,
    monthlyReportTemplateCode,
  }
}
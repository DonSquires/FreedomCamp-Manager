/**
 * Dashboard module types
 */

export interface DashboardKPI {
  label: string
  value: number
  change?: number
  trend?: 'up' | 'down' | 'neutral'
}

export interface AlertSummary {
  total_count: number
  critical: number
  high: number
  medium: number
  low: number
}

export interface PatrolStats {
  total: number
  active: number
  completed: number
  cancelled: number
  average_duration: number
}

export interface OperationsStatus {
  zones_enabled: number
  vehicles_active: number
  incidents_open: number
}

export interface OfficerWelfareAlert {
  officer_id: string
  alert_type: 'fatigue' | 'offline' | 'overdue'
  severity: 'low' | 'medium' | 'high'
  timestamp: string
  message: string
}

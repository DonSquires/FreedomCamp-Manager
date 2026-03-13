/**
 * CSV Export Utilities
 */

export interface CSVColumn {
  key: string
  label: string
  format?: (value: any, row?: any) => string
}

/**
 * Convert array of objects to CSV string
 */
export function arrayToCSV<T extends Record<string, any>>(
  data: T[],
  columns: CSVColumn[]
): string {
  // Header row
  const headers = columns.map(col => escapeCSVValue(col.label)).join(',')
  
  // Data rows
  const rows = data.map(row => {
    return columns
      .map(col => {
        const value = row[col.key]
        const formattedValue = col.format ? col.format(value, row) : String(value ?? '')
        return escapeCSVValue(formattedValue)
      })
      .join(',')
  })

  return [headers, ...rows].join('\n')
}

/**
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCSVValue(value: string): string {
  if (value === null || value === undefined) return ''
  
  const str = String(value)
  
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  
  return str
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, fileName: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', fileName)
  link.style.visibility = 'hidden'
  
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  URL.revokeObjectURL(url)
}

/**
 * Export observations to CSV
 */
export function exportObservationsCSV(
  observations: Array<{
    plate_number: string
    zone_name?: string
    recorded_at: string
    recorded_by_name?: string
    is_compliant: boolean
    gps_latitude: number
    gps_longitude: number
  }>,
  fileName = 'observations.csv'
): void {
  const columns: CSVColumn[] = [
    { key: 'plate_number', label: 'Plate Number' },
    { key: 'zone_name', label: 'Zone' },
    { 
      key: 'recorded_at', 
      label: 'Date/Time',
      format: (val) => new Date(val).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
    },
    { key: 'recorded_by_name', label: 'Recorded By' },
    { 
      key: 'is_compliant', 
      label: 'Compliant',
      format: (val) => val ? 'Yes' : 'No'
    },
    { key: 'gps_latitude', label: 'Latitude' },
    { key: 'gps_longitude', label: 'Longitude' },
  ]

  const csv = arrayToCSV(observations, columns)
  downloadCSV(csv, fileName)
}

/**
 * Export vehicles to CSV
 */
export function exportVehiclesCSV(
  vehicles: Array<{
    plate_number: string
    make?: string
    model?: string
    year?: number
    colour?: string
    self_contained: boolean
    total_observations: number
    total_breaches: number
  }>,
  fileName = 'vehicles.csv'
): void {
  const columns: CSVColumn[] = [
    { key: 'plate_number', label: 'Plate Number' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'year', label: 'Year' },
    { key: 'colour', label: 'Colour' },
    { 
      key: 'self_contained', 
      label: 'Self-Contained',
      format: (val) => val ? 'Yes' : 'No'
    },
    { key: 'total_observations', label: 'Total Observations' },
    { key: 'total_breaches', label: 'Total Breaches' },
  ]

  const csv = arrayToCSV(vehicles, columns)
  downloadCSV(csv, fileName)
}

/**
 * Export breaches to CSV
 */
export function exportBreachesCSV(
  breaches: Array<{
    plate_number: string
    zone_name?: string
    breach_type: string
    severity: string
    status: string
    /** `created_at` is the canonical DB column; `detected_at` is a legacy alias. */
    created_at?: string
    detected_at?: string
    resolved_at?: string
  }>,
  fileName = 'breaches.csv'
): void {
  const columns: CSVColumn[] = [
    { key: 'plate_number', label: 'Plate Number' },
    { key: 'zone_name', label: 'Zone' },
    { key: 'breach_type', label: 'Breach Type' },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: 'Status' },
    { 
      key: 'created_at', 
      label: 'Detected At',
      format: (val, row: any) => {
        const ts = val ?? row?.detected_at
        return ts ? new Date(ts).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) : ''
      }
    },
    { 
      key: 'resolved_at', 
      label: 'Resolved At',
      format: (val) => val ? new Date(val).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) : 'Not resolved'
    },
  ]

  const csv = arrayToCSV(breaches, columns)
  downloadCSV(csv, fileName)
}

/**
 * Export users to CSV
 */
export function exportUsersCSV(
  users: Array<{
    email: string
    first_name: string
    last_name: string
    role: string
    is_active: boolean
    created_at: string
  }>,
  fileName = 'users.csv'
): void {
  const columns: CSVColumn[] = [
    { key: 'email', label: 'Email' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'role', label: 'Role' },
    { 
      key: 'is_active', 
      label: 'Active',
      format: (val) => val ? 'Yes' : 'No'
    },
    { 
      key: 'created_at', 
      label: 'Created At',
      format: (val) => new Date(val).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })
    },
  ]

  const csv = arrayToCSV(users, columns)
  downloadCSV(csv, fileName)
}

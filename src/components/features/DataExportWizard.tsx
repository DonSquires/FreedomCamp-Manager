/**
 * DataExportWizard Component
 * Step-by-step export configuration
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { 
  Download,
  FileText,
  FileSpreadsheet,
  Database,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { exportMultiSheetXlsx, type XlsxColumn } from '@/lib/xlsxExport'
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'

type ExportFormat = 'csv' | 'json' | 'excel'
type ExportData = 'observations' | 'vehicles' | 'breaches' | 'enforcement' | 'zones' | 'users'

interface DataExportWizardProps {
  onExport?: (config: ExportConfig) => Promise<void>
  onClose?: () => void
}

interface ExportConfig {
  format: ExportFormat
  dataTypes: ExportData[]
  dateFrom?: string
  dateTo?: string
  includeDeleted: boolean
  includeArchived: boolean
}

const EXPORT_FORMATS: { id: ExportFormat; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'csv',
    label: 'CSV',
    icon: <FileText className="h-8 w-8" />,
    description: 'Comma-separated values, compatible with Excel and spreadsheets',
  },
  {
    id: 'json',
    label: 'JSON',
    icon: <Database className="h-8 w-8" />,
    description: 'Structured data format for developers and integrations',
  },
  {
    id: 'excel',
    label: 'Excel',
    icon: <FileSpreadsheet className="h-8 w-8" />,
    description: 'Microsoft Excel workbook with multiple sheets',
  },
]

const DATA_TYPES: { id: ExportData; label: string; description: string }[] = [
  { id: 'observations', label: 'Observations', description: 'Vehicle sightings and compliance data' },
  { id: 'vehicles', label: 'Vehicles', description: 'Vehicle profiles and history' },
  { id: 'breaches', label: 'Breach Alerts', description: 'Compliance violations and warnings' },
  { id: 'enforcement', label: 'Enforcement Actions', description: 'Warnings, notices, and tow requests' },
  { id: 'zones', label: 'Zones', description: 'Zone definitions and rules' },
  { id: 'users', label: 'Users', description: 'User accounts and permissions' },
]

export function DataExportWizard({
  onExport,
  onClose,
}: DataExportWizardProps) {
  const [step, setStep] = useState(1)
  const [config, setConfig] = useState<ExportConfig>({
    format: 'csv',
    dataTypes: [],
    includeDeleted: false,
    includeArchived: false,
  })
  const [isExporting, setIsExporting] = useState(false)

  // ─── Built-in export logic ─────────────────────────────────────────────────

  /**
   * Fetch the selected data types from Supabase and export them in the chosen
   * format. Each data type becomes one sheet in an Excel workbook, or a
   * separate CSV / JSON file.
   */
  const runBuiltInExport = async (cfg: ExportConfig) => {
    const dateFilter: Record<string, string> = {}
    if (cfg.dateFrom) dateFilter.from = cfg.dateFrom
    if (cfg.dateTo) dateFilter.to = cfg.dateTo

    // Map each selected data type to a Supabase query
    const TABLE_MAP: Record<ExportData, string> = {
      observations: 'vehicle_observations',
      vehicles:     'vehicles',
      breaches:     'breach_alerts',
      enforcement:  'infringement_notices',
      zones:        'zones',
      users:        'user_profiles',
    }

    const COLUMNS_MAP: Record<ExportData, XlsxColumn<Record<string, unknown>>[]> = {
      observations: [
        { key: 'id',           label: 'ID' },
        { key: 'plate_number', label: 'Plate' },
        { key: 'zone_id',      label: 'Zone ID' },
        { key: 'is_compliant', label: 'Compliant', format: v => v ? 'Yes' : 'No' },
        { key: 'recorded_at',  label: 'Recorded At', format: v => v ? new Date(v as string).toLocaleString('en-NZ') : '' },
      ],
      vehicles: [
        { key: 'id',           label: 'ID' },
        { key: 'plate_number', label: 'Plate' },
        { key: 'make',         label: 'Make' },
        { key: 'model',        label: 'Model' },
        { key: 'is_self_contained', label: 'Self Contained', format: v => v ? 'Yes' : 'No' },
      ],
      breaches: [
        { key: 'id',           label: 'ID' },
        { key: 'plate_number', label: 'Plate' },
        { key: 'breach_type',  label: 'Breach Type' },
        { key: 'status',       label: 'Status' },
        { key: 'detected_at',  label: 'Detected At', format: v => v ? new Date(v as string).toLocaleString('en-NZ') : '' },
      ],
      enforcement: [
        { key: 'id',                 label: 'ID' },
        { key: 'notice_number',      label: 'Notice #' },
        { key: 'plate_number',       label: 'Plate' },
        { key: 'offence_description',label: 'Offence' },
        { key: 'amount_cents',       label: 'Fine (NZD)', format: v => v != null ? `$${(Number(v) / 100).toFixed(2)}` : '' },
        { key: 'status',             label: 'Status' },
        { key: 'issued_at',          label: 'Issued At', format: v => v ? new Date(v as string).toLocaleString('en-NZ') : '' },
      ],
      zones: [
        { key: 'id',   label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'max_consecutive_nights', label: 'Max Consecutive Nights' },
        { key: 'max_nights_per_month',   label: 'Max Nights/Month' },
        { key: 'is_active', label: 'Active', format: v => v ? 'Yes' : 'No' },
      ],
      users: [
        { key: 'id',         label: 'ID' },
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name',  label: 'Last Name' },
        { key: 'email',      label: 'Email' },
        { key: 'role',       label: 'Role' },
        { key: 'is_active',  label: 'Active', format: v => v ? 'Yes' : 'No' },
      ],
    }

    const datestamp = new Date().toISOString().slice(0, 10)

    if (cfg.format === 'excel') {
      // Build one sheet per selected data type
      const sheets = []
      for (const dataType of cfg.dataTypes) {
        let query = supabase.from(TABLE_MAP[dataType] as any).select('*')
        if (cfg.dateFrom) query = query.gte('created_at', cfg.dateFrom) as any
        if (cfg.dateTo)   query = query.lte('created_at', cfg.dateTo) as any
        const { data, error } = await query
        if (error) throw new Error(`Failed to fetch ${dataType}: ${error.message}`)
        sheets.push({
          name: DATA_TYPES.find(t => t.id === dataType)?.label ?? dataType,
          rows: (data ?? []) as unknown as Record<string, unknown>[],
          columns: COLUMNS_MAP[dataType],
        })
      }
      exportMultiSheetXlsx(sheets, `fieldops-export-${datestamp}`)
      return
    }

    if (cfg.format === 'json') {
      const result: Record<string, unknown[]> = {}
      for (const dataType of cfg.dataTypes) {
        let query = supabase.from(TABLE_MAP[dataType] as any).select('*')
        if (cfg.dateFrom) query = query.gte('created_at', cfg.dateFrom) as any
        if (cfg.dateTo)   query = query.lte('created_at', cfg.dateTo) as any
        const { data, error } = await query
        if (error) throw new Error(`Failed to fetch ${dataType}: ${error.message}`)
        result[dataType] = data ?? []
      }
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fieldops-export-${datestamp}.json`
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    // CSV: one file per selected data type
    for (const dataType of cfg.dataTypes) {
      let query = supabase.from(TABLE_MAP[dataType] as any).select('*')
      if (cfg.dateFrom) query = query.gte('created_at', cfg.dateFrom) as any
      if (cfg.dateTo)   query = query.lte('created_at', cfg.dateTo) as any
      const { data, error } = await query
      if (error) throw new Error(`Failed to fetch ${dataType}: ${error.message}`)
      const rows = (data ?? []) as unknown as Record<string, unknown>[]
      const csvCols = COLUMNS_MAP[dataType].map(c => ({
        key: c.key,
        label: c.label,
        format: c.format ? (v: any) => String(c.format!(v, {} as any)) : undefined,
      }))
      const csv = arrayToCSV(rows, csvCols)
      downloadCSV(csv, `${dataType}-${datestamp}.csv`)
    }
  }

  const handleFormatSelect = (format: ExportFormat) => {
    setConfig(prev => ({ ...prev, format }))
    setStep(2)
  }

  const toggleDataType = (dataType: ExportData) => {
    setConfig(prev => ({
      ...prev,
      dataTypes: prev.dataTypes.includes(dataType)
        ? prev.dataTypes.filter(t => t !== dataType)
        : [...prev.dataTypes, dataType],
    }))
  }

  const handleExport = async () => {
    if (config.dataTypes.length === 0) {
      toast.error('Please select at least one data type to export')
      return
    }

    setIsExporting(true)
    try {
      if (onExport) {
        // Caller-provided export handler (e.g. a parent page with pre-fetched data)
        await onExport(config)
      } else {
        // Built-in export: fetch data from Supabase and produce the chosen format
        await runBuiltInExport(config)
      }
      toast.success('Export completed successfully')
      if (onClose) {
        onClose()
      }
    } catch (error: any) {
      toast.error(`Export failed: ${error.message}`)
    } finally {
      setIsExporting(false)
    }
  }

  const getFormatIcon = (format: ExportFormat) => {
    const formatDef = EXPORT_FORMATS.find(f => f.id === format)
    return formatDef?.icon || <FileText className="h-5 w-5" />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Export Data
        </CardTitle>
        <CardDescription>
          Step {step} of 3: {
            step === 1 ? 'Select Format' :
            step === 2 ? 'Choose Data' :
            'Configure Options'
          }
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step 1: Format selection */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Select export format</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {EXPORT_FORMATS.map((format) => (
                <Button
                  key={format.id}
                  variant={config.format === format.id ? 'default' : 'outline'}
                  className="h-auto p-4 flex-col items-start gap-3"
                  onClick={() => handleFormatSelect(format.id)}
                >
                  {format.icon}
                  <div className="text-left">
                    <div className="font-medium">{format.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {format.description}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Data type selection */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Select data to export</div>
              <Badge variant="secondary">
                {getFormatIcon(config.format)}
                <span className="ml-2">{config.format.toUpperCase()}</span>
              </Badge>
            </div>
            <div className="space-y-2">
              {DATA_TYPES.map((dataType) => (
                <div
                  key={dataType.id}
                  className="flex items-start justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleDataType(dataType.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{dataType.label}</div>
                    <div className="text-sm text-muted-foreground">
                      {dataType.description}
                    </div>
                  </div>
                  <Switch
                    checked={config.dataTypes.includes(dataType.id)}
                    onCheckedChange={() => toggleDataType(dataType.id)}
                  />
                </div>
              ))}
            </div>
            {config.dataTypes.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Select at least one data type to continue
              </div>
            )}
          </div>
        )}

        {/* Step 3: Options */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Export options</div>

            {/* Summary */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Format:</span>
                <Badge>{config.format.toUpperCase()}</Badge>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground">Data types:</span>
                <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                  {config.dataTypes.map(type => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {DATA_TYPES.find(t => t.id === type)?.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Date range */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Date Range (Optional)</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="date-from" className="text-xs">From</Label>
                  <input
                    id="date-from"
                    type="date"
                    className="w-full mt-1 p-2 border rounded"
                    value={config.dateFrom || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="date-to" className="text-xs">To</Label>
                  <input
                    id="date-to"
                    type="date"
                    className="w-full mt-1 p-2 border rounded"
                    value={config.dateTo || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-3 pt-3 border-t">
              <div className="flex items-center justify-between">
                <Label htmlFor="include-deleted" className="cursor-pointer">
                  Include deleted records
                </Label>
                <Switch
                  id="include-deleted"
                  checked={config.includeDeleted}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, includeDeleted: checked }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="include-archived" className="cursor-pointer">
                  Include archived records
                </Label>
                <Switch
                  id="include-archived"
                  checked={config.includeArchived}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, includeArchived: checked }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <div>
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep(step - 1)}
                disabled={isExporting}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            {onClose && (
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={isExporting}
              >
                Cancel
              </Button>
            )}

            {step < 3 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={step === 2 && config.dataTypes.length === 0}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                disabled={isExporting || config.dataTypes.length === 0}
              >
                {isExporting ? (
                  <>Exporting...</>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export Now
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

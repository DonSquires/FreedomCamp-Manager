/**
 * Custom Report Builder
 * Allows admins to create custom reports from any data source
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  Database,
  FileText,
  Download,
  Save,
  Play,
  Settings,
  Filter,
  ArrowUpDown,
  Plus,
  Trash2,
  GripVertical,
  Eye,
  FileSpreadsheet,
  Calendar,
  Clock,
  Send,
  Loader2,
  ChevronRight,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'
import { generateReportHTML, exportReportPDF, type PDFReportConfig, type PDFSection } from '@/lib/pdfExport'
import { exportToXlsx, type XlsxColumn } from '@/lib/xlsxExport'

interface DataSource {
  id: string
  code: string
  name: string
  description: string
  source_table: string
  available_fields: Field[]
  default_fields: string[]
  available_filters: FilterConfig[]
  supports_grouping: boolean
  supports_charts: boolean
}

interface Field {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'timestamp' | 'uuid'
  format?: string
  join?: string
  aggregate?: boolean
}

interface FilterConfig {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'daterange' | 'select'
  options?: string[]
  source?: string
}

interface FilterValue {
  field: string
  operator: string
  value: any
}

interface SortConfig {
  field: string
  direction: 'asc' | 'desc'
}

interface ReportConfig {
  selectedFields: string[]
  filters: FilterValue[]
  groupBy: string[]
  aggregations: { field: string; function: string; alias: string }[]
  sortBy: SortConfig[]
  displayOptions: {
    showTotals: boolean
    showCharts: boolean
    chartType: string
    pageSize: number
  }
}

interface ReportTemplate {
  id: string
  name: string
  description: string
  category: string
  data_source_id: string
  config: ReportConfig
  default_format: string
  is_public: boolean
  run_count: number
  last_run_at: string
  created_at: string
}

const FILTER_OPERATORS = {
  text: [
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'isnull', label: 'Is empty' },
  ],
  number: [
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'gt', label: 'Greater than' },
    { value: 'gte', label: 'Greater than or equal' },
    { value: 'lt', label: 'Less than' },
    { value: 'lte', label: 'Less than or equal' },
  ],
  boolean: [
    { value: 'eq', label: 'Equals' },
  ],
  date: [
    { value: 'eq', label: 'Equals' },
    { value: 'gte', label: 'On or after' },
    { value: 'lte', label: 'On or before' },
    { value: 'isnull', label: 'Is empty' },
  ],
  daterange: [
    { value: 'between', label: 'Between' },
  ],
  select: [
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'in', label: 'Is one of' },
  ],
}

const AGGREGATION_FUNCTIONS = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count_distinct', label: 'Count Distinct' },
]

const REPORT_CATEGORIES = [
  { value: 'compliance', label: 'Compliance' },
  { value: 'operations', label: 'Operations' },
  { value: 'financial', label: 'Financial' },
  { value: 'workforce', label: 'Workforce' },
  { value: 'assets', label: 'Assets' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'custom', label: 'Custom' },
  { value: 'general', label: 'General' },
]

export default function CustomReportBuilder() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  
  // Step tracking
  const [currentStep, setCurrentStep] = useState(1)
  
  // Data source state
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null)
  
  // Report configuration state
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [filters, setFilters] = useState<FilterValue[]>([])
  const [groupBy, setGroupBy] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<SortConfig[]>([])
  const [showTotals, setShowTotals] = useState(true)
  
  // Date range
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  
  // Preview state
  const [previewData, setPreviewData] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  
  // Save template dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateCategory, setTemplateCategory] = useState('general')
  const [templateIsPublic, setTemplateIsPublic] = useState(false)
  
  // Export format
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf' | 'excel'>('csv')

  // Fetch data sources
  // Note: Using type assertion as the new tables aren't in generated types yet
  const { data: dataSources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['report-data-sources'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('report_data_sources')
        .select('*')
        .eq('is_active', true)
        .order('name')
      
      if (error) throw error
      return (data || []) as DataSource[]
    },
  })

  // Fetch saved templates
  const { data: savedTemplates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['report-templates', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('report_templates')
        .select('*')
        .eq('organization_id', user?.organization_id)
        .eq('is_active', true)
        .order('name')
      
      if (error) throw error
      return (data || []) as ReportTemplate[]
    },
    enabled: !!user?.organization_id,
  })

  // Initialize fields when source changes
  useEffect(() => {
    if (selectedSource) {
      setSelectedFields(selectedSource.default_fields || [])
      setFilters([])
      setGroupBy([])
      setSortBy([])
      setPreviewData([])
    }
  }, [selectedSource])

  // Add a filter
  const addFilter = () => {
    if (!selectedSource) return
    const firstFilter = selectedSource.available_filters[0]
    if (firstFilter) {
      setFilters([...filters, {
        field: firstFilter.key,
        operator: 'eq',
        value: '',
      }])
    }
  }

  // Remove a filter
  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index))
  }

  // Update a filter
  const updateFilter = (index: number, updates: Partial<FilterValue>) => {
    setFilters(filters.map((f, i) => i === index ? { ...f, ...updates } : f))
  }

  // Toggle field selection
  const toggleField = (key: string) => {
    if (selectedFields.includes(key)) {
      setSelectedFields(selectedFields.filter(f => f !== key))
    } else {
      setSelectedFields([...selectedFields, key])
    }
  }

  // Add sort
  const addSort = () => {
    if (!selectedSource || selectedFields.length === 0) return
    setSortBy([...sortBy, { field: selectedFields[0], direction: 'asc' }])
  }

  // Remove sort
  const removeSort = (index: number) => {
    setSortBy(sortBy.filter((_, i) => i !== index))
  }

  // Run preview query
  const runPreview = async () => {
    if (!selectedSource || selectedFields.length === 0) {
      toast.error('Please select at least one field')
      return
    }

    setPreviewLoading(true)
    setPreviewError(null)

    try {
      // Build the query (using type assertion since source_table is dynamic)
      let query = (supabase as any)
        .from(selectedSource.source_table)
        .select(selectedFields.join(','))
        .limit(100)

      // Apply filters
      for (const filter of filters) {
        if (filter.value === '' || filter.value === null) continue
        
        switch (filter.operator) {
          case 'eq':
            query = query.eq(filter.field, filter.value)
            break
          case 'neq':
            query = query.neq(filter.field, filter.value)
            break
          case 'gt':
            query = query.gt(filter.field, filter.value)
            break
          case 'gte':
            query = query.gte(filter.field, filter.value)
            break
          case 'lt':
            query = query.lt(filter.field, filter.value)
            break
          case 'lte':
            query = query.lte(filter.field, filter.value)
            break
          case 'contains':
            query = query.ilike(filter.field, `%${filter.value}%`)
            break
          case 'isnull':
            if (filter.value) {
              query = query.is(filter.field, null)
            } else {
              query = query.not(filter.field, 'is', null)
            }
            break
          case 'in':
            if (Array.isArray(filter.value)) {
              query = query.in(filter.field, filter.value)
            }
            break
        }
      }

      // Apply date range if applicable
      const dateField = selectedSource.available_filters.find(f => f.type === 'daterange')?.key
      if (dateField && selectedFields.includes(dateField)) {
        query = query.gte(dateField, dateFrom).lte(dateField, dateTo)
      }

      // Apply sorting
      for (const sort of sortBy) {
        query = query.order(sort.field, { ascending: sort.direction === 'asc' })
      }

      // Apply org filter if user is not master
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { data, error } = await query

      if (error) throw error

      setPreviewData(data || [])
      toast.success(`Preview loaded: ${data?.length || 0} rows`)
    } catch (err: any) {
      console.error('Preview error:', err)
      setPreviewError(err.message || 'Failed to load preview')
      toast.error('Failed to load preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  // Export to CSV
  const exportToCSV = () => {
    if (previewData.length === 0) {
      toast.error('No data to export')
      return
    }

    const columns = selectedFields.map(key => {
      const field = selectedSource?.available_fields.find(f => f.key === key)
      return {
        key,
        label: field?.label || key,
        format: (value: any) => {
          if (value === null || value === undefined) return ''
          if (typeof value === 'boolean') return value ? 'Yes' : 'No'
          if (field?.type === 'timestamp' && value) {
            return new Date(value).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
          }
          if (field?.type === 'date' && value) {
            return new Date(value).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })
          }
          return String(value)
        }
      }
    })

    const csv = arrayToCSV(previewData, columns)
    const filename = `${selectedSource?.code || 'report'}-${dateFrom}-to-${dateTo}.csv`
    downloadCSV(csv, filename)
    toast.success('CSV exported successfully')
  }

  // Export to Excel (.xlsx)
  const exportToExcel = () => {
    if (previewData.length === 0) {
      toast.error('No data to export')
      return
    }

    const columns: XlsxColumn<Record<string, unknown>>[] = selectedFields.map(key => {
      const field = selectedSource?.available_fields.find(f => f.key === key)
      return {
        key,
        label: field?.label || key,
        format: (value: unknown) => {
          if (value === null || value === undefined) return ''
          if (typeof value === 'boolean') return value ? 'Yes' : 'No'
          if (field?.type === 'timestamp' && value) {
            return new Date(value as string).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
          }
          if (field?.type === 'date' && value) {
            return new Date(value as string).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })
          }
          return String(value)
        },
      }
    })

    const filename = `${selectedSource?.code || 'report'}-${dateFrom}-to-${dateTo}`
    exportToXlsx(previewData as Record<string, unknown>[], columns, filename)
    toast.success('Excel file downloaded')
  }

  // Export to PDF
  const exportToPDF = () => {
    if (previewData.length === 0) {
      toast.error('No data to export')
      return
    }

    const config: PDFReportConfig = {
      title: templateName || `${selectedSource?.name || 'Custom'} Report`,
      subtitle: templateDescription || `Data from ${selectedSource?.name || 'custom source'}`,
      organizationName: 'Organisation Report',
      generatedBy: user?.email || 'System',
      generatedAt: new Date(),
      dateRange: { from: new Date(dateFrom), to: new Date(dateTo) },
    }

    const sections: PDFSection[] = [
      {
        heading: 'Summary',
        content: [
          `Total Records: ${previewData.length}`,
          `Date Range: ${dateFrom} to ${dateTo}`,
          `Data Source: ${selectedSource?.name}`,
        ],
        type: 'list',
      },
      {
        heading: 'Report Data',
        content: previewData.map(row => {
          const formatted: Record<string, any> = {}
          for (const key of selectedFields) {
            const field = selectedSource?.available_fields.find(f => f.key === key)
            formatted[field?.label || key] = row[key]
          }
          return formatted
        }),
        type: 'table',
      },
    ]

    exportReportPDF(config, sections)
    toast.success('PDF opened for printing')
  }

  // Save template mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSource || !user?.organization_id) {
        throw new Error('Missing required data')
      }

      const config: ReportConfig = {
        selectedFields,
        filters,
        groupBy,
        aggregations: [],
        sortBy,
        displayOptions: {
          showTotals,
          showCharts: false,
          chartType: 'bar',
          pageSize: 50,
        },
      }

      const { data, error } = await (supabase as any)
        .from('report_templates')
        .insert({
          organization_id: user.organization_id,
          name: templateName,
          description: templateDescription,
          category: templateCategory,
          data_source_id: selectedSource.id,
          config,
          default_format: exportFormat,
          is_public: templateIsPublic,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Template saved successfully')
      setSaveDialogOpen(false)
      setTemplateName('')
      setTemplateDescription('')
      refetchTemplates()
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save template')
    },
  })

  // Load template
  const loadTemplate = (template: ReportTemplate) => {
    const source = dataSources.find(s => s.id === template.data_source_id)
    if (!source) {
      toast.error('Data source not found')
      return
    }

    setSelectedSource(source)
    setSelectedFields(template.config.selectedFields || [])
    setFilters(template.config.filters || [])
    setGroupBy(template.config.groupBy || [])
    setSortBy(template.config.sortBy || [])
    setShowTotals(template.config.displayOptions?.showTotals ?? true)
    setExportFormat(template.default_format as any || 'csv')
    setCurrentStep(2)
    toast.success(`Loaded template: ${template.name}`)
  }

  // Get field info
  const getFieldInfo = (key: string): Field | undefined => {
    return selectedSource?.available_fields.find(f => f.key === key)
  }

  // Get filter config
  const getFilterConfig = (key: string): FilterConfig | undefined => {
    return selectedSource?.available_filters.find(f => f.key === key)
  }

  return (
    <AppLayout
      title="Custom Report Builder"
      description="Create and export custom reports from any data source"
      showBackButton
    >
      <div className="space-y-6">
        {/* Progress Steps */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              {[
                { step: 1, label: 'Select Source', icon: Database },
                { step: 2, label: 'Configure Fields', icon: Settings },
                { step: 3, label: 'Add Filters', icon: Filter },
                { step: 4, label: 'Preview & Export', icon: Download },
              ].map(({ step, label, icon: Icon }, index) => (
                <div key={step} className="flex items-center">
                  <button
                    onClick={() => step <= (selectedSource ? 4 : 1) && setCurrentStep(step)}
                    className={`flex flex-col items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      currentStep === step
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : currentStep > step
                        ? 'text-green-600'
                        : 'text-gray-400'
                    }`}
                    disabled={step > (selectedSource ? 4 : 1)}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      currentStep === step
                        ? 'bg-blue-500 text-white'
                        : currentStep > step
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}>
                      {currentStep > step ? <CheckCircle className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                  {index < 3 && (
                    <ChevronRight className={`h-5 w-5 mx-2 ${
                      currentStep > step ? 'text-green-500' : 'text-gray-300'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Panel - Configuration */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Select Data Source */}
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Select Data Source
                  </CardTitle>
                  <CardDescription>
                    Choose the type of data you want to report on
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sourcesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {dataSources.map((source) => (
                        <button
                          key={source.id}
                          onClick={() => {
                            setSelectedSource(source)
                            setCurrentStep(2)
                          }}
                          className={`p-4 rounded-lg border text-left transition-all hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                            selectedSource?.id === source.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium">{source.name}</h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                {source.description}
                              </p>
                            </div>
                            {source.supports_charts && (
                              <Badge variant="secondary" className="ml-2">Charts</Badge>
                            )}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {source.available_fields.length} fields available
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 2: Configure Fields */}
            {currentStep === 2 && selectedSource && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Select Fields
                  </CardTitle>
                  <CardDescription>
                    Choose which columns to include in your report
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {selectedSource.available_fields.map((field) => (
                      <div
                        key={field.key}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedFields.includes(field.key)
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                        }`}
                        onClick={() => toggleField(field.key)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedFields.includes(field.key)}
                            onCheckedChange={() => toggleField(field.key)}
                          />
                          <div>
                            <div className="font-medium">{field.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {field.key} • {field.type}
                              {field.join && ` • from ${field.join}`}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline">{field.type}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={() => setCurrentStep(3)} disabled={selectedFields.length === 0}>
                      Next: Add Filters
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Add Filters */}
            {currentStep === 3 && selectedSource && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Configure Filters
                  </CardTitle>
                  <CardDescription>
                    Optionally filter your data to narrow results
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Date Range */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Date From</Label>
                      <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Date To</Label>
                      <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Additional Filters */}
                  {filters.length > 0 && (
                    <div className="space-y-3">
                      <Label>Additional Filters</Label>
                      {filters.map((filter, index) => {
                        const filterConfig = getFilterConfig(filter.field)
                        const operators = FILTER_OPERATORS[filterConfig?.type || 'text'] || FILTER_OPERATORS.text
                        
                        return (
                          <div key={index} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                            <Select
                              value={filter.field}
                              onValueChange={(value) => updateFilter(index, { field: value, value: '' })}
                            >
                              <SelectTrigger className="w-[180px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedSource.available_filters.map((f) => (
                                  <SelectItem key={f.key} value={f.key}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Select
                              value={filter.operator}
                              onValueChange={(value) => updateFilter(index, { operator: value })}
                            >
                              <SelectTrigger className="w-[150px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {operators.map((op) => (
                                  <SelectItem key={op.value} value={op.value}>
                                    {op.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {filterConfig?.type === 'boolean' ? (
                              <Select
                                value={String(filter.value)}
                                onValueChange={(value) => updateFilter(index, { value: value === 'true' })}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="true">Yes</SelectItem>
                                  <SelectItem value="false">No</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : filterConfig?.type === 'select' && filterConfig.options ? (
                              <Select
                                value={filter.value}
                                onValueChange={(value) => updateFilter(index, { value })}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {filterConfig.options.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                      {opt}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                type={filterConfig?.type === 'number' ? 'number' : filterConfig?.type === 'date' ? 'date' : 'text'}
                                placeholder="Value..."
                                value={filter.value}
                                onChange={(e) => updateFilter(index, { value: e.target.value })}
                                className="flex-1"
                              />
                            )}

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFilter(index)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <Button variant="outline" onClick={addFilter} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Filter
                  </Button>

                  {/* Sort Options */}
                  <div className="pt-4 border-t space-y-3">
                    <Label className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      Sort Order
                    </Label>
                    {sortBy.map((sort, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Select
                          value={sort.field}
                          onValueChange={(value) => {
                            setSortBy(sortBy.map((s, i) => i === index ? { ...s, field: value } : s))
                          }}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedFields.map((key) => (
                              <SelectItem key={key} value={key}>
                                {getFieldInfo(key)?.label || key}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={sort.direction}
                          onValueChange={(value: 'asc' | 'desc') => {
                            setSortBy(sortBy.map((s, i) => i === index ? { ...s, direction: value } : s))
                          }}
                        >
                          <SelectTrigger className="w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asc">Ascending</SelectItem>
                            <SelectItem value="desc">Descending</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" onClick={() => removeSort(index)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addSort} disabled={selectedFields.length === 0}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Sort
                    </Button>
                  </div>

                  <div className="mt-4 flex justify-between">
                    <Button variant="outline" onClick={() => setCurrentStep(2)}>
                      Back
                    </Button>
                    <Button onClick={() => { runPreview(); setCurrentStep(4); }}>
                      <Eye className="h-4 w-4 mr-2" />
                      Preview Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 4: Preview & Export */}
            {currentStep === 4 && selectedSource && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Eye className="h-5 w-5" />
                        Preview & Export
                      </CardTitle>
                      <CardDescription>
                        Review your data and export in your preferred format
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={runPreview} disabled={previewLoading}>
                        {previewLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                        Refresh
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {previewError && (
                    <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg mb-4">
                      <AlertCircle className="h-5 w-5" />
                      {previewError}
                    </div>
                  )}

                  {previewLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : previewData.length > 0 ? (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        Showing {previewData.length} rows (preview limited to 100)
                      </div>
                      <div className="border rounded-lg overflow-auto max-h-[400px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {selectedFields.map((key) => (
                                <TableHead key={key}>
                                  {getFieldInfo(key)?.label || key}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewData.slice(0, 50).map((row, index) => (
                              <TableRow key={index}>
                                {selectedFields.map((key) => (
                                  <TableCell key={key} className="max-w-[200px] truncate">
                                    {formatValue(row[key], getFieldInfo(key))}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      Click "Refresh" to load preview data
                    </div>
                  )}

                  {/* Export Actions */}
                  <div className="mt-6 pt-6 border-t space-y-4">
                    <div className="flex items-center gap-4">
                      <Label>Export Format:</Label>
                      <div className="flex gap-2">
                        {(['csv', 'pdf', 'excel'] as const).map((format) => (
                          <Button
                            key={format}
                            variant={exportFormat === format ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setExportFormat(format)}
                          >
                            {format === 'csv' && <FileSpreadsheet className="h-4 w-4 mr-2" />}
                            {format === 'pdf' && <FileText className="h-4 w-4 mr-2" />}
                            {format === 'excel' && <FileSpreadsheet className="h-4 w-4 mr-2" />}
                            {format.toUpperCase()}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={
                          exportFormat === 'csv' ? exportToCSV :
                          exportFormat === 'excel' ? exportToExcel :
                          exportToPDF
                        }
                        disabled={previewData.length === 0}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export {exportFormat.toUpperCase()}
                      </Button>
                      <Button variant="outline" onClick={() => setSaveDialogOpen(true)}>
                        <Save className="h-4 w-4 mr-2" />
                        Save as Template
                      </Button>
                      <Button variant="outline" onClick={() => setCurrentStep(3)}>
                        Back to Filters
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Saved Templates */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Saved Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                {savedTemplates.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No saved templates yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedTemplates.slice(0, 10).map((template) => (
                      <button
                        key={template.id}
                        onClick={() => loadTemplate(template)}
                        className="w-full p-3 text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-sm">{template.name}</div>
                            {template.description && (
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {template.description}
                              </div>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {template.category}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>Run {template.run_count}x</span>
                          {template.last_run_at && (
                            <span>Last: {new Date(template.last_run_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Current Configuration Summary */}
            {selectedSource && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Current Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Data Source</div>
                    <div className="font-medium">{selectedSource.name}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Selected Fields</div>
                    <div className="font-medium">{selectedFields.length} fields</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Filters</div>
                    <div className="font-medium">{filters.length} active</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Date Range</div>
                    <div className="font-medium">{dateFrom} to {dateTo}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Save Template Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Report Template</DialogTitle>
            <DialogDescription>
              Save this configuration for quick access later
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Weekly Compliance Report"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-desc">Description</Label>
              <Textarea
                id="template-desc"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={templateCategory} onValueChange={setTemplateCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="template-public">Share with organization</Label>
              <Switch
                id="template-public"
                checked={templateIsPublic}
                onCheckedChange={setTemplateIsPublic}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTemplateMutation.mutate()}
              disabled={!templateName.trim() || saveTemplateMutation.isPending}
            >
              {saveTemplateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Template
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

// Helper function to format values for display
function formatValue(value: any, field?: Field): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (field?.type === 'timestamp' && value) {
    return new Date(value).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
  }
  if (field?.type === 'date' && value) {
    return new Date(value).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })
  }
  if (field?.format === 'currency' && typeof value === 'number') {
    return `$${value.toFixed(2)}`
  }
  if (field?.format === 'percentage' && typeof value === 'number') {
    return `${value.toFixed(1)}%`
  }
  return String(value)
}

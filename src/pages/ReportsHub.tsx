import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FileText,
  Download,
  BarChart3,
  MapPin,
  Shield,
  AlertTriangle,
  Users,
  CheckCircle,
  FileSpreadsheet,
  Activity,
  ArrowRight,
  Wand2,
  CheckCircle2,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

interface ReportCard {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  badge?: string
  badgeColor?: string
  route?: string
  action?: () => void
}

const reportWizardSchema = z.object({
  reportId: z.string().min(1, 'Select a report type'),
  format: z.enum(['pdf', 'csv']),
  datePreset: z.enum(['7d', '30d', 'custom']),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  includeCharts: z.boolean(),
  includeRawData: z.boolean(),
})

type ReportWizardValues = z.infer<typeof reportWizardSchema>

export default function ReportsHub() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1)
  const [selectedReport, setSelectedReport] = useState<ReportCard | null>(null)

  const wizardForm = useForm<ReportWizardValues>({
    resolver: zodResolver(reportWizardSchema),
    defaultValues: {
      reportId: '',
      format: 'pdf',
      datePreset: '30d',
      dateFrom: '',
      dateTo: '',
      includeCharts: true,
      includeRawData: false,
    },
  })

  const complianceReports: ReportCard[] = [
    {
      id: 'compliance-summary',
      title: 'Compliance Summary',
      description: 'Zone-by-zone compliance statistics, breach breakdown, and PDF/CSV export',
      icon: <CheckCircle className="h-6 w-6" />,
      badge: 'PDF / CSV',
      badgeColor: 'bg-green-100 text-green-800',
      route: '/compliance-dashboard',
    },
    {
      id: 'breach-analysis',
      title: 'Breach Analysis',
      description: 'Detailed breach patterns and enforcement metrics',
      icon: <AlertTriangle className="h-6 w-6" />,
      badge: 'PDF / CSV',
      badgeColor: 'bg-red-100 text-red-800',
      route: '/breaches',
    },
    {
      id: 'compliance-analytics',
      title: 'Compliance Analytics',
      description: 'Deep analytics with charts and visualizations',
      icon: <BarChart3 className="h-6 w-6" />,
      badge: 'Interactive',
      badgeColor: 'bg-blue-100 text-blue-800',
      route: '/compliance-analytics',
    },
  ]

  const operationalReports: ReportCard[] = [
    {
      id: 'patrol-activity',
      title: 'Patrol Activity Report',
      description: 'Officer patrol logs, vehicles checked, and coverage',
      icon: <Shield className="h-6 w-6" />,
      badge: 'CSV',
      badgeColor: 'bg-purple-100 text-purple-800',
      route: '/observations-report',
    },
    {
      id: 'officer-performance',
      title: 'Officer Performance',
      description: 'Individual officer metrics, patrol KPIs and activity statistics',
      icon: <Users className="h-6 w-6" />,
      badge: 'PDF / CSV',
      badgeColor: 'bg-indigo-100 text-indigo-800',
      route: '/patrol-kpis',
    },
    {
      id: 'incident-reports',
      title: 'Incident Reports',
      description: 'Incident management with court-ready evidence',
      icon: <FileText className="h-6 w-6" />,
      badge: 'Interactive',
      badgeColor: 'bg-orange-100 text-orange-800',
      route: '/incident-reports',
    },
  ]

  const analyticsReports: ReportCard[] = [
    {
      id: 'hotspots-map',
      title: 'Hotspots Heatmap',
      description: 'GPS heatmap showing high-activity zones and historical trends',
      icon: <MapPin className="h-6 w-6" />,
      badge: 'Map',
      badgeColor: 'bg-yellow-100 text-yellow-800',
      route: '/hotspots',
    },
    {
      id: 'leadership-pack',
      title: 'Leadership Pack',
      description: 'Executive summary with key metrics and insights',
      icon: <FileSpreadsheet className="h-6 w-6" />,
      badge: 'PDF / CSV',
      badgeColor: 'bg-pink-100 text-pink-800',
      route: '/reports',
    },
  ]

  const systemReports: ReportCard[] = [
    {
      id: 'custom-report-builder',
      title: 'Custom Report Builder',
      description: 'Build custom reports from any data source with PDF/CSV export',
      icon: <Wand2 className="h-6 w-6" />,
      badge: 'New',
      badgeColor: 'bg-purple-100 text-purple-800',
      route: '/custom-reports',
    },
    {
      id: 'audit-log',
      title: 'Audit Trail',
      description: 'System activity log with user actions',
      icon: <Activity className="h-6 w-6" />,
      badge: 'Interactive',
      badgeColor: 'bg-gray-100 text-gray-800',
      route: '/audit-log',
    },
    {
      id: 'data-export',
      title: 'Data Export',
      description: 'Bulk CSV export of all observations and vehicles',
      icon: <Download className="h-6 w-6" />,
      badge: 'CSV',
      badgeColor: 'bg-green-100 text-green-800',
      route: '/data',
    },
  ]

  const recommendedReport = user?.role === 'officer'
    ? (operationalReports.find((report) => report.id === 'patrol-activity') ?? operationalReports[0])
    : (analyticsReports.find((report) => report.id === 'leadership-pack') ?? analyticsReports[0])

  const reportSections: Array<{ title: string; reports: ReportCard[] }> = [
    { title: 'Compliance Reports', reports: complianceReports },
    { title: 'Operational Reports', reports: operationalReports },
    { title: 'Analytics and Insights', reports: analyticsReports },
    { title: 'System Reports', reports: systemReports },
  ]

  const allReports = reportSections.flatMap((section) => section.reports)

  const openWizard = (report?: ReportCard) => {
    wizardForm.reset({
      reportId: report?.id ?? '',
      format: report?.badge === 'CSV' ? 'csv' : 'pdf',
      datePreset: '30d',
      dateFrom: '',
      dateTo: '',
      includeCharts: true,
      includeRawData: false,
    })
    setSelectedReport(report ?? null)
    setWizardStep(report ? 2 : 1)
    setWizardOpen(true)
  }

  const closeWizard = () => {
    setWizardOpen(false)
    setWizardStep(1)
    setSelectedReport(null)
  }

  const goPreviousStep = () => {
    setWizardStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3 | 4) : current))
  }

  const goNextStep = async () => {
    const values = wizardForm.getValues()

    if (wizardStep === 1) {
      if (!values.reportId) {
        wizardForm.setError('reportId', { message: 'Select a report type to continue' })
        return
      }
      const report = allReports.find((item) => item.id === values.reportId) ?? null
      setSelectedReport(report)
      setWizardStep(2)
      return
    }

    if (wizardStep === 2) {
      const valid = await wizardForm.trigger(['format', 'datePreset', 'dateFrom', 'dateTo'])
      if (!valid) return
      if (values.datePreset === 'custom' && (!values.dateFrom || !values.dateTo)) {
        wizardForm.setError('dateFrom', { message: 'Custom range requires both start and end date' })
        return
      }
      setWizardStep(3)
      return
    }

    if (wizardStep === 3) {
      setWizardStep(4)
    }
  }

  const generateReport = () => {
    const values = wizardForm.getValues()
    const report = allReports.find((item) => item.id === values.reportId)
    if (!report) {
      toast.error('Select a report before generating')
      return
    }

    const params = new URLSearchParams({
      report: report.id,
      format: values.format,
      period: values.datePreset,
      charts: values.includeCharts ? '1' : '0',
      raw: values.includeRawData ? '1' : '0',
    })

    if (values.datePreset === 'custom') {
      if (values.dateFrom) params.set('dateFrom', values.dateFrom)
      if (values.dateTo) params.set('dateTo', values.dateTo)
    }

    toast.success(`${report.title} ready for ${values.format.toUpperCase()} output`)
    if (report.route) {
      navigate(`${report.route}?${params.toString()}`)
    }
    closeWizard()
  }

  const renderReportSection = (title: string, reports: ReportCard[]) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((report) => (
          <div
            key={report.id}
            className="flex flex-col gap-3 rounded-xl border p-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                {report.icon}
              </div>
              <div>
                <p className="font-semibold text-foreground">{report.title}</p>
                <p className="text-sm text-muted-foreground">{report.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {report.badge && (
                <Badge className={report.badgeColor}>{report.badge}</Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => openWizard(report)}>
                Start flow
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )

  return (
    <AppLayout
      title="Reports Hub"
      description="Generate reports, analytics, and data exports"
      showBackButton
    >
      <GlobalFilterRibbon />

      <Card className="mb-6 border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-100">
            <FileText className="h-5 w-5" />
            Start Here
          </CardTitle>
          <CardDescription>
            Recommended next report for your role. Secondary actions stay available below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-white/80 p-4 dark:border-blue-900/60 dark:bg-slate-950/40">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-blue-700 dark:text-blue-300">Recommended</p>
                <p className="text-lg font-semibold text-foreground">{recommendedReport.title}</p>
                <p className="text-sm text-muted-foreground">{recommendedReport.description}</p>
              </div>
              <Button onClick={() => openWizard(recommendedReport)} className="gap-2">
                Start guided flow
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openWizard()}>Choose another report</Button>
            <Button variant="outline" onClick={() => navigate('/audit-log')}>Open audit trail</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-8">
        {reportSections.map((section) => renderReportSection(section.title, section.reports))}
      </div>

      <Dialog open={wizardOpen} onOpenChange={(open) => !open && closeWizard()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Guided Report Workflow</DialogTitle>
            <DialogDescription>
              Step {wizardStep} of 4: {wizardStep === 1 ? 'Select report type' : wizardStep === 2 ? 'Configure filters' : wizardStep === 3 ? 'Preview output' : 'Generate and download'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {wizardStep === 1 && (
              <div className="space-y-3">
                <Label>Select report type</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {allReports.map((report) => {
                    const active = wizardForm.watch('reportId') === report.id
                    return (
                      <button
                        key={report.id}
                        type="button"
                        onClick={() => {
                          wizardForm.setValue('reportId', report.id, { shouldValidate: true })
                          setSelectedReport(report)
                        }}
                        className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 hover:border-blue-300'}`}
                      >
                        <p className="text-sm font-semibold text-foreground">{report.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                      </button>
                    )
                  })}
                </div>
                {wizardForm.formState.errors.reportId?.message && (
                  <p className="text-xs text-red-600">{wizardForm.formState.errors.reportId.message}</p>
                )}
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Output format</Label>
                  <Select
                    value={wizardForm.watch('format')}
                    onValueChange={(value: 'pdf' | 'csv') => wizardForm.setValue('format', value, { shouldValidate: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Date range</Label>
                  <Select
                    value={wizardForm.watch('datePreset')}
                    onValueChange={(value: '7d' | '30d' | 'custom') => wizardForm.setValue('datePreset', value, { shouldValidate: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="custom">Custom range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {wizardForm.watch('datePreset') === 'custom' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>From</Label>
                      <Input
                        type="date"
                        value={wizardForm.watch('dateFrom') || ''}
                        onChange={(event) => wizardForm.setValue('dateFrom', event.target.value, { shouldValidate: true })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>To</Label>
                      <Input
                        type="date"
                        value={wizardForm.watch('dateTo') || ''}
                        onChange={(event) => wizardForm.setValue('dateTo', event.target.value, { shouldValidate: true })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="include-charts"
                      checked={wizardForm.watch('includeCharts')}
                      onCheckedChange={(checked) => wizardForm.setValue('includeCharts', checked === true)}
                    />
                    <Label htmlFor="include-charts">Include chart visuals</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="include-raw"
                      checked={wizardForm.watch('includeRawData')}
                      onCheckedChange={(checked) => wizardForm.setValue('includeRawData', checked === true)}
                    />
                    <Label htmlFor="include-raw">Include raw data appendix</Label>
                  </div>
                </div>

                {(wizardForm.formState.errors.dateFrom?.message || wizardForm.formState.errors.dateTo?.message) && (
                  <p className="text-xs text-red-600">{wizardForm.formState.errors.dateFrom?.message || wizardForm.formState.errors.dateTo?.message}</p>
                )}
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-semibold text-foreground">Preview</p>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p><span className="font-medium text-foreground">Report:</span> {selectedReport?.title ?? 'Not selected'}</p>
                  <p><span className="font-medium text-foreground">Format:</span> {wizardForm.watch('format').toUpperCase()}</p>
                  <p><span className="font-medium text-foreground">Period:</span> {wizardForm.watch('datePreset') === 'custom' ? `${wizardForm.watch('dateFrom') || '...'} to ${wizardForm.watch('dateTo') || '...'}` : wizardForm.watch('datePreset') === '7d' ? 'Last 7 days' : 'Last 30 days'}</p>
                  <p><span className="font-medium text-foreground">Charts:</span> {wizardForm.watch('includeCharts') ? 'Included' : 'Excluded'}</p>
                  <p><span className="font-medium text-foreground">Raw data:</span> {wizardForm.watch('includeRawData') ? 'Included' : 'Excluded'}</p>
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/20">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <p className="text-sm font-semibold">Ready to generate</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Generate the {selectedReport?.title ?? 'selected report'} now and open its results page.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeWizard}>Cancel</Button>
              {wizardStep > 1 && wizardStep < 4 && (
                <Button variant="outline" onClick={goPreviousStep}>Back</Button>
              )}
            </div>
            {wizardStep < 4 ? (
              <Button onClick={goNextStep}>Next</Button>
            ) : (
              <Button onClick={generateReport} className="gap-2">
                Generate and download
                <Download className="h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

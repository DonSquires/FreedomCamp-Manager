import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Wand2
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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

export default function ReportsHub() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)

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

  const handleReportClick = (report: ReportCard) => {
    if (report.route) {
      navigate(report.route)
    } else if (report.action) {
      report.action()
    }
  }

  const recommendedReport = user?.role === 'officer'
    ? (operationalReports.find((report) => report.id === 'patrol-activity') ?? operationalReports[0])
    : (analyticsReports.find((report) => report.id === 'leadership-pack') ?? analyticsReports[0])

  const reportSections: Array<{ title: string; reports: ReportCard[] }> = [
    { title: 'Compliance Reports', reports: complianceReports },
    { title: 'Operational Reports', reports: operationalReports },
    { title: 'Analytics and Insights', reports: analyticsReports },
    { title: 'System Reports', reports: systemReports },
  ]

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
              <Button variant="outline" size="sm" onClick={() => handleReportClick(report)}>
                {report.badge === 'Interactive' ? 'Open' : 'Generate'}
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
              <Button onClick={() => handleReportClick(recommendedReport)} className="gap-2">
                Open recommended report
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/custom-reports')}>Build custom report</Button>
            <Button variant="outline" onClick={() => navigate('/audit-log')}>Open audit trail</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-8">
        {reportSections.map((section) => renderReportSection(section.title, section.reports))}
      </div>
    </AppLayout>
  )
}

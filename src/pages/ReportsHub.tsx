import { useState } from 'react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FileText, 
  Download, 
  Clock, 
  BarChart3,
  MapPin,
  Shield,
  AlertTriangle,
  Users,
  Calendar,
  CheckCircle,
  FileSpreadsheet,
  Activity,
  Settings,
  Wand2
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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
  const [generating, setGenerating] = useState<string | null>(null)

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

  const renderReportSection = (title: string, reports: ReportCard[]) => (
    <div>
      <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-200">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <Card
            key={report.id}
            className="hover:shadow-lg transition-all cursor-pointer group"
            onClick={() => handleReportClick(report)}
          >
            <CardHeader>
              <div className="flex items-start justify-between mb-2">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                  {report.icon}
                </div>
                {report.badge && (
                  <Badge className={report.badgeColor}>
                    {report.badge}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg">{report.title}</CardTitle>
              <CardDescription>{report.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                {report.badge === 'Interactive' ? 'Open' : 'Generate'} →
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  return (
    <AppLayout
      title="Reports Hub"
      description="Generate reports, analytics, and data exports"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Available Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {complianceReports.length + operationalReports.length + analyticsReports.length + systemReports.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Compliance Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{complianceReports.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Operational Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{operationalReports.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{analyticsReports.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-8">
        {renderReportSection('Compliance Reports', complianceReports)}
        {renderReportSection('Operational Reports', operationalReports)}
        {renderReportSection('Analytics & Insights', analyticsReports)}
        {renderReportSection('System Reports', systemReports)}
      </div>

      {/* Quick Actions */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common reporting tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            <Button onClick={() => navigate('/reports')}>
              <Calendar className="h-4 w-4 mr-2" />
              Generate Monthly Summary
            </Button>
            <Button variant="outline" onClick={() => navigate('/compliance-analytics')}>
              <BarChart3 className="h-4 w-4 mr-2" />
              View Analytics Dashboard
            </Button>
            <Button variant="outline" onClick={() => navigate('/data')}>
              <Download className="h-4 w-4 mr-2" />
              Export All Data
            </Button>
            <Button variant="outline" onClick={() => navigate('/audit-log')}>
              <Activity className="h-4 w-4 mr-2" />
              View Audit Trail
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}

/**
 * Reports Hub - Central access to all reporting capabilities
 */

import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  BarChart3,
  TrendingUp,
  Users,
  Car,
  MapPin,
  Calendar,
  AlertTriangle,
  Shield,
  Download,
  Eye,
  Activity,
  Clock,
  Briefcase,
  Search,
  FileBarChart,
} from 'lucide-react';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: any;
  path: string;
  category: 'operations' | 'compliance' | 'analytics' | 'admin';
  badge?: string;
}

const reports: ReportCard[] = [
  // Operations Reports
  {
    id: 'observations',
    title: 'Observations Report',
    description: 'All vehicle observations with filtering and export',
    icon: Eye,
    path: '/admin/observations',
    category: 'operations',
  },
  {
    id: 'breaches',
    title: 'Breach Alerts Report',
    description: 'Compliance violations requiring attention',
    icon: AlertTriangle,
    path: '/admin/breaches',
    category: 'operations',
    badge: 'NEW',
  },
  {
    id: 'enforcement',
    title: 'Enforcement Actions',
    description: 'All enforcement actions and their status',
    icon: Shield,
    path: '/admin/enforcement-actions',
    category: 'operations',
  },
  {
    id: 'patrol',
    title: 'Patrol Management',
    description: 'Schedule and track patrol activities',
    icon: Calendar,
    path: '/admin/patrols',
    category: 'operations',
  },

  // Compliance Reports
  {
    id: 'compliance-analytics',
    title: 'Compliance Analytics',
    description: 'Zone compliance trends and statistics',
    icon: BarChart3,
    path: '/admin/compliance-analytics',
    category: 'compliance',
  },
  {
    id: 'hotspots',
    title: 'Hotspots Map',
    description: 'Geographic distribution of observations',
    icon: MapPin,
    path: '/admin/hotspots',
    category: 'compliance',
  },
  {
    id: 'zone-performance',
    title: 'Zone Performance',
    description: 'Compliance rates by zone',
    icon: TrendingUp,
    path: '/admin/zone-performance',
    category: 'compliance',
  },

  // Analytics Reports
  {
    id: 'vehicle-activity',
    title: 'Vehicle Activity Report',
    description: 'Individual vehicle tracking and history',
    icon: Car,
    path: '/admin/vehicle-activity',
    category: 'analytics',
  },
  {
    id: 'officer-activity',
    title: 'Officer Activity Report',
    description: 'Officer productivity and scan statistics',
    icon: Users,
    path: '/admin/officer-activity',
    category: 'analytics',
  },
  {
    id: 'organization',
    title: 'Organization Overview',
    description: 'Cross-organization summary and trends',
    icon: Briefcase,
    path: '/admin/organization-overview',
    category: 'analytics',
  },

  // Admin Reports
  {
    id: 'audit',
    title: 'Audit History',
    description: 'System activity and change logs',
    icon: FileText,
    path: '/admin/audit-history',
    category: 'admin',
  },
  {
    id: 'import-history',
    title: 'Import History',
    description: 'Data import logs and statistics',
    icon: Download,
    path: '/admin/historical-import',
    category: 'admin',
  },
  {
    id: 'data-integrity',
    title: 'Data Integrity Check',
    description: 'System health and data validation',
    icon: Search,
    path: '/admin/data-integrity-check',
    category: 'admin',
  },
];

const categories = [
  {
    id: 'operations',
    name: 'Operations',
    description: 'Daily operations and field activities',
    icon: Activity,
    color: 'blue',
  },
  {
    id: 'compliance',
    name: 'Compliance',
    description: 'Compliance monitoring and enforcement',
    icon: Shield,
    color: 'green',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Performance metrics and trends',
    icon: TrendingUp,
    color: 'purple',
  },
  {
    id: 'admin',
    name: 'Administration',
    description: 'System management and auditing',
    icon: FileBarChart,
    color: 'amber',
  },
];

export default function ReportsHub() {
  const navigate = useNavigate();

  const getReportsByCategory = (categoryId: string) => {
    return reports.filter(r => r.category === categoryId);
  };

  const getCategoryColor = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'border-blue-500 bg-blue-50 dark:bg-blue-950/20',
      green: 'border-green-500 bg-green-50 dark:bg-green-950/20',
      purple: 'border-purple-500 bg-purple-50 dark:bg-purple-950/20',
      amber: 'border-amber-500 bg-amber-50 dark:bg-amber-950/20',
    };
    return colors[color] || '';
  };

  const getIconColor = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'text-blue-600',
      green: 'text-green-600',
      purple: 'text-purple-600',
      amber: 'text-amber-600',
    };
    return colors[color] || '';
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AdminNavigationMenu />
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileBarChart className="h-8 w-8 text-primary" />
            Reports & Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Access all system reports and analytics dashboards
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center">
                <Activity className="h-6 w-6 text-white" />
              </div>
              <Badge variant="secondary">{getReportsByCategory('operations').length}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Operations Reports</div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-green-500 flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <Badge variant="secondary">{getReportsByCategory('compliance').length}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Compliance Reports</div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-purple-500 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <Badge variant="secondary">{getReportsByCategory('analytics').length}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Analytics Reports</div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-amber-500 flex items-center justify-center">
                <FileBarChart className="h-6 w-6 text-white" />
              </div>
              <Badge variant="secondary">{getReportsByCategory('admin').length}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Admin Reports</div>
          </CardContent>
        </Card>
      </div>

      {/* Report Categories */}
      <div className="space-y-8">
        {categories.map((category) => {
          const Icon = category.icon;
          const categoryReports = getReportsByCategory(category.id);

          return (
            <div key={category.id}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${getCategoryColor(category.color)}`}>
                  <Icon className={`h-5 w-5 ${getIconColor(category.color)}`} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">{category.name}</h2>
                  <p className="text-sm text-muted-foreground">{category.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryReports.map((report) => {
                  const ReportIcon = report.icon;

                  return (
                    <Card
                      key={report.id}
                      className="cursor-pointer hover:shadow-lg transition-all border-2 hover:border-primary"
                      onClick={() => navigate(report.path)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                            <ReportIcon className="h-6 w-6 text-primary" />
                          </div>
                          {report.badge && (
                            <Badge variant="secondary" className="text-xs">
                              {report.badge}
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-lg">{report.title}</CardTitle>
                        <CardDescription className="text-sm">
                          {report.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button variant="outline" className="w-full" size="sm">
                          <Eye className="h-4 w-4 mr-2" />
                          Open Report
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Help */}
      <Card className="border-2 border-dashed">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Need a custom report?</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Contact your system administrator to request new reports or custom analytics dashboards tailored to your organization's needs.
              </p>
              <Button variant="outline" size="sm">
                <Mail className="h-4 w-4 mr-2" />
                Request Custom Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

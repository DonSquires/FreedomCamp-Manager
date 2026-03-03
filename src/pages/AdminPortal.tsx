import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { 
  BarChart3, 
  AlertTriangle, 
  Car, 
  MapPin, 
  Users, 
  FileText,
  Shield,
  Settings,
  Database,
  Building2,
  Gavel,
  Layers,
  Map,
  Activity,
  Search,
  ClipboardList,
  Heart,
  Radio,
  TrendingUp,
  Lock,
  CheckSquare,
  LayoutGrid,
  ScrollText,
  Navigation,
  Inbox,
  Upload,
  FileSpreadsheet,
  Bell,
  BookOpen,
} from 'lucide-react'

export default function AdminPortal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const tile = (
    icon: React.ReactNode,
    title: string,
    description: string,
    path: string,
    label = 'Open',
  ) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" variant="outline" size="sm" onClick={() => navigate(path)}>
          {label}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <AppLayout
      title="Admin Portal"
      description={user?.role === 'master' ? 'System Administrator' : 'Organisation Administrator'}
    >
      {/* ── Compliance ─────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Compliance</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<BarChart3 className="h-4 w-4" />, 'Compliance Dashboard', 'Overview metrics and trends', '/compliance', 'View Dashboard')}
        {tile(<TrendingUp className="h-4 w-4" />, 'Compliance Analytics', 'Historical trends and zone breakdown', '/compliance-analytics', 'View Analytics')}
        {tile(<CheckSquare className="h-4 w-4" />, 'Compliance Recalculation', 'Recalculate compliance for selected date ranges', '/compliance-recalculation', 'Recalculate')}
        {tile(<LayoutGrid className="h-4 w-4" />, 'Spatial Compliance', 'Zone matrix configuration', '/spatial-compliance', 'Configure')}
      </div>

      {/* ── Breach & Enforcement ───────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Breach &amp; Enforcement</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<AlertTriangle className="h-4 w-4" />, 'Breach Alerts', 'Manage active breaches', '/breaches', 'View Breaches')}
        {tile(<Shield className="h-4 w-4" />, 'Enforcement Command', 'Warnings, notices and enforcement workflow', '/enforcement-command-center', 'View Command')}
        {tile(<ScrollText className="h-4 w-4" />, 'Enforcement Review', 'Review and approve pending enforcement actions', '/enforcement-review', 'Review')}
        {tile(<FileText className="h-4 w-4" />, 'Notice to Vacate', 'Issue and track legal notices', '/notice-to-vacate', 'View Notices')}
        {tile(<Gavel className="h-4 w-4" />, 'Infringement Notices', 'Issue FCA fines — ADR/TicketOr2 workflow', '/infringements', 'Manage Fines')}
        {tile(<ClipboardList className="h-4 w-4" />, 'Investigation Jobs', 'Assign and track investigation jobs', '/investigations', 'View Jobs')}
      </div>

      {/* ── Operations ─────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Operations</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<Layers className="h-4 w-4" />, 'Observations', 'Map, photos and list of field scans', '/observations', 'View Observations')}
        {tile(<Radio className="h-4 w-4" />, 'Live Patrol', 'Real-time patrol progress and checkpoints', '/live-patrol', 'View Patrols')}
        {tile(<Navigation className="h-4 w-4" />, 'Live Officer Tracking', 'GPS tracking and welfare monitoring', '/live-tracking', 'View Officers')}
        {tile(<Map className="h-4 w-4" />, 'Hotspots Map', 'Breach density by zone', '/hotspots', 'View Map')}
        {tile(<Heart className="h-4 w-4" />, 'Officer Welfare', 'Welfare settings and active alerts', '/officer-welfare', 'View Welfare')}
        {tile(<CheckSquare className="h-4 w-4" />, 'Patrol Checkpoints', 'Manage patrol checkpoint routes', '/patrol-checkpoints', 'Manage')}
      </div>

      {/* ── Management ─────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Management</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<Car className="h-4 w-4" />, 'Vehicles', 'Search and manage vehicles', '/vehicles', 'Manage Vehicles')}
        {tile(<BookOpen className="h-4 w-4" />, 'Vehicle Registry', 'Read-only vehicle registry and search', '/vehicle-registry', 'Browse Registry')}
        {tile(<MapPin className="h-4 w-4" />, 'Zones', 'Configure compliance zones', '/zones', 'Manage Zones')}
        {tile(<Users className="h-4 w-4" />, 'Users', 'Manage officers and admins', '/users', 'Manage Users')}
        {tile(<Users className="h-4 w-4" />, 'Person Records', 'Canonical person records and observations', '/person-records', 'View Persons')}
        {tile(<Activity className="h-4 w-4" />, 'Incidents', 'Incident management and reporting', '/incidents', 'View Incidents')}
        {tile(<Inbox className="h-4 w-4" />, 'Incident Reports', 'View and export incident reports', '/incident-reports', 'View Reports')}
        {tile(<Search className="h-4 w-4" />, 'Universal Search', 'Search across all records', '/search', 'Search')}
      </div>

      {/* ── Reporting ──────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Reporting</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<FileText className="h-4 w-4" />, 'Reports', 'Generate compliance reports', '/reports', 'View Reports')}
        {tile(<LayoutGrid className="h-4 w-4" />, 'Reports Hub', 'Leadership packs and dashboard reports', '/reports-hub', 'Open Hub')}
        {tile(<FileText className="h-4 w-4" />, 'Observations Report', 'Filter and export observation records', '/observations-report', 'View Report')}
        {tile(<Bell className="h-4 w-4" />, 'Breach Notices', 'All breach alerts with enforcement tracking', '/breach-notices', 'View Notices')}
        {tile(<ScrollText className="h-4 w-4" />, 'Audit Log', 'System audit trail', '/audit-log', 'View Log')}
        {tile(<Lock className="h-4 w-4" />, 'Privacy Curtain', 'PII access control and log', '/privacy-curtain', 'View')}
      </div>

      {/* ── Data & System ──────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Data &amp; System</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
        {tile(<Database className="h-4 w-4" />, 'Data Management', 'Import, export and data tools', '/data', 'Manage Data')}
        {tile(<Upload className="h-4 w-4" />, 'Import Data', 'AI-powered file import (CSV/image/text)', '/import-data', 'Import')}
        {tile(<FileSpreadsheet className="h-4 w-4" />, 'Import Historical', 'Bulk Excel import with progress tracking', '/import-historical', 'Import Excel')}
        {tile(<Database className="h-4 w-4" />, 'Data Hub', 'Advanced data management', '/admin/data-hub', 'Open Hub')}
        {tile(<Database className="h-4 w-4" />, 'Data Cleanup', 'Remove stale data', '/admin/data-cleanup', 'Cleanup')}
        {tile(<Activity className="h-4 w-4" />, 'Data Integrity', 'Validate and repair data', '/admin/data-integrity', 'Check Integrity')}
        {user?.role === 'master' && tile(<Building2 className="h-4 w-4" />, 'Organizations', 'Manage organization hierarchy', '/organizations', 'Manage Orgs')}
        {user?.role === 'master' && tile(<Settings className="h-4 w-4" />, 'System Diagnostics', 'System health and monitoring', '/diagnostics', 'View Diagnostics')}
        {user?.role === 'master' && tile(<Settings className="h-4 w-4" />, 'Organization Profile', 'Edit your organization settings', '/organization-profile', 'Edit Profile')}
      </div>
    </AppLayout>
  )
}

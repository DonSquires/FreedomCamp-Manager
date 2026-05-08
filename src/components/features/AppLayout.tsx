import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { isRouteVisibleForRole } from '@/navigation/routeManifestAdapter'
import { routeManifest, type AppRole } from '@/navigation/routeManifest'
import { useSessionLockStore } from '@/stores/sessionLockStore'
import { useAutoErrorReporter } from '@/hooks/useAutoErrorReporter'
import { FeedbackModal } from '@/components/features/FeedbackModal'
import { BreadcrumbNav } from '@/components/features/BreadcrumbNav'
import { PTTBar } from '@/components/features/PTTBar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNotificationCount } from '@/hooks/useNotifications'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import { PublicSafetyBanner } from '@/components/features/PublicSafetyBanner'
import { Button } from '@/components/ui/button'
import { HealthBanner } from '@/components/features/HealthBanner'
import { JurisdictionBanner } from '@/components/features/JurisdictionBanner'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import {
  Menu,
  Home,
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
  LogOut,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Search,
  Activity,
  Gavel,
  BookOpen,
  MonitorPlay,
  EyeOff,
  Image as ImageIcon,
  ScanLine,
  Receipt,
  User,
  Lock,
  Unlock,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Upload,
  CalendarDays,
  TrendingUp,
  Camera,
  Wrench,
  MessageSquarePlus,
  MessageSquare,
  Scale,
  BadgeCheck,
  Bug,
  FileCheck,
  CreditCard,
  PhoneCall,
  BadgeDollarSign,
  Ambulance,
  Flag,
  PackageX,
  Volume2,
  ParkingSquare,
  ClipboardCheck,
  FlameKindling,
  Flame,
  UserCheck,
  PieChart,
  ClipboardList,
  PersonStanding,
  Leaf,
  Wind,
  BrainCircuit,
  Map,
  HeartPulse,
  FileBarChart,
  ScrollText,
  Layers,
  Bell,
  Radio,
  CalendarRange,
  GraduationCap,
  CalendarCheck2,
  DollarSign,
  ClipboardCopy,
  Code2,
  Globe,
  LayoutDashboard,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Wand2,
  ListChecks,
  LayoutList,
  Mic,
  Tent,
  Package2,
  ExternalLink,
  ScanSearch,
  BarChart2,
  Package,
  Siren,
  Route,
  Navigation2,
  Gauge,
  FolderKanban,
  FileBadge2,
  Users2,
  ScanFace as ScanFaceAudit,
  Ban,
  KeyRound,
  FileWarning,
  GitCompareArrows,
  Briefcase,
  Waypoints,
  FlaskConical,
  CalendarClock,
  Eye,
  TicketX,
  UserX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { signalSessionActivity } from '@/hooks/useSessionInactivityLock'
import { usePTTStore, usePTTAvailable, usePTTCanSpeak } from '@/stores/pttStore'
import { startSpeaking, stopSpeaking } from '@/lib/ptt'
import { checkInferenceHealth, checkPttHealth } from '@/lib/proxyServices'

function HeaderStatusPill({
  label,
  state,
  icon,
  detail,
}: {
  label: string
  state: 'online' | 'offline' | 'degraded' | 'connecting'
  icon: React.ReactNode
  detail?: string
}) {
  const toneClasses = {
    online: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    degraded: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    connecting: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    offline: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
  }[state]

  const dotClasses = {
    online: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    connecting: 'bg-sky-500 animate-pulse',
    offline: 'bg-slate-400',
  }[state]

  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium', toneClasses)}>
      {icon}
      <span className={cn('h-2 w-2 rounded-full', dotClasses)} />
      <span>{label}</span>
      {detail ? <span className="hidden xl:inline opacity-75">{detail}</span> : null}
    </div>
  )
}

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  showBackButton?: boolean
  immersive?: boolean
}

type NavItem = {
  path: string
  icon: React.FC<{ className?: string }>
  label: string
  roles: string[]
  scopeHint?: string
}

// Pinned items always visible at the top of the sidebar
// eslint-disable-next-line react-refresh/only-export-components
export const pinnedItems: NavItem[] = [
  { path: '/platform', icon: Globe, label: 'Platform Overview', roles: ['grand_master'] },
  { path: '/admin', icon: LayoutDashboard, label: 'Command Centre', roles: ['grand_master'] },
  { path: '/compliance-escalations', icon: ShieldAlert, label: 'Escalations', roles: ['grand_master'] },
  { path: '/grandmaster-code-studio', icon: Code2, label: 'Coding Studio', roles: ['grand_master'] },
  { path: '/', icon: Home, label: 'Admin Hub', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/field-officer', icon: MonitorPlay, label: 'Field Portal', roles: ['officer'] },
  { path: '/', icon: Home, label: 'Home', roles: ['officer', 'nzscv_monitor'] },
  { path: '/bob-assistant', icon: BrainCircuit, label: 'Bob Assistant', roles: ['officer'] },
  { path: '/search', icon: Search, label: 'Search', roles: ['admin', 'admin_officer', 'master', 'officer', 'nzscv_monitor', 'grand_master'] },
]

// Grouped navigation — collapsed by default, each bucket holds related items
// eslint-disable-next-line react-refresh/only-export-components
export const navigationGroups: Array<{ label: string; icon: React.FC<{ className?: string }>; items: NavItem[] }> = [
  {
    label: 'Operations',
    icon: BarChart3,
    items: [
      { path: '/compliance', icon: ShieldCheck, label: 'Compliance Hub', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/observation-records', icon: ImageIcon, label: 'Observations', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/observations-report', icon: FileBarChart, label: 'Observations Report', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/breaches', icon: AlertTriangle, label: 'Breaches & Alerts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/breach-notices', icon: ScrollText, label: 'Breach Notices', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/enforcement-actions', icon: Gavel, label: 'Enforcement Actions', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/enforcement-review', icon: ClipboardCheck, label: 'Enforcement Review', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/enforcement-command-center', icon: MonitorPlay, label: 'Enforcement Console', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/enforcement-events-log', icon: Siren, label: 'Enforcement Event Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/trespass-notices-log', icon: Ban, label: 'Trespass Notice Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-infringements-log', icon: TicketX, label: 'Parking Infringement Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/disputes', icon: AlertTriangle, label: 'Disputes', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/discrepancies', icon: AlertTriangle, label: 'Discrepancies', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/infringements', icon: Receipt, label: 'Infringements', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/compliance-analytics', icon: PieChart, label: 'Compliance Analytics', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/compliance-audit-log', icon: BadgeCheck, label: 'Compliance Audit Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-checkpoints', icon: ScanLine, label: 'Checkpoints', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-schedule', icon: CalendarDays, label: 'Patrol Schedule', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-kpis', icon: TrendingUp, label: 'Patrol KPIs', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/noise-notices', icon: Volume2, label: 'Noise Notices', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/site-incidents', icon: Building2, label: 'Site Incidents', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/person-interactions', icon: Users, label: 'Person Interactions', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/notices-to-vacate', icon: FileWarning, label: 'Notices to Vacate', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/alarm-events-log', icon: Bell, label: 'Alarm Event Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/enforcement-events-log', icon: Gavel, label: 'Enforcement Event Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/checkpoint-visits-log', icon: ScanLine, label: 'Checkpoint Visit Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/officer-activity-log', icon: Activity, label: 'Officer Activity Log', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Live Ops',
    icon: MonitorPlay,
    items: [
      { path: '/live-tracking', icon: Activity, label: 'Live Tracking', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/live-patrol', icon: MonitorPlay, label: 'Live Patrol Monitor', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/operations-map', icon: Layers, label: 'Operations Map', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/hotspots', icon: FlameKindling, label: 'Hotspots Map', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch', icon: Radio, label: 'Dispatch Console', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-monitor', icon: LayoutList, label: 'Dispatch Monitor', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-wizard', icon: Wand2, label: 'Dispatch Wizard', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatched-jobs', icon: ListChecks, label: 'Dispatched Jobs', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-events', icon: Radio, label: 'Dispatch Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-ack-log', icon: Radio, label: 'Dispatch Ack Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/alarm-events', icon: Siren, label: 'Alarm Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/breach-escalation', icon: ShieldAlert, label: 'Breach Escalation', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/noise-complaints', icon: Volume2, label: 'Noise Complaints Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/incident-heatmap', icon: Flame, label: 'Incident Heatmap', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-route-optimiser', icon: Route, label: 'Route Optimiser', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/patrol-navigation', icon: Navigation2, label: 'Patrol Navigation', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/fixed-cameras', icon: Camera, label: 'Fixed Cameras', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/team-chat', icon: MessageSquare, label: 'Team Chat', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/radio', icon: Radio, label: 'Radio', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/lmr-bridge', icon: Radio, label: 'LMR Bridge', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/radio-transmissions', icon: Mic, label: 'Radio Transmissions', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/voice-profiles', icon: Mic, label: 'Voice Profiles & Consent', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/radio/audit', icon: Radio, label: 'Radio Audit', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Management',
    icon: Car,
    items: [
      { path: '/vehicles', icon: Car, label: 'Vehicles', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/vehicle-registry', icon: Car, label: 'Vehicle Registry', roles: ['admin', 'admin_officer', 'master', 'nzscv_monitor'] },
      { path: '/plate-finder', icon: ScanSearch, label: 'Plate Finder', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/plate-scans-log', icon: ScanSearch, label: 'Plate Scan Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/vehicle-discrepancies', icon: GitCompareArrows, label: 'Vehicle Discrepancies', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/drift-events', icon: Waypoints, label: 'Drift Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/flagged-vehicles-manager', icon: Flag, label: 'Flagged Vehicles', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/zone-signage-evidence', icon: ImageIcon, label: 'Zone Signage Evidence', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/zone-geofence-snapshots', icon: MapPin, label: 'Zone Geofence Snapshots', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/nzscv', icon: Car, label: 'NZSCV Monitor', roles: ['admin', 'master', 'nzscv_monitor'] },
      { path: '/admin/canonical-records', icon: Database, label: 'Canonical Records', roles: ['admin', 'master'] },
      { path: '/zones', icon: MapPin, label: 'Zones', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/zone-amenities', icon: Wrench, label: 'Zone Amenities', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/client-master-list', icon: ListChecks, label: 'Client Master List', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/client-sites', icon: Building2, label: 'Client Sites', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/site-permissions', icon: ShieldCheck, label: 'Site Permissions', roles: ['admin', 'master'] },
      { path: '/crm', icon: Building2, label: 'CRM / Accounts', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/tender-workspace', icon: Gavel, label: 'Tenders & Contracts', roles: ['admin', 'master', 'grand_master'] },
      { path: '/tender-reference-library', icon: BookOpen, label: 'Reference Library', roles: ['admin', 'master', 'grand_master'] },
      { path: '/pricing', icon: DollarSign, label: 'Service Pricing', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dynamic-pricing', icon: Gauge, label: 'Dynamic Pricing', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/revenue-forecasting', icon: TrendingUp, label: 'Revenue Forecasting', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/invoicing', icon: Receipt, label: 'Invoicing', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-permits', icon: BadgeCheck, label: 'Parking Permits', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/dashboard', icon: MonitorPlay, label: 'Ops Dashboard', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/users', icon: Users, label: 'Users', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/organization-profile', icon: Building2, label: 'Organisation', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/organizations', icon: Building2, label: 'Organisations', roles: ['master'] },
      // Sprint 22–26 (B-76–B-90) config/manager
      { path: '/investigation-job-config', icon: Settings, label: 'Investigation Job Config', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/zone-legal-config', icon: FileText, label: 'Zone Legal Config', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/flagged-vehicles-manager', icon: AlertTriangle, label: 'Flagged Vehicles', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/bug-reports-log', icon: Bug, label: 'Bug Report Log', roles: ['admin', 'master'] },
      { path: '/feature-flags', icon: Settings, label: 'Feature Flags', roles: ['master'] },
      // Sprint 43: B-141
      { path: '/import-batches-log', icon: Upload, label: 'Import Batch Log', roles: ['admin', 'master'] },
      // Sprint 44: B-142, B-144
      { path: '/admin-recalculation-log', icon: RefreshCw, label: 'Recalculation Run Log', roles: ['admin', 'master'] },
      { path: '/import-staging-log', icon: LayoutList, label: 'Import Staging Log', roles: ['admin', 'master'] },
      // Sprint 45: B-145, B-147
      { path: '/lmr-bridge-config-log', icon: Radio, label: 'LMR Bridge Config Log', roles: ['admin', 'master'] },
      { path: '/zone-dispatch-rules-log', icon: Waypoints, label: 'Zone Dispatch Rule Log', roles: ['admin', 'master'] },
      // Sprint 46: B-150
      { path: '/restrictions-log', icon: Map, label: 'Restriction Log', roles: ['admin', 'master'] },
    ],
  },
  {
    label: 'Records',
    icon: FileText,
    items: [
      { path: '/incidents', icon: Shield, label: 'Incidents & Evidence', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/evidence-packages', icon: Package, label: 'Evidence Packages', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/cohort-analysis', icon: BarChart2, label: 'Cohort Analysis', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/occupancy-analytics', icon: TrendingUp, label: 'Occupancy Analytics', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/incident-reports', icon: ClipboardList, label: 'Incident Reports', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/investigations', icon: BrainCircuit, label: 'Investigations', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/investigation-job-config', icon: FlaskConical, label: 'Job Config', roles: ['admin', 'master'] },
      { path: '/credential-processing-log', icon: FileCheck, label: 'Credential Processing Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/person-records', icon: PersonStanding, label: 'Person Records', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/canonical-persons', icon: Users, label: 'Canonical Persons', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/trespass-notices', icon: Ban, label: 'Trespass Notices', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/access-permissions', icon: KeyRound, label: 'Access Permissions', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/site-risk-assessment', icon: ClipboardCheck, label: 'Site Risk Assessments', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/site-risk-trends', icon: TrendingUp, label: 'Site Risk Trends', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/loi-browser', icon: MapPin, label: 'Dispatch LOI Browser', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/reports', icon: FileText, label: 'Reports', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/reports-hub', icon: FileBarChart, label: 'Reports Hub', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/audit-log', icon: Activity, label: 'Audit Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/privacy-curtain', icon: EyeOff, label: 'Privacy Curtain', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 19–21 (B-67–B-75) logs
      { path: '/noise-notices', icon: Volume2, label: 'Noise Notices', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/site-incidents', icon: Shield, label: 'Site Incidents', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/person-interactions', icon: Users, label: 'Person Interactions', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/person-observations-log', icon: Eye, label: 'Person Observation Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/plate-scans-log', icon: ScanSearch, label: 'Plate Scans', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-events', icon: Radio, label: 'Dispatch Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/notices-to-vacate', icon: ScrollText, label: 'Notices to Vacate', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/vehicle-discrepancies', icon: AlertTriangle, label: 'Vehicle Discrepancies', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 22–26 (B-76–B-90) logs
      { path: '/drift-events', icon: Navigation2, label: 'Drift Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/investigation-jobs-log', icon: BrainCircuit, label: 'Investigation Jobs', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/operational-cases-log', icon: FolderKanban, label: 'Operational Cases', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-events-log', icon: Route, label: 'Patrol Events Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/checkpoint-visits-log', icon: ScanLine, label: 'Checkpoint Visits', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/ems-attendances-log', icon: HeartPulse, label: 'EMS Attendances', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-sessions-log', icon: ParkingSquare, label: 'Parking Sessions', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-payments-log', icon: Receipt, label: 'Parking Payments', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/zone-signage-evidence', icon: ImageIcon, label: 'Zone Signage Evidence', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/officer-activity-log', icon: Activity, label: 'Officer Activity Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-ack-log', icon: Radio, label: 'Dispatch Acknowledgements', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/noise-jobs-log', icon: Volume2, label: 'Noise Job Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/noise-assessments-log', icon: Volume2, label: 'Noise Assessment Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 31: B-103–B-105
      { path: '/vehicles-of-interest-log', icon: Car, label: 'Vehicles of Interest', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/persons-of-interest-log', icon: UserX, label: 'Persons of Interest', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/photo-metadata-log', icon: ImageIcon, label: 'Photo Metadata Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 32: B-106–B-108
      { path: '/radio-comms-events-log', icon: Radio, label: 'Radio Comms Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/case-comments-log', icon: MessageSquare, label: 'Case Comment Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/lmr-bridge-sessions-log', icon: Radio, label: 'LMR Bridge Sessions', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 33: B-109–B-111
      { path: '/patrol-session-events-log', icon: Route, label: 'Patrol Session Events', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/radio-transcript-log', icon: FileText, label: 'Radio Transcript Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispute-intake-log', icon: Scale, label: 'Dispute Intake Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 34: B-112–B-114
      { path: '/radio-tts-render-log', icon: Volume2, label: 'Radio TTS Render Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/health-safety-report-log', icon: HeartPulse, label: 'H&S Report Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/noise-seizures-log', icon: PackageX, label: 'Noise Seizure Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 35: B-115–B-117
      { path: '/locations-of-interest-log', icon: MapPin, label: 'Locations of Interest', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/vehicle-monthly-stays-log', icon: CalendarRange, label: 'Vehicle Monthly Stays', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/radio-voice-consent-log', icon: ShieldCheck, label: 'Voice Consent Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/welfare-events-log', icon: HeartPulse, label: 'Welfare Events Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 44: B-143
      { path: '/contractor-documents-log', icon: Briefcase, label: 'Contractor Document Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 45: B-146
      { path: '/radio-voice-profiles-log', icon: Mic, label: 'Radio Voice Profile Log', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 46: B-149
      { path: '/homeless-records-log', icon: Tent, label: 'Homeless Record Log', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Specialist Portals',
    icon: Layers,
    items: [
      { path: '/field-officer?service=freedom_camping', icon: Tent, label: 'Freedom Camping', roles: ['officer', 'admin_officer'], scopeHint: 'Zone-based' },
      { path: '/parking-officer', icon: ParkingSquare, label: 'Parking Enforcement', roles: ['officer', 'admin_officer', 'admin', 'master'], scopeHint: 'Zone-based' },
      { path: '/noise-officer', icon: Volume2, label: 'Noise Control', roles: ['officer', 'admin_officer', 'admin', 'master'], scopeHint: 'Jurisdiction-wide' },
      { path: '/biosecurity-officer', icon: Leaf, label: 'Biosecurity (CNG)', roles: ['officer', 'admin_officer', 'admin', 'master'], scopeHint: 'Jurisdiction-wide' },
      { path: '/smoke-officer', icon: Wind, label: 'Smoke Complaints (OOH)', roles: ['officer', 'admin_officer', 'admin', 'master'], scopeHint: 'Jurisdiction-wide' },
      { path: '/identity-verification', icon: ShieldCheck, label: 'ID Verification', roles: ['admin', 'admin_officer', 'master'], scopeHint: 'Client/Site driven' },
      { path: '/officer-welfare', icon: HeartPulse, label: 'Officer Welfare', roles: ['admin', 'admin_officer', 'master'], scopeHint: 'Officer-based' },
      { path: '/welfare-checkins', icon: HeartPulse, label: 'Welfare Check-in Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-permits', icon: ParkingSquare, label: 'Parking Permits', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-sessions-log', icon: ParkingSquare, label: 'Parking Session Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-payments-log', icon: CreditCard, label: 'Parking Payment Log', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Roster & Workforce',
    icon: CalendarRange,
    items: [
      { path: '/roster', icon: CalendarRange, label: 'Roster Planner', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/roster-shifts', icon: ClipboardList, label: 'Roster Shift Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/open-shifts', icon: CalendarCheck2, label: 'Open Shifts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/open-shifts-manager', icon: CalendarClock, label: 'Open Shift Manager', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/availability', icon: CalendarDays, label: 'My Availability', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/officer-skills', icon: GraduationCap, label: 'Skills & Licences', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/timesheets', icon: ClipboardCopy, label: 'Timesheets', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/asset-management', icon: Package2, label: 'Asset Management', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/contractor-manager', icon: Wrench, label: 'Contractor Manager', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/on-call-periods', icon: PhoneCall, label: 'On-Call Periods', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/callout-shifts', icon: Siren, label: 'Callout Shifts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/officer-allowances', icon: BadgeDollarSign, label: 'Officer Allowances', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/travel-allowances', icon: Car, label: 'Travel Allowances', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking-appeals', icon: Gavel, label: 'Parking Appeals', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/camper-registrations', icon: Tent, label: 'Camper Registrations', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/case-bridge', icon: FolderKanban, label: 'Case Bridge', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/service-agreements', icon: FileBadge2, label: 'Service Agreements', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/ems-attendances-log', icon: Ambulance, label: 'EMS Attendance Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/poi-voi-dashboard', icon: Users2, label: 'POI/VOI Watch-list', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/access-audit', icon: ScanFaceAudit, label: 'Access Audit Log', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Bob',
    icon: BrainCircuit,
    items: [
      { path: '/bob-assistant', icon: BrainCircuit, label: 'Bob Assistant', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/bob-studio', icon: BrainCircuit, label: 'Bob Studio', roles: ['admin', 'admin_officer', 'master', 'grand_master'] },
      { path: '/bob-intake-queue', icon: ClipboardList, label: 'Bob Intake Queue', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/ai-analysis', icon: BrainCircuit, label: 'Bob Analysis', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/live-plan-reviews', icon: ShieldCheck, label: 'Live Plan Reviews', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 43: B-139–B-140
      { path: '/bob-proposals-log', icon: ScrollText, label: 'Bob Proposal Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/bob-proposal-events-log', icon: ListChecks, label: 'Bob Proposal Events', roles: ['admin', 'admin_officer', 'master'] },
      // Sprint 46: B-148
      { path: '/bob-action-proposal-events-log', icon: ListChecks, label: 'Bob Action Prop. Events', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { path: '/spatial-compliance', icon: Map, label: 'Spatial Compliance', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/compliance-recalculation', icon: Shield, label: 'Recalculation', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/cleanup-recalculate', icon: RefreshCw, label: 'Cleanup & Recalculate', roles: ['admin', 'master'] },
      { path: '/data', icon: Database, label: 'Data Management', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/data-hub', icon: Database, label: 'Data Hub', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/raw-data-browser', icon: Database, label: 'Raw Data Browser', roles: ['grand_master'] },
      { path: '/intel-approvals', icon: ShieldAlert, label: 'Intel Approvals', roles: ['master'] },
      { path: '/import-historical', icon: Upload, label: 'Import Data', roles: ['admin', 'master'] },
      { path: '/photo-reingest', icon: Camera, label: 'Photo Reingest', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/diagnostics', icon: Settings, label: 'Diagnostics', roles: ['master'] },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    items: [
      { path: '/admin/service-provider-access', icon: ShieldCheck, label: 'Service Provider Access', roles: ['admin', 'master'] },
      { path: '/profile', icon: User, label: 'My Profile', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/notifications', icon: Bell, label: 'Notifications', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/settings', icon: Settings, label: 'Settings', roles: ['admin', 'admin_officer', 'master', 'officer', 'nzscv_monitor'] },
    ],
  },
]

const navigationLabelByPath = new globalThis.Map(
  [...pinnedItems, ...navigationGroups.flatMap((group) => group.items)].map((item) => [item.path.split('?')[0], item.label])
)

function formatBreadcrumbSegment(segment: string) {
  return segment
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function NavigationLinks({ onClick }: { onClick?: () => void }) {
  const location = useLocation()
  const { user } = useAuthStore()
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  // grand_master sees the same grouped nav items as master
  const effectiveNavRole = user?.role === 'grand_master' ? 'master' : user?.role

  // Auto-expand the group containing the active path on navigation
  useEffect(() => {
    for (const group of navigationGroups) {
      if (group.items.some(item => location.pathname === item.path && item.roles.includes(effectiveNavRole ?? ''))) {
        setOpenGroups(prev => {
          if (prev.has(group.label)) return prev
          const next = new Set(prev)
          next.add(group.label)
          return next
        })
      }
    }
  }, [location.pathname, effectiveNavRole])

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // Derive active feature flags from role — master/grand_master can access internal tools
  const activeFeatureFlags = useMemo<Set<string>>(() => {
    const flags = new Set<string>()
    if (user?.role === 'master' || user?.role === 'grand_master') flags.add('enable_internal_tools')
    return flags
  }, [user?.role])

  const visiblePinned = pinnedItems.filter(item =>
    user && isRouteVisibleForRole(item.path, user.role as AppRole, routeManifest, activeFeatureFlags)
  )

  return (
    <nav className="space-y-2">
      {/* Pinned items */}
      {visiblePinned.map((item) => {
        const Icon = item.icon
        const isActive = location.pathname === item.path
        return (
          <Link
            key={`pinned:${item.path}`}
            to={item.path}
            onClick={onClick}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))] dark:bg-primary/15 ring-1 ring-primary/20'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
            <span>{item.label}</span>
          </Link>
        )
      })}

      <div className="my-2 border-t border-gray-200/90 dark:border-gray-700/80" />

      {/* Grouped navigation with accordion */}
      {navigationGroups.map((group) => {
        const GroupIcon = group.icon
        const visibleItems = group.items.filter(item =>
           isRouteVisibleForRole(item.path, effectiveNavRole as AppRole, routeManifest, activeFeatureFlags)
        )
        if (visibleItems.length === 0) return null

        const isOpen = openGroups.has(group.label)
        const hasActiveChild = visibleItems.some(item => location.pathname === item.path)

        return (
          <div
            key={group.label}
            className={cn(
              'rounded-xl p-1 transition-colors',
              hasActiveChild ? 'bg-primary/5 dark:bg-primary/10' : 'bg-transparent'
            )}
          >
            <button
              onClick={() => toggleGroup(group.label)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150',
                hasActiveChild
                  ? 'text-primary bg-primary/5 dark:bg-primary/15'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
              )}
            >
              <span className="flex items-center gap-3">
                <GroupIcon className={cn('h-4 w-4 shrink-0', hasActiveChild ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
                <span>{group.label}</span>
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-180')} />
            </button>

            {isOpen && (
              <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 dark:border-gray-700 pl-3">
                {visibleItems.map((item) => {
                  const Icon = item.icon
                  const isActive = location.pathname === item.path
                  return (
                    <Link
                      key={`group:${group.label}:${item.path}`}
                      to={item.path}
                      onClick={onClick}
                      className={cn(
                        'flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium dark:bg-primary/15 ring-1 ring-primary/20'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.scopeHint && (
                          <span className="block text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                            {item.scopeHint}
                          </span>
                        )}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function AppLayout({ children, title, description, showBackButton, immersive = false }: AppLayoutProps) {
  const brandLogoUrl = '/iron-eagle-security-logo.jpg'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [pttFabOpen, setPttFabOpen] = useState(false)
  const [desktopNavOpen, setDesktopNavOpen] = useState(() => {
    // Default to open (true). Only closes if the user has explicitly set it to 'false'.
    try { return localStorage.getItem('fc_sidebar_open') !== 'false' } catch { return true }
  })
  const [reLoginPassword, setReLoginPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const activeFetchCount = useIsFetching()

  useEffect(() => {
    const onOffline = () => setIsOffline(true)
    const onOnline = () => setIsOffline(false)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])
  const { user, logout, unlockSession } = useAuthStore()
  const {
    isLocked,
    isWarningVisible,
    warningSecondsRemaining,
    title: lockTitle,
    message: lockMessage,
    clearWarning,
    unlock,
  } = useSessionLockStore()
  const { autoLogoffEnabled } = useSessionPreferencesStore()
  const { themeMode } = useThemePreferencesStore()
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark' | 'high-contrast' | 'night-patrol'>('light')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  // ── Floating PTT button state ────────────────────────────────────────────
  const pttConnectionStatus   = usePTTStore((s) => s.connectionStatus)
  const pttChannelName        = usePTTStore((s) => s.channelName)
  const pttIsSpeaking         = usePTTStore((s) => s.isSpeaking)
  const pttSpeakerName        = usePTTStore((s) => s.speakerName)
  const pttSpeakerId          = usePTTStore((s) => s.speakerId)
  const pttAvailable          = usePTTAvailable()
  const pttCanSpeak           = usePTTCanSpeak()
  // True when the WebRTC socket is connected but no channel has been joined yet
  const pttConnectedNoChannel = usePTTStore((s) => s.connectionStatus === 'connected' && s.channelId === null)
  const [pttHolding, setPttHolding]   = useState(false)
  const [pttExpanded, setPttExpanded] = useState(false)

  const { data: bobHealth } = useQuery({
    queryKey: ['app-header-bob-health'],
    queryFn: checkInferenceHealth,
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 45_000,
  })

  const bobStatusTone: 'online' | 'offline' | 'degraded' | 'connecting' =
    bobHealth?.status === 'online' ? 'online' : bobHealth?.status === 'degraded' ? 'degraded' : 'offline'

  const { data: pttHealth } = useQuery({
    queryKey: ['ptt-health'],
    queryFn: checkPttHealth,
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 45_000,
  })

  const pttStatusTone: 'online' | 'offline' | 'degraded' | 'connecting' =
    pttConnectionStatus === 'connecting' || pttConnectionStatus === 'reconnecting'
      ? 'connecting'
      : pttConnectionStatus === 'error'
        ? 'degraded'
        : pttHealth?.status === 'online'
          ? 'online'
          : pttHealth?.status === 'degraded'
            ? 'degraded'
            : 'offline'

  const handlePTTDown = useCallback(async () => {
    // Prevent re-entry via both local guard and the authoritative store flag
    if (!pttCanSpeak || !pttAvailable || pttHolding || pttIsSpeaking) return
    try {
      await startSpeaking()
      setPttHolding(true)
    } catch { /* ptt.ts already toasts */ }
  }, [pttCanSpeak, pttAvailable, pttHolding, pttIsSpeaking])

  const handlePTTUp = useCallback(async () => {
    // Release if either the local guard or the store thinks we're still transmitting
    if (!pttHolding && !pttIsSpeaking) return
    try { await stopSpeaking() } catch { /* silent */ } finally { setPttHolding(false) }
  }, [pttHolding, pttIsSpeaking])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (location.pathname === '/radio') return
    window.sessionStorage.setItem('fc_last_non_radio_route', `${location.pathname}${location.search}${location.hash}`)
  }, [location.pathname, location.search, location.hash])

  const openRadioConsole = useCallback(() => {
    navigate('/radio', { state: { from: `${location.pathname}${location.search}${location.hash}` } })
  }, [navigate, location.hash, location.pathname, location.search])

  // Automatic crash detection — submits bug reports without user action
  useAutoErrorReporter()
  const { data: notifCount = 0 } = useNotificationCount()

  const teamChatSeenKey = user?.id ? `fc_team_chat_seen_at_${user.id}` : null

  const scopedOrgIds = useMemo(() => {
    if (!user) return [] as string[]
    const ids = [user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])]
    return Array.from(new Set(ids.filter(Boolean) as string[]))
  }, [user])

  const { data: chatSignalCount = 0 } = useQuery({
    queryKey: ['layout-chat-signal-count', user?.id, user?.role, scopedOrgIds, location.pathname],
    enabled: !!user,
    staleTime: 20_000,
    refetchInterval: 45_000,
    queryFn: async () => {
      if (!user) return 0

      const seenAt = (() => {
        if (typeof window === 'undefined' || !teamChatSeenKey) return null
        const value = window.localStorage.getItem(teamChatSeenKey)
        return value && !Number.isNaN(Date.parse(value)) ? value : null
      })()

      const isNewSinceSeen = (createdAt?: string | null) => {
        if (!createdAt) return false
        if (!seenAt) return true
        return new Date(createdAt).getTime() > new Date(seenAt).getTime()
      }

      const now = new Date().toISOString()
      const [alertsRes, acksRes] = await Promise.all([
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, scope, target_organization_ids, created_at')
          .eq('status', 'active')
          .lte('starts_at', now)
          .or(`expires_at.is.null,expires_at.gte.${now}`),
        ((supabase as any).from('public_safety_alert_acknowledgements') as any)
          .select('alert_id')
          .eq('user_id', user.id),
      ])

      if (alertsRes.error) throw alertsRes.error
      if (acksRes.error) throw acksRes.error

      const acked = new Set(((acksRes.data || []) as any[]).map((row) => row.alert_id))
      const unackedAlerts = ((alertsRes.data || []) as any[]).filter((row) => {
        if (acked.has(row.id)) return false
        if (!isNewSinceSeen(row.created_at)) return false
        if (row.scope === 'national') return true
        const targets = Array.isArray(row.target_organization_ids) ? row.target_organization_ids : []
        return targets.some((id: string) => scopedOrgIds.includes(id))
      }).length

      const isApprover = user.role === 'master' || user.role === 'grand_master'
      if (!isApprover) {
        return unackedAlerts
      }

      const [pendingBulletinsRes, pendingAlertsRes] = await Promise.all([
        ((supabase as any).from('external_intel_bulletins') as any)
          .select('id, created_at')
          .eq('approval_status', 'pending')
          .order('created_at', { ascending: false })
          .limit(200),
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      if (pendingBulletinsRes.error) throw pendingBulletinsRes.error
      if (pendingAlertsRes.error) throw pendingAlertsRes.error

      const pendingBulletinsNew = ((pendingBulletinsRes.data || []) as any[]).filter((row) => isNewSinceSeen(row.created_at)).length
      const pendingAlertsNew = ((pendingAlertsRes.data || []) as any[]).filter((row) => isNewSinceSeen(row.created_at)).length

      return unackedAlerts + pendingBulletinsNew + pendingAlertsNew
    },
  })

  useEffect(() => {
    if (!user || !teamChatSeenKey || location.pathname !== '/team-chat') return
    if (typeof window === 'undefined') return

    window.localStorage.setItem(teamChatSeenKey, new Date().toISOString())
    queryClient.invalidateQueries({ queryKey: ['layout-chat-signal-count'] })
  }, [location.pathname, queryClient, teamChatSeenKey, user])

  useEffect(() => {
    if (typeof window === 'undefined') {
      setResolvedTheme('light')
      return
    }

    const applyResolvedTheme = () => {
      if (themeMode === 'light' || themeMode === 'dark' || themeMode === 'high-contrast' || themeMode === 'night-patrol') {
        setResolvedTheme(themeMode)
        return
      }

      setResolvedTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    }

    applyResolvedTheme()

    if (themeMode !== 'system') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyResolvedTheme()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }

    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [themeMode])

  const themeBadgeText =
    themeMode === 'system'
      ? `System -> ${resolvedTheme === 'dark' ? 'Dark' : 'Light'}`
      : themeMode === 'high-contrast'
        ? 'High Contrast'
        : themeMode === 'night-patrol'
          ? '🌙 Night Patrol'
          : themeMode === 'dark'
            ? 'Dark'
            : 'Light'

  const ThemeBadgeIcon =
    themeMode === 'system'
      ? Monitor
      : resolvedTheme === 'dark' || resolvedTheme === 'night-patrol'
        ? Moon
        : Sun

  const handleLogout = async () => {
    await logout()
    queryClient.clear()
    navigate('/login')
  }

  const handleBack = () => {
    navigate('/')
  }

  const breadcrumbItems = useMemo(() => {
    const pathname = location.pathname.split('?')[0]
    const segments = pathname.split('/').filter(Boolean)

    if (segments.length === 0) return []

    return segments.map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`
      const navLabel = navigationLabelByPath.get(href)
      const fallbackLabel = formatBreadcrumbSegment(segment)
      const label = index === segments.length - 1 ? (title || navLabel || fallbackLabel) : (navLabel || fallbackLabel)

      return index === segments.length - 1 ? { label } : { label, href }
    })
  }, [location.pathname, title])

  // Persist sidebar open/closed preference
  const toggleDesktopNav = () => {
    setDesktopNavOpen((v) => {
      const next = !v
      try { localStorage.setItem('fc_sidebar_open', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const handleUnlockSession = async () => {
    if (!user?.email) {
      toast.error('Session cannot be restored. Please log in again.')
      return
    }
    if (!reLoginPassword.trim()) {
      toast.error('Enter your password to unlock the session.')
      return
    }

    setUnlocking(true)
    try {
      // unlockSession re-authenticates without a loading flash and clears the
      // lock state internally; no separate unlock() call is needed here.
      await unlockSession(user.email, reLoginPassword)
      setReLoginPassword('')
      toast.success('Session unlocked')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to unlock session')
    } finally {
      setUnlocking(false)
    }
  }

  const handleLogoutCompletely = async () => {
    await handleLogout()
    unlock()
  }

  const handleStaySignedIn = () => {
    clearWarning()
    signalSessionActivity()
    toast.success('Session extended')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-cyan-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      {/* Mobile Header */}
      {!immersive && (
      <header className="lg:hidden bg-white/95 dark:bg-gray-800/95 backdrop-blur shadow-sm sticky top-0 z-40 border-b border-gray-200/60 dark:border-gray-700/60">
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex flex-col h-full">
                  <div className="p-4 border-b dark:border-gray-700">
                    <h2 className="font-semibold text-lg">FieldOps</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {user?.full_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {user?.role === 'grand_master' ? 'Platform Administrator' :
                       user?.role === 'master' ? 'System Admin' : 
                       user?.role === 'admin' ? 'Admin' :
                        user?.role === 'admin_officer' ? 'Admin Officer' :
                        user?.role === 'nzscv_monitor' ? 'NZSCV Monitor' : 'Officer'}
                    </p>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4">
                    <NavigationLinks onClick={() => setSidebarOpen(false)} />
                  </div>

                  <div className="p-4 border-t dark:border-gray-700">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {showBackButton && (
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}
          </div>

          <h1 className="font-semibold text-lg truncate">{title || 'FieldOps'}</h1>
          
          {/* Mobile: notification bell */}
          <button
            type="button"
            title="Alerts"
            aria-label="Alerts"
            onClick={() => navigate('/notifications')}
            className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            {notifCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {notifCount > 9 ? '9+' : notifCount}
              </span>
            )}
          </button>
          </div>
          {user && (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <HeaderStatusPill
                label="PTT"
                state={pttStatusTone}
                icon={<Radio className="h-3.5 w-3.5" />}
                detail={pttChannelName || pttConnectionStatus}
              />
              <HeaderStatusPill
                label="Bob"
                state={bobStatusTone}
                icon={<BrainCircuit className="h-3.5 w-3.5" />}
                detail={bobHealth?.status === 'online' ? 'ready' : bobHealth?.error || 'offline'}
              />
            </div>
          )}
        </div>
      </header>
      )}

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:block fixed inset-y-0 left-0 w-64 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-r dark:border-gray-700 z-30 transition-transform duration-200 shadow-[2px_0_14px_-2px_rgba(0,0,0,0.1)] dark:shadow-[2px_0_14px_-2px_rgba(0,0,0,0.45)]',
          desktopNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          <div className="p-5 border-b dark:border-gray-700 bg-gradient-to-br from-cyan-700 via-cyan-800 to-slate-900 dark:from-cyan-900 dark:via-cyan-950 dark:to-slate-950">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h2 className="font-bold text-xl text-white">FieldOps</h2>
                <p className="text-sm text-cyan-100 mt-0.5 truncate">
                  {user?.full_name}
                </p>
                <p className="text-xs text-cyan-200 mt-0.5">
                  {user?.role === 'grand_master' ? 'Platform Administrator' :
                   user?.role === 'master' ? 'System Administrator' : 
                   user?.role === 'admin' ? 'Administrator' :
                  user?.role === 'admin_officer' ? 'Admin Officer' :
                  user?.role === 'nzscv_monitor' ? 'NZSCV Monitor' : 'Field Officer'}
                </p>
                <p className="mt-2 inline-flex rounded-full border border-cyan-200/30 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                  Operations Console
                </p>
              </div>
              <button
                onClick={toggleDesktopNav}
                title="Collapse sidebar"
                className="mt-0.5 shrink-0 rounded p-1 text-cyan-200 hover:bg-cyan-600/50 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <NavigationLinks />
          </div>

          <div className="p-4 border-t dark:border-gray-700">
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn('transition-[padding] duration-200', desktopNavOpen ? 'lg:pl-64' : 'lg:pl-0')}>
        {/* Desktop Header */}
        {!immersive && (
        <header className="hidden lg:block bg-white/95 dark:bg-gray-800/90 backdrop-blur shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)] sticky top-0 z-20 border-b border-gray-100/90 dark:border-gray-700/60">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleDesktopNav}
                  title={desktopNavOpen ? 'Collapse menu' : 'Open menu'}
                  className="mt-0.5"
                >
                  <Menu className="h-5 w-5" />
                </Button>

                <div>
                {breadcrumbItems.length > 0 && (
                  <div className="mb-2 hidden md:block">
                    <BreadcrumbNav items={breadcrumbItems} />
                  </div>
                )}
                {showBackButton && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleBack}
                    className="mb-2"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back to Home
                  </Button>
                )}
                {title && (
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {title}
                  </h1>
                )}
                {description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {description}
                  </p>
                )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {user && (
                  <div className="flex items-center gap-2">
                    <HeaderStatusPill
                      label="PTT"
                      state={pttStatusTone}
                      icon={<Radio className="h-3.5 w-3.5" />}
                      detail={pttChannelName || pttConnectionStatus}
                    />
                    <HeaderStatusPill
                      label="Bob"
                      state={bobStatusTone}
                      icon={<BrainCircuit className="h-3.5 w-3.5" />}
                      detail={bobHealth?.status === 'online' ? 'ready' : bobHealth?.error || 'offline'}
                    />
                  </div>
                )}
                <button
                  type="button"
                  title="Notifications"
                  aria-label="Notifications"
                  data-testid="notification-bell"
                  onClick={() => navigate('/notifications')}
                  className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  {notifCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                      {notifCount > 9 ? '9+' : notifCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </header>
        )}

        {/* Page Content */}
        <main className={cn('relative', immersive ? 'p-0 lg:p-0' : 'p-4 lg:p-6')}>
          {!immersive && <PublicSafetyBanner />}
          {!immersive && <JurisdictionBanner />}
          {!immersive && (user?.role === 'admin' || user?.role === 'master' || user?.role === 'grand_master') && <HealthBanner />}
          {!immersive && isOffline && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/25 dark:text-amber-200">
              Connection lost. You are offline and some live data may be stale.
            </div>
          )}
          {!immersive && !isOffline && activeFetchCount > 0 && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Refreshing live data in the background
            </div>
          )}
          {children}

          {/* PTT / Team Chat floating action button */}
          {user && !isLocked && (
            <Popover open={pttFabOpen} onOpenChange={setPttFabOpen}>
              <PopoverTrigger asChild>
                <button
                  title="Push-to-Talk / Team Chat"
                  className="fixed bottom-16 right-4 z-40 flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all hover:shadow-xl group"
                >
                  <span className="relative">
                    <Radio className="h-4 w-4 text-blue-500 group-hover:scale-110 transition-transform" />
                    <span
                      className={cn(
                        'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white dark:border-gray-800',
                        pttConnectionStatus === 'connected' && 'bg-green-500',
                        pttConnectionStatus === 'connecting' || pttConnectionStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' : '',
                        pttConnectionStatus === 'disconnected' || pttConnectionStatus === 'error' ? 'bg-gray-400' : '',
                      )}
                    />
                  </span>
                  <span className="hidden sm:inline">PTT</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-80 p-0"
                sideOffset={8}
              >
                <PTTBar />
              </PopoverContent>
            </Popover>
          )}

          {/* Global feedback button — visible to all authenticated users */}
          {user && !isLocked && (
            <>
              {location.pathname !== '/radio' && (
                <div className="md:hidden fixed bottom-2 left-2 right-2 z-40">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/95 shadow-xl px-3 py-2 flex items-center gap-2">
                    <button
                      onClick={() => setPttExpanded(v => !v)}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-200"
                      title={pttExpanded ? 'Hide channel info' : 'Show channel info'}
                      aria-label={pttExpanded ? 'Collapse PTT status' : 'Expand PTT status'}
                    >
                      {pttExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-200">
                        <span className={cn('w-2 h-2 rounded-full shrink-0', {
                          'bg-green-400 shadow-[0_0_5px_#4ade80]': pttConnectionStatus === 'connected',
                          'bg-yellow-400 animate-pulse': pttConnectionStatus === 'connecting' || pttConnectionStatus === 'reconnecting',
                          'bg-red-500': pttConnectionStatus === 'error',
                          'bg-slate-500': pttConnectionStatus === 'disconnected',
                        })} />
                        <span className="truncate">{pttChannelName ?? (pttConnectedNoChannel ? 'No channel' : 'Radio')}</span>
                      </div>
                      {pttExpanded && pttSpeakerId && !pttIsSpeaking && (
                        <div className="text-[10px] text-green-300 truncate">Receiving: {pttSpeakerName ?? 'RX'}</div>
                      )}
                    </div>

                    <button
                      onClick={openRadioConsole}
                      className="inline-flex items-center justify-center rounded-full h-10 w-10 bg-slate-700 text-slate-100"
                      title="Open full radio console"
                      aria-label="Open full radio console"
                    >
                      <Radio className="h-4 w-4" />
                    </button>

                    {pttConnectedNoChannel ? (
                      <button
                        onClick={openRadioConsole}
                        title="No channel selected - open radio"
                        className="inline-flex items-center justify-center rounded-full h-10 w-10 bg-slate-600 text-white opacity-80"
                        aria-label="Select channel"
                      >
                        <Radio className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onPointerDown={(e) => {
                          if (e.pointerType === 'mouse' && e.button !== 0) return
                          e.preventDefault()
                          void handlePTTDown()
                        }}
                        onPointerUp={(e) => {
                          e.preventDefault()
                          void handlePTTUp()
                        }}
                        onPointerCancel={() => { void handlePTTUp() }}
                        onPointerLeave={() => { if (pttIsSpeaking) void handlePTTUp() }}
                        onContextMenu={(e) => e.preventDefault()}
                        title={pttIsSpeaking ? 'Transmitting...' : (pttCanSpeak ? 'Hold to Talk' : 'PTT Ready')}
                        className={cn(
                          'inline-flex items-center justify-center rounded-full h-10 w-10 transition-all select-none',
                          pttIsSpeaking
                            ? 'bg-red-600 shadow-[0_0_18px_rgba(220,38,38,0.6)] ring-2 ring-red-400/60'
                            : pttCanSpeak
                              ? 'bg-blue-600 active:scale-95'
                              : 'bg-slate-600 opacity-70 cursor-not-allowed',
                        )}
                        aria-label={pttIsSpeaking ? 'Transmitting' : 'Push to Talk'}
                      >
                        <Mic className={cn('h-5 w-5 text-white', pttIsSpeaking && 'animate-pulse')} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">

                {/* ── Floating PTT button — hold to transmit on any page ─── */}
                {location.pathname !== '/radio' && (
                  <div className="hidden md:flex flex-col items-end gap-1">
                    {/* Expanded status strip — shown when pttExpanded */}
                    {pttExpanded && (
                      <div className="flex items-center gap-2 rounded-full bg-slate-800 dark:bg-slate-900 text-white text-[11px] font-medium px-3 py-1 shadow-lg">
                        <span className={cn('w-2 h-2 rounded-full shrink-0', {
                          'bg-green-400 shadow-[0_0_5px_#4ade80]': pttConnectionStatus === 'connected',
                          'bg-yellow-400 animate-pulse': pttConnectionStatus === 'connecting' || pttConnectionStatus === 'reconnecting',
                          'bg-red-500': pttConnectionStatus === 'error',
                          'bg-slate-500': pttConnectionStatus === 'disconnected',
                        })} />
                        <span className="truncate max-w-[120px]">{pttChannelName ?? 'No channel'}</span>
                        {pttSpeakerId && !pttIsSpeaking && (
                          <span className="text-green-300 truncate max-w-[80px]">📡 {pttSpeakerName ?? 'RX'}</span>
                        )}
                        <button
                          onClick={openRadioConsole}
                          className="ml-1 text-slate-300 hover:text-white transition-colors"
                          title="Open full radio console"
                        >
                          <Radio className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            const win = window.open('/radio', 'ptt-radio', 'width=960,height=720,menubar=no,toolbar=no,location=no,resizable=yes,scrollbars=yes')
                            // Prevent the popup from accessing this window via window.opener
                            if (win) win.opener = null
                          }}
                          className="text-slate-300 hover:text-white transition-colors"
                          title="Pop out radio console to its own window"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Separate expand/collapse toggle — keeps PTT button free of click handlers */}
                    <button
                      onClick={() => setPttExpanded(v => !v)}
                      className="flex items-center gap-1 rounded-full bg-slate-700/80 dark:bg-slate-800/80 text-slate-200 text-[10px] px-2 py-0.5 shadow hover:bg-slate-600/90 transition-colors"
                      title={pttExpanded ? 'Hide channel info' : 'Show channel info'}
                      aria-label={pttExpanded ? 'Collapse PTT status' : 'Expand PTT status'}
                    >
                      {pttExpanded
                        ? <ChevronDown className="h-3 w-3" />
                        : <ChevronUp className="h-3 w-3" />
                      }
                      <span className="truncate max-w-[80px]">{pttChannelName ?? (pttConnectedNoChannel ? 'No channel' : 'Radio')}</span>
                    </button>

                    {/* Hold-to-talk button — only pointer/touch handlers, no onClick */}
                    {pttConnectedNoChannel ? (
                      <button
                        onClick={openRadioConsole}
                        title="No channel selected — tap to open radio and join a channel"
                        className="flex items-center justify-center rounded-full shadow-xl h-14 w-14 bg-slate-600 opacity-70 cursor-pointer hover:opacity-90 transition-opacity"
                        aria-label="Select a channel to enable PTT"
                      >
                        <Radio className="h-6 w-6 text-white" />
                      </button>
                    ) : (
                      <button
                        onMouseDown={handlePTTDown}
                        onMouseUp={handlePTTUp}
                        onMouseLeave={handlePTTUp}
                        onTouchStart={(e) => { e.preventDefault(); handlePTTDown() }}
                        onTouchEnd={(e) => { e.preventDefault(); handlePTTUp() }}
                        onContextMenu={(e) => e.preventDefault()}
                        title={pttIsSpeaking ? 'Transmitting…' : (pttCanSpeak ? 'Hold to Talk' : 'PTT Ready')}
                        className={cn(
                          'flex items-center justify-center rounded-full shadow-xl transition-all select-none',
                          'h-14 w-14',
                          pttIsSpeaking
                            ? 'bg-red-600 scale-110 shadow-[0_0_24px_rgba(220,38,38,0.7)] ring-4 ring-red-400/50'
                            : pttCanSpeak
                              ? 'bg-blue-600 hover:bg-blue-700 active:scale-105'
                              : 'bg-slate-600 opacity-70 cursor-not-allowed',
                        )}
                        aria-label={pttIsSpeaking ? 'Transmitting' : 'Push to Talk'}
                      >
                        <Mic className={cn('h-6 w-6 text-white', pttIsSpeaking && 'animate-pulse')} />
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={() => navigate('/bob-assistant')}
                  title="Ask Bob — operational assistant"
                  className={cn(
                    'flex items-center gap-2 rounded-full shadow-lg px-3 py-2 text-xs font-medium transition-all hover:shadow-xl',
                    location.pathname === '/bob-assistant'
                      ? 'bg-violet-600 text-white opacity-60 cursor-default'
                      : 'bg-violet-600 hover:bg-violet-700 text-white',
                  )}
                  aria-label="Open Bob assistant"
                >
                  <BrainCircuit className="h-4 w-4" />
                  <span className="hidden sm:inline">Ask Bob</span>
                </button>

                <button
                  onClick={() => navigate('/team-chat')}
                  title="Open Team Chat"
                  className="relative flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-3 py-2 text-xs font-medium hover:opacity-95 transition-all hover:shadow-xl"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden sm:inline">Team Chat</span>
                  {location.pathname !== '/team-chat' && chatSignalCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                      {chatSignalCount > 99 ? '99+' : chatSignalCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setFeedbackOpen(true)}
                  title="Send feedback or report an issue"
                  className="flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all hover:shadow-xl group"
                >
                  <MessageSquarePlus className="h-4 w-4 text-violet-500 group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline">Feedback</span>
                </button>
              </div>
              <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
            </>
          )}

          {autoLogoffEnabled && isWarningVisible && !isLocked && (
            <div className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[3px] flex items-start justify-center pt-16 px-4 pb-4">
              <div className="session-mesh session-mesh--amber" aria-hidden="true" />
              <div className="session-mesh session-mesh--rose" aria-hidden="true" />
              <div className="w-full max-w-lg rounded-3xl border border-amber-200/80 bg-white/95 shadow-[0_25px_80px_rgba(15,23,42,0.45)] overflow-hidden relative">
                <div className="absolute -top-20 -right-14 h-52 w-52 rounded-full bg-orange-300/30 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl pointer-events-none" />

                <div className="relative bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-6 text-white">
                  <div className="flex items-center gap-3">
                    <img src={brandLogoUrl} alt="Iron Eagle Security logo" className="h-12 w-12 rounded-xl object-cover border border-white/30 shadow-sm transition dark:brightness-90 dark:contrast-125 dark:saturate-75" />
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Session Timeout Warning</h2>
                      <p className="text-sm opacity-95">No activity detected. Your data view will lock soon.</p>
                      <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                        <ThemeBadgeIcon className="h-3.5 w-3.5" />
                        Theme: {themeBadgeText}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative p-6 space-y-4">
                  <p className="text-sm text-slate-600">
                    Locking in <span className="font-semibold text-slate-900">{warningSecondsRemaining}s</span> unless activity is detected.
                  </p>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 transition-all"
                      style={{ width: `${Math.max(2, (warningSecondsRemaining / 60) * 100)}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={handleStaySignedIn}>
                      Keep Working
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={handleLogoutCompletely}>
                      Logout
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLocked && (
            <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md flex items-start justify-center pt-16 px-4 pb-4">
              <div className="session-mesh session-mesh--cyan" aria-hidden="true" />
              <div className="session-mesh session-mesh--violet" aria-hidden="true" />
              <div className="w-full max-w-xl rounded-3xl border border-slate-200/60 bg-white/95 shadow-[0_30px_100px_rgba(15,23,42,0.55)] overflow-hidden relative">
                <div className="absolute -top-24 -left-10 h-64 w-64 rounded-full bg-cyan-200/25 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-12 h-72 w-72 rounded-full bg-rose-200/20 blur-3xl pointer-events-none" />

                <div className="relative bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 p-6 text-white">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-white/15 p-2">
                      <img src={brandLogoUrl} alt="Iron Eagle Security logo" className="h-10 w-10 rounded-lg object-cover border border-white/20 transition dark:brightness-90 dark:contrast-125 dark:saturate-75" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider opacity-90">Time Out Detected</p>
                      <h2 className="text-2xl font-bold leading-tight">{lockTitle}</h2>
                      <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                        <ThemeBadgeIcon className="h-3.5 w-3.5" />
                        Theme: {themeBadgeText}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative p-6 space-y-4">
                  <p className="text-sm text-slate-600">{lockMessage}</p>
                  <p className="text-sm text-slate-600">
                    Log back in from this screen to continue where you left off, or sign out completely.
                  </p>

                  <div className="space-y-2">
                    <label htmlFor="unlock-password" className="text-sm font-medium text-slate-700">
                      Password for {user?.email}
                    </label>
                    <Input
                      id="unlock-password"
                      type="password"
                      value={reLoginPassword}
                      onChange={(e) => setReLoginPassword(e.target.value)}
                      placeholder="Enter password to unlock"
                      disabled={unlocking}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleUnlockSession()
                        }
                      }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button className="flex-1" onClick={handleUnlockSession} disabled={unlocking}>
                      <Unlock className="h-4 w-4 mr-2" />
                      {unlocking ? 'Unlocking...' : 'Log Back In'}
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={handleLogoutCompletely} disabled={unlocking}>
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout Completely
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * ADMIN PORTAL - REBUILT FROM SCRATCH
 * 
 * Architecture:
 * - PlateScanner as primary scanning interface
 * - Clean, modern navigation with logical grouping
 * - Streamlined workflow with 4-layer pipeline integration
 * - Mobile-first responsive design
 * 
 * Changes from legacy:
 * - Removed duplicate/outdated pages
 * - Added Quick Scan section at top
 * - Reorganized navigation into clear hierarchies
 * - Integrated PlateScanner as single unified scanner
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Database,
  FileText,
  Settings,
  LogOut,
  MapPin,
  Shield,
  Building2,
  Eye,
  Menu,
  X,
  Heart,
  AlertTriangle,
  HelpCircle,
  ArrowLeftRight,
  Flag,
  Bug,
  Camera,
  ClipboardList,
  BarChart3,
  Users,
} from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { Badge } from '@/components/ui/badge';

// Components
import { ZoomScan } from '@/components/features/ZoomScan';
import { UnifiedDashboard } from './UnifiedDashboard';
import ObservationsReport from './ObservationsReport';
import { VehicleRegistry } from './VehicleRegistry';
import { VehicleEvidenceReport } from './VehicleEvidenceReport';
import { ZoneManagement } from './ZoneManagement';
import { UrgentFollowUps } from './UrgentFollowUps';
import { OfficerWelfareHub } from './OfficerWelfareHub';
import { LiveFieldOperations } from './LiveFieldOperations';
import { PatrolManagement } from './PatrolManagement';
import { InvestigationJobs } from './InvestigationJobs';
import { BulkScanReview } from './BulkScanReview';
import { IncidentReports } from './IncidentReports';
import { EnforcementHub } from './EnforcementHub';
import { SpecialVehiclesManagement } from './SpecialVehiclesManagement';
import { DataManagementHub } from './DataManagementHub';
import { SettingsHub } from './SettingsHub';
import { OrganizationManagement } from './OrganizationManagement';
import { DatabaseMaintenance } from './DatabaseMaintenance';
import { BugReportsManagement } from './BugReportsManagement';
import { HelpDocumentation } from './HelpDocumentation';
import { DarkModeToggle } from '@/components/features/DarkModeToggle';
import { PWAUpdateNotification } from '@/components/features/PWAUpdateNotification';
import { supabase } from '@/lib/supabase';

interface AdminPortalProps {
  onLogout: () => void;
}

export function AdminPortal({ onLogout }: AdminPortalProps) {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [urgentFollowUpsCount, setUrgentFollowUpsCount] = useState(0);
  
  // ZoomScan state
  const [zoomScanActive, setZoomScanActive] = useState(false);
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string; organization_id: string } | null>(null);
  const [zones, setZones] = useState<Array<{ id: string; name: string; organization_id: string }>>([]);

  const isMaster = user?.role === 'master';

  // Handle URL parameters for cross-portal navigation and BI drill-down
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) {
      setActiveTab(tab);
      // Keep URL parameters for pages that need them
      const drillDownPages = ['observations-report', 'vehicle-registry', 'zone-management'];
      if (!drillDownPages.includes(tab)) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Load zones for PlateScanner
  useEffect(() => {
    const loadZones = async () => {
      if (!user?.organization_id) return;
      
      try {
        const { data } = await supabase
          .from('zones')
          .select('id, name, organization_id')
          .eq('organization_id', user.organization_id)
          .eq('is_active', true)
          .order('name');
        
        if (data && data.length > 0) {
          setZones(data);
          setSelectedZone(data[0]); // Auto-select first zone
        }
      } catch (error) {
        console.error('Failed to load zones:', error);
      }
    };
    
    loadZones();
  }, [user?.organization_id]);

  // Load urgent follow-ups count
  useEffect(() => {
    const loadUrgentCount = async () => {
      if (!user?.organization_id) return;
      
      try {
        const { count: incCount } = await supabase
          .from('incidents')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('court_ready', false)
          .neq('status', 'closed');

        const { count: bugCount } = await supabase
          .from('bug_reports')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted');

        const total = (incCount || 0) + (bugCount || 0);
        setUrgentFollowUpsCount(total);
      } catch (error) {
        console.error('Failed to load urgent count:', error);
      }
    };

    loadUrgentCount();
    const interval = setInterval(loadUrgentCount, 60000);
    return () => clearInterval(interval);
  }, [user?.organization_id]);

  // Open Quick Scan
  const handleQuickScan = () => {
    setZoomScanActive(true);
    setSidebarOpen(false);
  };

  return (
    <ResponsiveContainer maxWidth="full" padding="none" mobileFullHeight>
      <PWAUpdateNotification />
      
      {/* ZoomScan Overlay - Full Screen */}
      {zoomScanActive && (
        <ZoomScan onExit={() => setZoomScanActive(false)} />
      )}
      
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={`
            fixed lg:static inset-y-0 left-0 z-50
            w-72 lg:w-64 xl:w-72 flex flex-col border-r bg-card
            transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          {/* Header */}
          <div className="p-4 lg:p-5 xl:p-6 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <JDSLogo size="sm" />
                <h1 className="text-lg lg:text-xl font-bold">Admin Portal</h1>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden h-10 w-10 touch-manipulation"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="mt-3">
              <p className="text-xs lg:text-sm text-gray-700 dark:text-gray-200 font-semibold truncate">
                {user?.first_name} {user?.last_name}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 font-medium capitalize">
                {user?.role} Access
              </p>
            </div>
            
            {/* Dark Mode Toggle */}
            <div className="mt-4 flex items-center gap-2">
              <DarkModeToggle variant="icon" />
              <span className="text-xs text-muted-foreground">Display Mode</span>
            </div>
            
            {/* Portal Switch */}
            {(user?.role === 'admin' || user?.role === 'master') && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  className="w-full justify-start h-10 text-sm bg-primary/10 hover:bg-primary/20 border-primary/30 touch-manipulation"
                  onClick={() => {
                    const { setPreferredPortal } = useAuthStore.getState();
                    setPreferredPortal('field');
                    window.location.reload();
                  }}
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Switch to Field Portal
                </Button>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 lg:p-4 space-y-1.5 lg:space-y-2 overflow-y-auto">
            {/* QUICK SCAN - NEW TOP SECTION */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2">
              ⚡ QUICK ACTIONS
            </div>

            <Button
              variant={activeTab === 'quick-scan' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-12 lg:h-11 touch-manipulation bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20 border-2 border-green-500/50 shadow-sm hover:shadow-md transition-all"
              onClick={handleQuickScan}
            >
              <Camera className="h-5 w-5 mr-2 lg:mr-3 text-green-600 dark:text-green-400" />
              <span className="text-green-700 dark:text-green-300 font-bold">Quick Scan</span>
            </Button>

            {urgentFollowUpsCount > 0 && (
              <Button
                variant={activeTab === 'urgent-followups' ? 'default' : 'ghost'}
                className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-red-50 dark:bg-red-950/20 border border-red-500/30"
                onClick={() => {
                  setActiveTab('urgent-followups');
                  setSidebarOpen(false);
                }}
              >
                <AlertTriangle className="h-4 w-4 mr-2 lg:mr-3 text-red-500" />
                <span className="text-red-600 dark:text-red-400 font-semibold">
                  Urgent ({urgentFollowUpsCount})
                </span>
              </Button>
            )}

            {/* ANALYTICS & REPORTING */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              📊 ANALYTICS & REPORTING
            </div>

            <Button
              variant={activeTab === 'dashboard' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('dashboard');
                setSidebarOpen(false);
              }}
            >
              <BarChart3 className="h-4 w-4 mr-2 lg:mr-3" />
              BI Dashboard
            </Button>

            <Button
              variant={activeTab === 'observations-report' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('observations-report');
                setSidebarOpen(false);
              }}
            >
              <Eye className="h-4 w-4 mr-2 lg:mr-3" />
              Observations Report
            </Button>

            <Button
              variant={activeTab === 'vehicle-registry' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('vehicle-registry');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Vehicle Registry
            </Button>

            <Button
              variant={activeTab === 'vehicle-evidence-report' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('vehicle-evidence-report');
                setSidebarOpen(false);
              }}
            >
              <FileText className="h-4 w-4 mr-2 lg:mr-3" />
              Evidence Report
            </Button>

            {/* FIELD OPERATIONS */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              🚔 FIELD OPERATIONS
            </div>

            <Button
              variant={activeTab === 'officer-welfare-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('officer-welfare-hub');
                setSidebarOpen(false);
              }}
            >
              <Heart className="h-4 w-4 mr-2 lg:mr-3 text-red-600" />
              <span className="text-red-600 dark:text-red-400">Officer Welfare</span>
            </Button>

            <Button
              variant={activeTab === 'live-field-ops' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('live-field-ops');
                setSidebarOpen(false);
              }}
            >
              <MapPin className="h-4 w-4 mr-2 lg:mr-3" />
              Live Field Operations
            </Button>

            <Button
              variant={activeTab === 'patrol-management' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('patrol-management');
                setSidebarOpen(false);
              }}
            >
              <Shield className="h-4 w-4 mr-2 lg:mr-3" />
              Patrol Management
            </Button>

            <Button
              variant={activeTab === 'investigation-jobs' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('investigation-jobs');
                setSidebarOpen(false);
              }}
            >
              <ClipboardList className="h-4 w-4 mr-2 lg:mr-3" />
              Investigation Jobs
            </Button>

            <Button
              variant={activeTab === 'bulk-scan-review' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('bulk-scan-review');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Bulk Scan Review
            </Button>

            {/* ENFORCEMENT */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              ⚖️ ENFORCEMENT
            </div>

            <Button
              variant={activeTab === 'incident-reports' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('incident-reports');
                setSidebarOpen(false);
              }}
            >
              <AlertTriangle className="h-4 w-4 mr-2 lg:mr-3" />
              Incident Reports
            </Button>

            <Button
              variant={activeTab === 'enforcement-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('enforcement-hub');
                setSidebarOpen(false);
              }}
            >
              <Shield className="h-4 w-4 mr-2 lg:mr-3" />
              Enforcement Hub
            </Button>

            <Button
              variant={activeTab === 'special-vehicles' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('special-vehicles');
                setSidebarOpen(false);
              }}
            >
              <Flag className="h-4 w-4 mr-2 lg:mr-3" />
              Flagged Vehicles
            </Button>

            {/* MANAGEMENT */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              ⚙️ MANAGEMENT
            </div>

            <Button
              variant={activeTab === 'zone-management' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('zone-management');
                setSidebarOpen(false);
              }}
            >
              <MapPin className="h-4 w-4 mr-2 lg:mr-3" />
              Zone Management
            </Button>

            {isMaster && (
              <Button
                variant={activeTab === 'organization-management' ? 'default' : 'ghost'}
                className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
                onClick={() => {
                  setActiveTab('organization-management');
                  setSidebarOpen(false);
                }}
              >
                <Building2 className="h-4 w-4 mr-2 lg:mr-3" />
                Organizations
              </Button>
            )}

            <Button
              variant={activeTab === 'data-management-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('data-management-hub');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Data Management
            </Button>

            <Button
              variant={activeTab === 'settings-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('settings-hub');
                setSidebarOpen(false);
              }}
            >
              <Settings className="h-4 w-4 mr-2 lg:mr-3" />
              Settings
            </Button>

            {isMaster && (
              <Button
                variant={activeTab === 'database-maintenance' ? 'default' : 'ghost'}
                className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
                onClick={() => {
                  setActiveTab('database-maintenance');
                  setSidebarOpen(false);
                }}
              >
                <Database className="h-4 w-4 mr-2 lg:mr-3 text-amber-600" />
                <span className="text-amber-600 dark:text-amber-400">DB Maintenance</span>
              </Button>
            )}

            {/* HELP & SUPPORT */}
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              💡 HELP & SUPPORT
            </div>

            <Button
              variant={activeTab === 'help' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('help');
                setSidebarOpen(false);
              }}
            >
              <HelpCircle className="h-4 w-4 mr-2 lg:mr-3" />
              Documentation
            </Button>

            {isMaster && (
              <Button
                variant={activeTab === 'bug-reports' ? 'default' : 'ghost'}
                className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
                onClick={() => {
                  setActiveTab('bug-reports');
                  setSidebarOpen(false);
                }}
              >
                <Bug className="h-4 w-4 mr-2 lg:mr-3" />
                Bug Reports
              </Button>
            )}
          </nav>

          {/* Logout Button */}
          <div className="p-3 lg:p-4 border-t">
            <Button
              variant="ghost"
              className="w-full justify-start h-10 lg:h-9 text-sm lg:text-base text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 touch-manipulation"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4 mr-2 lg:mr-3" />
              Logout
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Mobile Header */}
          <div className="sticky top-0 z-30 lg:hidden bg-background/95 backdrop-blur-sm border-b">
            <div className="flex items-center justify-between p-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-10 w-10 touch-manipulation"
              >
                <Menu className="h-6 w-6" />
              </Button>
              <h1 className="text-lg font-bold">Admin Portal</h1>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleQuickScan}
                className="h-10 w-10 text-green-600 touch-manipulation"
                title="Quick Scan"
              >
                <Camera className="h-6 w-6" />
              </Button>
            </div>
          </div>

          {/* Urgent Banner */}
          {urgentFollowUpsCount > 0 && activeTab !== 'urgent-followups' && (
            <div className="sticky top-0 z-20 mx-4 md:mx-6 mt-4">
              <Card
                className="border-red-500 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/40 dark:to-orange-950/40 cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setActiveTab('urgent-followups')}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                        <AlertTriangle className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-red-900 dark:text-red-100 text-lg">
                          {urgentFollowUpsCount} Urgent Item{urgentFollowUpsCount !== 1 ? 's' : ''}
                        </p>
                        <p className="text-sm text-red-700 dark:text-red-300">
                          Tap to review incidents and reports
                        </p>
                      </div>
                    </div>
                    <Button className="bg-red-600 hover:bg-red-700">
                      Review Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 lg:p-6 xl:p-8 max-w-[1600px] mx-auto">
              {activeTab === 'dashboard' && <UnifiedDashboard />}
              {activeTab === 'urgent-followups' && <UrgentFollowUps onTabChange={setActiveTab} />}
              {activeTab === 'observations-report' && <ObservationsReport />}
              {activeTab === 'vehicle-registry' && <VehicleRegistry />}
              {activeTab === 'vehicle-evidence-report' && <VehicleEvidenceReport />}
              {activeTab === 'zone-management' && <ZoneManagement />}
              {activeTab === 'officer-welfare-hub' && <OfficerWelfareHub />}
              {activeTab === 'live-field-ops' && <LiveFieldOperations />}
              {activeTab === 'patrol-management' && <PatrolManagement />}
              {activeTab === 'investigation-jobs' && <InvestigationJobs />}
              {activeTab === 'bulk-scan-review' && <BulkScanReview />}
              {activeTab === 'incident-reports' && <IncidentReports />}
              {activeTab === 'enforcement-hub' && <EnforcementHub />}
              {activeTab === 'special-vehicles' && <SpecialVehiclesManagement />}
              {activeTab === 'data-management-hub' && <DataManagementHub />}
              {activeTab === 'settings-hub' && <SettingsHub />}
              {activeTab === 'organization-management' && isMaster && <OrganizationManagement />}
              {activeTab === 'database-maintenance' && isMaster && <DatabaseMaintenance />}
              {activeTab === 'bug-reports' && isMaster && <BugReportsManagement />}
              {activeTab === 'help' && <HelpDocumentation />}
            </div>
          </div>
        </div>
      </div>
    </ResponsiveContainer>
  );
}

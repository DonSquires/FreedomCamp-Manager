/**
 * AdminPortal - Responsive admin interface optimized for mobile and desktop
 * Comprehensive dashboard with tabbed navigation for all admin features
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Database,
  TrendingUp,
  FileText,
  Settings,
  LogOut,
  MapPin,
  Shield,
  Building2,
  Eye,
  Menu,
  X,
  Users,
  Heart,
  AlertTriangle,
  HelpCircle,
  ArrowLeftRight,
  Flag,
} from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { DriftDashboard } from './DriftDashboard';
import { ComplianceMatrixManagement } from './ComplianceMatrixManagement';
import { ComplianceRecalculation } from './ComplianceRecalculation';
import { HistoricalImport } from './HistoricalImport';
import { VehicleLogImport } from './VehicleLogImport';
import { ZoneDrillDown } from './ZoneDrillDown';
import { ObservationDetailModal } from './ObservationDetailModal';
import { LeadershipPackGenerator } from './LeadershipPackGenerator';
import { PrivacyControlsPanel } from './PrivacyControlsPanel';
import { BulkScanReview } from './BulkScanReview';
import { IncidentReports } from './IncidentReports';
import { EnforcementHub } from './EnforcementHub';
import { SpecialVehiclesManagement } from './SpecialVehiclesManagement';
import { PatrolManagement } from './PatrolManagement';
import { InvestigationJobs } from './InvestigationJobs';
import { UrgentFollowUps } from './UrgentFollowUps';
import { ZoneManagement } from './ZoneManagement';
import { OfficerWelfareHub } from './OfficerWelfareHub';
import { HelpDocumentation } from './HelpDocumentation';
import { AnalyticsHub } from './AnalyticsHub';
import { OrganizationDashboard } from './OrganizationDashboard';
import { OrganizationManagement } from './OrganizationManagement';
import { ZoneCorrections } from './ZoneCorrections';
import { UserManagement } from './UserManagement';
import { VehicleRecords } from './VehicleRecords';
import { supabase } from '@/lib/supabase';
import DataIntegrityCheck from './DataIntegrityCheck';
import { DarkModeToggle } from '@/components/features/DarkModeToggle';
import { DataMigrationUtility } from './DataMigrationUtility';
import { VehicleEnrichmentMaintenance } from './VehicleEnrichmentMaintenance';
import { HomelessSupport } from './HomelessSupport';
import { DataManagementHub } from './DataManagementHub';
import { SettingsHub } from './SettingsHub';

interface AdminPortalProps {
  onLogout: () => void;
}

export function AdminPortal({ onLogout }: AdminPortalProps) {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [urgentFollowUpsCount, setUrgentFollowUpsCount] = useState(0);
  
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string } | null>(null);
  const [selectedObservation, setSelectedObservation] = useState<string | null>(null);

  const handleZoneSelect = (zoneId: string, zoneName: string) => {
    setSelectedZone({ id: zoneId, name: zoneName });
    setActiveTab('zone-drilldown');
  };

  const handleObservationSelect = (observationId: string) => {
    setSelectedObservation(observationId);
  };

  const isMaster = user?.role === 'master';
  const isSuperUser = user?.email === 'don.squire@firstsecurity.co.nz';

  useEffect(() => {
    const loadUrgentCount = async () => {
      if (!user?.organization_id) return;
      
      try {
        const { count: obsCount } = await supabase
          .from('vehicle_records')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('requires_followup', true)
          .eq('followup_resolved', false);

        const { count: incCount } = await supabase
          .from('incidents')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('court_ready', false)
          .neq('status', 'closed');

        const { count: homelessCount } = await supabase
          .from('vehicle_records')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('homeless_claimed', true)
          .eq('homeless_confirmed', false);

        const total = (obsCount || 0) + (incCount || 0) + (homelessCount || 0);
        setUrgentFollowUpsCount(total);
      } catch (error) {
        console.error('Failed to load urgent count:', error);
      }
    };

    loadUrgentCount();
    const interval = setInterval(loadUrgentCount, 60000);
    return () => clearInterval(interval);
  }, [user?.organization_id]);

  return (
    <ResponsiveContainer maxWidth="full" padding="none" mobileFullHeight>
      <div className="flex h-screen bg-background overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div
          className={`
            fixed lg:static inset-y-0 left-0 z-50
            w-72 lg:w-64 xl:w-72 flex flex-col border-r bg-card
            transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
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
              {isSuperUser && (
                <p className="text-xs font-semibold text-primary mt-1">
                  🔑 Super User
                </p>
              )}
            </div>
            
            {/* Dark Mode Toggle */}
            <div className="mt-4 flex items-center gap-2">
              <DarkModeToggle variant="icon" />
              <span className="text-xs text-muted-foreground">Display Mode</span>
            </div>
            
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

          <nav className="flex-1 p-3 lg:p-4 space-y-1.5 lg:space-y-2 overflow-y-auto">
            <div className="text-xs font-semibold text-muted-foreground px-3 py-2">
              OPERATIONAL
            </div>

            <Button
              variant={activeTab === 'urgent-followups' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-red-50 dark:bg-red-950/20 border border-red-500/30"
              onClick={() => {
                setActiveTab('urgent-followups');
                setSidebarOpen(false);
              }}
            >
              <AlertTriangle className="h-4 w-4 mr-2 lg:mr-3 text-red-500" />
              <span className="text-red-600 dark:text-red-400 font-semibold">Urgent Follow-Ups</span>
            </Button>

            <Button
              variant={activeTab === 'dashboard' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('dashboard');
                setSidebarOpen(false);
              }}
            >
              <LayoutDashboard className="h-4 w-4 mr-2 lg:mr-3" />
              Organization
            </Button>

            {(isMaster || isSuperUser) && (
              <Button
                variant={activeTab === 'cross-org' ? 'default' : 'ghost'}
                className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
                onClick={() => {
                  setActiveTab('cross-org');
                  setSidebarOpen(false);
                }}
              >
                <Building2 className="h-4 w-4 mr-2 lg:mr-3" />
                Cross-Org View
              </Button>
            )}

            <Button
              variant={activeTab === 'officer-welfare-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-red-50 dark:bg-red-950/20 border border-red-500/30"
              onClick={() => {
                setActiveTab('officer-welfare-hub');
                setSidebarOpen(false);
              }}
            >
              <Heart className="h-4 w-4 mr-2 lg:mr-3 text-red-600" />
              <span className="text-red-600 dark:text-red-400 font-semibold">Officer Welfare Hub</span>
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
              <FileText className="h-4 w-4 mr-2 lg:mr-3" />
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

            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              ENFORCEMENT
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
              Special Vehicles
            </Button>

            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              REPORTING & ANALYTICS
            </div>

            <Button
              variant={activeTab === 'analytics-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('analytics-hub');
                setSidebarOpen(false);
              }}
            >
              <TrendingUp className="h-4 w-4 mr-2 lg:mr-3" />
              Analytics Hub
            </Button>

            <Button
              variant={activeTab === 'vehicle-list' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('vehicle-list');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Vehicle Records
            </Button>

            <Button
              variant={activeTab === 'person-records' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('person-records');
                setSidebarOpen(false);
              }}
            >
              <Users className="h-4 w-4 mr-2 lg:mr-3" />
              Person Records
            </Button>

            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              MANAGEMENT
            </div>

            <Button
              variant={activeTab === 'data-management-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-blue-50 dark:bg-blue-950/20 border border-blue-500/30"
              onClick={() => {
                setActiveTab('data-management-hub');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3 text-blue-600" />
              <span className="text-blue-600 dark:text-blue-400 font-semibold">Data Management Hub</span>
            </Button>

            <Button
              variant={activeTab === 'settings-hub' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-purple-50 dark:bg-purple-950/20 border border-purple-500/30"
              onClick={() => {
                setActiveTab('settings-hub');
                setSidebarOpen(false);
              }}
            >
              <Settings className="h-4 w-4 mr-2 lg:mr-3 text-purple-600" />
              <span className="text-purple-600 dark:text-purple-400 font-semibold">Settings Hub</span>
            </Button>

            {/* MAINTENANCE - Only visible to master users */}
            {isMaster && (
              <>
                <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
                  MAINTENANCE
                </div>

                <Button
                  variant={activeTab === 'data-migration' ? 'default' : 'ghost'}
                  className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-amber-50 dark:bg-amber-950/20 border border-amber-500/30"
                  onClick={() => {
                    setActiveTab('data-migration');
                    setSidebarOpen(false);
                  }}
                >
                  <Database className="h-4 w-4 mr-2 lg:mr-3 text-amber-600" />
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">Data Migration</span>
                </Button>

            <Button
              variant={activeTab === 'data-integrity' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('data-integrity');
                setSidebarOpen(false);
              }}
            >
              <Shield className="h-4 w-4 mr-2 lg:mr-3" />
              Data Integrity Check
            </Button>

            <Button
              variant={activeTab === 'drift' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('drift');
                setSidebarOpen(false);
              }}
            >
              <TrendingUp className="h-4 w-4 mr-2 lg:mr-3" />
              Drift Monitor
            </Button>

            <Button
              variant={activeTab === 'recalculation' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('recalculation');
                setSidebarOpen(false);
              }}
            >
              <FileText className="h-4 w-4 mr-2 lg:mr-3" />
              Recalculation
            </Button>

            <Button
              variant={activeTab === 'zone-corrections' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('zone-corrections');
                setSidebarOpen(false);
              }}
            >
              <MapPin className="h-4 w-4 mr-2 lg:mr-3" />
              Zone Corrections
            </Button>

            <Button
              variant={activeTab === 'vehicle-enrichment' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-green-50 dark:bg-green-950/20 border border-green-500/30"
              onClick={() => {
                setActiveTab('vehicle-enrichment');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3 text-green-600" />
              <span className="text-green-600 dark:text-green-400 font-semibold">Vehicle Enrichment</span>
            </Button>

            <Button
              variant={activeTab === 'import' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('import');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Data Import
            </Button>

            <Button
              variant={activeTab === 'vehicle-log-import' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('vehicle-log-import');
                setSidebarOpen(false);
              }}
            >
              <Database className="h-4 w-4 mr-2 lg:mr-3" />
              Vehicle Log Import
            </Button>

            <Button
              variant={activeTab === 'leadership' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('leadership');
                setSidebarOpen(false);
              }}
            >
              <FileText className="h-4 w-4 mr-2 lg:mr-3" />
              Leadership Pack
            </Button>

            <Button
              variant={activeTab === 'privacy' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation"
              onClick={() => {
                setActiveTab('privacy');
                setSidebarOpen(false);
              }}
            >
              <Eye className="h-4 w-4 mr-2 lg:mr-3" />
              Privacy Controls
            </Button>
              </>
            )}

            <div className="text-xs font-semibold text-muted-foreground px-3 py-2 mt-3 lg:mt-4">
              HELP & SUPPORT
            </div>

            <Button
              variant={activeTab === 'help' ? 'default' : 'ghost'}
              className="w-full justify-start text-sm lg:text-base h-10 lg:h-9 touch-manipulation bg-blue-50 dark:bg-blue-950/20 border border-blue-500/30"
              onClick={() => {
                setActiveTab('help');
                setSidebarOpen(false);
              }}
            >
              <HelpCircle className="h-4 w-4 mr-2 lg:mr-3 text-blue-600" />
              <span className="text-blue-600 dark:text-blue-400 font-semibold">Help & Documentation</span>
            </Button>
          </nav>

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

        <div className="flex-1 overflow-hidden flex flex-col">
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
              <div className="w-10" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {urgentFollowUpsCount > 0 && activeTab !== 'urgent-followups' && (
              <div className="sticky top-0 z-20 mx-4 md:mx-6 mt-4">
                <Card
                  className="border-red-500 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/40 dark:to-orange-950/40 cursor-pointer hover:shadow-lg transition-shadow animate-pulse"
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
                            {urgentFollowUpsCount} Urgent Item{urgentFollowUpsCount !== 1 ? 's' : ''} Requiring Attention
                          </p>
                          <p className="text-sm text-red-700 dark:text-red-300">
                            Tap to review observations, incidents, and homeless claims
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

            <div className="p-4 lg:p-6 xl:p-8 max-w-[1600px] mx-auto">
              {activeTab === 'urgent-followups' && <UrgentFollowUps onTabChange={setActiveTab} />}
              
              {/* Placeholder for rebuilding */}
              {activeTab === 'dashboard' && <OrganizationDashboard />}
              
              {activeTab === 'zone-drilldown' && selectedZone && (
                <ZoneDrillDown
                  zoneId={selectedZone.id}
                  zoneName={selectedZone.name}
                  onBack={() => {
                    setSelectedZone(null);
                    setActiveTab('dashboard');
                  }}
                  onObservationSelect={handleObservationSelect}
                />
              )}

              {activeTab === 'drift' && <DriftDashboard />}
              {activeTab === 'matrix' && <ComplianceMatrixManagement />}
              {activeTab === 'recalculation' && <ComplianceRecalculation />}

              {/* Analytics Hub - Phase 3 Complete */}
              {activeTab === 'analytics-hub' && <AnalyticsHub />}

              {activeTab === 'bulk-scan-review' && <BulkScanReview />}
              
              {activeTab === 'vehicle-list' && <VehicleRecords />}
              
              {activeTab === 'person-records' && (
                <Card>
                  <CardContent className="p-12 text-center">
                    <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-xl font-bold mb-2">Person Records</h3>
                    <p className="text-muted-foreground mb-4">Person records for non-vehicle freedom campers</p>
                    <p className="text-sm text-muted-foreground">Records are captured via Field Officer Portal and appear here for administrative review</p>
                  </CardContent>
                </Card>
              )}

              {activeTab === 'incident-reports' && <IncidentReports />}
              {activeTab === 'enforcement-hub' && <EnforcementHub />}
              {activeTab === 'special-vehicles' && <SpecialVehiclesManagement />}

              {activeTab === 'investigation-jobs' && <InvestigationJobs />}

              {activeTab === 'zone-management' && <ZoneManagement />}
              {activeTab === 'patrol-management' && <PatrolManagement />}
              {activeTab === 'officer-welfare-hub' && <OfficerWelfareHub />}

              {/* Phase 4 & 5: Consolidated Hubs */}
              {activeTab === 'data-management-hub' && <DataManagementHub />}
              {activeTab === 'settings-hub' && <SettingsHub />}

              {activeTab === 'cross-org' && isSuperUser && (
                <Card>
                  <CardContent className="p-12 text-center">
                    <Building2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-xl font-bold mb-2">Master Cross-Org Dashboard</h3>
                    <p className="text-muted-foreground">This page is being rebuilt from scratch...</p>
                  </CardContent>
                </Card>
              )}
              {activeTab === 'leadership' && <LeadershipPackGenerator />}
              {activeTab === 'privacy' && <PrivacyControlsPanel />}

              {activeTab === 'import' && <HistoricalImport />}

              {activeTab === 'vehicle-log-import' && <VehicleLogImport />}

              {activeTab === 'user-management' && <UserManagement />}
              {activeTab === 'organization-management' && isMaster && <OrganizationManagement />}

              {activeTab === 'zone-corrections' && <ZoneCorrections />}

              {activeTab === 'vehicle-enrichment' && <VehicleEnrichmentMaintenance />}

              {activeTab === 'data-migration' && isMaster && <DataMigrationUtility />}
              {activeTab === 'data-integrity' && isMaster && <DataIntegrityCheck />}

              {activeTab === 'help' && <HelpDocumentation />}
            </div>
          </div>
        </div>

        {selectedObservation && (
          <ObservationDetailModal
            observationId={selectedObservation}
            open={!!selectedObservation}
            onClose={() => setSelectedObservation(null)}
          />
        )}
      </div>
    </ResponsiveContainer>
  );
}

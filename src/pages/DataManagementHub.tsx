/**
 * DATA MANAGEMENT HUB - PHASE 4 CONSOLIDATION
 * Unified interface for all data management operations
 * 
 * Consolidates:
 * - Vehicle Registry (canonical vehicles)
 * - Zone Management (geofenced areas)
 * - Compliance Matrix (zone rules)
 * - Person Records (non-vehicle freedom campers)
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Car,
  MapPin,
  Settings,
  Users,
  Database,
  Download,
  TrendingUp,
  LayoutDashboard,
  Wrench,
  Upload,
  X,
} from 'lucide-react';
import { VehicleRegistry } from './VehicleRegistry';
import { ZoneManagement } from './ZoneManagement';
import { ComplianceMatrixManagement } from './ComplianceMatrixManagement';
import { PersonRecordsManager } from '@/components/features/PersonRecordsManager';
import { ComplianceRecalculation } from './DataCleanupUtility';
import { HistoricalImport } from './HistoricalImport';
import { toast } from 'sonner';

export function DataManagementHub() {
  const [activeTab, setActiveTab] = useState('vehicles');
  const [showImport, setShowImport] = useState(false);

  const handleExportAll = () => {
    toast.info('Preparing comprehensive data export...');
    // TODO: Implement comprehensive export across all data types
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
            <Database className="h-8 w-8 text-blue-600" />
            Data Management Hub
          </h1>
          <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
            Comprehensive data management - vehicles, zones, compliance rules, and person records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowImport(true)} className="bg-blue-600 hover:bg-blue-700">
            <Upload className="h-4 w-4 mr-2" />
            Import Historical Data
          </Button>
          <Button variant="outline" onClick={handleExportAll}>
            <Download className="h-4 w-4 mr-2" />
            Export All Data
          </Button>
        </div>
      </div>

      {/* Quick Stats Dashboard */}
      <Card className="border-2 border-blue-500/30 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40">
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
                <Car className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Vehicles</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-600 flex items-center justify-center">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Zones</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-purple-600 flex items-center justify-center">
                <Settings className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Matrices</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-amber-600 flex items-center justify-center">
                <Users className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Persons</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Historical Data Import</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowImport(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-6">
              <HistoricalImport />
            </div>
          </div>
        </div>
      )}

      {/* Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 h-auto">
          <TabsTrigger value="vehicles" className="flex items-center gap-2 py-3">
            <Car className="h-4 w-4" />
            <span className="hidden md:inline">Vehicle Registry</span>
            <span className="md:hidden">Vehicles</span>
          </TabsTrigger>
          <TabsTrigger value="zones" className="flex items-center gap-2 py-3">
            <MapPin className="h-4 w-4" />
            <span className="hidden md:inline">Zone Management</span>
            <span className="md:hidden">Zones</span>
          </TabsTrigger>
          <TabsTrigger value="matrix" className="flex items-center gap-2 py-3">
            <Settings className="h-4 w-4" />
            <span className="hidden md:inline">Compliance Matrix</span>
            <span className="md:hidden">Matrix</span>
          </TabsTrigger>
          <TabsTrigger value="persons" className="flex items-center gap-2 py-3">
            <Users className="h-4 w-4" />
            <span className="hidden md:inline">Person Records</span>
            <span className="md:hidden">Persons</span>
          </TabsTrigger>
          <TabsTrigger value="cleanup" className="flex items-center gap-2 py-3 bg-amber-50 dark:bg-amber-950/20 data-[state=active]:bg-amber-100 dark:data-[state=active]:bg-amber-900/40">
            <Wrench className="h-4 w-4" />
            <span className="hidden md:inline">Data Cleanup</span>
            <span className="md:hidden">Cleanup</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="mt-6">
          <VehicleRegistry />
        </TabsContent>

        <TabsContent value="zones" className="mt-6">
          <ZoneManagement />
        </TabsContent>

        <TabsContent value="matrix" className="mt-6">
          <ComplianceMatrixManagement />
        </TabsContent>

        <TabsContent value="persons" className="mt-6">
          <PersonRecordsManager />
        </TabsContent>

        <TabsContent value="cleanup" className="mt-6">
          <ComplianceRecalculation />
        </TabsContent>
      </Tabs>
    </div>
  );
}

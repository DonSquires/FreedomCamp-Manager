/**
 * DATABASE MAINTENANCE - MASTER USERS ONLY
 * 
 * Three independent maintenance operations:
 * 1. Zone Correction: GPS-based automatic zone reassignment
 * 2. Duplicate Detection: Remove duplicate scans within 8 hours in same zone
 * 3. Compliance Recalculation: Recalculate compliance against current zone rules
 * 
 * Each operation can be run independently and tracks progress in real-time
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MapPin,
  Copy,
  RefreshCw,
  AlertTriangle,
  Shield,
  Wrench,
  Database,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { ComplianceRecalculation } from './DataCleanupUtility';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function DatabaseMaintenance() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('recalculation');

  // Check if user is master
  const isMaster = user?.role === 'master';

  if (!isMaster) {
    return (
      <ResponsiveContainer maxWidth="3xl" padding="md">
        <Alert className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <Shield className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-900 dark:text-red-100">
            <strong>Access Denied:</strong> This page is restricted to master users only.
            These operations can affect the entire database and should only be performed by system administrators.
          </AlertDescription>
        </Alert>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer maxWidth="7xl" padding="md">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
            <Database className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            Database Maintenance
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Shield className="h-3 w-3 md:h-4 md:w-4 text-amber-600" />
            <span className="font-semibold text-amber-900 dark:text-amber-100">
              Master Users Only
            </span>
            <span>•</span>
            System-wide maintenance operations for data integrity and compliance accuracy
          </p>
        </div>

        {/* Warning Banner */}
        <Alert className="border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs md:text-sm text-amber-900 dark:text-amber-100">
            <p className="font-semibold mb-2">⚠️ Important Safety Notes</p>
            <ul className="space-y-1 text-xs md:text-sm">
              <li>
                <strong>Zone Correction:</strong> Uses GPS coordinates to reassign observations to correct zones. 
                Only affects observations with GPS accuracy ≤100m. Preserves observations with incidents/HS reports.
              </li>
              <li>
                <strong>Duplicate Detection:</strong> Removes duplicate scans of the same plate within 8 hours in the same zone. 
                Keeps the newest observation. Preserves observations with incidents/HS reports.
              </li>
              <li>
                <strong>Compliance Recalculation:</strong> Tests all observations against current zone compliance matrix rules. 
                Updates monthly stays, consecutive nights, and breach status.
              </li>
            </ul>
            <p className="mt-2 text-xs font-semibold">
              💡 Tip: Run Zone Correction first, then Duplicate Detection, then Compliance Recalculation for best results.
            </p>
          </AlertDescription>
        </Alert>

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="zone-correction" className="flex items-center gap-2 py-3">
              <MapPin className="h-4 w-4" />
              <span className="hidden md:inline">Zone Correction</span>
              <span className="md:hidden">Zones</span>
            </TabsTrigger>
            <TabsTrigger value="duplicate-detection" className="flex items-center gap-2 py-3">
              <Copy className="h-4 w-4" />
              <span className="hidden md:inline">Duplicate Detection</span>
              <span className="md:hidden">Duplicates</span>
            </TabsTrigger>
            <TabsTrigger value="recalculation" className="flex items-center gap-2 py-3">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden md:inline">Compliance Recalculation</span>
              <span className="md:hidden">Compliance</span>
            </TabsTrigger>
          </TabsList>

          {/* Zone Correction Tab */}
          <TabsContent value="zone-correction" className="mt-6">
            <Card className="border-2 border-blue-500/30">
              <CardHeader className="p-3 md:p-6">
                <CardTitle className="text-base md:text-lg flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  GPS-Based Zone Correction
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-6 space-y-4">
                <Alert>
                  <MapPin className="h-4 w-4" />
                  <AlertDescription className="text-xs md:text-sm">
                    <p className="font-semibold mb-2">How This Works:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Loads all observations with GPS coordinates (accuracy ≤100m)</li>
                      <li>Compares GPS location against active zone boundaries</li>
                      <li>Reassigns observations to correct zones based on GPS data</li>
                      <li>Preserves observations with incidents or HS reports</li>
                      <li>Updates zone assignments for better compliance accuracy</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="text-center p-8 border-2 border-dashed rounded-lg">
                  <Wrench className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Zone Correction tool coming soon
                  </p>
                  <Button
                    disabled
                    className="gap-2"
                  >
                    <MapPin className="h-4 w-4" />
                    Run Zone Correction
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Duplicate Detection Tab */}
          <TabsContent value="duplicate-detection" className="mt-6">
            <Card className="border-2 border-purple-500/30">
              <CardHeader className="p-3 md:p-6">
                <CardTitle className="text-base md:text-lg flex items-center gap-2">
                  <Copy className="h-5 w-5 text-purple-600" />
                  Duplicate Scan Detection & Removal
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-6 space-y-4">
                <Alert>
                  <Copy className="h-4 w-4" />
                  <AlertDescription className="text-xs md:text-sm">
                    <p className="font-semibold mb-2">How This Works:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Groups observations by plate number and zone</li>
                      <li>Identifies duplicates: same plate in same zone within 8 hours</li>
                      <li>Keeps the newest observation, deletes older duplicates</li>
                      <li>Preserves observations with incidents or HS reports (never deleted)</li>
                      <li>Cleans up redundant data for accurate compliance tracking</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="text-center p-8 border-2 border-dashed rounded-lg">
                  <Wrench className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Duplicate Detection tool coming soon
                  </p>
                  <Button
                    disabled
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Run Duplicate Detection
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compliance Recalculation Tab */}
          <TabsContent value="recalculation" className="mt-6">
            <ComplianceRecalculation />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveContainer>
  );
}

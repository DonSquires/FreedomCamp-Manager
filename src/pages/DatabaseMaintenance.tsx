/**
 * DATABASE MAINTENANCE - MASTER USERS ONLY
 * 
 * Three independent maintenance operations (Note: Zone Correction and Duplicate Detection run together):
 * 1. Comprehensive Cleanup (Zone Correction + Duplicate Detection + Compliance): Most thorough cleanup
 * 2. Standalone Compliance Recalculation: Tests compliance against current zone rules only
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
import { ComplianceRecalculation } from './ComplianceRecalculation';
import { useAuthStore } from '@/stores/authStore';

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
                <strong>Compliance Recalculation (Recommended):</strong> Pure compliance check - tests all observations against current zone rules, updates monthly stays, creates breach alerts. Safe to run anytime.
              </li>
            </ul>
            <p className="mt-2 text-xs font-semibold text-green-700 dark:text-green-300">
              💡 Start with Compliance Recalculation for routine maintenance and accurate breach detection.
            </p>
          </AlertDescription>
        </Alert>

        {/* Compliance Recalculation - The standalone tool */}
        <ComplianceRecalculation />
      </div>
    </ResponsiveContainer>
  );
}

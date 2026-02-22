/**
 * Database Tools - Imports, Cleaners, Integrity Checks
 * Admin-only page for database maintenance operations
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Database,
  Upload,
  Download,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  RefreshCw,
  Activity,
} from 'lucide-react';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface JobStatus {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  createdAt: Date;
  completedAt?: Date;
}

export default function DatabaseToolsPage() {
  const [activeTab, setActiveTab] = useState('imports');
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const handleRunComplianceRecalculation = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('recalculate-compliance-v2', {
        body: { full_rebuild: true },
      });

      if (error) {
        // Extract actual error message from Edge Function
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }

      toast.success('Compliance recalculation started');
      
      // Add job to tracking list
      setJobs(prev => [{
        id: data.job_id || Date.now().toString(),
        type: 'Compliance Recalculation',
        status: 'running',
        progress: 0,
        message: 'Processing observations...',
        createdAt: new Date(),
      }, ...prev]);
    } catch (error: any) {
      toast.error('Failed to start recalculation: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunZoneCorrections = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('zone-correction', {
        body: { mode: 'auto' },
      });

      if (error) {
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }

      toast.success('Zone corrections started');
      
      setJobs(prev => [{
        id: data.job_id || Date.now().toString(),
        type: 'Zone Corrections',
        status: 'running',
        progress: 0,
        message: 'Fixing GPS/zone mismatches...',
        createdAt: new Date(),
      }, ...prev]);
    } catch (error: any) {
      toast.error('Failed to start zone corrections: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunIntegrityCheck = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-data-integrity', {
        body: {},
      });

      if (error) {
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }

      toast.success('Data integrity check completed');
      
      setJobs(prev => [{
        id: Date.now().toString(),
        type: 'Data Integrity Check',
        status: 'completed',
        progress: 100,
        message: `Found ${data.issues?.length || 0} issues`,
        createdAt: new Date(),
        completedAt: new Date(),
      }, ...prev]);
    } catch (error: any) {
      toast.error('Failed to run integrity check: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <AdminNavigationMenu />
              <div>
                <h1 className="text-2xl font-bold">Database Tools</h1>
                <p className="text-sm text-muted-foreground">
                  Imports, cleaners, and integrity checks
                </p>
              </div>
            </div>
          </div>
        </div>

        <GlobalFilterRibbon showOrgFilter={false} showZoneFilter={false} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="imports">Imports</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
              <TabsTrigger value="jobs">Jobs</TabsTrigger>
            </TabsList>

            {/* Imports Tab */}
            <TabsContent value="imports" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Historical Observations Import
                  </CardTitle>
                  <CardDescription>
                    Upload CSV file with historical observation data
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 border-2 border-dashed rounded-lg text-center">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-3">
                      Drop CSV file here or click to browse
                    </p>
                    <Button variant="outline">
                      <Upload className="h-4 w-4 mr-2" />
                      Select File
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Download Template
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Vehicle Registry Import
                  </CardTitle>
                  <CardDescription>
                    Upload CSV file with vehicle registry data
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 border-2 border-dashed rounded-lg text-center">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-3">
                      Drop CSV file here or click to browse
                    </p>
                    <Button variant="outline">
                      <Upload className="h-4 w-4 mr-2" />
                      Select File
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Download Template
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Maintenance Tab */}
            <TabsContent value="maintenance" className="space-y-6 mt-6">
              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <RefreshCw className="h-5 w-5" />
                      Compliance Recalculation
                    </CardTitle>
                    <CardDescription>
                      Rebuild all compliance results from observations
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      This will recalculate compliance status for all observations.
                      This may take several minutes.
                    </p>
                    <Button
                      onClick={handleRunComplianceRecalculation}
                      disabled={isRunning}
                      className="w-full"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Run Recalculation
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Zone Corrections
                    </CardTitle>
                    <CardDescription>
                      Fix GPS/zone assignment mismatches
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      Automatically fix observations with incorrect zone assignments
                      based on GPS coordinates.
                    </p>
                    <Button
                      onClick={handleRunZoneCorrections}
                      disabled={isRunning}
                      variant="outline"
                      className="w-full"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-2" />
                          Run Corrections
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      Data Integrity Check
                    </CardTitle>
                    <CardDescription>
                      Run comprehensive database health check
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      Check for orphaned records, invalid references, and data
                      consistency issues.
                    </p>
                    <Button
                      onClick={handleRunIntegrityCheck}
                      disabled={isRunning}
                      variant="outline"
                      className="w-full"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Run Check
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5" />
                      Cleanup Operations
                    </CardTitle>
                    <CardDescription>
                      Remove orphaned evidence and duplicates
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      Clean up orphaned evidence files, merge duplicate vehicles,
                      and normalize zone names.
                    </p>
                    <Button variant="outline" className="w-full" disabled>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Coming Soon
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Background Jobs
                  </CardTitle>
                  <CardDescription>
                    Track long-running database operations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {jobs.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Activity className="h-16 w-16 mx-auto mb-4 opacity-20" />
                      <p>No jobs running</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {jobs.map((job) => (
                        <div
                          key={job.id}
                          className="p-4 border rounded-lg space-y-3"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold">{job.type}</h4>
                                {job.status === 'running' && (
                                  <Badge variant="secondary">
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    Running
                                  </Badge>
                                )}
                                {job.status === 'completed' && (
                                  <Badge className="bg-green-500">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Completed
                                  </Badge>
                                )}
                                {job.status === 'failed' && (
                                  <Badge variant="destructive">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    Failed
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {job.message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Started: {job.createdAt.toLocaleString()}
                              </p>
                            </div>
                          </div>
                          {job.status === 'running' && (
                            <Progress value={job.progress} className="h-2" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/**
 * Data Integrity Check - Admin Portal
 * Comprehensive validation of all system data
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Database,
  FileWarning,
  RefreshCw,
  Download,
  Trash2,
  Building2,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface IntegrityIssue {
  table: string;
  issue_type: 'duplicate' | 'integrity' | 'spelling' | 'empty_field' | 'invalid_plate' | 'orphaned';
  severity: 'critical' | 'warning' | 'info';
  record_id: string;
  field_name?: string;
  current_value?: string;
  expected_value?: string;
  description: string;
  auto_fixable: boolean;
}

interface IntegrityReport {
  scan_id: string;
  scanned_at: string;
  tables_checked: string[];
  total_records_scanned: number;
  issues_found: number;
  issues_by_severity: {
    critical: number;
    warning: number;
    info: number;
  };
  issues_by_type: {
    duplicate: number;
    integrity: number;
    spelling: number;
    empty_field: number;
    invalid_plate: number;
    orphaned: number;
  };
  issues: IntegrityIssue[];
  auto_fixable_count: number;
}

interface Organization {
  id: string;
  name: string;
  is_active: boolean;
}

interface Zone {
  id: string;
  name: string;
  is_active: boolean;
}

export default function DataIntegrityCheck() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentTable, setCurrentTable] = useState('');
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isFixing, setIsFixing] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  
  // Sequential scanning state
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrgIndex, setCurrentOrgIndex] = useState(0);
  const [currentZoneIndex, setCurrentZoneIndex] = useState(0);
  const [currentOrgZones, setCurrentOrgZones] = useState<Zone[]>([]);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [allIssues, setAllIssues] = useState<IntegrityIssue[]>([]);
  const [totalRecordsScanned, setTotalRecordsScanned] = useState(0);

  const runIntegrityCheck = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setCurrentTable('Loading organizations...');
    setReport(null);
    setSelectedIssues(new Set());
    setScanLogs([]);
    setAllIssues([]);
    setTotalRecordsScanned(0);
    setCurrentOrgIndex(0);
    setCurrentZoneIndex(0);

    try {
      console.log('Step 1: Fetching organizations...');
      
      // Step 1: Get all organizations
      const { data: orgsData, error: orgsError } = await supabase.functions.invoke('check-data-integrity', {
        body: { get_organizations: true },
      });

      if (orgsError) {
        let errorMessage = orgsError.message;
        if (orgsError instanceof FunctionsHttpError) {
          try {
            const statusCode = orgsError.context?.status ?? 500;
            const textContent = await orgsError.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || orgsError.message || 'Unknown error'}`;
          } catch {
            errorMessage = orgsError.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }

      const orgs = orgsData.organizations || [];
      setOrganizations(orgs);
      console.log(`Found ${orgs.length} organizations to scan`);
      
      if (orgs.length === 0) {
        toast.warning('No active organizations found');
        setIsScanning(false);
        return;
      }

      setScanLogs(prev => [...prev, `📋 Found ${orgs.length} organization(s) to scan`]);

      // Step 2: Process each organization sequentially
      for (let orgIdx = 0; orgIdx < orgs.length; orgIdx++) {
        const org = orgs[orgIdx];
        setCurrentOrgIndex(orgIdx);
        setCurrentTable(`Organization: ${org.name}`);
        setScanLogs(prev => [...prev, `\n🏢 Organization ${orgIdx + 1}/${orgs.length}: ${org.name}`]);

        // Get zones for this organization
        const { data: zonesData, error: zonesError } = await supabase.functions.invoke('check-data-integrity', {
          body: {
            get_zones: true,
            organization_id: org.id,
          },
        });

        if (zonesError) {
          console.error('Failed to get zones:', zonesError);
          let errorMessage = zonesError.message;
          if (zonesError instanceof FunctionsHttpError) {
            try {
              const statusCode = zonesError.context?.status ?? 500;
              const textContent = await zonesError.context?.text();
              errorMessage = `[Code: ${statusCode}] ${textContent || zonesError.message || 'Unknown error'}`;
            } catch {
              errorMessage = zonesError.message || 'Failed to read response';
            }
          }
          setScanLogs(prev => [...prev, `  ⚠️ Failed to load zones for ${org.name}: ${errorMessage}`]);
          continue;
        }

        const zones = zonesData.zones || [];
        setCurrentOrgZones(zones);
        setScanLogs(prev => [...prev, `  📍 Found ${zones.length} zone(s)`]);

        // Step 3: Process each zone sequentially
        for (let zoneIdx = 0; zoneIdx < zones.length; zoneIdx++) {
          const zone = zones[zoneIdx];
          setCurrentZoneIndex(zoneIdx);
          setCurrentTable(`${org.name} → ${zone.name}`);
          setScanLogs(prev => [...prev, `    🔍 Scanning zone ${zoneIdx + 1}/${zones.length}: ${zone.name}`]);

          // Calculate progress
          const totalZonesAcrossAllOrgs = orgs.reduce((sum, o, idx) => {
            if (idx < orgIdx) return sum + (currentOrgZones.length || 0);
            if (idx === orgIdx) return sum + zoneIdx + 1;
            return sum;
          }, 0);
          const estimatedTotalZones = orgs.length * 5; // Rough estimate
          const progress = Math.min(95, (totalZonesAcrossAllOrgs / estimatedTotalZones) * 100);
          setScanProgress(progress);

          // Scan this specific zone
          const { data: zoneReport, error: zoneError } = await supabase.functions.invoke('check-data-integrity', {
            body: {
              include_auto_fix: true,
              check_duplicates: true,
              check_foreign_keys: true,
              check_plate_formats: true,
              check_required_fields: true,
              organization_id: org.id,
              zone_id: zone.id,
            },
          });

          if (zoneError) {
            console.error('Zone scan failed:', zoneError);
            let errorMessage = zoneError.message;
            if (zoneError instanceof FunctionsHttpError) {
              try {
                const statusCode = zoneError.context?.status ?? 500;
                const textContent = await zoneError.context?.text();
                errorMessage = `[Code: ${statusCode}] ${textContent || zoneError.message || 'Unknown error'}`;
              } catch {
                errorMessage = zoneError.message || 'Failed to read response';
              }
            }
            setScanLogs(prev => [...prev, `      ❌ Scan failed: ${errorMessage}`]);
            continue;
          }

          // Accumulate results
          setAllIssues(prev => [...prev, ...zoneReport.issues]);
          setTotalRecordsScanned(prev => prev + zoneReport.total_records_scanned);
          
          setScanLogs(prev => [...prev, 
            `      ✅ Complete: ${zoneReport.total_records_scanned} records, ${zoneReport.issues_found} issues`
          ]);
        }

        setScanLogs(prev => [...prev, `  ✅ Organization ${org.name} complete\n`]);
      }

      // Step 4: Build final consolidated report
      const issuesBySeverity = {
        critical: allIssues.filter(i => i.severity === 'critical').length,
        warning: allIssues.filter(i => i.severity === 'warning').length,
        info: allIssues.filter(i => i.severity === 'info').length,
      };

      const issuesByType = {
        duplicate: allIssues.filter(i => i.issue_type === 'duplicate').length,
        integrity: allIssues.filter(i => i.issue_type === 'integrity').length,
        spelling: allIssues.filter(i => i.issue_type === 'spelling').length,
        empty_field: allIssues.filter(i => i.issue_type === 'empty_field').length,
        invalid_plate: allIssues.filter(i => i.issue_type === 'invalid_plate').length,
        orphaned: allIssues.filter(i => i.issue_type === 'orphaned').length,
      };

      const autoFixableCount = allIssues.filter(i => i.auto_fixable).length;

      const finalReport: IntegrityReport = {
        scan_id: crypto.randomUUID(),
        scanned_at: new Date().toISOString(),
        tables_checked: [
          'canonical_vehicles',
          'vehicle_observations_v2',
          'vehicle_monthly_stays',
          'incidents',
          'enforcement_actions',
          'flagged_vehicles',
          'breach_alerts',
          'person_records',
          'investigation_jobs',
          'plate_scans',
        ],
        total_records_scanned: totalRecordsScanned,
        issues_found: allIssues.length,
        issues_by_severity: issuesBySeverity,
        issues_by_type: issuesByType,
        issues: allIssues,
        auto_fixable_count: autoFixableCount,
      };

      setReport(finalReport);
      setScanProgress(100);

      setScanLogs(prev => [...prev, 
        `\n✅ SCAN COMPLETE`,
        `📊 Total: ${totalRecordsScanned} records scanned across ${orgs.length} organization(s)`,
        `⚠️ Issues: ${allIssues.length} (Critical: ${issuesBySeverity.critical}, Warnings: ${issuesBySeverity.warning})`,
      ]);

      if (allIssues.length === 0) {
        toast.success('✅ No data integrity issues found! System is healthy.');
      } else {
        toast.warning(`Found ${allIssues.length} issues requiring attention`, {
          description: `Critical: ${issuesBySeverity.critical}, Warnings: ${issuesBySeverity.warning}`,
        });
      }

    } catch (error: any) {
      console.error('Scan error:', error);
      toast.error('Integrity check failed: ' + error.message);
      setScanLogs(prev => [...prev, `\n❌ ERROR: ${error.message}`]);
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      setCurrentTable('');
    }
  };

  const fixSelectedIssues = async () => {
    if (selectedIssues.size === 0) {
      toast.error('No issues selected');
      return;
    }

    setIsFixing(true);

    try {
      const issuesToFix = report?.issues.filter(issue => 
        selectedIssues.has(issue.record_id) && issue.auto_fixable
      ) || [];

      if (issuesToFix.length === 0) {
        toast.error('None of the selected issues are auto-fixable');
        return;
      }

      console.log('Fixing issues:', issuesToFix);

      const { data, error } = await supabase.functions.invoke('check-data-integrity', {
        body: {
          fix_mode: true,
          issues_to_fix: issuesToFix,
        },
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

      console.log('Fix results:', data);
      toast.success(`Fixed ${data.fixed_count} issues successfully`);

      // Re-run scan to get updated report
      await runIntegrityCheck();

    } catch (error: any) {
      console.error('Fix error:', error);
      toast.error('Failed to fix issues: ' + error.message);
    } finally {
      setIsFixing(false);
    }
  };

  const toggleIssueSelection = (recordId: string) => {
    setSelectedIssues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recordId)) {
        newSet.delete(recordId);
      } else {
        newSet.add(recordId);
      }
      return newSet;
    });
  };

  const selectAllAutoFixable = () => {
    if (!report) return;
    
    const autoFixableIds = report.issues
      .filter(issue => issue.auto_fixable)
      .map(issue => issue.record_id);
    
    setSelectedIssues(new Set(autoFixableIds));
    toast.info(`Selected ${autoFixableIds.length} auto-fixable issues`);
  };

  const exportReport = () => {
    if (!report) return;

    const reportData = {
      ...report,
      exported_at: new Date().toISOString(),
      exported_by: 'admin',
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-integrity-report-${report.scan_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Report exported');
  };

  const filteredIssues = report?.issues.filter(issue => {
    if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
    if (filterType !== 'all' && issue.issue_type !== filterType) return false;
    return true;
  }) || [];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'info': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <XCircle className="h-5 w-5 text-red-600" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'info': return <FileWarning className="h-5 w-5 text-blue-600" />;
      default: return <CheckCircle2 className="h-5 w-5 text-gray-600" />;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            Data Integrity Check
          </h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive validation of all system data for duplicates, integrity, and quality
          </p>
        </div>
        
        {report && (
          <Button variant="outline" onClick={exportReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        )}
      </div>

      {/* Scan Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Integrity Scan
          </CardTitle>
          <CardDescription>
            Scans canonical vehicles, observations_v2 (migrated table), monthly stays, incidents, enforcement actions, flagged vehicles, breach alerts, homeless records, investigation jobs, and bulk scans
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isScanning ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Scanning: {currentTable}</span>
                <span className="text-sm text-muted-foreground">{Math.round(scanProgress)}%</span>
              </div>
              <Progress value={scanProgress} />
              
              {organizations.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3 w-3" />
                    Organization: {currentOrgIndex + 1} of {organizations.length}
                  </div>
                  {currentOrgZones.length > 0 && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      Zone: {currentZoneIndex + 1} of {currentOrgZones.length}
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing organizations and zones sequentially...
              </div>
              
              {/* Live Scan Log */}
              {scanLogs.length > 0 && (
                <div className="mt-4 p-3 bg-gray-900 text-gray-100 dark:bg-gray-950 rounded-lg max-h-64 overflow-y-auto font-mono text-xs">
                  {scanLogs.map((log, idx) => (
                    <div key={idx} className="whitespace-pre-wrap">
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Button 
                onClick={runIntegrityCheck} 
                disabled={isScanning}
                className="w-full h-14 text-lg font-bold"
              >
                <Shield className="h-5 w-5 mr-2" />
                Run Complete Integrity Check
              </Button>
              
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>What this checks:</strong>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>Duplicate canonical vehicles (should be prevented by PK)</li>
                    <li>Orphaned observations in vehicle_observations_v2 (invalid plate_number or zone_id)</li>
                    <li>Orphaned monthly stays (invalid plate_number)</li>
                    <li>Invalid NZ plate number formats</li>
                    <li>Required fields with missing data</li>
                    <li>Foreign key integrity across all tables</li>
                    <li><strong>Future-dated imports</strong> (records with timestamp after current date)</li>
                  </ul>
                </AlertDescription>
              </Alert>
              
              <Alert className="border-blue-200 bg-blue-50">
                <Database className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-xs">
                  <strong>SQL Cleanup Scripts:</strong>
                  
                  <div className="mt-3">
                    <div className="font-semibold text-blue-800 mb-1">1. Fix Future-Dated Imports:</div>
                    <div className="p-2 bg-gray-900 text-gray-100 dark:bg-gray-950 rounded font-mono text-[10px] overflow-x-auto">
                      <div className="whitespace-pre">-- Fix records imported with future dates (set to 19:00 the day before)</div>
                      <div className="whitespace-pre">UPDATE vehicle_observations_v2</div>
                      <div className="whitespace-pre">SET recorded_at = (DATE(recorded_at) - INTERVAL '1 day')::date + TIME '19:00:00'</div>
                      <div className="whitespace-pre">WHERE recorded_at &gt; NOW()</div>
                      <div className="whitespace-pre">  AND DATE(recorded_at) = CURRENT_DATE + INTERVAL '1 day';</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="font-semibold text-blue-800 mb-1">2. Remove Duplicate Observations:</div>
                    <div className="p-2 bg-gray-900 text-gray-100 dark:bg-gray-950 rounded font-mono text-[10px] overflow-x-auto">
                      <div className="whitespace-pre">-- Remove duplicate observations (keep only the earliest record per plate/zone/date)</div>
                      <div className="whitespace-pre">WITH duplicates AS (</div>
                      <div className="whitespace-pre">  SELECT observation_id,</div>
                      <div className="whitespace-pre">         ROW_NUMBER() OVER (</div>
                      <div className="whitespace-pre">           PARTITION BY plate_number, zone_id, DATE(recorded_at)</div>
                      <div className="whitespace-pre">           ORDER BY recorded_at ASC</div>
                      <div className="whitespace-pre">         ) as row_num</div>
                      <div className="whitespace-pre">  FROM vehicle_observations_v2</div>
                      <div className="whitespace-pre">)</div>
                      <div className="whitespace-pre">DELETE FROM vehicle_observations_v2</div>
                      <div className="whitespace-pre">WHERE observation_id IN (</div>
                      <div className="whitespace-pre">  SELECT observation_id FROM duplicates WHERE row_num &gt; 1</div>
                      <div className="whitespace-pre">);</div>
                      <div className="whitespace-pre mt-2">-- Then recalculate canonical_vehicles stats and monthly_stays</div>
                    </div>
                  </div>

                  <p className="mt-3 text-blue-700">
                    Run these in <strong>Supabase SQL Editor</strong> to clean up data issues.
                    After running duplicate removal, <strong>trigger a compliance recalculation</strong> to rebuild canonical_vehicles stats and monthly_stays.
                  </p>
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Integrity Report */}
      {report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Records Scanned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{report.total_records_scanned.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across {report.tables_checked.length} tables
                </p>
              </CardContent>
            </Card>

            <Card className={report.issues_by_severity.critical > 0 ? 'border-red-200 bg-red-50' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-red-600">Critical Issues</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">{report.issues_by_severity.critical}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Require immediate attention
                </p>
              </CardContent>
            </Card>

            <Card className={report.issues_by_severity.warning > 0 ? 'border-yellow-200 bg-yellow-50' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-yellow-600">Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-yellow-600">{report.issues_by_severity.warning}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Should be reviewed
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-blue-600">Auto-Fixable</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{report.auto_fixable_count}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Can be fixed automatically
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Issue Type Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Issues by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(report.issues_by_type).map(([type, count]) => (
                  <div key={type} className="text-center p-3 border rounded-lg">
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-muted-foreground capitalize mt-1">
                      {type.replace('_', ' ')}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Filters and Actions */}
          {report.issues.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Issues Found ({filteredIssues.length})</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllAutoFixable}
                      disabled={report.auto_fixable_count === 0}
                    >
                      Select All Auto-Fixable
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={fixSelectedIssues}
                      disabled={selectedIssues.size === 0 || isFixing}
                    >
                      {isFixing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Fixing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Fix Selected ({selectedIssues.size})
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Severity:</span>
                    {(['all', 'critical', 'warning', 'info'] as const).map(severity => (
                      <Button
                        key={severity}
                        variant={filterSeverity === severity ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setFilterSeverity(severity)}
                      >
                        {severity === 'all' ? 'All' : severity.charAt(0).toUpperCase() + severity.slice(1)}
                      </Button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Type:</span>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="border rounded px-3 py-1 text-sm"
                    >
                      <option value="all">All Types</option>
                      <option value="duplicate">Duplicates</option>
                      <option value="integrity">Integrity</option>
                      <option value="spelling">Spelling</option>
                      <option value="empty_field">Empty Fields</option>
                      <option value="invalid_plate">Invalid Plates</option>
                      <option value="orphaned">Orphaned Records</option>
                    </select>
                  </div>
                </div>

                {/* Issues List */}
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {filteredIssues.map((issue, index) => (
                    <div
                      key={`${issue.table}-${issue.record_id}-${index}`}
                      className={`border rounded-lg p-4 ${getSeverityColor(issue.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          {issue.auto_fixable && (
                            <input
                              type="checkbox"
                              checked={selectedIssues.has(issue.record_id)}
                              onChange={() => toggleIssueSelection(issue.record_id)}
                              className="mt-1 h-5 w-5 rounded border-gray-300"
                            />
                          )}
                          
                          {getSeverityIcon(issue.severity)}
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <Badge variant="outline" className="text-xs">
                                {issue.table}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {issue.issue_type.replace('_', ' ')}
                              </Badge>
                              {issue.auto_fixable && (
                                <Badge className="text-xs bg-green-600">
                                  Auto-fixable
                                </Badge>
                              )}
                            </div>
                            
                            <p className="text-sm font-medium mb-1">{issue.description}</p>
                            
                            {issue.field_name && (
                              <div className="text-xs space-y-1 mt-2">
                                <div>
                                  <span className="font-semibold">Field:</span> {issue.field_name}
                                </div>
                                {issue.current_value && (
                                  <div>
                                    <span className="font-semibold">Current:</span> {issue.current_value}
                                  </div>
                                )}
                                {issue.expected_value && (
                                  <div>
                                    <span className="font-semibold">Expected:</span> {issue.expected_value}
                                  </div>
                                )}
                              </div>
                            )}
                            
                            <div className="text-xs text-muted-foreground mt-2">
                              Record ID: <code className="bg-black/5 px-1 py-0.5 rounded">{issue.record_id}</code>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {filteredIssues.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      No issues match the current filters
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No Issues Found */}
          {report.issues.length === 0 && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="text-center py-12">
                <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-green-900 mb-2">All Clear!</h3>
                <p className="text-green-700">
                  No data integrity issues found. Your system data is healthy.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

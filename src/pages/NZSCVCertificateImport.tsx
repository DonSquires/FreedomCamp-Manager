/**
 * NZSCV Certificate Import - Updates canonical_vehicles table
 * 
 * Purpose: Import self-contained certification data from NZSCV
 * Updates: canonical_vehicles.self_contained, self_contained_expiry, nzscv_last_checked, nzscv_source
 * 
 * Features:
 * - Batch processing (250 records at a time)
 * - Optional reset all vehicles to non-self-contained before import
 * - Real-time progress tracking
 * 
 * CSV Format Expected:
 * - Column A: Vehicle Registration (plate number)
 * - Column B: Certificate Status (Current/Expired/etc)
 * - Column C: Certificate Issue Date (DD/MM/YYYY)
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Download,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface ImportResult {
  plate_number: string;
  status: 'updated' | 'created' | 'failed' | 'no_change';
  message: string;
  old_expiry?: string;
  new_expiry?: string;
}

interface ImportSummary {
  total: number;
  updated: number;
  created: number;
  failed: number;
  no_change: number;
  results: ImportResult[];
}

interface ImportProgress {
  current: number;
  total: number;
  currentPlate: string;
  recentUpdates: string[];
  currentBatch?: number;
  totalBatches?: number;
}

const BATCH_SIZE = 250;

export function NZSCVCertificateImport() {
  const { user } = useAuthStore();

  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [resetBeforeImport, setResetBeforeImport] = useState(true);

  // Parse CSV/Excel file
  const parseFile = async (selectedFile: File): Promise<any[]> => {
    const isExcel = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls');
    
    if (isExcel) {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs');
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      return jsonData.slice(1).map(row => ({
        plate: row[0]?.toString().trim() || '',
        status: row[1]?.toString().trim() || '',
        issueDate: row[2]?.toString().trim() || '',
      }));
    } else {
      const text = await selectedFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      return lines.slice(1).map(line => {
        const columns = line.split(',').map(col => col.trim());
        return {
          plate: columns[0] || '',
          status: columns[1] || '',
          issueDate: columns[2] || '',
        };
      });
    }
  };

  const parseDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    
    const formats = [
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    ];
    
    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        const [_, part1, part2, part3] = match;
        const day = parseInt(part1);
        const month = parseInt(part2) - 1;
        const year = parseInt(part3);
        
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const normalizePlate = (plate: string): string => {
    return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  };

  // Reset all vehicles to non-self-contained
  const handleResetAllSelfContained = async () => {
    setIsResetting(true);
    try {
      console.log('🔄 Resetting all canonical vehicles to non-self-contained...');
      
      const { error } = await supabase
        .from('canonical_vehicles')
        .update({
          self_contained: false,
          self_contained_expiry: null,
          nzscv_last_checked: new Date().toISOString(),
          nzscv_source: 'reset_before_import',
        })
        .neq('plate_number', '');

      if (error) throw error;

      console.log('✅ All canonical vehicles reset to non-self-contained');
      toast.success('All vehicles reset to non-self-contained status');
      return true;
    } catch (error: any) {
      console.error('❌ Failed to reset vehicles:', error);
      toast.error('Failed to reset vehicles: ' + error.message);
      return false;
    } finally {
      setIsResetting(false);
    }
  };

  // Process import with batch processing
  const handleImport = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setIsImporting(true);
    setSummary(null);
    setProgress(null);

    try {
      // Step 1: Reset all vehicles if requested
      if (resetBeforeImport) {
        const resetSuccess = await handleResetAllSelfContained();
        if (!resetSuccess) {
          throw new Error('Failed to reset vehicles before import');
        }
      }

      console.log('📄 Parsing file:', file.name);
      const rows = await parseFile(file);
      
      if (rows.length === 0) {
        throw new Error('No data found in file');
      }

      console.log(`✅ Parsed ${rows.length} rows`);

      const results: ImportResult[] = [];
      let updated = 0;
      let created = 0;
      let failed = 0;
      let noChange = 0;
      const recentUpdates: string[] = [];

      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
      console.log(`📦 Processing ${rows.length} records in ${totalBatches} batches`);

      setProgress({
        current: 0,
        total: rows.length,
        currentPlate: '',
        recentUpdates: [],
        currentBatch: 0,
        totalBatches,
      });

      // Process in batches
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, rows.length);
        const batch = rows.slice(batchStart, batchEnd);

        console.log(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (records ${batchStart + 1}-${batchEnd})`);

        // Prepare batch data
        const batchData: Array<{
          plate: string;
          normalizedPlate: string;
          isCurrent: boolean;
          expiryDateStr: string | null;
          status: string;
          issueDate: string;
        }> = [];

        for (const row of batch) {
          const { plate, status, issueDate } = row;
          if (!plate) continue;

          const normalizedPlate = normalizePlate(plate);
          const parsedDate = parseDate(issueDate);
          const isCurrent = status?.toLowerCase() === 'current';
          const expiryDateStr = parsedDate ? parsedDate.toISOString().split('T')[0] : null;

          batchData.push({
            plate,
            normalizedPlate,
            isCurrent,
            expiryDateStr,
            status,
            issueDate,
          });
        }

        // Fetch existing vehicles for this batch
        const plateNumbers = batchData.map(d => d.normalizedPlate);
        const { data: existingVehicles, error: fetchError } = await supabase
          .from('canonical_vehicles')
          .select('plate_number, self_contained, self_contained_expiry')
          .in('plate_number', plateNumbers);

        if (fetchError) {
          console.error('❌ Failed to fetch existing vehicles:', fetchError);
          batchData.forEach(item => {
            results.push({
              plate_number: item.normalizedPlate,
              status: 'failed',
              message: `Batch fetch error: ${fetchError.message}`,
            });
            failed++;
          });
          continue;
        }

        const existingMap = new Map(
          (existingVehicles || []).map(v => [v.plate_number, v])
        );

        // Prepare batch updates and inserts
        const toUpdate: Array<any> = [];
        const toInsert: Array<any> = [];

        for (let i = 0; i < batchData.length; i++) {
          const item = batchData[i];
          const existing = existingMap.get(item.normalizedPlate);

          setProgress({
            current: batchStart + i + 1,
            total: rows.length,
            currentPlate: item.normalizedPlate,
            recentUpdates: recentUpdates.slice(-5),
            currentBatch: batchIndex + 1,
            totalBatches,
          });

          if (existing) {
            const needsUpdate = 
              existing.self_contained !== item.isCurrent ||
              existing.self_contained_expiry !== item.expiryDateStr;

            if (needsUpdate) {
              toUpdate.push({
                plate_number: item.normalizedPlate,
                self_contained: item.isCurrent,
                self_contained_expiry: item.expiryDateStr,
                nzscv_last_checked: new Date().toISOString(),
                nzscv_source: 'manual_import',
              });

              const updateMessage = `Updated ${item.normalizedPlate}: ${item.status} - ${item.issueDate}`;
              recentUpdates.push(updateMessage);

              results.push({
                plate_number: item.normalizedPlate,
                status: 'updated',
                message: `Updated: ${item.status} - ${item.issueDate}`,
                old_expiry: existing.self_contained_expiry || undefined,
                new_expiry: item.expiryDateStr || undefined,
              });
              updated++;
            } else {
              results.push({
                plate_number: item.normalizedPlate,
                status: 'no_change',
                message: 'Already up to date',
              });
              noChange++;
            }
          } else {
            toInsert.push({
              plate_number: item.normalizedPlate,
              self_contained: item.isCurrent,
              self_contained_expiry: item.expiryDateStr,
              nzscv_last_checked: new Date().toISOString(),
              nzscv_source: 'manual_import',
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            });

            const createMessage = `Created ${item.normalizedPlate}: ${item.status} - ${item.issueDate}`;
            recentUpdates.push(createMessage);

            results.push({
              plate_number: item.normalizedPlate,
              status: 'created',
              message: `Created new record: ${item.status} - ${item.issueDate}`,
              new_expiry: item.expiryDateStr || undefined,
            });
            created++;
          }
        }

        // Execute batch updates
        if (toUpdate.length > 0) {
          console.log(`🔄 Updating ${toUpdate.length} existing vehicles...`);
          for (const updateData of toUpdate) {
            const { error: updateError } = await supabase
              .from('canonical_vehicles')
              .update({
                self_contained: updateData.self_contained,
                self_contained_expiry: updateData.self_contained_expiry,
                nzscv_last_checked: updateData.nzscv_last_checked,
                nzscv_source: updateData.nzscv_source,
              })
              .eq('plate_number', updateData.plate_number);

            if (updateError) {
              console.error(`❌ Failed to update ${updateData.plate_number}:`, updateError);
            }
          }
        }

        // Execute batch inserts
        if (toInsert.length > 0) {
          console.log(`➕ Inserting ${toInsert.length} new vehicles...`);
          const { error: insertError } = await supabase
            .from('canonical_vehicles')
            .insert(toInsert);

          if (insertError) {
            console.error('❌ Batch insert error:', insertError);
          }
        }

        console.log(`✅ Batch ${batchIndex + 1}/${totalBatches} complete`);
      }

      setSummary({
        total: rows.length,
        updated,
        created,
        failed,
        no_change: noChange,
        results,
      });

      setProgress(null);

      toast.success(
        `Import complete! ${updated} updated, ${created} created, ${noChange} unchanged, ${failed} failed`
      );

    } catch (error: any) {
      console.error('❌ Import failed:', error);
      toast.error('Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  const exportResults = () => {
    if (!summary) return;

    const csv = [
      ['Plate Number', 'Status', 'Message', 'Old Expiry', 'New Expiry'],
      ...summary.results.map(r => [
        r.plate_number,
        r.status,
        r.message,
        r.old_expiry || '',
        r.new_expiry || '',
      ]),
    ]
      .map(row => row.join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nzscv_import_results_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Results exported');
  };

  const handleReset = () => {
    setFile(null);
    setSummary(null);
    setProgress(null);
  };

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-primary" />
          NZSCV Certificate Import
        </h2>
        <p className="text-muted-foreground">
          Import self-contained vehicle certification data from NZSCV (batch processing: 250 records at a time)
        </p>
      </div>

      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>File Format Requirements</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1 text-sm mt-2">
            <li>Upload CSV or Excel (.xlsx) file</li>
            <li><strong>Column A:</strong> Vehicle Registration (plate number)</li>
            <li><strong>Column B:</strong> Certificate Status (Current/Expired)</li>
            <li><strong>Column C:</strong> Certificate Issue Date (DD/MM/YYYY)</li>
            <li>First row is treated as header and skipped</li>
          </ul>
        </AlertDescription>
      </Alert>

      {!summary && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Certificate Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Reset Option */}
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="reset-before-import"
                  checked={resetBeforeImport}
                  onChange={(e) => setResetBeforeImport(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-amber-400"
                  disabled={isImporting || isResetting}
                />
                <div className="flex-1">
                  <Label htmlFor="reset-before-import" className="cursor-pointer font-semibold text-amber-900 dark:text-amber-100">
                    🔄 Reset all vehicles to non-self-contained before import
                  </Label>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    <strong>Recommended:</strong> Sets ALL canonical vehicles to self_contained=false first, 
                    then updates only those in the NZSCV register. This ensures vehicles removed from 
                    the register are correctly marked as non-compliant.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <Label
                htmlFor="file-upload"
                className="cursor-pointer text-primary hover:underline font-medium"
              >
                Click to upload CSV or Excel file
              </Label>
              <Input
                id="file-upload"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  const uploadedFile = e.target.files?.[0];
                  if (uploadedFile) {
                    setFile(uploadedFile);
                  }
                }}
                className="hidden"
                disabled={isImporting || isResetting}
              />
              {file && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {file && !isImporting && !isResetting && (
              <div className="flex gap-2">
                <Button onClick={handleImport} className="flex-1 gap-2">
                  <PlayCircle className="h-4 w-4" />
                  Start Import
                </Button>
                <Button variant="outline" onClick={() => setFile(null)}>
                  Cancel
                </Button>
              </div>
            )}

            {(isResetting || isImporting) && (
              <div className="space-y-4">
                {isResetting && (
                  <div className="flex items-center justify-center gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                    <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
                        🔄 Resetting All Vehicles to Non-Self-Contained
                      </div>
                      <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Setting all canonical vehicles to self_contained = false...
                      </div>
                    </div>
                  </div>
                )}

                {isImporting && progress && (
                  <>
                    <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          📦 Batch Processing NZSCV Certificates
                        </div>
                        <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                          Batch {progress.currentBatch}/{progress.totalBatches} • {progress.current} of {progress.total} records
                          {progress.currentPlate && <span className="ml-2">• Current: {progress.currentPlate}</span>}
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-blue-600">
                        {Math.round((progress.current / progress.total) * 100)}%
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Progress value={(progress.current / progress.total) * 100} className="h-4" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress: {progress.current} / {progress.total}</span>
                        <span>{progress.total - progress.current} remaining</span>
                      </div>
                      <div className="text-center text-xs text-blue-600 dark:text-blue-400 font-medium">
                        ⚡ Processing {BATCH_SIZE} records per batch for optimal performance
                      </div>
                    </div>

                    {progress.recentUpdates.length > 0 && (
                      <div className="border rounded-lg p-3 bg-white dark:bg-gray-900 space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          📝 Recent Updates:
                        </div>
                        {progress.recentUpdates.map((update, idx) => (
                          <div
                            key={idx}
                            className="text-xs text-green-700 dark:text-green-300 font-mono animate-in fade-in duration-200"
                          >
                            ✓ {update}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card className="border-2 border-green-500/30 bg-green-50 dark:bg-green-950/20">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-green-900 dark:text-green-100">
                <CheckCircle2 className="h-5 w-5" />
                Import Complete!
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportResults} className="gap-1">
                  <Download className="h-3 w-3" />
                  Export Results
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Import Another File
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold">{summary.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-green-600">{summary.updated}</div>
                <div className="text-xs text-muted-foreground">Updated</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-blue-600">{summary.created}</div>
                <div className="text-xs text-muted-foreground">Created</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-gray-600">{summary.no_change}</div>
                <div className="text-xs text-muted-foreground">No Change</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Import Details (showing first 100 results)
              </h4>
              <div className="border rounded-lg bg-white dark:bg-gray-900 p-3 max-h-96 overflow-y-auto">
                <div className="space-y-2 text-xs">
                  {summary.results.slice(0, 100).map((result, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded border ${
                        result.status === 'updated'
                          ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                          : result.status === 'created'
                          ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                          : result.status === 'failed'
                          ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                          : 'bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{result.plate_number}</div>
                        <Badge
                          variant={
                            result.status === 'updated' || result.status === 'created'
                              ? 'default'
                              : result.status === 'failed'
                              ? 'destructive'
                              : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {result.status}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-1">{result.message}</div>
                    </div>
                  ))}
                  {summary.results.length > 100 && (
                    <p className="text-center text-muted-foreground py-2">
                      ... and {summary.results.length - 100} more (download full report)
                    </p>
                  )}
                </div>
              </div>
            </div>

            {summary.failed === 0 && (
              <Alert className="border-green-500/50 bg-green-100 dark:bg-green-950/30">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-900 dark:text-green-100">
                  Perfect Import!
                </AlertTitle>
                <AlertDescription className="text-green-800 dark:text-green-200">
                  All {summary.total} records were processed successfully.{' '}
                  {summary.updated > 0 && <>{summary.updated} vehicles updated. </>}
                  {summary.created > 0 && <>{summary.created} new vehicles created. </>}
                  {summary.no_change > 0 && <>{summary.no_change} were already up to date.</>}
                </AlertDescription>
              </Alert>
            )}

            {summary.failed > 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Some Records Failed</AlertTitle>
                <AlertDescription>
                  {summary.failed} record(s) could not be processed. Download the full report for details.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <AlertTriangle className="h-4 w-4" />
            How NZSCV Import Works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-blue-800 dark:text-blue-200">
          <div>
            <strong>📦 Batch Processing (250 records at a time):</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
              <li>Processes large files efficiently without timeouts</li>
              <li>Real-time progress tracking per batch</li>
              <li>Continues processing even if individual records fail</li>
            </ul>
          </div>
          <div className="pt-2 border-t border-blue-300">
            <strong>🔄 Reset Before Import (Recommended):</strong>
            <p className="mt-1 text-[11px]">
              When enabled, sets ALL vehicles to self_contained=false first, then updates only those in the NZSCV register. 
              This ensures any vehicles removed from the register are correctly marked as non-compliant.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

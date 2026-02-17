/**
 * NZSCV Certificate Import - Updates canonical_vehicles table
 * 
 * Purpose: Import self-contained certification data from NZSCV
 * Updates: canonical_vehicles.self_contained, self_contained_expiry, nzscv_last_checked, nzscv_source
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
}

export function NZSCVCertificateImport() {
  const { user } = useAuthStore();

  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  // Parse CSV/Excel file
  const parseFile = async (selectedFile: File): Promise<any[]> => {
    const isExcel = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls');
    
    if (isExcel) {
      // Parse Excel using SheetJS
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs');
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Skip header row and convert to objects
      return jsonData.slice(1).map(row => ({
        plate: row[0]?.toString().trim() || '',
        status: row[1]?.toString().trim() || '',
        issueDate: row[2]?.toString().trim() || '',
      }));
    } else {
      // Parse CSV
      const text = await selectedFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      // Skip header row
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

  // Parse date from various formats (DD/MM/YYYY, MM/DD/YYYY, etc.)
  const parseDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    
    // Try common formats
    const formats = [
      // DD/MM/YYYY
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      // MM/DD/YYYY
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      // YYYY-MM-DD
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    ];
    
    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        const [_, part1, part2, part3] = match;
        
        // Assume DD/MM/YYYY format (NZ standard)
        const day = parseInt(part1);
        const month = parseInt(part2) - 1; // JS months are 0-indexed
        const year = parseInt(part3);
        
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    // Fallback: try native Date parser
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Normalize plate number (uppercase, remove spaces and special chars)
  const normalizePlate = (plate: string): string => {
    return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  };

  // Process import
  const handleImport = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setIsImporting(true);
    setSummary(null);
    setProgress(null);

    try {
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

      // Initialize progress
      setProgress({
        current: 0,
        total: rows.length,
        currentPlate: '',
        recentUpdates: [],
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const { plate, status, issueDate } = row;
        
        // Skip empty rows
        if (!plate) {
          continue;
        }

        const normalizedPlate = normalizePlate(plate);
        const parsedDate = parseDate(issueDate);
        const isCurrent = status?.toLowerCase() === 'current';
        const expiryDateStr = parsedDate ? parsedDate.toISOString().split('T')[0] : null;

        // Update progress
        setProgress({
          current: i + 1,
          total: rows.length,
          currentPlate: normalizedPlate,
          recentUpdates: recentUpdates.slice(-5), // Keep last 5 updates
        });

        try {
          // Check if vehicle exists
          const { data: existingVehicle, error: fetchError } = await supabase
            .from('canonical_vehicles')
            .select('plate_number, self_contained, self_contained_expiry')
            .eq('plate_number', normalizedPlate)
            .maybeSingle();

          if (fetchError) throw fetchError;

          if (existingVehicle) {
            // Check if update is needed
            const needsUpdate = 
              existingVehicle.self_contained !== isCurrent ||
              existingVehicle.self_contained_expiry !== expiryDateStr;

            if (needsUpdate) {
              // Update existing vehicle
              const { error: updateError } = await supabase
                .from('canonical_vehicles')
                .update({
                  self_contained: isCurrent,
                  self_contained_expiry: expiryDateStr,
                  nzscv_last_checked: new Date().toISOString(),
                  nzscv_source: 'manual_import',
                })
                .eq('plate_number', normalizedPlate);

              if (updateError) throw updateError;

              const updateMessage = `Updated ${normalizedPlate}: ${status} - ${issueDate}`;
              recentUpdates.push(updateMessage);

              results.push({
                plate_number: normalizedPlate,
                status: 'updated',
                message: `Updated: ${status} - ${issueDate}`,
                old_expiry: existingVehicle.self_contained_expiry || undefined,
                new_expiry: expiryDateStr || undefined,
              });
              updated++;
            } else {
              // No change needed
              results.push({
                plate_number: normalizedPlate,
                status: 'no_change',
                message: 'Already up to date',
              });
              noChange++;
            }
          } else {
            // Create new canonical vehicle
            const { error: insertError } = await supabase
              .from('canonical_vehicles')
              .insert({
                plate_number: normalizedPlate,
                self_contained: isCurrent,
                self_contained_expiry: expiryDateStr,
                nzscv_last_checked: new Date().toISOString(),
                nzscv_source: 'manual_import',
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
              });

            if (insertError) throw insertError;

            const createMessage = `Created ${normalizedPlate}: ${status} - ${issueDate}`;
            recentUpdates.push(createMessage);

            results.push({
              plate_number: normalizedPlate,
              status: 'created',
              message: `Created new record: ${status} - ${issueDate}`,
              new_expiry: expiryDateStr || undefined,
            });
            created++;
          }
        } catch (error: any) {
          console.error(`❌ Failed to process ${normalizedPlate}:`, error);
          results.push({
            plate_number: normalizedPlate,
            status: 'failed',
            message: error.message,
          });
          failed++;
        }
      }

      setSummary({
        total: rows.length,
        updated,
        created,
        failed,
        no_change: noChange,
        results,
      });

      // Clear progress on completion
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

  // Export results to CSV
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

  // Reset
  const handleReset = () => {
    setFile(null);
    setSummary(null);
    setProgress(null);
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-primary" />
          NZSCV Certificate Import
        </h2>
        <p className="text-muted-foreground">
          Import self-contained vehicle certification data from NZSCV
        </p>
      </div>

      {/* Instructions */}
      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>File Format Requirements</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1 text-sm mt-2">
            <li>Upload CSV or Excel (.xlsx) file</li>
            <li>
              <strong>Column A:</strong> Vehicle Registration (plate number)
            </li>
            <li>
              <strong>Column B:</strong> Certificate Status (Current/Expired)
            </li>
            <li>
              <strong>Column C:</strong> Certificate Issue Date (DD/MM/YYYY)
            </li>
            <li>First row is treated as header and skipped</li>
          </ul>
          <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-950/20 rounded text-xs">
            <strong>What This Updates:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>
                <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">self_contained</code> (true if
                status = "Current")
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">self_contained_expiry</code>{' '}
                (parsed from Issue Date)
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">nzscv_last_checked</code> (set
                to now)
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">nzscv_source</code> (set to
                "manual_import")
              </li>
            </ul>
          </div>
        </AlertDescription>
      </Alert>

      {/* Upload Section */}
      {!summary && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Certificate Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                disabled={isImporting}
              />
              {file && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {file && !isImporting && (
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

            {isImporting && progress && (
              <div className="space-y-4">
                {/* Progress Stats */}
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Processing NZSCV Certificates...
                    </div>
                    <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      {progress.current} of {progress.total} records
                      {progress.currentPlate && (
                        <span className="ml-2">• Current: {progress.currentPlate}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    {Math.round((progress.current / progress.total) * 100)}%
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300 ease-out"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress: {progress.current} / {progress.total}</span>
                    <span>{progress.total - progress.current} remaining</span>
                  </div>
                </div>

                {/* Recent Updates Feed */}
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results Section */}
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
            {/* Summary Stats */}
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

            {/* Detailed Results */}
            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Import Details
              </h4>
              <div className="border rounded-lg bg-white dark:bg-gray-900 p-3 max-h-96 overflow-y-auto">
                <div className="space-y-2 text-xs">
                  {summary.results.map((result, index) => (
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
                      {(result.old_expiry || result.new_expiry) && (
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          {result.old_expiry && (
                            <span>
                              Old Expiry: <strong>{result.old_expiry}</strong>
                            </span>
                          )}
                          {result.old_expiry && result.new_expiry && <span> → </span>}
                          {result.new_expiry && (
                            <span>
                              New Expiry: <strong>{result.new_expiry}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Success Message */}
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

            {/* Failed Records Warning */}
            {summary.failed > 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Some Records Failed</AlertTitle>
                <AlertDescription>
                  {summary.failed} record(s) could not be processed. Please review the detailed
                  results above and export the error report for further investigation.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Architecture Info */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <AlertTriangle className="h-4 w-4" />
            How NZSCV Data is Stored
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-blue-800 dark:text-blue-200">
          <div>
            <strong>Updates canonical_vehicles table:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
              <li>
                Plate numbers are normalized (uppercase, no spaces/special chars) before matching
              </li>
              <li>If vehicle exists, updates self-contained status and expiry date</li>
              <li>If vehicle doesn't exist, creates new canonical vehicle record</li>
              <li>Tracks last NZSCV check timestamp and data source</li>
              <li>All changes are logged in audit trail for compliance</li>
            </ul>
          </div>
          <div className="pt-2 border-t border-blue-300">
            <strong>Future NZSCV API Integration:</strong>
            <p className="mt-1 text-[11px]">
              This manual import process will be replaced with automatic API sync when NZSCV
              provides their API. The same table structure will be used, with{' '}
              <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">nzscv_source</code> set
              to "api" instead of "manual_import".
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

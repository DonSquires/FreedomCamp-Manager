/**
 * Vehicle Log Import - Simplified historical observation import
 * For files with only: Plate Number, Zone, Date
 * 
 * NOTE: Cannot directly access SharePoint URLs
 * User must download "vehicle Log" file from SharePoint and upload here:
 * https://wilsongroupau.sharepoint.com/sites/LakeDunstanFreedomCampingPatrols
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  MapPin,
  AlertCircle,
  Download,
  PlayCircle,
  RefreshCw,
  ExternalLink,
  Calendar,
  Car,
  Image as ImageIcon,
  Scissors,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface ImportSummary {
  total: number;
  successful: number;
  failed: number;
  zones_created: number;
  new_zones: string[];
}

const DOWNER_LINZ_ORG_NAME = 'Downer/LINZ';
const MAX_RECORDS_PER_FILE = 300; // Split files larger than this
const CHUNK_SIZE = 300; // Records per chunk

export function VehicleLogImport() {
  const { user } = useAuthStore();

  const [file, setFile] = useState<File | null>(null);
  const [downerLinzOrgId, setDownerLinzOrgId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importHistoryId, setImportHistoryId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorLog, setErrorLog] = useState<any[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  
  // File splitter state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fileRowCount, setFileRowCount] = useState<number>(0);
  const [showSplitOption, setShowSplitOption] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitFiles, setSplitFiles] = useState<{ name: string; blob: Blob; rowCount: number }[]>([]);

  // Find Downer/LINZ organization on component mount
  useState(() => {
    const findDownerLinzOrg = async () => {
      try {
        const { data: org, error } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('name', DOWNER_LINZ_ORG_NAME)
          .eq('is_active', true)
          .single();

        if (error) {
          console.error('Failed to find Downer/LINZ organization:', error);
          toast.error(`Organization "${DOWNER_LINZ_ORG_NAME}" not found. Please create it first.`);
          return;
        }

        setDownerLinzOrgId(org.id);
        console.log('✅ Found Downer/LINZ organization:', org.id);
      } catch (err: any) {
        console.error('Error finding organization:', err);
        toast.error('Failed to locate organization');
      }
    };

    findDownerLinzOrg();
  });

  // Analyze file size when selected
  const analyzeFile = async (selectedFile: File) => {
    setIsAnalyzing(true);
    try {
      // Dynamically load xlsx library
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs');
      
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      const rowCount = jsonData.length - 1; // Exclude header
      setFileRowCount(rowCount);
      
      if (rowCount > MAX_RECORDS_PER_FILE) {
        setShowSplitOption(true);
        toast.warning(
          `Large file detected: ${rowCount} records. Splitting into smaller files is recommended for better performance.`,
          { duration: 6000 }
        );
      } else {
        setShowSplitOption(false);
      }
    } catch (error: any) {
      console.error('Failed to analyze file:', error);
      toast.error('Failed to analyze file');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Split large file into chunks
  const splitFile = async () => {
    if (!file) return;
    
    setIsSplitting(true);
    try {
      // Dynamically load xlsx library
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs');
      
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      const header = jsonData[0];
      const dataRows = jsonData.slice(1);
      
      const chunks: { name: string; blob: Blob; rowCount: number }[] = [];
      const totalChunks = Math.ceil(dataRows.length / CHUNK_SIZE);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, dataRows.length);
        const chunkRows = dataRows.slice(start, end);
        
        // Create new workbook with header + chunk data
        const newWorkbook = XLSX.utils.book_new();
        const newWorksheet = XLSX.utils.aoa_to_sheet([header, ...chunkRows]);
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
        
        // Generate blob
        const wbout = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const originalName = file.name.replace('.xlsx', '');
        chunks.push({
          name: `${originalName}_part${i + 1}of${totalChunks}.xlsx`,
          blob,
          rowCount: chunkRows.length,
        });
      }
      
      setSplitFiles(chunks);
      toast.success(`File split into ${chunks.length} smaller files (${CHUNK_SIZE} records each)`);
    } catch (error: any) {
      console.error('Failed to split file:', error);
      toast.error('Failed to split file: ' + error.message);
    } finally {
      setIsSplitting(false);
    }
  };

  // Download split files
  const downloadSplitFiles = () => {
    splitFiles.forEach((chunk, index) => {
      setTimeout(() => {
        const url = URL.createObjectURL(chunk.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = chunk.name;
        a.click();
        URL.revokeObjectURL(url);
      }, index * 500); // Stagger downloads
    });
    
    toast.success(`Downloading ${splitFiles.length} files...`, {
      description: 'Import each file separately using the upload button above',
      duration: 8000,
    });
  };

  // Upload file to storage and trigger import
  const handleUploadAndImport = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    if (!downerLinzOrgId) {
      toast.error(`Organization "${DOWNER_LINZ_ORG_NAME}" not found. Please create it first.`);
      return;
    }

    setIsUploading(true);
    setIsImporting(true);
    setSummary(null);
    setErrorLog([]);
    setAiAnalysis(null);
    setProgress(0);

    try {
      // Upload file to storage
      const fileName = `imports/${user?.id}/${Date.now()}_${file.name}`;
      console.log('📤 Uploading vehicle log file to storage:', fileName);

      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error('❌ Upload failed:', uploadError);
        throw uploadError;
      }

      console.log('✅ File uploaded successfully');
      setIsUploading(false);

      // Call Edge Function to process import - auto-assigned to Downer/LINZ
      console.log('🔄 Calling import Edge Function for Downer/LINZ...');
      const { data, error } = await supabase.functions.invoke('import-historical-data', {
        body: { 
          file_path: fileName,
          organization_id: downerLinzOrgId // Auto-assign to Downer/LINZ
        },
      });

      if (error) {
        console.error('❌ Import function error:', error);
        
        let errorMessage = error.message || 'Import failed';
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = (error as any).context?.status ?? 500;
            const textContent = await (error as any).context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read error response';
          }
        }
        
        throw new Error(errorMessage);
      }

      console.log('✅ Import completed:', data);

      setImportHistoryId(data.import_history_id);
      setSummary(data.summary);
      setErrorLog(data.error_log || []);
      
      // Extract AI analysis from error_log if available
      if (data.error_log && Array.isArray(data.error_log) && data.error_log.length > 0) {
        const firstError = data.error_log[0];
        if (firstError.ai_analysis) {
          setAiAnalysis(firstError.ai_analysis);
        }
      }
      
      setProgress(100);

      toast.success(
        `Import complete! ${data.summary.successful}/${data.summary.total} successful, ${data.summary.zones_created} zones created`,
        { duration: 6000 }
      );

      // Clean up uploaded file from storage
      await supabase.storage.from('evidence').remove([fileName]);

    } catch (error: any) {
      console.error('❌ Import failed:', error);
      toast.error('Import failed: ' + error.message);
    } finally {
      setIsUploading(false);
      setIsImporting(false);
    }
  };

  // Reset for new import
  const handleReset = () => {
    setFile(null);
    setImportHistoryId(null);
    setSummary(null);
    setErrorLog([]);
    setAiAnalysis(null);
    setProgress(0);
  };

  // Export error report
  const exportErrorReport = () => {
    const csv = [
      ['Record ID', 'Plate', 'Zone', 'Error'],
      ...errorLog.map(e => [e.record_id, e.plate, e.zone, e.error]),
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle_log_errors_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Error report exported');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-primary" />
          Vehicle Log Import
        </h2>
        <p className="text-muted-foreground">
          Import historical observation data (plate, zone, date) to <strong>{DOWNER_LINZ_ORG_NAME}</strong>
        </p>
      </div>

      {/* SharePoint Link Notice */}
      <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
        <ExternalLink className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-900 dark:text-blue-100">
          ⚠️ Important: Download File from SharePoint First
        </AlertTitle>
        <AlertDescription className="text-blue-800 dark:text-blue-200 space-y-2">
          <p>
            This system <strong>cannot directly access SharePoint</strong>. Please follow these steps:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>
              Go to SharePoint:{' '}
              <a
                href="https://wilsongroupau.sharepoint.com/sites/LakeDunstanFreedomCampingPatrols"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold hover:text-blue-600"
              >
                Lake Dunstan Freedom Camping Patrols
              </a>
            </li>
            <li>Download the <strong>"vehicle Log"</strong> file (.xlsx)</li>
            <li>Upload the downloaded file below</li>
          </ol>
          <p className="text-xs mt-2 font-medium">
            All records will be automatically assigned to <strong>{DOWNER_LINZ_ORG_NAME}</strong> organization.
          </p>
        </AlertDescription>
      </Alert>

      {/* Upload Section */}
      {!summary && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Vehicle Log (.xlsx)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Expected File Format</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 text-sm mt-2">
                  <li>File must be <strong>.xlsx</strong> format</li>
                  <li><strong>Column A</strong>: ID (optional, can be blank)</li>
                  <li><strong>Column B</strong>: <strong>Zone/Location name</strong> (e.g., "Bendigo", "Lowburn")</li>
                  <li><strong>Column C</strong>: <strong>Recorded date</strong> (when vehicle was observed)</li>
                  <li><strong>Column D</strong>: <strong>Plate number</strong> (vehicle registration)</li>
                  <li>Column E: Notes (optional)</li>
                  <li>Column F: Attachments (optional, will be ignored)</li>
                </ul>
                <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-2">
                    <Calendar className="h-3 w-3" />
                    AI-Powered Date Detection
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                    System will automatically detect date format (dd/mm/yyyy, mm/dd/yyyy, Excel serial numbers) using AI analysis.
                  </p>
                </div>
                <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 flex items-center gap-2">
                    <MapPin className="h-3 w-3" />
                    Smart Zone Matching
                  </p>
                  <p className="text-xs text-blue-800 dark:text-blue-200 mt-1">
                    "Bendigo" matches "LINZ - Bendigo", "Lowburn" matches "LINZ - Lowburn", etc.
                    New zones will be created automatically if no match found.
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            {!downerLinzOrgId && (
              <Alert className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertTitle className="text-red-900 dark:text-red-100">
                  Organization Not Found
                </AlertTitle>
                <AlertDescription className="text-red-800 dark:text-red-200">
                  The <strong>"{DOWNER_LINZ_ORG_NAME}"</strong> organization does not exist in the system.
                  Please create it in Organization Management before importing.
                </AlertDescription>
              </Alert>
            )}

            {downerLinzOrgId && (
              <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-900 dark:text-green-100">
                  Organization Ready
                </AlertTitle>
                <AlertDescription className="text-green-800 dark:text-green-200">
                  All imported records will be assigned to <strong>{DOWNER_LINZ_ORG_NAME}</strong> organization.
                </AlertDescription>
              </Alert>
            )}

            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <label
                htmlFor="file-upload"
                className="cursor-pointer text-primary hover:underline font-medium"
              >
                Click to upload vehicle log .xlsx file
              </label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const uploadedFile = e.target.files?.[0];
                  if (uploadedFile) {
                    if (!uploadedFile.name.endsWith('.xlsx')) {
                      toast.error('Please upload an .xlsx file');
                      return;
                    }
                    setFile(uploadedFile);
                    setShowSplitOption(false);
                    setSplitFiles([]);
                    analyzeFile(uploadedFile);
                  }
                }}
                className="hidden"
                disabled={isUploading || isImporting || !downerLinzOrgId}
              />
              {file && (
                <div className="mt-4 space-y-3">
                  <div className="p-3 bg-muted/50 rounded border">
                    <p className="text-sm font-medium flex items-center justify-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-primary" />
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Size: {(file.size / 1024).toFixed(2)} KB
                    </p>
                    {isAnalyzing && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Analyzing file size...
                      </div>
                    )}
                    {!isAnalyzing && fileRowCount > 0 && (
                      <p className="text-xs font-semibold mt-2">
                        📊 {fileRowCount.toLocaleString()} records detected
                      </p>
                    )}
                  </div>

                  {showSplitOption && splitFiles.length === 0 && (
                    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                      <Scissors className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-900 dark:text-amber-100">
                        Large File Detected
                      </AlertTitle>
                      <AlertDescription className="text-amber-800 dark:text-amber-200">
                        <p className="mb-3">
                          Your file has <strong>{fileRowCount.toLocaleString()} records</strong>. 
                          For better performance and reliability, we recommend splitting it into 
                          smaller files.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={splitFile}
                          disabled={isSplitting}
                          className="w-full bg-amber-100 hover:bg-amber-200 border-amber-400"
                        >
                          {isSplitting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Splitting file...
                            </>
                          ) : (
                            <>
                              <Scissors className="h-4 w-4 mr-2" />
                              Split into {Math.ceil(fileRowCount / CHUNK_SIZE)} files (~{CHUNK_SIZE} records each)
                            </>
                          )}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {splitFiles.length > 0 && (
                    <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                      <Package className="h-4 w-4 text-green-600" />
                      <AlertTitle className="text-green-900 dark:text-green-100">
                        ✅ File Split Complete!
                      </AlertTitle>
                      <AlertDescription className="text-green-800 dark:text-green-200 space-y-3">
                        <p>
                          Your file has been split into <strong>{splitFiles.length} smaller files</strong>:
                        </p>
                        <div className="space-y-1 text-xs">
                          {splitFiles.map((chunk, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <FileSpreadsheet className="h-3 w-3" />
                              <span>{chunk.name}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {chunk.rowCount} records
                              </Badge>
                            </div>
                          ))}
                        </div>
                        <div className="pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={downloadSplitFiles}
                            className="w-full bg-green-100 hover:bg-green-200 border-green-400"
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download All {splitFiles.length} Files
                          </Button>
                        </div>
                        <p className="text-xs font-semibold pt-2 border-t border-green-300">
                          📝 Next Steps:
                        </p>
                        <ol className="text-xs list-decimal list-inside space-y-1">
                          <li>Download all files using the button above</li>
                          <li>Upload and import each file one by one</li>
                          <li>System will process them efficiently (no timeouts!)</li>
                        </ol>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>

            {file && !isImporting && (
              <div className="flex gap-2">
                <Button
                  onClick={handleUploadAndImport}
                  className="flex-1 gap-2"
                  disabled={isUploading || isImporting || !downerLinzOrgId}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-4 w-4" />
                      Start Import to {DOWNER_LINZ_ORG_NAME}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setFile(null)}
                  disabled={isUploading || isImporting}
                >
                  Cancel
                </Button>
              </div>
            )}

            {isImporting && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  <div>
                    <div className="font-medium text-blue-900 dark:text-blue-100">
                      {isUploading ? 'Uploading file...' : 'Processing vehicle log...'}
                    </div>
                    <div className="text-xs text-blue-600 dark:text-blue-400">
                      {isUploading 
                        ? 'Uploading to storage...' 
                        : 'Server is parsing Excel, analyzing dates with AI, matching zones, and importing observations...'}
                    </div>
                  </div>
                </div>
                {!isUploading && (
                  <div>
                    <Progress value={progress} className="h-3" />
                    <div className="text-xs text-muted-foreground mt-1 text-center">
                      Processing on server... Please wait
                    </div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Import Another File
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI Analysis Summary */}
            {aiAnalysis && (
              <Alert className="border-purple-500/50 bg-purple-50 dark:bg-purple-950/20">
                <AlertCircle className="h-4 w-4 text-purple-600" />
                <AlertTitle className="text-purple-900 dark:text-purple-100">
                  🤖 AI Document Analysis
                </AlertTitle>
                <AlertDescription className="text-purple-800 dark:text-purple-200 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <strong>Date Format:</strong> {aiAnalysis.dateFormat}
                    </div>
                    <div>
                      <strong>Confidence:</strong> {(aiAnalysis.dateFormatConfidence * 100).toFixed(0)}%
                    </div>
                    <div>
                      <strong>Date Range:</strong> {aiAnalysis.earliestDate} to {aiAnalysis.latestDate}
                    </div>
                    <div>
                      <strong>Rows Analyzed:</strong> {aiAnalysis.totalRowsAnalyzed}
                    </div>
                  </div>
                  {aiAnalysis.dataQualityIssues && aiAnalysis.dataQualityIssues.length > 0 && (
                    <div className="text-xs mt-2">
                      <strong>Issues:</strong> {aiAnalysis.dataQualityIssues.join(', ')}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold">{summary.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-green-600">{summary.successful}</div>
                <div className="text-xs text-muted-foreground">Success</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-amber-600">{summary.zones_created}</div>
                <div className="text-xs text-muted-foreground">Zones Created</div>
              </div>
              <div className="text-center p-3 bg-white dark:bg-gray-900 rounded">
                <div className="text-2xl font-bold text-green-600">
                  {Math.round((summary.successful / summary.total) * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">Success Rate</div>
              </div>
            </div>

            {/* New Zones Created */}
            {summary.zones_created > 0 && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-900 dark:text-amber-100">
                  Admin Action Required
                </AlertTitle>
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  {summary.zones_created} new zone(s) were created and assigned to {DOWNER_LINZ_ORG_NAME}:
                  <div className="flex flex-wrap gap-1 mt-2">
                    {summary.new_zones.map(zone => (
                      <Badge key={zone} variant="outline" className="bg-amber-100 text-amber-800 border-amber-400">
                        <MapPin className="h-3 w-3 mr-1" />
                        {zone}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs">
                    Please review and configure these zones in Zone Management (set compliance rules, boundaries, etc.)
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Error Report */}
            {summary.failed > 0 && errorLog.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-red-900 dark:text-red-100 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Import Errors ({summary.failed})
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportErrorReport}
                    className="gap-1"
                  >
                    <Download className="h-3 w-3" />
                    Download Error Report
                  </Button>
                </div>
                <div className="border rounded-lg bg-white dark:bg-gray-900 p-3 max-h-64 overflow-y-auto">
                  <div className="space-y-2 text-xs">
                    {errorLog.slice(0, 10).map((error, index) => (
                      <div key={index} className="p-2 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-800">
                        <div className="font-semibold text-red-900 dark:text-red-100">
                          Record #{error.record_id} - {error.plate}
                        </div>
                        <div className="text-red-700 dark:text-red-300">
                          Zone: {error.zone}
                        </div>
                        <div className="text-red-600 dark:text-red-400 mt-1">
                          Error: {error.error}
                        </div>
                      </div>
                    ))}
                    {errorLog.length > 10 && (
                      <p className="text-center text-muted-foreground">
                        ... and {errorLog.length - 10} more errors (download full report)
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Success Message */}
            {summary.failed === 0 && (
              <Alert className="border-green-500/50 bg-green-100 dark:bg-green-950/30">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-900 dark:text-green-100">
                  Perfect Import!
                </AlertTitle>
                <AlertDescription className="text-green-800 dark:text-green-200">
                  All {summary.total} records were imported successfully to <strong>{DOWNER_LINZ_ORG_NAME}</strong> with no errors.
                  {summary.zones_created > 0 && (
                    <> {summary.zones_created} new zones were created automatically.</>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <AlertCircle className="h-4 w-4" />
            What This Does
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-blue-800 dark:text-blue-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold mb-1 flex items-center gap-2">
                <Car className="h-3 w-3" />
                Processing Steps:
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>Uploads .xlsx file to secure storage</li>
                <li>AI analyzes date format (dd/mm/yyyy, Excel serial, etc.)</li>
                <li>Server-side Excel parsing</li>
                <li>Smart zone matching with fuzzy logic</li>
                <li>Creates new zones if needed</li>
                <li>Bulk imports observations</li>
                <li>Auto-assigns to {DOWNER_LINZ_ORG_NAME}</li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-1 flex items-center gap-2">
                <ImageIcon className="h-3 w-3" />
                Photo Handling:
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li><strong>Photos in SharePoint:</strong> Cannot be auto-imported</li>
                <li>Download photos manually from SharePoint</li>
                <li>Upload to observations after import</li>
                <li>Photos linked via observation edit interface</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

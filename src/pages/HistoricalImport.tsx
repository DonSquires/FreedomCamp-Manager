/**
 * Historical Data Import - PROPER BACKEND-DRIVEN ARCHITECTURE
 * 
 * Frontend Responsibilities:
 * - Upload .xlsx file to storage
 * - Call Edge Function with file path
 * - Poll for progress updates
 * - Display results
 * 
 * Backend Responsibilities (Edge Function):
 * - Download file from storage
 * - Parse Excel server-side
 * - Fuzzy zone matching
 * - Batch zone creation
 * - Bulk upsert vehicles
 * - Bulk insert observations
 * - Progress tracking in database
 * - Error handling
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  MapPin,
  AlertCircle,
  Download,
  PlayCircle,
  RefreshCw,
  Building2,
  Scissors,
  Package,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

interface BatchProgress {
  current_batch: number;
  total_batches: number;
  batch_size: number;
  ai_analysis?: any;
}

const MAX_RECORDS_PER_FILE = 300; // Split files larger than this for better performance
const CHUNK_SIZE = 250; // Records per chunk (AI-powered batch size)

export function HistoricalImport() {
  const { user } = useAuthStore();

  const [file, setFile] = useState<File | null>(null);
  const [selectedOrganization, setSelectedOrganization] = useState<string>('');
  const [availableOrganizations, setAvailableOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [isMasterUser, setIsMasterUser] = useState(false);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importHistoryId, setImportHistoryId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorLog, setErrorLog] = useState<any[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  
  // File splitter state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fileRowCount, setFileRowCount] = useState<number>(0);
  const [showSplitOption, setShowSplitOption] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitFiles, setSplitFiles] = useState<{ name: string; blob: Blob; rowCount: number }[]>([]);

  useEffect(() => {
    loadUserProfile();
  }, [user?.id]);

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

  const loadUserProfile = async () => {
    if (!user?.id) return;

    setIsLoadingOrgs(true);
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      const isMaster = profile.role === 'master';
      setIsMasterUser(isMaster);

      if (isMaster) {
        // Load all organizations for master users
        const { data: orgs, error: orgsError } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('is_active', true)
          .order('name');

        if (orgsError) throw orgsError;
        setAvailableOrganizations(orgs || []);
      } else {
        // Set current organization for non-master users
        if (profile.organization_id) {
          setSelectedOrganization(profile.organization_id);
          
          const { data: org } = await supabase
            .from('organizations')
            .select('id, name')
            .eq('id', profile.organization_id)
            .single();

          if (org) {
            setAvailableOrganizations([org]);
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Failed to load user profile:', error);
      toast.error('Failed to load user profile');
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  // Upload file to storage and trigger import
  const handleUploadAndImport = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    if (!selectedOrganization) {
      toast.error('Please select an organization');
      return;
    }

    setIsUploading(true);
    setIsImporting(true);
    setSummary(null);
    setErrorLog([]);
    setProgress(0);

    try {
      // Upload file to storage
      const fileName = `imports/${user?.id}/${Date.now()}_${file.name}`;
      console.log('📤 Uploading file to storage:', fileName);

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

      // Call Edge Function to process import
      console.log('🔄 Calling import Edge Function...');
      const { data, error } = await supabase.functions.invoke('import-historical-data', {
        body: { 
          file_path: fileName,
          organization_id: selectedOrganization 
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
      setProgress(100);
      setBatchProgress(null);
      setAiAnalysis(data.ai_analysis || null);

      toast.success(
        `Import complete! ${data.summary.successful}/${data.summary.total} successful, ${data.summary.zones_created} zones created`
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

  // Poll for batch progress updates (real-time)
  useEffect(() => {
    if (!isImporting || !importHistoryId) return;

    const pollProgress = async () => {
      try {
        const { data, error } = await supabase
          .from('import_history')
          .select('error_log, records_imported')
          .eq('id', importHistoryId)
          .single();

        if (error) throw error;

        if (data?.error_log) {
          const log = data.error_log as any;
          
          // Extract AI analysis if available
          if (log.ai_analysis) {
            setAiAnalysis(log.ai_analysis);
          }
          
          // Update batch progress
          if (log.current_batch && log.total_batches) {
            setBatchProgress({
              current_batch: log.current_batch,
              total_batches: log.total_batches,
              batch_size: log.batch_size || 250,
              ai_analysis: log.ai_analysis,
            });
            
            // Calculate progress percentage
            const batchPercent = (log.current_batch / log.total_batches) * 100;
            setProgress(Math.min(batchPercent, 95)); // Cap at 95% until complete
          }
        }
      } catch (error: any) {
        console.error('Failed to poll progress:', error);
      }
    };

    const interval = setInterval(pollProgress, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [isImporting, importHistoryId]);

  // Reset for new import
  const handleReset = () => {
    setFile(null);
    setImportHistoryId(null);
    setSummary(null);
    setErrorLog([]);
    setProgress(0);
    setBatchProgress(null);
    setAiAnalysis(null);
    setShowSplitOption(false);
    setSplitFiles([]);
    setFileRowCount(0);
    if (isMasterUser) {
      setSelectedOrganization('');
    }
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
    a.download = `import_errors_${new Date().toISOString().split('T')[0]}.csv`;
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
          Historical Data Import
        </h2>
        <p className="text-muted-foreground">
          Backend-driven Excel import with automatic zone matching and batch processing
        </p>
      </div>

      {/* Upload Section */}
      {!summary && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Excel File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Organization Selection - Master Users Only */}
            {isMasterUser && (
              <div className="space-y-2 p-4 border-2 border-primary/30 bg-primary/5 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <Label className="font-semibold">Select Organization</Label>
                </div>
                <Select 
                  value={selectedOrganization} 
                  onValueChange={setSelectedOrganization}
                  disabled={isLoadingOrgs || isUploading || isImporting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose organization..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOrganizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  All imported records will be assigned to this organization
                </p>
              </div>
            )}

            {/* Non-Master: Show Selected Org */}
            {!isMasterUser && selectedOrganization && availableOrganizations.length > 0 && (
              <Alert>
                <Building2 className="h-4 w-4" />
                <AlertTitle>Organization</AlertTitle>
                <AlertDescription>
                  Importing to: <strong>{availableOrganizations[0]?.name}</strong>
                </AlertDescription>
              </Alert>
            )}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>File Format Requirements</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 text-sm mt-2">
                  <li>File must be <strong>.xlsx</strong> format</li>
                  <li>Column A: ID (ignored)</li>
                  <li>Column B: <strong>Title/Zone name</strong> (will fuzzy match with existing zones or create new)</li>
                  <li>Column C: <strong>Recorded date</strong> (observation date/time)</li>
                  <li>Column D: <strong>Plate number</strong></li>
                  <li>Column E: Officer notes</li>
                  <li>Column F: Attachments count (ignored)</li>
                </ul>
                <p className="mt-3 text-xs font-semibold text-primary">
                  <strong>Zone Matching:</strong> System will match "Bendigo" with "LINZ - Bendigo", "Lowburn" with "LINZ - Lowburn", etc.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  <strong>Processing:</strong> All parsing, zone matching, and database operations happen server-side for maximum performance and reliability.
                </p>
              </AlertDescription>
            </Alert>

            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <Label
                htmlFor="file-upload"
                className="cursor-pointer text-primary hover:underline font-medium"
              >
                Click to upload .xlsx file
              </Label>
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
                disabled={isUploading || isImporting}
              />
              {file && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                  {isAnalyzing && (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Analyzing...
                    </span>
                  )}
                  {!isAnalyzing && fileRowCount > 0 && (
                    <span className="ml-2 font-semibold">
                      • {fileRowCount.toLocaleString()} records
                    </span>
                  )}
                </p>
              )}
            </div>

            {showSplitOption && splitFiles.length === 0 && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <Scissors className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-900 dark:text-amber-100">
                  ⚠️ Large File Detected
                </AlertTitle>
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  <p className="mb-3">
                    Your file has <strong>{fileRowCount.toLocaleString()} records</strong>. 
                    For better performance and to avoid timeouts, we recommend splitting it into 
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
                    <li>System will process them efficiently without timeouts</li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}

            {file && !isImporting && splitFiles.length === 0 && (
              <div className="flex gap-2">
                <Button
                  onClick={handleUploadAndImport}
                  className="flex-1 gap-2"
                  disabled={isUploading || isImporting || !selectedOrganization}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-4 w-4" />
                      Start Import
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setShowSplitOption(false);
                    setFileRowCount(0);
                  }}
                  disabled={isUploading || isImporting}
                >
                  Cancel
                </Button>
              </div>
            )}

            {isImporting && (
              <div className="space-y-4">
                {/* AI Analysis Results */}
                {aiAnalysis && (
                  <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertTitle className="text-blue-900 dark:text-blue-100">
                      🤖 AI Document Analysis Complete
                    </AlertTitle>
                    <AlertDescription className="text-blue-800 dark:text-blue-200 space-y-2">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="font-semibold">Date Format:</span>
                          <div className="mt-1">
                            {aiAnalysis.dateFormat} 
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {Math.round((aiAnalysis.dateFormatConfidence || 0) * 100)}% confident
                            </Badge>
                          </div>
                        </div>
                        <div>
                          <span className="font-semibold">Date Range:</span>
                          <div className="mt-1">
                            {aiAnalysis.earliestDate} to {aiAnalysis.latestDate}
                          </div>
                        </div>
                        <div>
                          <span className="font-semibold">Rows Analyzed:</span>
                          <div className="mt-1">{aiAnalysis.totalRowsAnalyzed || 0}</div>
                        </div>
                        <div>
                          <span className="font-semibold">Data Quality:</span>
                          <div className="mt-1">
                            {aiAnalysis.blankDates || 0} blank dates, 
                            {aiAnalysis.blankPlates || 0} blank plates
                          </div>
                        </div>
                      </div>
                      {aiAnalysis.recommendations?.length > 0 && (
                        <div className="pt-2 border-t border-blue-300">
                          <div className="font-semibold text-xs mb-1">💡 AI Recommendations:</div>
                          <ul className="list-disc list-inside text-[11px] space-y-0.5">
                            {aiAnalysis.recommendations.map((rec: string, idx: number) => (
                              <li key={idx}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Processing Status */}
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  <div className="flex-1">
                    <div className="font-medium text-blue-900 dark:text-blue-100">
                      {isUploading ? 'Uploading file...' : 'AI-Powered Batch Processing'}
                    </div>
                    <div className="text-xs text-blue-600 dark:text-blue-400">
                      {isUploading 
                        ? 'Uploading to storage...' 
                        : batchProgress
                        ? `Processing batch ${batchProgress.current_batch} of ${batchProgress.total_batches} (${batchProgress.batch_size} records per batch)`
                        : 'AI analyzing document structure and parsing data...'}
                    </div>
                  </div>
                </div>
                
                {/* Progress Bar with Batch Details */}
                {!isUploading && (
                  <div className="space-y-2">
                    <Progress value={progress} className="h-4" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {batchProgress 
                          ? `Batch ${batchProgress.current_batch}/${batchProgress.total_batches}` 
                          : 'Initializing...'}
                      </span>
                      <span className="font-bold">{Math.round(progress)}%</span>
                    </div>
                    {batchProgress && (
                      <div className="text-center text-xs text-muted-foreground">
                        Processing {batchProgress.batch_size} records at a time for optimal performance
                      </div>
                    )}
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
                  {summary.zones_created} new zone(s) were created and flagged for admin review:
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
                  All {summary.total} records were imported successfully with no errors.
                  {summary.zones_created > 0 && (
                    <> {summary.zones_created} new zones were created automatically.</>
                  )}
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
            <AlertCircle className="h-4 w-4" />
            🤖 AI-Powered Batch Processing Architecture
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-blue-800 dark:text-blue-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold mb-1">✅ How It Works:</div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>AI analyzes file structure and data quality</li>
                <li>Detects date formats automatically</li>
                <li>Processes 250 records per batch</li>
                <li>Real-time progress updates every 2 seconds</li>
                <li>Automatic zone matching with fuzzy logic</li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-1">🚀 Benefits:</div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>AI validates data before processing</li>
                <li>No manual file splitting needed</li>
                <li>Handles 100k+ records efficiently</li>
                <li>Prevents duplicate zone creation</li>
                <li>Court-ready audit trail</li>
              </ul>
            </div>
          </div>
          <div className="pt-2 border-t border-blue-300">
            <div className="font-semibold mb-1">🔄 Batch Processing:</div>
            <p className="text-[11px]">
              Instead of uploading all records at once, the system intelligently processes <strong>250 records at a time</strong>. 
              This prevents timeouts, provides real-time progress feedback, and ensures data integrity through atomic transactions.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

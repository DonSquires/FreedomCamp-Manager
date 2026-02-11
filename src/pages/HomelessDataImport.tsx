import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function HomelessDataImport() {
  const [rawData, setRawData] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleProcessData = async () => {
    if (!rawData.trim()) {
      toast.error('Please paste the homeless status data');
      return;
    }

    setIsProcessing(true);
    setResults(null);

    try {
      // Parse the raw data into structured format
      // Supports multiple formats: pipe-separated (|), tab-separated (\t), or space-separated
      const lines = rawData.split('\n').filter(line => line.trim());
      
      // Detect separator: check first data line
      let separator = '|';
      const firstDataLine = lines.find(line => !line.toLowerCase().includes('last known site') && line.trim());
      
      if (firstDataLine) {
        if (firstDataLine.includes('|')) {
          separator = '|';
        } else if (firstDataLine.includes('\t')) {
          separator = '\t';
        } else {
          // Space-separated: use regex to split by 2+ spaces
          separator = 'space';
        }
      }

      console.log('📋 Detected separator:', separator === 'space' ? 'multiple spaces' : separator);

      // Filter out header lines
      const dataLines = lines.filter(line => {
        const lower = line.toLowerCase();
        return !lower.includes('last known site') && 
               !lower.includes('vehicle description') &&
               line.trim().length > 0;
      });

      const tableData = dataLines.map((line, index) => {
        let cells: string[];
        
        if (separator === 'space') {
          // Split by 2+ spaces or tabs
          cells = line.split(/\s{2,}|\t/).map(cell => cell.trim()).filter(cell => cell);
        } else {
          cells = line.split(separator).map(cell => cell.trim()).filter(cell => cell);
        }
        
        console.log(`Row ${index + 1}: ${cells.length} cells:`, cells);
        
        // Flexible mapping - handle different column counts
        if (cells.length >= 4) {
          return {
            last_known_site: cells[0] || '',
            date: cells[1] || '',
            vehicle_description: cells[2] || '',
            rego: cells[3] || '',
            name_contact: cells[4] || '',
            confirmed_homeless: cells[5] || cells[cells.length - 1] || '', // Last column if 5 doesn't exist
          };
        }
        return null;
      }).filter(row => row !== null);

      console.log('📊 Parsed', tableData.length, 'rows from input');

      if (tableData.length === 0) {
        toast.error('No valid data found. Please check the format.');
        return;
      }

      toast.info(`🤖 Processing ${tableData.length} records with AI...`);

      // Call edge function to process with AI
      const { data, error } = await supabase.functions.invoke('process-homeless-data', {
        body: { data: tableData },
      });

      if (error) throw error;

      setResults(data.results);
      
      toast.success(
        `✅ Success! Matched ${data.results.matched} vehicles, updated ${data.results.updated} records.`
      );

    } catch (error: any) {
      console.error('Processing failed:', error);
      toast.error('Failed to process data: ' + (error.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const sampleData = `Last Known Site  Date        Vehicle Description    Rego    Name & Contact  Confirmed Homeless
Saxton Carpark   2026-01-15  Mazda sleeper van      O1761   Joseph          Yes
Kinzet Terrace   2025-11-19  Brown House Bus        DRD906  David H         Yes
Tahunanui Beach  2025-10-30  White Van              CWB872  -               No

OR pipe-separated format:
| Last Known Site | Date | Vehicle Description | Rego | Name & Contact | Confirmed Homeless |
| Saxton Carpark | 2026-01-15 | Mazda sleeper van | O1761 | Joseph | Yes |`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Homeless Status Data Import</h2>
        <p className="text-muted-foreground">
          Use AI to automatically match plate numbers and update homeless status
        </p>
      </div>

      {/* Instructions */}
      <Card className="border-blue-500/50 bg-blue-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            How to Use
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm space-y-2 list-decimal list-inside">
            <li>Copy the entire homeless status table from Excel/Google Sheets (including headers)</li>
            <li>Paste it into the text area below</li>
            <li>Click "Process with AI"</li>
            <li>AI will automatically:
              <ul className="ml-6 mt-1 space-y-1 list-disc list-inside text-xs text-muted-foreground">
                <li>Auto-detect format (tab, space, or pipe-separated)</li>
                <li>Extract and normalize plate numbers</li>
                <li>Match them with existing vehicle records</li>
                <li>Update homeless status (claimed/confirmed)</li>
                <li>Detect aggressive/abusive behavior and create safety flags</li>
                <li>Handle messy data, typos, and missing values</li>
              </ul>
            </li>
          </ol>
          
          <div className="mt-4 p-3 bg-muted/50 rounded text-xs space-y-1">
            <p className="font-semibold">Example format:</p>
            <pre className="text-[10px] overflow-x-auto">{sampleData}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Input Area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paste Table Data</CardTitle>
          <CardDescription>
            Copy and paste the entire table including headers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            placeholder="Paste table data here..."
            rows={15}
            className="font-mono text-xs"
          />

          <div className="flex items-center gap-3">
            <Button
              onClick={handleProcessData}
              disabled={isProcessing || !rawData.trim()}
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing with AI...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Process with AI
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRawData('');
                setResults(null);
              }}
              disabled={isProcessing}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Processing Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-500">{results.processed}</p>
                <p className="text-xs text-muted-foreground mt-1">Processed</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-green-500">{results.matched}</p>
                <p className="text-xs text-muted-foreground mt-1">Matched</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-primary">{results.updated}</p>
                <p className="text-xs text-muted-foreground mt-1">Updated</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-amber-500">{results.skipped}</p>
                <p className="text-xs text-muted-foreground mt-1">Skipped</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-red-500">{results.errors.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Errors</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-orange-500">{results.flagged_vehicles || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Safety Flags</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-purple-500">{results.incidents_created || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">H&S Incidents</p>
              </div>
            </div>

            {results.errors.length > 0 && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded">
                <p className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Errors ({results.errors.length})
                </p>
                <ul className="text-xs space-y-1 text-red-600">
                  {results.errors.map((error: string, i: number) => (
                    <li key={i}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Safety Concerns Summary */}
            {(results.flagged_vehicles > 0 || results.incidents_created > 0) && (
              <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded">
                <p className="text-sm font-semibold text-orange-600 mb-2 flex items-center gap-2">
                  ⚠️ Safety Concerns Detected
                </p>
                <ul className="text-xs space-y-1 text-orange-600">
                  {results.flagged_vehicles > 0 && (
                    <li>• {results.flagged_vehicles} vehicle{results.flagged_vehicles === 1 ? '' : 's'} flagged for officer caution</li>
                  )}
                  {results.incidents_created > 0 && (
                    <li>• {results.incidents_created} H&S incident{results.incidents_created === 1 ? '' : 's'} created for aggressive/abusive behavior</li>
                  )}
                </ul>
                <p className="text-xs text-muted-foreground mt-2">
                  📋 Review in: Flagged Vehicles & Incidents pages
                </p>
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
              <p className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-blue-600" />
                <span className="text-blue-600 font-medium">
                  Check the Vehicle Management, Homeless Claims Review, Flagged Vehicles, and Incidents pages to verify the updates.
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                <Badge variant="outline" className="mr-2 bg-green-500/10 text-green-500">Yes</Badge>
                in source data
              </span>
              <span className="text-xs">
                → <Badge variant="outline" className="bg-green-500/10 text-green-500">Confirmed Homeless</Badge>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                <Badge variant="outline" className="mr-2 bg-red-500/10 text-red-500">No</Badge>
                in source data
              </span>
              <span className="text-xs">
                → <Badge variant="outline" className="bg-red-500/10 text-red-500">Not Homeless</Badge>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                <Badge variant="outline" className="mr-2 bg-amber-500/10 text-amber-500">Possibly / ?</Badge>
                in source data
              </span>
              <span className="text-xs">
                → <Badge variant="outline" className="bg-amber-500/10 text-amber-500">Pending Review</Badge>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

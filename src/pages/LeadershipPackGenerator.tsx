/**
 * LeadershipPackGenerator - Generate analytics PDFs with drift trends
 * Exports comprehensive leadership reports with charts and compliance trends
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export function LeadershipPackGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportType, setReportType] = useState('comprehensive');
  const [dateRange, setDateRange] = useState('30days');
  
  // Report sections
  const [includeCompliance, setIncludeCompliance] = useState(true);
  const [includeDrift, setIncludeDrift] = useState(true);
  const [includeIncidents, setIncludeIncidents] = useState(true);
  const [includeVehicles, setIncludeVehicles] = useState(true);
  const [includeZones, setIncludeZones] = useState(true);
  const [includeOfficers, setIncludeOfficers] = useState(false);

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      console.log('📊 Generating leadership pack...');
      toast.loading('Generating leadership pack PDF...');

      // Call Edge Function to generate HTML
      const { data, error } = await supabase.functions.invoke('generate-leadership-pack', {
        body: {
          reportType,
          dateRange,
          sections: {
            compliance: includeCompliance,
            drift: includeDrift,
            incidents: includeIncidents,
            vehicles: includeVehicles,
            zones: includeZones,
            officers: includeOfficers,
          },
        },
      });

      if (error) throw error;

      // The Edge Function returns HTML, not a PDF URL
      // We need to convert HTML to PDF client-side or open in new tab for printing
      if (data?.html) {
        // Open HTML in new window for printing to PDF
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(data.html);
          printWindow.document.close();
          
          // Wait for content to load then trigger print dialog
          printWindow.onload = () => {
            printWindow.focus();
            setTimeout(() => {
              printWindow.print();
            }, 250);
          };
          
          toast.success('Leadership pack opened in new tab - use browser print to save as PDF');
        } else {
          // Fallback: Download as HTML if popup blocked
          const blob = new Blob([data.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `leadership-pack-${Date.now()}.html`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          
          toast.success('Leadership pack downloaded as HTML - open in browser and print to PDF');
        }
      } else {
        throw new Error('No HTML content returned from server');
      }

    } catch (error: any) {
      console.error('Failed to generate leadership pack:', error);
      toast.error('Failed to generate report: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
          <FileText className="h-8 w-8 text-blue-600" />
          Leadership Pack Generator
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Generate comprehensive analytics PDFs with charts and drift trends
        </p>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">Report Configuration</CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-300">
            Customize the content and scope of your leadership report
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Report Type */}
          <div>
            <Label htmlFor="report-type" className="text-gray-900 dark:text-white">Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger id="report-type" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comprehensive">
                  Comprehensive (All Sections)
                </SelectItem>
                <SelectItem value="executive">
                  Executive Summary
                </SelectItem>
                <SelectItem value="compliance">
                  Compliance Focus
                </SelectItem>
                <SelectItem value="drift">
                  Drift Analysis
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div>
            <Label htmlFor="date-range" className="text-gray-900 dark:text-white">Date Range</Label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="date-range" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="90days">Last 90 Days</SelectItem>
                <SelectItem value="6months">Last 6 Months</SelectItem>
                <SelectItem value="1year">Last Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sections */}
          <div>
            <Label className="mb-3 block text-gray-900 dark:text-white">Include Sections</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="compliance"
                  checked={includeCompliance}
                  onCheckedChange={(checked) => setIncludeCompliance(checked as boolean)}
                />
                <label
                  htmlFor="compliance"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Compliance Trends & Charts
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="drift"
                  checked={includeDrift}
                  onCheckedChange={(checked) => setIncludeDrift(checked as boolean)}
                />
                <label
                  htmlFor="drift"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Drift Detection & Matrix Changes
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="incidents"
                  checked={includeIncidents}
                  onCheckedChange={(checked) => setIncludeIncidents(checked as boolean)}
                />
                <label
                  htmlFor="incidents"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Incident Reports & Enforcement
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="vehicles"
                  checked={includeVehicles}
                  onCheckedChange={(checked) => setIncludeVehicles(checked as boolean)}
                />
                <label
                  htmlFor="vehicles"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Vehicle Analytics & Flagged Vehicles
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="zones"
                  checked={includeZones}
                  onCheckedChange={(checked) => setIncludeZones(checked as boolean)}
                />
                <label
                  htmlFor="zones"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Zone Performance Comparison
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="officers"
                  checked={includeOfficers}
                  onCheckedChange={(checked) => setIncludeOfficers(checked as boolean)}
                />
                <label
                  htmlFor="officers"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900 dark:text-white cursor-pointer"
                >
                  Officer Activity Statistics
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Features Overview */}
      <Card className="border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Report Features
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-gray-900 dark:text-gray-100">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-gray-900 dark:text-gray-100">Executive summary with key metrics and trends</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-gray-900 dark:text-gray-100">Compliance rate charts with historical comparison</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-gray-900 dark:text-gray-100">Drift events timeline and matrix change audit</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-gray-900 dark:text-gray-100">Zone-by-zone performance breakdown</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-gray-900 dark:text-gray-100">Privacy-compliant (no PII in leadership reports)</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Generate Button */}
      <div className="flex gap-3">
        <Button
          onClick={generatePDF}
          disabled={isGenerating}
          className="flex-1 h-14 text-lg font-bold"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Generating PDF...
            </>
          ) : (
            <>
              <Download className="h-5 w-5 mr-2" />
              Generate Leadership Pack
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * ProductOverviewDocument - Marketing/Sales Overview Page
 * 
 * Displays the comprehensive product overview document with:
 * - Executive summary and key features
 * - Sample vehicle records and analytics
 * - Pricing tiers and contact information
 * - Export to PDF functionality
 * 
 * MASTER ONLY ACCESS
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FileText,
  Download,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

export function ProductOverviewDocument() {
  const [isLoading, setIsLoading] = useState(false);

  const handleExportPDF = () => {
    setIsLoading(true);
    toast.info('Opening print dialog...');
    
    // Open the document in a new window for printing/PDF export
    const newWindow = window.open('/marketing/product-overview.html', '_blank');
    
    if (newWindow) {
      // Wait for document to load, then trigger print
      newWindow.addEventListener('load', () => {
        setTimeout(() => {
          newWindow.print();
          setIsLoading(false);
        }, 500);
      });
    } else {
      toast.error('Please allow popups to export PDF');
      setIsLoading(false);
    }
  };

  const handleOpenFullPage = () => {
    window.open('/marketing/product-overview.html', '_blank');
  };

  const handleRefresh = () => {
    const iframe = document.getElementById('product-overview-iframe') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
      toast.success('Document refreshed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
          <FileText className="h-8 w-8 text-blue-600" />
          Product Overview Document
        </h1>
        <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
          Comprehensive marketing overview for sales presentations and client demos
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
        <CheckCircle2 className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900 dark:text-blue-100">
          <strong>Master Only Access</strong> - This document contains sample data and pricing information for 
          sales and marketing purposes. Use the Export to PDF button to save for proposals and presentations.
        </AlertDescription>
      </Alert>

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={handleExportPDF} 
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Opening Print Dialog...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export to PDF
                </>
              )}
            </Button>

            <Button 
              variant="outline" 
              onClick={handleOpenFullPage}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>

            <Button 
              variant="outline" 
              onClick={handleRefresh}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Document
            </Button>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Export Instructions:</strong> Click "Export to PDF" to open the print dialog. 
              Select "Save as PDF" as your destination, adjust margins if needed, and click Save.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Document Preview */}
      <Card className="border-2 border-blue-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Document Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative" style={{ height: 'calc(100vh - 400px)', minHeight: '600px' }}>
            <iframe
              id="product-overview-iframe"
              src="/marketing/product-overview.html"
              className="w-full h-full border-0 rounded-b-lg"
              title="Product Overview Document"
              sandbox="allow-same-origin allow-scripts"
            />
          </div>
        </CardContent>
      </Card>

      {/* Document Info */}
      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-lg">Document Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Document Type</p>
              <p className="font-medium">Sales & Marketing Overview</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Target Audience</p>
              <p className="font-medium">Councils, Security Companies, Property Managers</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Sample Organization</p>
              <p className="font-medium">Iron Eagle Security (Example Data)</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground">File Location</p>
              <p className="font-mono text-xs bg-muted px-2 py-1 rounded">
                /public/marketing/product-overview.html
              </p>
            </div>
          </div>

          <div className="border-t pt-3 mt-3">
            <p className="text-sm font-semibold text-muted-foreground mb-2">Included Sections</p>
            <div className="grid md:grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Executive Summary with Key Stats
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                9 Core Features Overview
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                5-Step Workflow Diagram
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Sample Vehicle Records
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Real-Time Analytics Charts
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Key Benefits List (10 items)
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                3-Tier Pricing Structure
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Contact Information & CTA
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

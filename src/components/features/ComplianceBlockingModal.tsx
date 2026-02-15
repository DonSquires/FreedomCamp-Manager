import { useState, useEffect } from 'react';
import { AlertTriangle, Shield, FileCheck, Upload, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ComplianceStatus {
  can_login: boolean;
  can_work: boolean;
  can_enforce: boolean;
  missing_items: string[];
  warnings: string[];
  requires_coa: boolean;
  requires_warrant: boolean;
  compliance_status: string;
}

interface ComplianceBlockingModalProps {
  userId: string;
  employerOrgId: string;
  employerOrgName: string;
  onCredentialsUpdated: () => void;
}

export function ComplianceBlockingModal({
  userId,
  employerOrgId,
  employerOrgName,
  onCredentialsUpdated,
}: ComplianceBlockingModalProps) {
  const [complianceStatus, setComplianceStatus] = useState<ComplianceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  // COA upload state
  const [coaFile, setCoaFile] = useState<File | null>(null);
  const [coaUploading, setCoaUploading] = useState(false);
  const [coaProcessed, setCoaProcessed] = useState(false);

  // Warrant upload state
  const [warrantFile, setWarrantFile] = useState<File | null>(null);
  const [warrantUploading, setWarrantUploading] = useState(false);
  const [warrantProcessed, setWarrantProcessed] = useState(false);

  // AI extraction results
  const [aiExtractionResult, setAiExtractionResult] = useState<any>(null);

  useEffect(() => {
    checkCompliance();
  }, [userId, employerOrgId]);

  const checkCompliance = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('check_organization_compliance', {
        p_user_id: userId,
        p_employer_org_id: employerOrgId,
      });

      if (error) throw error;

      setComplianceStatus(data as ComplianceStatus);

      // Show modal if user can't work (missing credentials or expired)
      if (!data.can_work) {
        setIsOpen(true);
      }
    } catch (error: any) {
      console.error('Compliance check error:', error);
      toast.error('Failed to check compliance status');
    } finally {
      setLoading(false);
    }
  };

  const handleCoaUpload = async () => {
    if (!coaFile) {
      toast.error('Please select a COA document');
      return;
    }

    setCoaUploading(true);
    try {
      // Upload document to storage
      const fileName = `coa_${userId}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('compliance-documents')
        .upload(`coa/${fileName}`, coaFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('compliance-documents')
        .getPublicUrl(uploadData.path);

      toast.success('COA uploaded - processing with AI...');

      // Call AI processing edge function
      const { data: aiResult, error: aiError } = await supabase.functions.invoke(
        'process-credential-document',
        {
          body: {
            documentUrl: publicUrl,
            documentType: 'coa',
            userId: userId,
          },
        }
      );

      if (aiError) throw aiError;

      setAiExtractionResult(aiResult);

      if (aiResult.auto_filled) {
        toast.success('✅ COA processed and auto-filled successfully!');
        setCoaProcessed(true);
        
        // Re-check compliance
        await checkCompliance();
        
        // If now compliant, close modal
        if (complianceStatus?.can_work) {
          setIsOpen(false);
          onCredentialsUpdated();
        }
      } else {
        toast.warning('⚠️ COA processed but requires manual review. Please verify the extracted information.');
      }
    } catch (error: any) {
      console.error('COA upload error:', error);
      toast.error(`Failed to process COA: ${error.message}`);
    } finally {
      setCoaUploading(false);
    }
  };

  const handleWarrantUpload = async () => {
    if (!warrantFile) {
      toast.error('Please select a warrant document');
      return;
    }

    setWarrantUploading(true);
    try {
      // Upload document to storage
      const fileName = `warrant_${userId}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('compliance-documents')
        .upload(`warrants/${fileName}`, warrantFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('compliance-documents')
        .getPublicUrl(uploadData.path);

      toast.success('Warrant uploaded - processing with AI...');

      // Call AI processing edge function
      const { data: aiResult, error: aiError } = await supabase.functions.invoke(
        'process-credential-document',
        {
          body: {
            documentUrl: publicUrl,
            documentType: 'warrant',
            userId: userId,
          },
        }
      );

      if (aiError) throw aiError;

      setAiExtractionResult(aiResult);

      if (aiResult.auto_filled) {
        toast.success('✅ Warrant processed and auto-filled successfully!');
        setWarrantProcessed(true);
        
        // Re-check compliance
        await checkCompliance();
        
        // If now compliant, close modal
        if (complianceStatus?.can_work) {
          setIsOpen(false);
          onCredentialsUpdated();
        }
      } else {
        toast.warning('⚠️ Warrant processed but requires manual review. Please verify the extracted information.');
      }
    } catch (error: any) {
      console.error('Warrant upload error:', error);
      toast.error(`Failed to process warrant: ${error.message}`);
    } finally {
      setWarrantUploading(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={true}>
        <DialogContent>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <span className="ml-3 text-gray-600">Checking credentials...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!complianceStatus) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      // Prevent closing if credentials still missing
      if (!open && !complianceStatus.can_work) {
        toast.error('You must upload valid credentials before accessing the portal');
        return;
      }
      setIsOpen(open);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-red-600" />
            <DialogTitle className="text-xl">Credentials Required</DialogTitle>
          </div>
          <DialogDescription>
            You must upload valid credentials before you can work. We'll use AI to automatically scan and verify your documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Missing Items Alert */}
          {complianceStatus.missing_items.length > 0 && (
            <Alert className="border-red-200 bg-red-50">
              <XCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                <strong>Missing Required Credentials:</strong>
                <ul className="list-disc list-inside mt-2">
                  {complianceStatus.missing_items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Warnings Alert */}
          {complianceStatus.warnings.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <ul className="list-disc list-inside">
                  {complianceStatus.warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* COA Upload Section (if required) */}
          {complianceStatus.requires_coa && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-600" />
                  <CardTitle>Certificate of Approval (COA) - Security License</CardTitle>
                  {coaProcessed && <CheckCircle className="h-5 w-5 text-green-600 ml-auto" />}
                </div>
                <CardDescription>
                  Required for {employerOrgName} officers. Upload your COA document and AI will automatically extract the details.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="coa-file">Upload COA Document (PDF or Image)</Label>
                  <Input
                    id="coa-file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setCoaFile(e.target.files?.[0] || null)}
                    disabled={coaUploading || coaProcessed}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    AI will scan your document and auto-fill: license number, expiry date, authorized activities
                  </p>
                </div>

                <Button
                  onClick={handleCoaUpload}
                  disabled={!coaFile || coaUploading || coaProcessed}
                  className="w-full"
                >
                  {coaUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing with AI...
                    </>
                  ) : coaProcessed ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      COA Processed
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload & Process COA
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Warrant Upload Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-purple-600" />
                <CardTitle>Freedom Camping / Noise Control Warrant</CardTitle>
                {warrantProcessed && <CheckCircle className="h-5 w-5 text-green-600 ml-auto" />}
              </div>
              <CardDescription>
                {complianceStatus.requires_coa 
                  ? 'Optional - required only if you issue enforcement actions/infringements'
                  : 'Required to perform enforcement duties'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="warrant-file">Upload Warrant Document (PDF or Image)</Label>
                <Input
                  id="warrant-file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setWarrantFile(e.target.files?.[0] || null)}
                  disabled={warrantUploading || warrantProcessed}
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI will scan your warrant and extract: warrant number, expiry date, authorized acts (Freedom Camping Act 2011, Noise Control, etc.)
                </p>
              </div>

              <Button
                onClick={handleWarrantUpload}
                disabled={!warrantFile || warrantUploading || warrantProcessed}
                className="w-full"
              >
                {warrantUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing with AI...
                  </>
                ) : warrantProcessed ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Warrant Processed
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload & Process Warrant
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* AI Extraction Result Display */}
          {aiExtractionResult && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader>
                <CardTitle className="text-sm text-green-800">AI Extraction Result</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-green-900 overflow-x-auto">
                  {JSON.stringify(aiExtractionResult.extracted_data, null, 2)}
                </pre>
                <p className="text-xs text-green-700 mt-2">
                  Confidence: {(aiExtractionResult.confidence * 100).toFixed(0)}%
                  {aiExtractionResult.manual_review_required && ' - Manual review recommended'}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Help Text */}
          <Alert>
            <AlertDescription className="text-sm">
              <strong>How it works:</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1">
                <li>Upload your COA or Warrant document (PDF, JPG, or PNG)</li>
                <li>Our AI scans the document and extracts license numbers, expiry dates, and authorized activities</li>
                <li>The system auto-fills your credentials if confidence is high (≥80%)</li>
                <li>If confidence is low, an admin will manually verify the information</li>
                <li>Once verified, you'll have full access to the portal</li>
              </ol>
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}

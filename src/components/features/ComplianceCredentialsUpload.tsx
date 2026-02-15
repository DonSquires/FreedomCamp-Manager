import { useState } from 'react';
import { Upload, FileCheck, AlertTriangle, Calendar, Shield, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ComplianceCredentialsUploadProps {
  userId: string;
  employerOrgName?: string;
  currentCOA?: {
    coa_number?: string;
    coa_expiry_date?: string;
    coa_document_url?: string;
  };
  currentWarrant?: {
    has_warrant?: boolean;
    warrant_number?: string;
    warrant_expiry_date?: string;
    warrant_document_url?: string;
  };
  onUpdate?: () => void;
}

export function ComplianceCredentialsUpload({
  userId,
  employerOrgName,
  currentCOA,
  currentWarrant,
  onUpdate
}: ComplianceCredentialsUploadProps) {
  const [coaNumber, setCoaNumber] = useState(currentCOA?.coa_number || '');
  const [coaExpiry, setCoaExpiry] = useState(currentCOA?.coa_expiry_date || '');
  const [coaFile, setCoaFile] = useState<File | null>(null);
  const [coaUploading, setCoaUploading] = useState(false);

  const [hasWarrant, setHasWarrant] = useState(currentWarrant?.has_warrant || false);
  const [warrantNumber, setWarrantNumber] = useState(currentWarrant?.warrant_number || '');
  const [warrantExpiry, setWarrantExpiry] = useState(currentWarrant?.warrant_expiry_date || '');
  const [warrantFile, setWarrantFile] = useState<File | null>(null);
  const [warrantUploading, setWarrantUploading] = useState(false);

  const isFirstSecurity = employerOrgName === 'First Security';

  const handleCoaUpload = async () => {
    if (!coaFile || !coaNumber || !coaExpiry) {
      toast.error('Please provide COA number, expiry date, and document');
      return;
    }

    setCoaUploading(true);
    try {
      // Upload COA document to storage
      const fileName = `coa_${userId}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('compliance-documents')
        .upload(`coa/${fileName}`, coaFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('compliance-documents')
        .getPublicUrl(uploadData.path);

      // Update user profile
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          coa_number: coaNumber,
          coa_expiry_date: coaExpiry,
          coa_document_url: publicUrl,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      toast.success('COA uploaded successfully');
      setCoaFile(null);
      onUpdate?.();
    } catch (error: any) {
      console.error('COA upload error:', error);
      toast.error(`Failed to upload COA: ${error.message}`);
    } finally {
      setCoaUploading(false);
    }
  };

  const handleWarrantUpload = async () => {
    if (!hasWarrant) {
      // Just update checkbox status
      const { error } = await supabase
        .from('user_profiles')
        .update({ has_warrant: false, warrant_number: null, warrant_expiry_date: null })
        .eq('id', userId);

      if (error) {
        toast.error('Failed to update warrant status');
      } else {
        toast.success('Warrant status updated');
        onUpdate?.();
      }
      return;
    }

    if (!warrantFile || !warrantNumber || !warrantExpiry) {
      toast.error('Please provide warrant number, expiry date, and document');
      return;
    }

    setWarrantUploading(true);
    try {
      // Upload warrant document to storage
      const fileName = `warrant_${userId}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('compliance-documents')
        .upload(`warrants/${fileName}`, warrantFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('compliance-documents')
        .getPublicUrl(uploadData.path);

      // Update user profile
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          has_warrant: true,
          warrant_number: warrantNumber,
          warrant_expiry_date: warrantExpiry,
          warrant_document_url: publicUrl,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      toast.success('Warrant uploaded successfully');
      setWarrantFile(null);
      onUpdate?.();
    } catch (error: any) {
      console.error('Warrant upload error:', error);
      toast.error(`Failed to upload warrant: ${error.message}`);
    } finally {
      setWarrantUploading(false);
    }
  };

  const getExpiryStatus = (expiryDate: string) => {
    if (!expiryDate) return null;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { status: 'expired', color: 'text-red-600', icon: AlertTriangle };
    } else if (daysUntilExpiry <= 30) {
      return { status: 'expiring_soon', color: 'text-amber-600', icon: AlertTriangle };
    } else {
      return { status: 'valid', color: 'text-green-600', icon: CheckCircle };
    }
  };

  const coaStatus = getExpiryStatus(coaExpiry);
  const warrantStatus = getExpiryStatus(warrantExpiry);

  return (
    <div className="space-y-6">
      {/* COA Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <CardTitle>Certificate of Approval (COA) - Security License</CardTitle>
          </div>
          <CardDescription>
            {isFirstSecurity ? (
              <span className="text-red-600 font-semibold">REQUIRED for First Security officers to work</span>
            ) : (
              'Security license information'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isFirstSecurity && !currentCOA?.coa_document_url && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                This officer cannot work until a valid COA is uploaded. Patrol check-in and enforcement actions are blocked.
              </AlertDescription>
            </Alert>
          )}

          {currentCOA?.coa_document_url && coaStatus && (
            <Alert className={`border-${coaStatus.status === 'valid' ? 'green' : coaStatus.status === 'expiring_soon' ? 'amber' : 'red'}-200`}>
              <coaStatus.icon className={`h-4 w-4 ${coaStatus.color}`} />
              <AlertDescription className={coaStatus.color}>
                {coaStatus.status === 'expired' && 'COA has EXPIRED. Officer cannot work.'}
                {coaStatus.status === 'expiring_soon' && `COA expires in ${Math.floor((new Date(coaExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days`}
                {coaStatus.status === 'valid' && 'COA is valid'}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4">
            <div>
              <Label htmlFor="coa-number">COA Number *</Label>
              <Input
                id="coa-number"
                value={coaNumber}
                onChange={(e) => setCoaNumber(e.target.value)}
                placeholder="e.g., COA123456"
              />
            </div>

            <div>
              <Label htmlFor="coa-expiry">Expiry Date *</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <Input
                  id="coa-expiry"
                  type="date"
                  value={coaExpiry}
                  onChange={(e) => setCoaExpiry(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="coa-file">Upload COA Document (PDF) *</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="coa-file"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setCoaFile(e.target.files?.[0] || null)}
                />
                {currentCOA?.coa_document_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(currentCOA.coa_document_url, '_blank')}
                  >
                    <FileCheck className="h-4 w-4 mr-2" />
                    View Current
                  </Button>
                )}
              </div>
            </div>

            <Button
              onClick={handleCoaUpload}
              disabled={coaUploading || !coaNumber || !coaExpiry || !coaFile}
              className="w-full"
            >
              <Upload className="h-4 w-4 mr-2" />
              {coaUploading ? 'Uploading...' : currentCOA?.coa_document_url ? 'Update COA' : 'Upload COA'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Warrant Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-purple-600" />
            <CardTitle>Freedom Camping Enforcement Warrant</CardTitle>
          </div>
          <CardDescription>
            Required to issue infringements and enforcement actions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="has-warrant"
              checked={hasWarrant}
              onCheckedChange={(checked) => setHasWarrant(checked as boolean)}
            />
            <Label htmlFor="has-warrant" className="font-semibold">
              Officer has a valid Freedom Camping Enforcement Warrant
            </Label>
          </div>

          {hasWarrant && (
            <>
              {currentWarrant?.warrant_document_url && warrantStatus && (
                <Alert className={`border-${warrantStatus.status === 'valid' ? 'green' : warrantStatus.status === 'expiring_soon' ? 'amber' : 'red'}-200`}>
                  <warrantStatus.icon className={`h-4 w-4 ${warrantStatus.color}`} />
                  <AlertDescription className={warrantStatus.color}>
                    {warrantStatus.status === 'expired' && 'Warrant has EXPIRED. Officer cannot issue enforcement actions.'}
                    {warrantStatus.status === 'expiring_soon' && `Warrant expires in ${Math.floor((new Date(warrantExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days`}
                    {warrantStatus.status === 'valid' && 'Warrant is valid - can issue enforcement actions'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div>
                  <Label htmlFor="warrant-number">Warrant Number *</Label>
                  <Input
                    id="warrant-number"
                    value={warrantNumber}
                    onChange={(e) => setWarrantNumber(e.target.value)}
                    placeholder="e.g., WRT789012"
                  />
                </div>

                <div>
                  <Label htmlFor="warrant-expiry">Expiry Date *</Label>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <Input
                      id="warrant-expiry"
                      type="date"
                      value={warrantExpiry}
                      onChange={(e) => setWarrantExpiry(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="warrant-file">Upload Warrant Document (PDF) *</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="warrant-file"
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setWarrantFile(e.target.files?.[0] || null)}
                    />
                    {currentWarrant?.warrant_document_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(currentWarrant.warrant_document_url, '_blank')}
                      >
                        <FileCheck className="h-4 w-4 mr-2" />
                        View Current
                      </Button>
                    )}
                  </div>
                </div>

                <Button
                  onClick={handleWarrantUpload}
                  disabled={warrantUploading || !warrantNumber || !warrantExpiry || !warrantFile}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {warrantUploading ? 'Uploading...' : currentWarrant?.warrant_document_url ? 'Update Warrant' : 'Upload Warrant'}
                </Button>
              </div>
            </>
          )}

          {!hasWarrant && (
            <Alert>
              <AlertDescription>
                Officer can work patrols and report observations, but <strong>cannot issue enforcement actions or infringements</strong> without a valid warrant.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

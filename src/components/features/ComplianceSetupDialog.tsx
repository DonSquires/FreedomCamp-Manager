/**
 * ComplianceSetupDialog - First-time compliance credential setup
 * Shows after login to collect COA and Warrant status
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Shield, FileCheck, AlertCircle, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ComplianceSetupDialogProps {
  userId: string;
  userRole: string;
  onComplete: () => void;
}

export function ComplianceSetupDialog({ userId, userRole, onComplete }: ComplianceSetupDialogProps) {
  const [coaRequired, setCoaRequired] = useState(false);
  const [coaVerified, setCoaVerified] = useState(false);
  const [coaExpiry, setCoaExpiry] = useState<Date>();
  
  const [warrantRequired, setWarrantRequired] = useState(false);
  const [warrantVerified, setWarrantVerified] = useState(false);
  const [warrantExpiry, setWarrantExpiry] = useState<Date>();
  
  const [isSaving, setIsSaving] = useState(false);

  // Only show dialog for officers
  const isOfficer = userRole === 'officer' || userRole === 'admin_officer';

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          coa_required: coaRequired,
          coa_verified: coaVerified,
          coa_expiry: coaExpiry ? format(coaExpiry, 'yyyy-MM-dd') : null,
          warrant_required: warrantRequired,
          warrant_verified: warrantVerified,
          warrant_expiry: warrantExpiry ? format(warrantExpiry, 'yyyy-MM-dd') : null,
        })
        .eq('id', userId);

      if (error) throw error;

      toast.success('Compliance settings saved');
      onComplete();
    } catch (error: any) {
      console.error('Failed to save compliance settings:', error);
      toast.error('Failed to save compliance settings: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    toast.info('You can update compliance settings later in your profile');
    onComplete();
  };

  if (!isOfficer) {
    // Skip for non-officers
    onComplete();
    return null;
  }

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-blue-600" />
          </div>
          <DialogTitle className="text-center text-xl">Compliance Credentials Setup</DialogTitle>
          <DialogDescription className="text-center pt-2">
            Configure your compliance credentials for field operations
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* COA Section */}
          <div className="p-4 border-2 rounded-lg space-y-4">
            <div className="flex items-center gap-3">
              <FileCheck className="h-6 w-6 text-blue-600" />
              <div>
                <h3 className="font-semibold text-lg">Certificate of Approval (COA)</h3>
                <p className="text-xs text-muted-foreground">Required for enforcement in some zones</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="coa-required"
                  checked={coaRequired}
                  onCheckedChange={(checked) => {
                    setCoaRequired(checked as boolean);
                    if (!checked) {
                      setCoaVerified(false);
                      setCoaExpiry(undefined);
                    }
                  }}
                />
                <Label htmlFor="coa-required" className="text-sm cursor-pointer">
                  COA is required for my role
                </Label>
              </div>

              {coaRequired && (
                <div className="ml-6 space-y-3 p-3 bg-muted rounded border">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="coa-verified"
                      checked={coaVerified}
                      onCheckedChange={(checked) => setCoaVerified(checked as boolean)}
                    />
                    <Label htmlFor="coa-verified" className="text-sm cursor-pointer">
                      I have a verified COA
                    </Label>
                  </div>

                  {coaVerified && (
                    <div className="space-y-2">
                      <Label className="text-xs">Expiry Date (Optional)</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !coaExpiry && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {coaExpiry ? format(coaExpiry, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={coaExpiry}
                            onSelect={setCoaExpiry}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Warrant Section */}
          <div className="p-4 border-2 rounded-lg space-y-4">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-green-600" />
              <div>
                <h3 className="font-semibold text-lg">Freedom Camping Warrant</h3>
                <p className="text-xs text-muted-foreground">Required for Freedom Camping Act enforcement</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="warrant-required"
                  checked={warrantRequired}
                  onCheckedChange={(checked) => {
                    setWarrantRequired(checked as boolean);
                    if (!checked) {
                      setWarrantVerified(false);
                      setWarrantExpiry(undefined);
                    }
                  }}
                />
                <Label htmlFor="warrant-required" className="text-sm cursor-pointer">
                  Warrant is required for my role
                </Label>
              </div>

              {warrantRequired && (
                <div className="ml-6 space-y-3 p-3 bg-muted rounded border">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="warrant-verified"
                      checked={warrantVerified}
                      onCheckedChange={(checked) => setWarrantVerified(checked as boolean)}
                    />
                    <Label htmlFor="warrant-verified" className="text-sm cursor-pointer">
                      I have a verified Warrant
                    </Label>
                  </div>

                  {warrantVerified && (
                    <div className="space-y-2">
                      <Label className="text-xs">Expiry Date (Optional)</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !warrantExpiry && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {warrantExpiry ? format(warrantExpiry, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={warrantExpiry}
                            onSelect={setWarrantExpiry}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Information Notice */}
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-300 dark:border-blue-700">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-900 dark:text-blue-100">
                <p className="font-semibold mb-1">Important Information</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>These settings can be updated later in your profile</li>
                  <li>Your admin will verify uploaded credentials</li>
                  <li>Work may be restricted until credentials are verified</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleSkip} className="w-full sm:w-auto">
            Skip for Now
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

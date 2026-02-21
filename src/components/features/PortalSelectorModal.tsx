/**
 * Portal Selector Modal
 * For admin_officer role - choose between Admin Portal or Officer Portal
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Camera, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PortalSelectorModalProps {
  open: boolean;
  onClose: () => void;
}

export function PortalSelectorModal({ open, onClose }: PortalSelectorModalProps) {
  const navigate = useNavigate();
  const [selectedPortal, setSelectedPortal] = useState<'admin' | 'officer' | null>(null);

  const handleSelectAdmin = () => {
    localStorage.setItem('preferred_portal', 'admin');
    navigate('/admin/dashboard');
    onClose();
  };

  const handleSelectOfficer = () => {
    localStorage.setItem('preferred_portal', 'officer');
    navigate('/officer/scan');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Choose Your Portal</DialogTitle>
          <DialogDescription>
            You have access to both Admin and Officer portals. Select which one to use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 py-4">
          {/* Admin Portal */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedPortal === 'admin' ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setSelectedPortal('admin')}
          >
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Admin Portal</CardTitle>
              </div>
              <CardDescription>
                Full administrative access to manage zones, users, compliance, and enforcement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Dashboard & Analytics</li>
                <li>• Breach Management</li>
                <li>• Enforcement Actions</li>
                <li>• User Management</li>
                <li>• Zone Configuration</li>
                <li>• Reports & Exports</li>
              </ul>
              <Button
                onClick={handleSelectAdmin}
                className="w-full mt-4"
                variant={selectedPortal === 'admin' ? 'default' : 'outline'}
              >
                Enter Admin Portal
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Officer Portal */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedPortal === 'officer' ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setSelectedPortal('officer')}
          >
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle>Officer Portal</CardTitle>
              </div>
              <CardDescription>
                Mobile-optimized field operations for vehicle scanning and patrol management
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Vehicle Scanning</li>
                <li>• Patrol Check-ins</li>
                <li>• My Tasks & Assignments</li>
                <li>• Incident Reporting</li>
                <li>• Scan History</li>
                <li>• Offline Support</li>
              </ul>
              <Button
                onClick={handleSelectOfficer}
                className="w-full mt-4 bg-green-600 hover:bg-green-700"
                variant={selectedPortal === 'officer' ? 'default' : 'outline'}
              >
                Enter Officer Portal
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          You can change portals at any time from the navigation menu
        </div>
      </DialogContent>
    </Dialog>
  );
}

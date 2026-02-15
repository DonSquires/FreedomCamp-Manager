/**
 * Floating Bug Report Button - Always accessible from any page
 * Opens bug report modal for quick issue reporting
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bug } from 'lucide-react';
import { BugReportModal } from './BugReportModal';
import { useAuthStore } from '@/stores/authStore';

export function BugReportButton() {
  const [showModal, setShowModal] = useState(false);
  const { isAuthenticated, user } = useAuthStore();

  // Only show for master users (super admins)
  if (!isAuthenticated || !user || user.role !== 'master') return null;

  return (
    <>
      <Button
        onClick={() => setShowModal(true)}
        variant="outline"
        size="sm"
        className="fixed bottom-4 right-4 z-40 shadow-lg border-2 border-primary/20 bg-background/95 backdrop-blur-sm hover:bg-primary/10 hover:border-primary transition-all"
        title="Report a bug or issue"
      >
        <Bug className="h-4 w-4 mr-2" />
        Report Issue
      </Button>

      <BugReportModal
        open={showModal}
        onOpenChange={setShowModal}
        defaultPage={window.location.pathname}
      />
    </>
  );
}

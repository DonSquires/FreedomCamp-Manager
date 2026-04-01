/**
 * Identity Verification Page
 *
 * Page for face recognition identity verification at secure access control points.
 * Used at military bases, secure facilities, and restricted zones.
 * 
 * Features:
 *  - Face capture and comparison against stored profile photos
 *  - Geofence-restricted verification (only works inside designated zones)
 *  - Complete audit trail of all verification attempts
 *  - Access permission checking
 */

import { AppLayout } from '@/components/features/AppLayout'
import { AccessControlPanel } from '@/components/features/AccessControlPanel'

export default function IdentityVerificationPage() {
  return (
    <AppLayout title="Identity Verification">
      <div className="max-w-3xl mx-auto">
        <AccessControlPanel />
      </div>
    </AppLayout>
  )
}

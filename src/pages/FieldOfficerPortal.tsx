import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { CameraCapture } from '@/components/features/CameraCapture'
import { Camera, Map, FileText, History, AlertTriangle, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, setZone } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const [showScanner, setShowScanner] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)

  // Auto-monitor geofence and manage patrol
  useEffect(() => {
    if (!user?.id || !user?.organization_id) return

    const checkGeofence = () => {
      monitorGeofenceAndPatrol(
        user.id,
        user.organization_id!,
        currentPatrolZone,
        (newZoneId, newZoneName) => {
          setCurrentPatrolZone(newZoneId)
          setZone(newZoneId, newZoneName)
        }
      )
    }

    checkGeofence()
    const interval = setInterval(checkGeofence, 30000)
    return () => clearInterval(interval)
  }, [user, currentPatrolZone])

  /**
   * UNIFIED SCAN LOGIC
   * 1. Uploads photo to /scans/{user_id}/
   * 2. Calls alpr-process (Master 3-Stage AI)
   * 3. Handles DB Save automatically
   */
  const handleCapture = async (file: File) => {
    setIsProcessing(true)
    try {
      // 1. SESSION VALIDATION
      if (!user?.id || !user?.organization_id) {
        throw new Error('Session expired. Please log out and log back in.')
      }

      // 2. GET GPS LOCATION
      toast.info('Getting GPS location...')
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })

      // 3. UPLOAD PHOTO (Fixed folder path to /scans/)
      toast.info('Uploading photo...')
      const photoHash = Math.random().toString(36).substring(7)
      const filePath = `scans/${user.id}/${Date.now()}-${photoHash}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(filePath, file)

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      // 4. UNIFIED AI PIPELINE (ALPR -> Railway -> OnSpace)
      // We use supabase.functions.invoke to automatically handle apikey and auth headers
      toast.info('Analyzing vehicle (3-Stage AI)...')
      const { data, error: ingestError } = await supabase.functions.invoke('alpr-process', {
        body: {
          photo_url: photoUrl,
          officerId: user.id,
          zoneId: zoneId || 'other-location',
          organizationId: user.organization_id,
          gpsLatitude: position.coords.latitude,
          gpsLongitude: position.coords.longitude,
          gpsAccuracy: position.coords.accuracy,
          recordedAt: new Date().toISOString()
        }
      })

      if (ingestError) throw new Error(`Server Error: ${ingestError.message || 'Check logs'}`)
      if (!data?.success) throw new Error('AI Analysis failed to return a valid result.')

      // 5. SUCCESS HANDLING
      const plate = data.observation?.plate_number
      if (!plate || plate === 'MANUAL_REQUIRED') {
        toast.warning('Plate not clearly detected. Please verify details manually.', { duration: 6000 })
      } else {
        toast.success(`✅ Sighted: ${plate}`, { duration: 5000 })
      }

      setShowScanner(false)
    } catch (error: any) {
      console.error('❌ Scan flow failed:', error)
      toast.error(error.message || 'Scan failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleStartScanner = () => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired. Please re-login.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera not available on this device')
      return
    }
    setShowScanner(true)
  }

  return (
    <AppLayout title="Field Officer Portal" description={`Welcome, ${user?.full_name || 'Officer'}`}>
      {showScanner ? (
        <CameraCapture 
          onCapture={handleCapture} 
          onCancel={() => setShowScanner(false)} 
          facing="environment" 
          showControls={true} 
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Main Action: Scan */}
          <Card className="hover:shadow-lg transition-shadow border-blue-200 dark:border-blue-900 border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Camera className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                Scan Vehicle
              </CardTitle>
              <CardDescription>Capture plate and GPS location</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full h-12 text-lg" onClick={handleStartScanner} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Open Scanner'}
              </Button>
            </CardContent>
          </Card>

          {/* Secondary Actions */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                Active Patrol
              </CardTitle>
              <CardDescription>Manage your patrol session</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => toast.info('Patrol tracking active via geofence')}>
                Patrol Status
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                  <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                Create Report
              </CardTitle>
              <CardDescription>Submit incident or H&S</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                New Report
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                  <History className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                My Scans
              </CardTitle>
              <CardDescription>Recent observations</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/compliance')}>
                View History
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                Breach Alerts
              </CardTitle>
              <CardDescription>Active notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/breaches')}>
                View Alerts
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-teal-100 dark:bg-teal-900 rounded-lg">
                  <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                Zones
              </CardTitle>
              <CardDescription>Enforcement zones</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/zones')}>
                View Zones
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info Card */}
      <Card className="mt-6 bg-slate-50 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-sm">Officer Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Current Zone:</span>
              <span className="font-semibold text-blue-600">{zoneId || 'Scanning Geofence...'}</span>
            </div>
            <div className="flex justify-between">
              <span>Organization:</span>
              <span>{user?.organization_id?.substring(0, 8)}...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}

      </Card>
    </AppLayout>
  )
}

/**
 * AccessControlPanel Component
 *
 * Identity verification panel for secure access control points.
 * Combines face recognition verification with ID document checking.
 * 
 * Features:
 *  - Live face capture and comparison against stored profile photo
 *  - Side-by-side photo comparison cards
 *  - ID document photo capture and verification
 *  - Geofence restriction (only works inside designated zones)
 *  - Access permission checking
 *  - Incident recording for verification attempts
 *  - Vehicle of Interest (VOI) capture
 *  - Complete audit trail of verification attempts
 * 
 * Use Cases:
 *  - Military base entry/exit control
 *  - Secure facility access verification
 *  - Event credential verification
 *  - Visitor management
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Camera,
  X,
  User,
  UserCheck,
  UserX,
  Shield,
  ShieldCheck,
  ShieldX,
  CreditCard,
  ScanFace,
  MapPin,
  Clock,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  History,
  FileText,
  Key,
  Lock,
  Unlock,
  LogIn,
  LogOut,
  Ban,
  Trash2,
  CalendarClock,
  AlertCircle as AlertCircleIcon,
  UserPlus,
  Car,
  Plus,
  Image as ImageIcon,
  AlertOctagon,
  FileWarning,
  CheckCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { detectCurrentZones, isInsideGeofence, type GeofenceZone } from '@/lib/geofence'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonRecord {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  profile_photo_url: string | null
  profile_photo_embedding: number[] | null
  access_clearance_level: string | null
  access_badge_number: string | null
  id_document_number: string | null
  id_document_type: string | null
  // Visitor/temporary fields
  is_temporary_visitor?: boolean
  visitor_type?: string | null
  data_retention_until?: string | null
  auto_delete_on_expiry?: boolean
  visit_purpose?: string | null
  visit_start_date?: string | null
  visit_end_date?: string | null
}

interface AccessControlZone {
  id: string
  organization_id: string
  name: string
  location_lat: number
  location_lng: number
  radius_meters: number | null
  access_control_enabled: boolean
  access_control_config: {
    require_face_match?: boolean
    require_id_document?: boolean
    min_face_confidence?: number
  } | null
}

interface VerificationResult {
  success: boolean
  error?: string
  person?: {
    id: string
    first_name: string | null
    last_name: string | null
    access_clearance_level: string | null
    access_badge_number: string | null
  }
  verification?: {
    face_match_passed: boolean
    face_similarity: number | null
    min_confidence_required: number
    inside_geofence: boolean
  }
  permission?: {
    has_permission: boolean
    permission_type: string | null
    requires_escort: boolean
    valid_until: string | null
  }
  access_granted: boolean
}

interface AccessEntry {
  id: string
  entry_type: 'entry' | 'exit' | 'denied'
  verification_method: string
  person_record_id: string | null
  face_match_confidence: number | null
  face_match_passed: boolean | null
  created_at: string
  person_records?: {
    first_name: string | null
    last_name: string | null
  }
}

// Detected face from inference service
interface DetectedFace {
  bbox: { x: number; y: number; width: number; height: number } | null
  confidence: number
  approximate_age: string
  gender: string
  description: string | null
  embedding?: number[]
}

// Verification result card for stacking
interface VerificationResultCard {
  id: string
  timestamp: Date
  capturedPhotoUrl: string
  croppedFaceUrl?: string  // Cropped face from multi-face detection
  referencePhotoUrl: string | null
  person: PersonRecord | null
  verificationResult: VerificationResult | null
  isMatch: boolean
  similarity: number | null
  acknowledged: boolean
  incidentId?: string
  incidentDetails?: string
  additionalPhotos: string[]
  vehiclePhotos: string[]
  // Multi-face tracking
  faceIndex?: number
  totalFaces?: number
  detectedFace?: DetectedFace
  // Matched person from POI search
  matchedPerson?: {
    id: string
    first_name: string | null
    last_name: string | null
    similarity: number
  } | null
}

interface AccessControlPanelProps {
  /** Pre-selected zone ID */
  zoneId?: string
  /** Callback when verification completes */
  onVerificationComplete?: (result: VerificationResult, entryId: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccessControlPanel({
  zoneId: preSelectedZoneId,
  onVerificationComplete,
}: AccessControlPanelProps) {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const queryClient = useQueryClient()
  
  // ── State ─────────────────────────────────────────────────────────────────
  
  const [selectedZoneId, setSelectedZoneId] = useState<string>(preSelectedZoneId || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPerson, setSelectedPerson] = useState<PersonRecord | null>(null)
  const [verificationStep, setVerificationStep] = useState<'search' | 'verify' | 'result'>('search')
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null)
  
  // Location state
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [isInsideZone, setIsInsideZone] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  
  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [faceEmbedding, setFaceEmbedding] = useState<number[] | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Multi-face scanning state
  const [scanMode, setScanMode] = useState<'single' | 'multi'>('single')
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([])
  
  // Video stream monitoring state
  const [videoSource, setVideoSource] = useState<'camera' | 'stream'>('camera')
  const [streamUrl, setStreamUrl] = useState('')
  const [isStreamConnected, setIsStreamConnected] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [autoCapture, setAutoCapture] = useState(false)
  const [autoCaptureInterval, setAutoCaptureInterval] = useState(5) // seconds
  
  // Visitor management state
  const [deleteVisitorDialog, setDeleteVisitorDialog] = useState<PersonRecord | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [immediateDelete, setImmediateDelete] = useState(false)
  
  // ── Verification Result Cards (stacking) ─────────────────────────────────
  const [resultCards, setResultCards] = useState<VerificationResultCard[]>([])
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [incidentDetails, setIncidentDetails] = useState('')
  const [incidentTitle, setIncidentTitle] = useState('')
  const [incidentType, setIncidentType] = useState<string>('other')
  const [incidentSeverity, setIncidentSeverity] = useState<string>('low')
  const [isCapturingAdditional, setIsCapturingAdditional] = useState(false)
  const [additionalPhotoType, setAdditionalPhotoType] = useState<'evidence' | 'vehicle'>('evidence')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleNotes, setVehicleNotes] = useState('')
  const [showIncidentDialog, setShowIncidentDialog] = useState(false)
  const [incidentTargetCard, setIncidentTargetCard] = useState<VerificationResultCard | null>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const streamVideoRef = useRef<HTMLVideoElement>(null)
  const autoCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const additionalVideoRef = useRef<HTMLVideoElement>(null)
  const additionalCanvasRef = useRef<HTMLCanvasElement>(null)
  const additionalStreamRef = useRef<MediaStream | null>(null)
  
  // ── Queries ───────────────────────────────────────────────────────────────
  
  // Fetch zone access statistics
  const { data: zoneStats } = useQuery({
    queryKey: ['zone-access-stats', selectedZoneId],
    queryFn: async () => {
      if (!selectedZoneId) return null
      const { data, error } = await (supabase as any).rpc('get_zone_access_statistics', {
        p_zone_id: selectedZoneId,
      })
      if (error) throw error
      return data
    },
    enabled: !!selectedZoneId,
  })
  
  // Fetch access control enabled zones
  const { data: accessZones = [] } = useQuery({
    queryKey: ['access-control-zones', operationalOrganizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('zones')
        .select('id, organization_id, name, location_lat, location_lng, radius_meters, access_control_enabled, access_control_config')
        .eq('access_control_enabled', true)
        .eq('organization_id', operationalOrganizationId)
        .eq('is_active', true)
        .order('name')
      
      if (error) throw error
      return (data ?? []) as AccessControlZone[]
    },
    enabled: !!operationalOrganizationId,
  })
  
  // Search persons
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['access-control-person-search', searchQuery, selectedZoneId, operationalOrganizationId],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      const targetOrganizationId = accessZones.find(z => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId
      if (!targetOrganizationId) return []
      
      const { data, error } = await (supabase as any)
        .from('person_records')
        .select('id, first_name, last_name, date_of_birth, profile_photo_url, profile_photo_embedding, access_clearance_level, access_badge_number, id_document_number, id_document_type')
        .eq('organization_id', targetOrganizationId)
        .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,access_badge_number.ilike.%${searchQuery}%`)
        .limit(20)
      
      if (error) throw error
      return (data ?? []) as PersonRecord[]
    },
    enabled: searchQuery.length >= 2,
  })
  
  // Recent access entries for selected zone
  const { data: recentEntries = [], refetch: refetchEntries } = useQuery({
    queryKey: ['access-entries', selectedZoneId],
    queryFn: async () => {
      if (!selectedZoneId) return []
      
      const { data, error } = await (supabase as any)
        .from('access_entries')
        .select(`
          id, entry_type, verification_method, person_record_id,
          face_match_confidence, face_match_passed, created_at,
          person_records (first_name, last_name)
        `)
        .eq('zone_id', selectedZoneId)
        .order('created_at', { ascending: false })
        .limit(20)
      
      if (error) throw error
      return (data ?? []) as AccessEntry[]
    },
    enabled: !!selectedZoneId,
  })
  
  // Fetch temporary visitors
  const { data: temporaryVisitors = [], refetch: refetchVisitors } = useQuery({
    queryKey: ['temporary-visitors', selectedZoneId, operationalOrganizationId],
    queryFn: async () => {
      const targetOrganizationId = accessZones.find(z => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId
      if (!targetOrganizationId) return []
      const { data, error } = await (supabase as any)
        .from('person_records')
        .select('id, first_name, last_name, visitor_type, data_retention_until, auto_delete_on_expiry, visit_purpose, visit_start_date, visit_end_date, profile_photo_url, access_badge_number, created_at')
        .eq('organization_id', targetOrganizationId)
        .eq('is_temporary_visitor', true)
        .is('deleted_at', null)
        .order('data_retention_until', { ascending: true })
        .limit(100)
      
      if (error) throw error
      return (data ?? []) as PersonRecord[]
    },
    enabled: !!operationalOrganizationId,
  })
  
  // Fetch expiring visitors (within 7 days)
  const { data: expiringVisitors = [] } = useQuery({
    queryKey: ['expiring-visitors', selectedZoneId, operationalOrganizationId],
    queryFn: async () => {
      const targetOrganizationId = accessZones.find(z => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId
      if (!targetOrganizationId) return []
      const { data, error } = await (supabase as any).rpc('list_expiring_visitors', {
        p_organization_id: targetOrganizationId,
        p_days_until_expiry: 7,
      })
      
      if (error) throw error
      return data ?? []
    },
    enabled: !!operationalOrganizationId,
  })
  
  // ── Location Monitoring ───────────────────────────────────────────────────
  
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported')
      return
    }
    
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        setLocationError(null)
      },
      (error) => {
        setLocationError(error.message)
      },
      { enableHighAccuracy: true, maximumAge: 10000 }
    )
    
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])
  
  // Check if inside selected zone
  useEffect(() => {
    if (!currentLocation || !selectedZoneId) {
      setIsInsideZone(false)
      return
    }
    
    const zone = accessZones.find(z => z.id === selectedZoneId)
    if (!zone) {
      setIsInsideZone(false)
      return
    }
    
    const inside = isInsideGeofence(
      currentLocation.lat,
      currentLocation.lng,
      {
        id: zone.id,
        organization_id: zone.organization_id,
        name: zone.name,
        location_lat: zone.location_lat,
        location_lng: zone.location_lng,
        radius_meters: zone.radius_meters ?? 500,
      }
    )
    setIsInsideZone(inside)
  }, [currentLocation, selectedZoneId, accessZones])
  
  // ── Camera Controls ───────────────────────────────────────────────────────
  
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsCameraOpen(true)
    } catch (error: any) {
      toast.error(`Camera error: ${error.message}`)
    }
  }, [])
  
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraOpen(false)
    
    // Also stop auto-capture if running
    if (autoCaptureTimerRef.current) {
      clearInterval(autoCaptureTimerRef.current)
      autoCaptureTimerRef.current = null
    }
  }, [])
  
  // ── Video Stream Functions ─────────────────────────────────────────────────
  
  const connectToStream = useCallback(async () => {
    if (!streamUrl) {
      toast.error('Please enter a stream URL')
      return
    }
    
    // Validate URL format (only allow http/https/rtsp protocols)
    try {
      const url = new URL(streamUrl)
      const allowedProtocols = ['http:', 'https:', 'rtsp:']
      if (!allowedProtocols.includes(url.protocol)) {
        toast.error('Invalid stream URL protocol. Only http, https, and rtsp are allowed.')
        return
      }
    } catch {
      toast.error('Invalid stream URL format')
      return
    }
    
    setStreamError(null)
    
    try {
      // For HLS/DASH streams, we can use the video element directly
      // For RTSP, we'd need a proxy service to convert to HLS
      if (streamVideoRef.current) {
        streamVideoRef.current.src = streamUrl
        streamVideoRef.current.crossOrigin = 'anonymous'
        
        await new Promise((resolve, reject) => {
          const video = streamVideoRef.current!
          video.onloadeddata = resolve
          video.onerror = () => reject(new Error('Failed to load stream'))
          video.load()
        })
        
        await streamVideoRef.current.play()
        setIsStreamConnected(true)
        toast.success('Connected to video stream')
      }
    } catch (error: any) {
      setStreamError(error.message || 'Failed to connect to stream')
      toast.error(`Stream error: ${error.message}`)
      setIsStreamConnected(false)
    }
  }, [streamUrl])
  
  const disconnectStream = useCallback(() => {
    if (streamVideoRef.current) {
      streamVideoRef.current.pause()
      streamVideoRef.current.src = ''
    }
    setIsStreamConnected(false)
    setAutoCapture(false)
    
    if (autoCaptureTimerRef.current) {
      clearInterval(autoCaptureTimerRef.current)
      autoCaptureTimerRef.current = null
    }
  }, [])
  
  const captureFromStream = useCallback(async () => {
    if (!streamVideoRef.current || !canvasRef.current || !user || !isStreamConnected) return
    
    setIsProcessing(true)
    
    try {
      const video = streamVideoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context unavailable')
      ctx.drawImage(video, 0, 0)
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Blob creation failed')), 'image/jpeg', 0.9)
      })
      
      // Upload to storage
      const timestamp = Date.now()
      const filePath = `${user.id}/access-control/stream-${timestamp}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false })
      
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
      
      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl
      
      // Process face detection with POI matching
      const { data: faceData, error: faceError } = await edgeFunctions.processFaceScan({
        action: 'detect_and_match',
        photo_url: photoUrl,
        organization_id: accessZones.find((z) => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId ?? undefined,
        zone_id: selectedZoneId || undefined,
        save: false,
      })
      
      if (faceError) throw new Error(faceError)
      
      const faces = faceData?.faces || []
      const faceCount = faceData?.face_count || faces.length
      
      if (faceCount === 0) {
        // No faces detected - skip silently in auto-capture mode
        if (!autoCapture) {
          toast.info('No faces detected in frame')
        }
        return
      }
      
      // Create cards for each detected face
      const newCards: VerificationResultCard[] = []
      const poiMatches = faceData?.poi_matches || []
      
      for (let i = 0; i < faces.length; i++) {
        const face = faces[i]
        const matchedPoi = poiMatches.find((m: any) => m.face_index === i) || poiMatches[i]
        
        const card: VerificationResultCard = {
          id: `stream-${Date.now()}-${i}`,
          timestamp: new Date(),
          capturedPhotoUrl: photoUrl,
          referencePhotoUrl: matchedPoi?.photo_url || null,
          person: matchedPoi ? {
            id: matchedPoi.person_record_id,
            first_name: matchedPoi.person?.full_name?.split(' ')[0] || matchedPoi.person_full_name?.split(' ')[0] || null,
            last_name: matchedPoi.person?.full_name?.split(' ').slice(1).join(' ') || matchedPoi.person_full_name?.split(' ').slice(1).join(' ') || null,
            date_of_birth: null,
            profile_photo_url: matchedPoi.photo_url,
            profile_photo_embedding: null,
            access_clearance_level: null,
            access_badge_number: null,
            id_document_number: null,
            id_document_type: null,
          } : null,
          verificationResult: null,
          isMatch: matchedPoi?.same_person || false,
          similarity: matchedPoi?.similarity || null,
          acknowledged: false,
          additionalPhotos: [],
          vehiclePhotos: [],
          faceIndex: i,
          totalFaces: faceCount,
          detectedFace: face,
          matchedPerson: matchedPoi ? {
            id: matchedPoi.person_record_id,
            first_name: matchedPoi.person_full_name?.split(' ')[0] || null,
            last_name: matchedPoi.person_full_name?.split(' ').slice(1).join(' ') || null,
            similarity: matchedPoi.similarity,
          } : null,
        }
        newCards.push(card)
      }
      
      if (newCards.length > 0) {
        setResultCards(prev => [...newCards, ...prev])
        setActiveCardId(newCards[0].id)
        
        if (!autoCapture) {
          toast.success(`Captured ${faceCount} face${faceCount > 1 ? 's' : ''} from stream`)
        }
      }
    } catch (error: any) {
      if (!autoCapture) {
        toast.error(error.message || 'Failed to capture from stream')
      }
      console.error('Stream capture error:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [user, isStreamConnected, autoCapture, accessZones, operationalOrganizationId, selectedZoneId])
  
  // Auto-capture effect
  useEffect(() => {
    if (autoCapture && isStreamConnected) {
      autoCaptureTimerRef.current = setInterval(() => {
        captureFromStream()
      }, autoCaptureInterval * 1000)
      
      return () => {
        if (autoCaptureTimerRef.current) {
          clearInterval(autoCaptureTimerRef.current)
          autoCaptureTimerRef.current = null
        }
      }
    }
  }, [autoCapture, isStreamConnected, autoCaptureInterval, captureFromStream])
  
  // ── Camera Capture ─────────────────────────────────────────────────────────
  
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !user) return
    
    setIsProcessing(true)
    
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context unavailable')
      ctx.drawImage(video, 0, 0)
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Blob creation failed')), 'image/jpeg', 0.9)
      })
      
      // Upload to storage
      const timestamp = Date.now()
      const filePath = `${user.id}/access-control/${timestamp}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false })
      
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
      
      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl
      
      // Process face detection with POI matching
      const { data: faceData, error: faceError } = await edgeFunctions.processFaceScan({
        action: 'detect_and_match',
        photo_url: photoUrl,
        organization_id: accessZones.find((z) => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId ?? undefined,
        zone_id: selectedZoneId || undefined,
        save: false,
      })
      
      if (faceError) throw new Error(faceError)
      
      const faces = faceData?.faces || []
      const faceCount = faceData?.face_count || faces.length
      
      if (faceCount === 0) {
        throw new Error('No face detected in photo')
      }
      
      // Handle multiple faces
      if (faceCount > 1 || scanMode === 'multi') {
        // Store detected faces for multi-face processing
        setDetectedFaces(faces)
        setCapturedPhoto(photoUrl)
        stopCamera()
        
        // Create a card for each face
        const newCards: VerificationResultCard[] = []
        const poiMatches = faceData?.poi_matches || []
        
        for (let i = 0; i < faces.length; i++) {
          const face = faces[i]
          // Find POI match for this face if available
          const matchedPoi = poiMatches.find((m: any) => m.face_index === i) || poiMatches[i]
          
          const card: VerificationResultCard = {
            id: `card-${Date.now()}-${i}`,
            timestamp: new Date(),
            capturedPhotoUrl: photoUrl,
            referencePhotoUrl: matchedPoi?.photo_url || null,
            person: matchedPoi ? {
              id: matchedPoi.person_record_id,
              first_name: matchedPoi.person?.full_name?.split(' ')[0] || matchedPoi.person_full_name?.split(' ')[0] || null,
              last_name: matchedPoi.person?.full_name?.split(' ').slice(1).join(' ') || matchedPoi.person_full_name?.split(' ').slice(1).join(' ') || null,
              date_of_birth: null,
              profile_photo_url: matchedPoi.photo_url,
              profile_photo_embedding: null,
              access_clearance_level: null,
              access_badge_number: null,
              id_document_number: null,
              id_document_type: null,
            } : null,
            verificationResult: null,
            isMatch: matchedPoi?.same_person || false,
            similarity: matchedPoi?.similarity || null,
            acknowledged: false,
            additionalPhotos: [],
            vehiclePhotos: [],
            faceIndex: i,
            totalFaces: faceCount,
            detectedFace: face,
            matchedPerson: matchedPoi ? {
              id: matchedPoi.person_record_id,
              first_name: matchedPoi.person?.full_name?.split(' ')[0] || matchedPoi.person_full_name?.split(' ')[0] || null,
              last_name: matchedPoi.person?.full_name?.split(' ').slice(1).join(' ') || matchedPoi.person_full_name?.split(' ').slice(1).join(' ') || null,
              similarity: matchedPoi.similarity,
            } : null,
          }
          newCards.push(card)
        }
        
        setResultCards(prev => [...newCards, ...prev])
        if (newCards.length > 0) {
          setActiveCardId(newCards[0].id)
        }
        
        toast.success(`${faceCount} face${faceCount > 1 ? 's' : ''} detected`, { duration: 3000 })
      } else {
        // Single face mode - use existing flow
        setCapturedPhoto(photoUrl)
        setFaceEmbedding(faceData.embedding)
        setDetectedFaces(faces)
        stopCamera()
        
        toast.success('Photo captured successfully')
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to capture photo')
    } finally {
      setIsProcessing(false)
    }
  }, [user, stopCamera, scanMode, accessZones, operationalOrganizationId, selectedZoneId])
  
  // ── Scan All Faces (multi-face mode) ─────────────────────────────────────────
  
  const scanAllFaces = useCallback(async () => {
    if (!capturedPhoto || !selectedZoneId || !user) return
    
    setIsProcessing(true)
    
    try {
      // Process each detected face
      const newCards: VerificationResultCard[] = []
      
      for (let i = 0; i < detectedFaces.length; i++) {
        const face = detectedFaces[i]
        if (!face.embedding) continue
        
        // Search for matching POI
        const { data: matchData, error: matchError } = await edgeFunctions.processFaceScan({
          action: 'match',
          embedding: face.embedding,
          organization_id: accessZones.find((z) => z.id === selectedZoneId)?.organization_id ?? operationalOrganizationId ?? undefined,
          zone_id: selectedZoneId || undefined,
          max_results: 3,
        })
        
        const bestMatch = matchData?.matches?.[0]
        
        const card: VerificationResultCard = {
          id: `card-${Date.now()}-${i}`,
          timestamp: new Date(),
          capturedPhotoUrl: capturedPhoto,
          referencePhotoUrl: bestMatch?.photo_url || null,
          person: bestMatch ? {
            id: bestMatch.person_record_id,
            first_name: bestMatch.person_full_name?.split(' ')[0] || null,
            last_name: bestMatch.person_full_name?.split(' ').slice(1).join(' ') || null,
            date_of_birth: bestMatch.person_date_of_birth,
            profile_photo_url: bestMatch.photo_url,
            profile_photo_embedding: null,
            access_clearance_level: null,
            access_badge_number: null,
            id_document_number: null,
            id_document_type: null,
          } : null,
          verificationResult: null,
          isMatch: bestMatch?.same_person || false,
          similarity: bestMatch?.similarity || null,
          acknowledged: false,
          additionalPhotos: [],
          vehiclePhotos: [],
          faceIndex: i,
          totalFaces: detectedFaces.length,
          detectedFace: face,
          matchedPerson: bestMatch ? {
            id: bestMatch.person_record_id,
            first_name: bestMatch.person_full_name?.split(' ')[0] || null,
            last_name: bestMatch.person_full_name?.split(' ').slice(1).join(' ') || null,
            similarity: bestMatch.similarity,
          } : null,
        }
        
        newCards.push(card)
      }
      
      setResultCards(prev => [...newCards, ...prev])
      if (newCards.length > 0) {
        setActiveCardId(newCards[0].id)
      }
      
      toast.success(`Processed ${newCards.length} face${newCards.length > 1 ? 's' : ''}`)
    } catch (error: any) {
      toast.error(error.message || 'Failed to process faces')
    } finally {
      setIsProcessing(false)
    }
  }, [capturedPhoto, detectedFaces, accessZones, operationalOrganizationId, selectedZoneId, user])
  
  // ── Verification ──────────────────────────────────────────────────────────
  
  const verifyIdentityMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPerson || !selectedZoneId || !faceEmbedding) {
        throw new Error('Missing required verification data')
      }
      
      // Call RPC to verify identity
      const { data, error } = await (supabase as any).rpc('verify_access_identity', {
        p_person_record_id: selectedPerson.id,
        p_zone_id: selectedZoneId,
        p_face_embedding: faceEmbedding,
        p_gps_lat: currentLocation?.lat ?? null,
        p_gps_lng: currentLocation?.lng ?? null,
      })
      
      if (error) throw error
      return data as VerificationResult
    },
    onSuccess: async (result) => {
      setVerificationResult(result)
      setVerificationStep('result')
      
      // Log the access entry
      const entryType = result.access_granted ? 'entry' : 'denied'
      const verificationMethod = result.verification?.face_match_passed ? 'face_only' : 'denied_no_match'
      
      const { data: entryId, error: logError } = await (supabase as any).rpc('log_access_entry', {
        p_organization_id: selectedZone?.organization_id ?? operationalOrganizationId,
        p_zone_id: selectedZoneId,
        p_person_record_id: selectedPerson?.id ?? null,
        p_entry_type: entryType,
        p_verification_method: verificationMethod,
        p_face_match_confidence: result.verification?.face_similarity ?? null,
        p_face_match_passed: result.verification?.face_match_passed ?? false,
        p_face_photo_url: capturedPhoto,
        p_gps_lat: currentLocation?.lat ?? null,
        p_gps_lng: currentLocation?.lng ?? null,
        p_inside_geofence: result.verification?.inside_geofence ?? false,
        p_processed_by: user?.id ?? null,
      })
      
      if (logError) {
        console.error('Failed to log access entry:', logError)
      }
      
      // Refetch entries
      refetchEntries()
      
      // Callback
      if (onVerificationComplete && entryId) {
        onVerificationComplete(result, entryId as string)
      }
      
      // Create a result card for stacking display
      const newCard: VerificationResultCard = {
        id: `card-${Date.now()}`,
        timestamp: new Date(),
        capturedPhotoUrl: capturedPhoto || '',
        referencePhotoUrl: selectedPerson?.profile_photo_url || null,
        person: selectedPerson,
        verificationResult: result,
        isMatch: result.verification?.face_match_passed || false,
        similarity: result.verification?.face_similarity || null,
        acknowledged: false,
        additionalPhotos: [],
        vehiclePhotos: [],
      }
      
      setResultCards(prev => [newCard, ...prev])
      setActiveCardId(newCard.id)
      
      if (result.access_granted) {
        toast.success('Access GRANTED', { duration: 5000 })
      } else {
        toast.error('Access DENIED', { duration: 5000 })
      }
    },
    onError: (error: any) => {
      // Create a no-match card for failed verification attempts
      if (capturedPhoto && selectedPerson) {
        const noMatchCard: VerificationResultCard = {
          id: `card-${Date.now()}`,
          timestamp: new Date(),
          capturedPhotoUrl: capturedPhoto,
          referencePhotoUrl: selectedPerson.profile_photo_url || null,
          person: selectedPerson,
          verificationResult: null,
          isMatch: false,
          similarity: null,
          acknowledged: false,
          additionalPhotos: [],
          vehiclePhotos: [],
        }
        setResultCards(prev => [noMatchCard, ...prev])
        setActiveCardId(noMatchCard.id)
      }
      toast.error(error.message || 'Verification failed')
    },
  })
  
  // ── Reset ─────────────────────────────────────────────────────────────────
  
  const resetVerification = useCallback(() => {
    setSelectedPerson(null)
    setVerificationStep('search')
    setVerificationResult(null)
    setCapturedPhoto(null)
    setFaceEmbedding(null)
    setSearchQuery('')
    stopCamera()
  }, [stopCamera])
  
  // ── Delete Visitor Mutation ────────────────────────────────────────────────
  
  const deleteVisitorMutation = useMutation({
    mutationFn: async ({ personId, reason, immediate }: { personId: string; reason: string; immediate: boolean }) => {
      const { data, error } = await (supabase as any).rpc('delete_visitor_with_data', {
        p_person_record_id: personId,
        p_reason: reason || 'Manual deletion by administrator',
        p_immediate: immediate,
      })
      
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(data.immediate ? 'Visitor record permanently deleted' : 'Visitor marked for deletion')
        setDeleteVisitorDialog(null)
        setDeleteReason('')
        setImmediateDelete(false)
        refetchVisitors()
        queryClient.invalidateQueries({ queryKey: ['temporary-visitors'] })
        queryClient.invalidateQueries({ queryKey: ['expiring-visitors'] })
      } else {
        toast.error(data?.error || 'Failed to delete visitor')
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete visitor')
    },
  })
  
  const extendRetentionMutation = useMutation({
    mutationFn: async ({ personId, newDate }: { personId: string; newDate: string }) => {
      const { data, error } = await (supabase as any).rpc('extend_visitor_retention', {
        p_person_record_id: personId,
        p_new_retention_until: newDate,
        p_reason: 'Extended by administrator',
      })
      
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Retention period extended')
      refetchVisitors()
      queryClient.invalidateQueries({ queryKey: ['expiring-visitors'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to extend retention')
    },
  })
  
  // ── Create Incident Mutation ─────────────────────────────────────────────────
  
  const createIncidentMutation = useMutation({
    mutationFn: async (params: {
      card: VerificationResultCard
      title: string
      description: string
      incidentType: string
      severity: string
      vehiclePlate?: string
      vehiclePhotoUrl?: string
      vehicleNotes?: string
    }) => {
      const { data, error } = await (supabase as any).rpc('create_access_control_incident', {
        p_organization_id: selectedZone?.organization_id ?? operationalOrganizationId,
        p_zone_id: selectedZoneId,
        p_incident_type: params.incidentType,
        p_title: params.title,
        p_description: params.description,
        p_severity: params.severity,
        p_person_record_id: params.card.person?.id || null,
        p_verification_photo_url: params.card.capturedPhotoUrl,
        p_reference_photo_url: params.card.referencePhotoUrl,
        p_face_match_similarity: params.card.similarity,
        p_evidence_photos: JSON.stringify(params.card.additionalPhotos.map(url => ({ url, type: 'evidence' }))),
        p_vehicle_plate: params.vehiclePlate || null,
        p_vehicle_photo_url: params.vehiclePhotoUrl || (params.card.vehiclePhotos[0] || null),
        p_vehicle_notes: params.vehicleNotes || null,
        p_gps_lat: currentLocation?.lat ?? null,
        p_gps_lng: currentLocation?.lng ?? null,
      })
      
      if (error) throw error
      return data
    },
    onSuccess: (data, variables) => {
      if (data?.success) {
        toast.success('Incident created successfully')
        
        // Update the card with incident ID
        setResultCards(prev => prev.map(c => 
          c.id === variables.card.id 
            ? { ...c, incidentId: data.incident_id, incidentDetails: variables.description }
            : c
        ))
        
        // Reset incident form
        setShowIncidentDialog(false)
        setIncidentTargetCard(null)
        setIncidentTitle('')
        setIncidentDetails('')
        setIncidentType('other')
        setIncidentSeverity('low')
        setVehiclePlate('')
        setVehicleNotes('')
        
        // Refresh stats
        queryClient.invalidateQueries({ queryKey: ['zone-access-stats'] })
      } else {
        toast.error(data?.error || 'Failed to create incident')
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create incident')
    },
  })
  
  // ── Acknowledge Card ─────────────────────────────────────────────────────────
  
  const acknowledgeCard = useCallback((cardId: string) => {
    setResultCards(prev => prev.map(c => 
      c.id === cardId ? { ...c, acknowledged: true } : c
    ))
    
    // Find next unacknowledged card
    const unacknowledged = resultCards.find(c => c.id !== cardId && !c.acknowledged)
    if (unacknowledged) {
      setActiveCardId(unacknowledged.id)
    } else {
      setActiveCardId(null)
    }
  }, [resultCards])
  
  // ── Helpers ───────────────────────────────────────────────────────────────
  
  const selectedZone = accessZones.find(z => z.id === selectedZoneId)
  const personName = (p: { first_name: string | null; last_name: string | null }) =>
    [p.first_name, p.last_name].filter(Boolean).join(' ') || '(Unknown)'
  
  const getDaysRemaining = (dateStr: string | null | undefined) => {
    if (!dateStr) return null
    const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return days
  }
  
  const activeCard = resultCards.find(c => c.id === activeCardId)
  const unacknowledgedCount = resultCards.filter(c => !c.acknowledged).length
  
  // ── Render ────────────────────────────────────────────────────────────────
  
  return (
    <div className="space-y-6">
      {/* Verification Result Cards Stack */}
      {activeCard && (
        <Dialog open={!!activeCard} onOpenChange={(open) => !open && setActiveCardId(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  {activeCard.isMatch ? (
                    <>
                      <UserCheck className="h-5 w-5 text-green-600" />
                      <span className="text-green-600">Identity Match</span>
                    </>
                  ) : (
                    <>
                      <UserX className="h-5 w-5 text-red-600" />
                      <span className="text-red-600">No Match Found</span>
                    </>
                  )}
                  {activeCard.totalFaces && activeCard.totalFaces > 1 && (
                    <Badge variant="outline" className="ml-2">
                      Face {(activeCard.faceIndex || 0) + 1} of {activeCard.totalFaces}
                    </Badge>
                  )}
                </DialogTitle>
                {unacknowledgedCount > 1 && (
                  <Badge variant="secondary">{unacknowledgedCount} pending</Badge>
                )}
              </div>
              <DialogDescription>
                {activeCard.isMatch
                  ? 'This person matches a record in the system.'
                  : 'This person does not match any records. Further verification required.'}
              </DialogDescription>
            </DialogHeader>
            
            {/* Side-by-side Photo Comparison */}
            <div className="grid grid-cols-2 gap-4 my-4">
              {/* Captured Photo */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Captured Photo</Label>
                <div className="aspect-square bg-muted rounded-lg overflow-hidden relative">
                  {activeCard.capturedPhotoUrl ? (
                    <img
                      src={activeCard.capturedPhotoUrl}
                      alt="Captured"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="h-16 w-16 text-muted-foreground/40" />
                    </div>
                  )}
                  {activeCard.detectedFace && (
                    <div className="absolute bottom-2 left-2 right-2">
                      <Badge variant="secondary" className="text-xs">
                        {activeCard.detectedFace.approximate_age} • {activeCard.detectedFace.gender}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Reference Photo */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Reference Photo</Label>
                <div className="aspect-square bg-muted rounded-lg overflow-hidden relative">
                  {activeCard.referencePhotoUrl ? (
                    <img
                      src={activeCard.referencePhotoUrl}
                      alt="Reference"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center flex-col gap-2">
                      <User className="h-16 w-16 text-muted-foreground/40" />
                      <span className="text-sm text-muted-foreground">No reference photo</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Match Confidence */}
            {activeCard.similarity !== null && (
              <div className="flex items-center justify-center gap-4 py-2 bg-muted rounded-lg">
                <span className="text-sm text-muted-foreground">Match Confidence:</span>
                <Badge variant={activeCard.isMatch ? 'default' : 'destructive'} className="text-lg px-4 py-1">
                  {(activeCard.similarity * 100).toFixed(1)}%
                </Badge>
              </div>
            )}
            
            {/* Person Details */}
            {activeCard.person || activeCard.matchedPerson ? (
              <Card className="mt-4">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Person Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <p className="font-medium">
                        {activeCard.person 
                          ? personName(activeCard.person)
                          : activeCard.matchedPerson
                            ? personName(activeCard.matchedPerson)
                            : '(Unknown)'}
                      </p>
                    </div>
                    {activeCard.person?.access_badge_number && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Badge Number</Label>
                        <p className="font-medium">{activeCard.person.access_badge_number}</p>
                      </div>
                    )}
                    {activeCard.person?.access_clearance_level && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Clearance Level</Label>
                        <Badge variant="outline" className="capitalize">
                          {activeCard.person.access_clearance_level}
                        </Badge>
                      </div>
                    )}
                    {activeCard.person?.date_of_birth && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Date of Birth</Label>
                        <p className="font-medium">{activeCard.person.date_of_birth}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="mt-4 border-orange-300 bg-orange-50">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <AlertOctagon className="h-6 w-6 text-orange-600" />
                    <div>
                      <p className="font-medium text-orange-800">Unknown Person</p>
                      <p className="text-sm text-orange-600">
                        This person is not in the system. Create an incident to record this verification attempt.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Incident Status */}
            {activeCard.incidentId && (
              <Card className="mt-4 border-blue-300 bg-blue-50">
                <CardContent className="py-3">
                  <div className="flex items-center gap-2">
                    <FileWarning className="h-5 w-5 text-blue-600" />
                    <span className="text-blue-800 font-medium">Incident Recorded</span>
                  </div>
                  {activeCard.incidentDetails && (
                    <p className="text-sm text-blue-600 mt-1">{activeCard.incidentDetails}</p>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Actions */}
            <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
              {!activeCard.incidentId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIncidentTargetCard(activeCard)
                    setShowIncidentDialog(true)
                  }}
                  className="gap-2"
                >
                  <FileWarning className="h-4 w-4" />
                  Create Incident
                </Button>
              )}
              
              <Button
                variant={activeCard.isMatch ? 'default' : 'destructive'}
                onClick={() => acknowledgeCard(activeCard.id)}
                className="gap-2"
              >
                <CheckCheck className="h-4 w-4" />
                Acknowledge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      
      {/* Incident Creation Dialog */}
      <Dialog open={showIncidentDialog} onOpenChange={setShowIncidentDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5" />
              Create Incident
            </DialogTitle>
            <DialogDescription>
              Record an incident for this verification attempt.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Incident Type</Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_match">No Match</SelectItem>
                  <SelectItem value="denied_access">Denied Access</SelectItem>
                  <SelectItem value="suspicious_activity">Suspicious Activity</SelectItem>
                  <SelectItem value="unauthorized_entry">Unauthorized Entry</SelectItem>
                  <SelectItem value="badge_mismatch">Badge Mismatch</SelectItem>
                  <SelectItem value="expired_credentials">Expired Credentials</SelectItem>
                  <SelectItem value="tailgating">Tailgating</SelectItem>
                  <SelectItem value="trespass">Trespass</SelectItem>
                  <SelectItem value="verbal_altercation">Verbal Altercation</SelectItem>
                  <SelectItem value="physical_altercation">Physical Altercation</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
                placeholder="Brief description of the incident"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={incidentDetails}
                onChange={(e) => setIncidentDetails(e.target.value)}
                placeholder="Detailed description of what happened..."
                rows={3}
              />
            </div>
            
            {/* Vehicle of Interest */}
            <Card className="border-dashed">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Vehicle of Interest (Optional)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs">License Plate</Label>
                  <Input
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Notes</Label>
                  <Input
                    value={vehicleNotes}
                    onChange={(e) => setVehicleNotes(e.target.value)}
                    placeholder="Make, model, color, etc."
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIncidentDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (incidentTargetCard && incidentTitle) {
                  createIncidentMutation.mutate({
                    card: incidentTargetCard,
                    title: incidentTitle,
                    description: incidentDetails,
                    incidentType,
                    severity: incidentSeverity,
                    vehiclePlate: vehiclePlate || undefined,
                    vehicleNotes: vehicleNotes || undefined,
                  })
                }
              }}
              disabled={!incidentTitle || createIncidentMutation.isPending}
            >
              {createIncidentMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileWarning className="h-4 w-4 mr-2" />
              )}
              Create Incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              <div>
                <CardTitle>Access Control</CardTitle>
                <CardDescription>Identity verification for secure zones</CardDescription>
              </div>
            </div>
            
            {/* Location Status */}
            <div className="flex items-center gap-2">
              {unacknowledgedCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="cursor-pointer"
                  onClick={() => {
                    const first = resultCards.find(c => !c.acknowledged)
                    if (first) setActiveCardId(first.id)
                  }}
                >
                  {unacknowledgedCount} pending
                </Badge>
              )}
              {locationError ? (
                <Badge variant="destructive" className="gap-1">
                  <MapPin className="h-3 w-3" />
                  Location Error
                </Badge>
              ) : isInsideZone ? (
                <Badge className="bg-green-600 gap-1">
                  <MapPin className="h-3 w-3" />
                  Inside Zone
                </Badge>
              ) : selectedZoneId ? (
                <Badge variant="outline" className="gap-1 text-orange-600 border-orange-300">
                  <MapPin className="h-3 w-3" />
                  Outside Zone
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          {/* Zone Selection */}
          <div className="space-y-2">
            <Label>Access Control Zone</Label>
            <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
              <SelectTrigger>
                <SelectValue placeholder="Select zone..." />
              </SelectTrigger>
              <SelectContent>
                {accessZones.map(zone => (
                  <SelectItem key={zone.id} value={zone.id}>
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      {zone.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {accessZones.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No access control zones configured. Enable access control on a zone in Zone Management.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Main Content */}
      {selectedZoneId && (
        <Tabs defaultValue="verify" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="verify" className="gap-2">
              <ScanFace className="h-4 w-4" />
              <span className="hidden sm:inline">Verify</span>
            </TabsTrigger>
            <TabsTrigger value="monitor" className="gap-2">
              <Camera className="h-4 w-4" />
              <span className="hidden sm:inline">Monitor</span>
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Stats</span>
            </TabsTrigger>
            <TabsTrigger value="visitors" className="gap-2">
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Visitors</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
          </TabsList>
          
          {/* Monitor Tab - Video Stream */}
          <TabsContent value="monitor" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Video Stream Monitor
                </CardTitle>
                <CardDescription>
                  Connect to an IP camera or video stream to monitor and capture faces automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stream URL Input */}
                <div className="space-y-2">
                  <Label>Stream URL (HLS/DASH/MJPEG)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={streamUrl}
                      onChange={(e) => setStreamUrl(e.target.value)}
                      placeholder="https://camera.example.com/stream.m3u8"
                      disabled={isStreamConnected}
                    />
                    {!isStreamConnected ? (
                      <Button onClick={connectToStream} disabled={!streamUrl}>
                        Connect
                      </Button>
                    ) : (
                      <Button variant="destructive" onClick={disconnectStream}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                  {streamError && (
                    <p className="text-sm text-red-600">{streamError}</p>
                  )}
                </div>
                
                {/* Video Feed */}
                <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
                  {isStreamConnected ? (
                    <video
                      ref={streamVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                      <Camera className="h-16 w-16 mb-4 opacity-40" />
                      <p>Enter a stream URL and click Connect</p>
                      <p className="text-sm mt-2">Supports HLS (.m3u8), DASH (.mpd), and MJPEG streams</p>
                    </div>
                  )}
                  
                  {isStreamConnected && (
                    <div className="absolute top-2 left-2 flex items-center gap-2">
                      <Badge className="bg-green-600 gap-1">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        LIVE
                      </Badge>
                    </div>
                  )}
                  
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-white" />
                    </div>
                  )}
                </div>
                
                {/* Hidden canvas for capture */}
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Controls */}
                {isStreamConnected && (
                  <div className="flex flex-wrap items-center gap-4">
                    <Button
                      onClick={captureFromStream}
                      disabled={isProcessing}
                      className="gap-2"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      Capture Now
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="auto-capture"
                        checked={autoCapture}
                        onChange={(e) => setAutoCapture(e.target.checked)}
                        className="rounded"
                      />
                      <label htmlFor="auto-capture" className="text-sm cursor-pointer">
                        Auto-capture every
                      </label>
                      <Select
                        value={autoCaptureInterval.toString()}
                        onValueChange={(v) => setAutoCaptureInterval(parseInt(v))}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2s</SelectItem>
                          <SelectItem value="5">5s</SelectItem>
                          <SelectItem value="10">10s</SelectItem>
                          <SelectItem value="30">30s</SelectItem>
                          <SelectItem value="60">60s</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {autoCapture && (
                      <Badge variant="secondary" className="gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        Auto-capturing
                      </Badge>
                    )}
                  </div>
                )}
                
                {/* Tips */}
                <Card className="border-dashed">
                  <CardContent className="py-3">
                    <p className="text-sm text-muted-foreground">
                      <strong>Tips:</strong> For RTSP cameras, use a media server like FFmpeg or nginx-rtmp to convert to HLS.
                      Example: <code className="bg-muted px-1 rounded">ffmpeg -i rtsp://camera/stream -c copy -f hls output.m3u8</code>
                    </p>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Statistics Tab */}
          <TabsContent value="stats" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Zone Statistics</CardTitle>
                <CardDescription>Last 30 days overview</CardDescription>
              </CardHeader>
              <CardContent>
                {zoneStats ? (
                  <div className="space-y-6">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-green-50 rounded-lg text-center">
                        <p className="text-3xl font-bold text-green-600">{zoneStats.entries || 0}</p>
                        <p className="text-sm text-green-700">Entries</p>
                      </div>
                      <div className="p-4 bg-blue-50 rounded-lg text-center">
                        <p className="text-3xl font-bold text-blue-600">{zoneStats.exits || 0}</p>
                        <p className="text-sm text-blue-700">Exits</p>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg text-center">
                        <p className="text-3xl font-bold text-red-600">{zoneStats.denied || 0}</p>
                        <p className="text-sm text-red-700">Denied</p>
                      </div>
                      <div className="p-4 bg-orange-50 rounded-lg text-center">
                        <p className="text-3xl font-bold text-orange-600">{zoneStats.incidents || 0}</p>
                        <p className="text-sm text-orange-700">Incidents</p>
                      </div>
                    </div>
                    
                    {/* Additional Stats */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Unique Persons</p>
                        <p className="text-2xl font-semibold">{zoneStats.unique_persons || 0}</p>
                      </div>
                      <div className="p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Avg Match Confidence</p>
                        <p className="text-2xl font-semibold">
                          {zoneStats.avg_match_confidence 
                            ? `${(zoneStats.avg_match_confidence * 100).toFixed(1)}%`
                            : 'N/A'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Recent Incidents */}
                    {zoneStats.recent_incidents?.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-3">Recent Incidents</h4>
                        <div className="space-y-2">
                          {zoneStats.recent_incidents.map((incident: any) => (
                            <div key={incident.id} className="flex items-center gap-3 p-3 border rounded-lg">
                              <Badge variant={
                                incident.severity === 'critical' ? 'destructive' :
                                incident.severity === 'high' ? 'destructive' :
                                incident.severity === 'medium' ? 'default' : 'secondary'
                              }>
                                {incident.severity}
                              </Badge>
                              <div className="flex-1">
                                <p className="font-medium text-sm">{incident.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {incident.incident_type.replace('_', ' ')}
                                </p>
                              </div>
                              <Badge variant="outline">{incident.status}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-40" />
                    <p>No statistics available yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Verify Tab */}
          <TabsContent value="verify" className="space-y-4">
            {/* Geofence Warning */}
            {!isInsideZone && (
              <Card className="border-orange-300 bg-orange-50">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                    <div>
                      <p className="font-medium text-orange-800">Outside Zone Boundary</p>
                      <p className="text-sm text-orange-600">
                        You must be inside the zone boundary to verify identities.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Step 1: Search Person */}
            {verificationStep === 'search' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Step 1: Find Person</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or badge number..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  
                  {isSearching && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </div>
                  )}
                  
                  {searchResults.length > 0 && (
                    <div className="space-y-2">
                      {searchResults.map(person => (
                        <Card
                          key={person.id}
                          className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                            selectedPerson?.id === person.id ? 'ring-2 ring-primary' : ''
                          }`}
                          onClick={() => {
                            setSelectedPerson(person)
                            if (person.profile_photo_embedding) {
                              setVerificationStep('verify')
                            }
                          }}
                        >
                          <CardContent className="py-3">
                            <div className="flex items-center gap-3">
                              {person.profile_photo_url ? (
                                <img
                                  src={person.profile_photo_url}
                                  alt={personName(person)}
                                  className="w-12 h-12 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                                  <User className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                              
                              <div className="flex-1">
                                <p className="font-medium">{personName(person)}</p>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  {person.access_badge_number && (
                                    <span className="flex items-center gap-1">
                                      <Key className="h-3 w-3" />
                                      {person.access_badge_number}
                                    </span>
                                  )}
                                  {person.access_clearance_level && (
                                    <Badge variant="outline" className="text-xs">
                                      {person.access_clearance_level}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              
                              {!person.profile_photo_embedding && (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">
                                  No Photo
                                </Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  
                  {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                    <p className="text-center text-muted-foreground py-4">
                      No matching persons found
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Step 2: Verify */}
            {verificationStep === 'verify' && selectedPerson && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Step 2: Verify Identity</CardTitle>
                    <Button variant="ghost" size="sm" onClick={resetVerification}>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Person Info */}
                  <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                    {selectedPerson.profile_photo_url ? (
                      <img
                        src={selectedPerson.profile_photo_url}
                        alt={personName(selectedPerson)}
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-muted-foreground/10 flex items-center justify-center">
                        <User className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    
                    <div>
                      <h3 className="text-lg font-semibold">{personName(selectedPerson)}</h3>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {selectedPerson.access_badge_number && (
                          <p>Badge: {selectedPerson.access_badge_number}</p>
                        )}
                        {selectedPerson.access_clearance_level && (
                          <p>Clearance: {selectedPerson.access_clearance_level}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Camera / Captured Photo */}
                  {!capturedPhoto ? (
                    <div className="space-y-4">
                      {isCameraOpen ? (
                        <div className="space-y-4">
                          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover"
                            />
                            <canvas ref={canvasRef} className="hidden" />
                          </div>
                          
                          <div className="flex gap-2">
                            <Button
                              onClick={capturePhoto}
                              disabled={isProcessing}
                              className="flex-1"
                            >
                              {isProcessing ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Camera className="h-4 w-4 mr-2" />
                              )}
                              Capture Face
                            </Button>
                            <Button variant="outline" onClick={stopCamera}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          onClick={startCamera}
                          className="w-full h-24"
                          disabled={!isInsideZone}
                        >
                          <Camera className="h-6 w-6 mr-2" />
                          Open Camera for Face Verification
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="relative">
                        <img
                          src={capturedPhoto}
                          alt="Captured"
                          className="w-full max-h-64 object-contain rounded-lg"
                        />
                        <Badge className="absolute top-2 right-2 bg-green-600">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Face Detected
                        </Badge>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          onClick={() => verifyIdentityMutation.mutate()}
                          disabled={verifyIdentityMutation.isPending || !isInsideZone}
                          className="flex-1"
                        >
                          {verifyIdentityMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-4 w-4 mr-2" />
                          )}
                          Verify Identity
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCapturedPhoto(null)
                            setFaceEmbedding(null)
                          }}
                        >
                          Retake
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Step 3: Result */}
            {verificationStep === 'result' && verificationResult && (
              <Card className={verificationResult.access_granted ? 'border-green-300' : 'border-red-300'}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    {verificationResult.access_granted ? (
                      <>
                        <div className="p-3 rounded-full bg-green-100">
                          <Unlock className="h-8 w-8 text-green-600" />
                        </div>
                        <div>
                          <CardTitle className="text-green-600">ACCESS GRANTED</CardTitle>
                          <CardDescription>Identity verified successfully</CardDescription>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-3 rounded-full bg-red-100">
                          <Lock className="h-8 w-8 text-red-600" />
                        </div>
                        <div>
                          <CardTitle className="text-red-600">ACCESS DENIED</CardTitle>
                          <CardDescription>
                            {verificationResult.error || 'Verification failed'}
                          </CardDescription>
                        </div>
                      </>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  {/* Verification Details */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Face Match</Label>
                      <div className="flex items-center gap-2">
                        {verificationResult.verification?.face_match_passed ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span>
                          {verificationResult.verification?.face_similarity
                            ? `${(verificationResult.verification.face_similarity * 100).toFixed(1)}%`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Inside Zone</Label>
                      <div className="flex items-center gap-2">
                        {verificationResult.verification?.inside_geofence ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span>
                          {verificationResult.verification?.inside_geofence ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Permission</Label>
                      <div className="flex items-center gap-2">
                        {verificationResult.permission?.has_permission ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span>
                          {verificationResult.permission?.permission_type || 'None'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Clearance</Label>
                      <span>
                        {verificationResult.person?.access_clearance_level || 'N/A'}
                      </span>
                    </div>
                  </div>
                  
                  <Button onClick={resetVerification} className="w-full">
                    New Verification
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          {/* History Tab */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Access Entries</CardTitle>
              </CardHeader>
              <CardContent>
                {recentEntries.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No access entries recorded yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recentEntries.map(entry => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 border rounded-lg"
                      >
                        <div className={`p-2 rounded-full ${
                          entry.entry_type === 'entry' ? 'bg-green-100' :
                          entry.entry_type === 'exit' ? 'bg-blue-100' : 'bg-red-100'
                        }`}>
                          {entry.entry_type === 'entry' ? (
                            <LogIn className={`h-4 w-4 text-green-600`} />
                          ) : entry.entry_type === 'exit' ? (
                            <LogOut className={`h-4 w-4 text-blue-600`} />
                          ) : (
                            <Ban className={`h-4 w-4 text-red-600`} />
                          )}
                        </div>
                        
                        <div className="flex-1">
                          <p className="font-medium">
                            {entry.person_records
                              ? personName(entry.person_records)
                              : 'Unknown Person'}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(entry.created_at)}
                          </div>
                        </div>
                        
                        <Badge variant={
                          entry.entry_type === 'entry' ? 'default' :
                          entry.entry_type === 'exit' ? 'secondary' : 'destructive'
                        }>
                          {entry.entry_type.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Visitors Tab */}
          <TabsContent value="visitors" className="space-y-4">
            {/* Expiring Visitors Warning */}
            {expiringVisitors.length > 0 && (
              <Card className="border-orange-300 bg-orange-50">
                <CardHeader className="py-3">
                  <div className="flex items-center gap-2">
                    <AlertCircleIcon className="h-5 w-5 text-orange-600" />
                    <CardTitle className="text-base text-orange-800">
                      {expiringVisitors.length} Visitor{expiringVisitors.length !== 1 ? 's' : ''} Expiring Soon
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="py-2">
                  <p className="text-sm text-orange-700">
                    These visitor records will be automatically deleted when their retention period expires.
                  </p>
                </CardContent>
              </Card>
            )}
            
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Temporary Visitors</CardTitle>
                  <Badge variant="outline">{temporaryVisitors.length} records</Badge>
                </div>
                <CardDescription>
                  Short-term visitors with automatic data retention. Records are deleted after the retention period expires.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {temporaryVisitors.length === 0 ? (
                  <div className="text-center py-8">
                    <UserPlus className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground">No temporary visitors registered</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {temporaryVisitors.map(visitor => {
                      const daysRemaining = getDaysRemaining(visitor.data_retention_until)
                      const isExpiringSoon = daysRemaining !== null && daysRemaining <= 7
                      
                      return (
                        <div
                          key={visitor.id}
                          className={`p-4 border rounded-lg ${isExpiringSoon ? 'border-orange-300 bg-orange-50/50' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                              {visitor.profile_photo_url ? (
                                <img
                                  src={visitor.profile_photo_url}
                                  alt={personName(visitor)}
                                  className="w-12 h-12 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                                  <User className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                              
                              <div>
                                <p className="font-medium">{personName(visitor)}</p>
                                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                  {visitor.visitor_type && (
                                    <Badge variant="outline" className="text-xs capitalize">
                                      {visitor.visitor_type.replace('_', ' ')}
                                    </Badge>
                                  )}
                                  {visitor.access_badge_number && (
                                    <span className="flex items-center gap-1">
                                      <Key className="h-3 w-3" />
                                      {visitor.access_badge_number}
                                    </span>
                                  )}
                                </div>
                                {visitor.visit_purpose && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Purpose: {visitor.visit_purpose}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end gap-2">
                              {visitor.data_retention_until && (
                                <div className="text-right">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <CalendarClock className="h-3 w-3" />
                                    Expires: {new Date(visitor.data_retention_until).toLocaleDateString()}
                                  </div>
                                  {daysRemaining !== null && (
                                    <Badge 
                                      variant={daysRemaining <= 3 ? 'destructive' : daysRemaining <= 7 ? 'outline' : 'secondary'}
                                      className="text-xs mt-1"
                                    >
                                      {daysRemaining <= 0 ? 'Expired' : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left`}
                                    </Badge>
                                  )}
                                </div>
                              )}
                              
                              <div className="flex gap-1">
                                {visitor.data_retention_until && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      // Extend by 30 days
                                      const newDate = new Date()
                                      newDate.setDate(newDate.getDate() + 30)
                                      extendRetentionMutation.mutate({
                                        personId: visitor.id,
                                        newDate: newDate.toISOString(),
                                      })
                                    }}
                                    disabled={extendRetentionMutation.isPending}
                                  >
                                    <CalendarClock className="h-3 w-3 mr-1" />
                                    +30d
                                  </Button>
                                )}
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setDeleteVisitorDialog(visitor)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      
      {/* Delete Visitor Dialog */}
      <Dialog open={!!deleteVisitorDialog} onOpenChange={(open) => !open && setDeleteVisitorDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Delete Visitor Record
            </DialogTitle>
          </DialogHeader>
          
          {deleteVisitorDialog && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{personName(deleteVisitorDialog)}</p>
                {deleteVisitorDialog.visitor_type && (
                  <p className="text-sm text-muted-foreground capitalize">
                    {deleteVisitorDialog.visitor_type.replace('_', ' ')}
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label>Reason for deletion (optional)</Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Enter reason for deletion..."
                  rows={2}
                />
              </div>
              
              <div className="flex items-start gap-3 p-3 border rounded-lg bg-red-50 border-red-200">
                <input
                  type="checkbox"
                  id="immediate-delete"
                  checked={immediateDelete}
                  onChange={(e) => setImmediateDelete(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <label htmlFor="immediate-delete" className="font-medium text-red-800 cursor-pointer">
                    Permanent deletion (cannot be undone)
                  </label>
                  <p className="text-sm text-red-600">
                    Immediately delete all data including face records, ID documents, and access history.
                    If unchecked, records will be soft-deleted and removed after 30 days.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVisitorDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteVisitorDialog) {
                  deleteVisitorMutation.mutate({
                    personId: deleteVisitorDialog.id,
                    reason: deleteReason,
                    immediate: immediateDelete,
                  })
                }
              }}
              disabled={deleteVisitorMutation.isPending}
            >
              {deleteVisitorMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {immediateDelete ? 'Permanently Delete' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * FaceRecognition Component
 *
 * Camera-based face detection and recognition for enforcement officers.
 * Uses the inference service /infer/face endpoint for AI-powered face detection,
 * description, and embedding generation.
 *
 * Features:
 *  - Live camera viewfinder with manual capture
 *  - Face detection with bounding box overlay
 *  - AI-generated descriptions (age range, distinguishing features)
 *  - Face embedding generation for comparison/matching
 *  - Results history with face thumbnails
 *  - Face comparison between captures
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Camera, X, FlipHorizontal, ZoomIn, ZoomOut,
  User, UserCheck, UserX, Clock, Loader2, ScanFace,
  AlertTriangle, Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface POIMatch {
  face_record_id: string
  person_record_id: string
  similarity: number
  confidence: string
  same_person: boolean
  photo_url: string
  label: string | null
  face_created_at: string
  person: {
    id: string
    full_name: string | null
    date_of_birth: string | null
    notes: string | null
    homeless_status: string | null
    is_of_interest: boolean | null
    trespass_issued: boolean | null
    trespass_date: string | null
    risk_level: string | null
  }
}

interface FaceResult {
  id: string
  faceRecordId: string | null
  photoUrl: string
  faceCount: number
  faces: Array<{
    bbox: { x: number; y: number; width: number; height: number } | null
    confidence: number
    approximate_age: string
    gender: string
    description: string | null
  }>
  embedding: number[] | null
  detectionMethod: string
  capturedAt: string
  poiMatches: POIMatch[]
}

interface FaceRecognitionProps {
  onClose: () => void
  onFaceCaptured?: (result: FaceResult) => void
  /** Optional: existing face embedding to compare against */
  compareEmbedding?: number[] | null
  /** Optional: label for the comparison target */
  compareLabel?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FaceRecognition({
  onClose,
  onFaceCaptured,
  compareEmbedding,
  compareLabel,
}: FaceRecognitionProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)

  const [cameraReady, setCameraReady]     = useState(false)
  const [facingMode, setFacingMode]       = useState<'user' | 'environment'>('user')
  const [zoom, setZoom]                   = useState(1.0)
  const [isProcessing, setIsProcessing]   = useState(false)
  const [results, setResults]             = useState<FaceResult[]>([])
  const [comparisonResult, setComparisonResult] = useState<{
    similarity: number
    samePerson: boolean
    confidence: string
  } | null>(null)

  const user = useAuthStore(s => s.user)

  // ── Camera lifecycle ────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraReady(true)
      }
    } catch (err: any) {
      console.error('Camera start failed:', err)
      toast.error('Camera access denied. Please allow camera permissions.')
      setCameraReady(false)
    }
  }, [facingMode])

  useEffect(() => {
    startCamera()
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [startCamera])

  // ── Zoom ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!streamRef.current) return
    const track = streamRef.current.getVideoTracks()[0]
    if (!track) return
    const capabilities = track.getCapabilities?.() as any
    if (capabilities?.zoom) {
      const maxZoom = capabilities.zoom.max ?? 5
      const clampedZoom = Math.min(zoom, maxZoom)
      track.applyConstraints({ advanced: [{ zoom: clampedZoom } as any] }).catch((err) => {
        console.warn('Zoom constraint failed:', err)
      })
    }
  }, [zoom])

  // ── Capture + detect ────────────────────────────────────────────────────────

  const captureAndDetect = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || isProcessing) return
    setIsProcessing(true)

    try {
      const video  = videoRef.current
      const canvas = canvasRef.current
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context unavailable')
      ctx.drawImage(video, 0, 0)

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Blob creation failed')), 'image/jpeg', 0.9)
      })

      // Upload to Supabase storage
      // Path must start with user UUID to satisfy the scans bucket RLS policy
      const timestamp = Date.now()
      const filePath = `${user?.id}/face-scans/${timestamp}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      // Call inference service via edge function — detect_and_match searches POI
      const { data: faceData, error: faceError } = await edgeFunctions.processFaceScan(
        { action: 'detect_and_match', photo_url: photoUrl }
      )

      if (faceError) throw new Error(faceError || 'Face detection failed')

      const poiMatches: POIMatch[] = faceData?.poi_matches ?? []

      const result: FaceResult = {
        id:              `face-${timestamp}`,
        faceRecordId:    faceData?.face_record_id ?? null,
        photoUrl,
        faceCount:       faceData?.face_count ?? 0,
        faces:           faceData?.faces ?? [],
        embedding:       faceData?.embedding ?? null,
        detectionMethod: faceData?.metadata?.detection_method ?? 'unknown',
        capturedAt:      new Date().toISOString(),
        poiMatches,
      }

      setResults(prev => [result, ...prev])

      if (result.faceCount > 0) {
        if (poiMatches.length > 0) {
          const bestMatch = poiMatches[0]
          const matchName = bestMatch.person.full_name || 'Unknown'
          toast.warning(
            `⚠️ POI Match: ${matchName} (${(bestMatch.similarity * 100).toFixed(0)}%)` +
            (bestMatch.person.trespass_issued ? ' — TRESPASS ACTIVE' : ''),
            { duration: 8000 }
          )
        } else {
          toast.success(`${result.faceCount} face${result.faceCount > 1 ? 's' : ''} detected — no POI matches`)
        }
      } else {
        toast.info('No faces detected in this capture')
      }

      // Compare with existing embedding if provided
      if (compareEmbedding && result.embedding) {
        try {
          const { data: cmpData, error: cmpError } = await edgeFunctions.processFaceScan(
            {
              action: 'compare',
              embedding1: compareEmbedding,
              embedding2: result.embedding,
            }
          )

          if (!cmpError && cmpData) {
            setComparisonResult({
              similarity: cmpData.similarity,
              samePerson: cmpData.same_person,
              confidence: cmpData.confidence,
            })
          }
        } catch {
          // Comparison failure is non-fatal
        }
      }

      onFaceCaptured?.(result)
    } catch (err: any) {
      console.error('Face capture failed:', err)
      toast.error(err.message || 'Face capture failed')
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, user, compareEmbedding, onFaceCaptured])

  // ── Flip camera ─────────────────────────────────────────────────────────────

  const flipCamera = useCallback(() => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user')
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-black">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 text-white z-10">
        <div className="flex items-center gap-2">
          <ScanFace className="h-5 w-5 text-blue-400" />
          <span className="font-semibold text-sm">Face Recognition</span>
          {results.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {results.length} capture{results.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-gray-800">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Viewfinder ────────────────────────────────────────────────── */}
      <div className="relative flex-shrink-0" style={{ height: '55dvh' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Face guide overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute border-2 border-dashed border-blue-400/60 rounded-full"
            style={{
              left: '25%', top: '10%', width: '50%', height: '70%',
            }}
          />
          <div className="absolute bottom-3 left-0 right-0 text-center">
            <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
              Position face within the guide
            </span>
          </div>
        </div>

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Detecting faces…</span>
            </div>
          </div>
        )}

        {/* Camera controls */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-4">
          {/* Zoom out */}
          <Button
            variant="ghost"
            size="icon"
            className="bg-black/50 text-white rounded-full"
            onClick={() => setZoom(z => Math.max(1.0, z - 0.5))}
            disabled={zoom <= 1.0}
          >
            <ZoomOut className="h-5 w-5" />
          </Button>

          {/* Shutter button */}
          <button
            onClick={captureAndDetect}
            disabled={!cameraReady || isProcessing}
            className={`w-16 h-16 rounded-full border-4 border-white flex items-center justify-center
              ${isProcessing ? 'bg-gray-500' : 'bg-blue-600 active:bg-blue-800'}
              disabled:opacity-50 transition-colors`}
          >
            <Camera className="h-7 w-7 text-white" />
          </button>

          {/* Zoom in */}
          <Button
            variant="ghost"
            size="icon"
            className="bg-black/50 text-white rounded-full"
            onClick={() => setZoom(z => Math.min(5.0, z + 0.5))}
            disabled={zoom >= 5.0}
          >
            <ZoomIn className="h-5 w-5" />
          </Button>
        </div>

        {/* Flip camera */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3 bg-black/50 text-white rounded-full"
          onClick={flipCamera}
        >
          <FlipHorizontal className="h-5 w-5" />
        </Button>

        {/* Zoom badge */}
        {zoom > 1.0 && (
          <Badge className="absolute top-3 left-3 bg-black/60 text-white text-xs">
            {zoom.toFixed(1)}×
          </Badge>
        )}
      </div>

      {/* ── Comparison result ──────────────────────────────────────────── */}
      {comparisonResult && compareLabel && (
        <div className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${
          comparisonResult.samePerson
            ? 'bg-green-600 text-white'
            : 'bg-amber-600 text-white'
        }`}>
          {comparisonResult.samePerson ? (
            <UserCheck className="h-4 w-4" />
          ) : (
            <UserX className="h-4 w-4" />
          )}
          <span>
            {comparisonResult.samePerson
              ? `Match with ${compareLabel} (${(comparisonResult.similarity * 100).toFixed(1)}%)`
              : `No match with ${compareLabel} (${(comparisonResult.similarity * 100).toFixed(1)}%)`
            }
          </span>
          <Badge variant="outline" className="ml-auto text-xs border-white/40">
            {comparisonResult.confidence}
          </Badge>
        </div>
      )}

      {/* ── Results feed ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 p-6">
            <ScanFace className="h-10 w-10" />
            <span className="text-sm text-center">
              Capture a photo to detect faces.<br />
              AI will identify faces and generate descriptions.
            </span>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {results.map(r => (
              <Card key={r.id} className={`overflow-hidden ${
                r.poiMatches.some(m => m.same_person) ? 'ring-2 ring-red-500' : ''
              }`}>
                {/* POI match banner */}
                {r.poiMatches.length > 0 && r.poiMatches.some(m => m.same_person) && (
                  <div className="bg-red-600 text-white px-3 py-2 text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>POI Match Found</span>
                  </div>
                )}
                <CardContent className="p-3">
                  <div className="flex gap-3">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-gray-200">
                      <img
                        src={r.photoUrl}
                        alt="Face capture"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {r.faceCount > 0 ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">
                            <User className="h-3 w-3 mr-1" />
                            {r.faceCount} face{r.faceCount !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-gray-500">
                            No faces detected
                          </Badge>
                        )}
                        <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(r.capturedAt).toLocaleTimeString('en-NZ')}
                        </span>
                      </div>

                      {/* Face descriptions */}
                      {r.faces.map((face, idx) => (
                        <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          <span className="font-medium">Face {idx + 1}:</span>{' '}
                          {face.description ?? `${face.approximate_age}, ${face.gender}`}
                          <span className="text-gray-400 ml-1">
                            ({(face.confidence * 100).toFixed(0)}%)
                          </span>
                        </div>
                      ))}

                      {/* Embedding indicator */}
                      {r.embedding && r.poiMatches.length === 0 && (
                        <Badge variant="outline" className="text-xs mt-1 text-blue-600">
                          Embedding saved — no POI matches
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* ── POI match details ──────────────────────────────── */}
                  {r.poiMatches.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {r.poiMatches.map((match) => (
                        <div
                          key={match.face_record_id}
                          className={`border rounded-lg p-3 text-sm ${
                            match.same_person
                              ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                              : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Match photo thumbnail */}
                            {match.photo_url && (
                              <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-200">
                                <img
                                  src={match.photo_url}
                                  alt="POI match"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {/* Name + similarity */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm">
                                  {match.person.full_name || 'Unknown Person'}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${
                                    match.confidence === 'high' ? 'border-red-400 text-red-700' :
                                    match.confidence === 'medium' ? 'border-amber-400 text-amber-700' :
                                    'border-gray-300 text-gray-600'
                                  }`}
                                >
                                  {(match.similarity * 100).toFixed(0)}% match
                                </Badge>
                              </div>

                              {/* POI / Trespass badges */}
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {match.person.is_of_interest && (
                                  <Badge className="bg-orange-600 text-white text-[10px] gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Person of Interest
                                  </Badge>
                                )}
                                {match.person.trespass_issued && (
                                  <Badge className="bg-red-700 text-white text-[10px] gap-1">
                                    <Shield className="h-3 w-3" />
                                    Trespass Active
                                    {match.person.trespass_date && (
                                      <span className="ml-1 opacity-80">
                                        (since {new Date(match.person.trespass_date).toLocaleDateString('en-NZ')})
                                      </span>
                                    )}
                                  </Badge>
                                )}
                                {match.person.risk_level && (
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${
                                      match.person.risk_level === 'critical' ? 'border-red-500 text-red-700' :
                                      match.person.risk_level === 'high' ? 'border-orange-500 text-orange-700' :
                                      match.person.risk_level === 'medium' ? 'border-amber-500 text-amber-700' :
                                      'border-gray-300'
                                    }`}
                                  >
                                    Risk: {match.person.risk_level}
                                  </Badge>
                                )}
                              </div>

                              {/* Notes */}
                              {match.person.notes && (
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                                  {match.person.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


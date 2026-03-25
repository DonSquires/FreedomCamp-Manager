/**
 * Face Recognition Page
 *
 * Admin/officer page for face detection and recognition.
 * Provides camera-based face capture, AI-powered detection,
 * and face comparison capabilities.
 */

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ScanFace, Camera, History, Users, Search,
  Clock, User, Shield, AlertTriangle,
} from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { FaceRecognition } from '@/components/features/FaceRecognition'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FaceRecordRow {
  id: string
  photo_url: string
  face_count: number
  faces: Array<{
    confidence: number
    approximate_age: string
    gender: string
    description: string | null
  }>
  detection_method: string | null
  officer_id: string | null
  label: string | null
  notes: string | null
  created_at: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FaceRecognitionPage() {
  const [cameraOpen, setCameraOpen] = useState(false)
  const user = useAuthStore(s => s.user)

  // Fetch recent face records
  const { data: recentRecords, refetch } = useQuery({
    queryKey: ['face-records', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('face_records')
        .select('id, photo_url, face_count, faces, detection_method, officer_id, label, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return (data ?? []) as FaceRecordRow[]
    },
    enabled: !!user?.organization_id,
  })

  const handleFaceCaptured = useCallback(() => {
    refetch()
  }, [refetch])

  // ── Camera mode ─────────────────────────────────────────────────────────────

  if (cameraOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <FaceRecognition
          onClose={() => setCameraOpen(false)}
          onFaceCaptured={handleFaceCaptured}
        />
      </div>
    )
  }

  // ── Page layout ─────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScanFace className="h-7 w-7 text-blue-600" />
              Face Recognition
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-powered face detection for enforcement and identification
            </p>
          </div>
          <Button onClick={() => setCameraOpen(true)} className="gap-2">
            <Camera className="h-4 w-4" />
            Open Camera
          </Button>
        </div>

        {/* Privacy notice */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <Shield className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">Privacy Notice</p>
              <p className="text-amber-700 dark:text-amber-300 mt-1">
                Face recognition data is processed securely and stored within your organisation only.
                Face embeddings are numerical vectors — they cannot be reverse-engineered into images.
                All data is subject to NZ Privacy Act 2020 requirements.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="recent">
          <TabsList>
            <TabsTrigger value="recent" className="gap-1">
              <History className="h-4 w-4" />
              Recent Captures
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-1">
              <Search className="h-4 w-4" />
              Search
            </TabsTrigger>
          </TabsList>

          {/* Recent captures */}
          <TabsContent value="recent" className="mt-4">
            {!recentRecords || recentRecords.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <ScanFace className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No face captures yet</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Open the camera to start detecting faces
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4 gap-2"
                    onClick={() => setCameraOpen(true)}
                  >
                    <Camera className="h-4 w-4" />
                    Start Capture
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentRecords.map(record => (
                  <Card key={record.id} className="overflow-hidden">
                    <div className="aspect-video bg-gray-100 relative">
                      <img
                        src={record.photo_url}
                        alt="Face capture"
                        className="w-full h-full object-cover"
                      />
                      <Badge
                        className={`absolute top-2 left-2 text-xs ${
                          record.face_count > 0
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-500 text-white'
                        }`}
                      >
                        <Users className="h-3 w-3 mr-1" />
                        {record.face_count} face{record.face_count !== 1 ? 's' : ''}
                      </Badge>
                      {record.label && (
                        <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-white/90">
                          {record.label}
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <Clock className="h-3 w-3" />
                        {new Date(record.created_at).toLocaleString('en-NZ')}
                        <Badge variant="outline" className="ml-auto text-xs">
                          {record.detection_method ?? 'unknown'}
                        </Badge>
                      </div>
                      {record.faces?.map((face: any, idx: number) => (
                        <div key={idx} className="text-xs text-gray-600 dark:text-gray-400">
                          <User className="h-3 w-3 inline mr-1" />
                          {face.description ?? `${face.approximate_age}, ${face.gender}`}
                          <span className="text-gray-400 ml-1">
                            ({(face.confidence * 100).toFixed(0)}%)
                          </span>
                        </div>
                      ))}
                      {record.notes && (
                        <p className="text-xs text-gray-500 mt-2 italic">{record.notes}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Search */}
          <TabsContent value="search" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Face Search</CardTitle>
                <CardDescription>
                  Compare a new face capture against existing records using AI-powered
                  embedding similarity.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-4 p-6 border-2 border-dashed rounded-lg">
                  <ScanFace className="h-10 w-10 text-gray-400" />
                  <p className="text-sm text-gray-500 text-center">
                    Capture a face photo to search for matches in your organisation&apos;s records
                  </p>
                  <Button variant="outline" className="gap-2" onClick={() => setCameraOpen(true)}>
                    <Camera className="h-4 w-4" />
                    Capture & Search
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}

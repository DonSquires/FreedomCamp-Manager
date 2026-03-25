/**
 * Face Recognition Page
 *
 * Admin/officer page for face detection and recognition.
 * Provides camera-based face capture, AI-powered detection,
 * face comparison, and POI (Person of Interest) matching.
 *
 * When a face is captured:
 *   1. Face is detected and an embedding is generated
 *   2. The embedding is automatically compared against all known POI face records
 *   3. If a match is found, the person's details are shown immediately
 *   4. Officers can link new face captures to existing person records
 */

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ScanFace, Camera, History, Search,
  Clock, User, Shield, AlertTriangle, UserCheck, Link2,
} from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { FaceRecognition, type POIMatch } from '@/components/features/FaceRecognition'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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
  person_record_id: string | null
  created_at: string
}

interface PersonOption {
  id: string
  full_name: string
  is_of_interest: boolean | null
  trespass_notice_issued: boolean | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FaceRecognitionPage() {
  const [cameraOpen, setCameraOpen] = useState(false)
  const [linkDialog, setLinkDialog] = useState<{ faceRecordId: string; photoUrl: string } | null>(null)
  const [selectedPersonId, setSelectedPersonId] = useState<string>('')
  const [lastMatches, setLastMatches] = useState<POIMatch[]>([])

  const user = useAuthStore(s => s.user)
  const queryClient = useQueryClient()

  // Fetch recent face records
  const { data: recentRecords, refetch } = useQuery({
    queryKey: ['face-records', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('face_records')
        .select('id, photo_url, face_count, faces, detection_method, officer_id, label, notes, person_record_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return (data ?? []) as FaceRecordRow[]
    },
    enabled: !!user?.organization_id,
  })

  // Fetch person records for the link dialog
  const { data: personOptions = [] } = useQuery({
    queryKey: ['person-records-options'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('person_records') as any)
        .select('id, full_name, is_of_interest, trespass_notice_issued')
        .order('full_name')
        .limit(500)

      if (error) throw error
      return (data ?? []) as PersonOption[]
    },
    enabled: !!linkDialog,
  })

  const handleFaceCaptured = useCallback((result: any) => {
    refetch()
    if (result.poiMatches?.length > 0) {
      setLastMatches(result.poiMatches)
    }
  }, [refetch])

  const handleLinkToPerson = useCallback(async () => {
    if (!linkDialog || !selectedPersonId) return

    try {
      const { error } = await supabase.functions.invoke('process-face-scan', {
        body: {
          action: 'link_poi',
          face_record_id: linkDialog.faceRecordId,
          person_record_id: selectedPersonId,
        },
      })

      if (error) throw error

      toast.success('Face linked to person record')
      setLinkDialog(null)
      setSelectedPersonId('')
      refetch()
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
    } catch (err: any) {
      toast.error(err.message || 'Failed to link')
    }
  }, [linkDialog, selectedPersonId, refetch, queryClient])

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

  // ── Computed stats ──────────────────────────────────────────────────────────

  const linkedRecords = recentRecords?.filter(r => r.person_record_id) ?? []
  const unlinkedWithFaces = recentRecords?.filter(r => !r.person_record_id && r.face_count > 0) ?? []

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
              AI-powered face detection with automatic POI / trespass matching
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

        {/* How it works */}
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <ScanFace className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-200">How POI Matching Works</p>
              <p className="text-blue-700 dark:text-blue-300 mt-1">
                1. Take a photo of a person → AI detects the face and generates an embedding.<br/>
                2. The embedding is automatically compared against all linked POI face records.<br/>
                3. If a match is found, the person&apos;s details (including trespass status) are shown immediately.<br/>
                4. You can link new captures to existing person records to build the recognition database.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Last POI match alert */}
        {lastMatches.length > 0 && lastMatches.some(m => m.same_person) && (
          <Card className="border-red-300 bg-red-50 dark:bg-red-950/30 ring-2 ring-red-400">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                Latest POI Match
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {lastMatches.filter(m => m.same_person).map(match => (
                <div key={match.face_record_id} className="flex items-start gap-3 mb-2">
                  {match.photo_url && (
                    <div className="flex-shrink-0 w-14 h-14 rounded overflow-hidden">
                      <img src={match.photo_url} alt="POI" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div>
                    <p className="font-bold">{match.person.full_name || 'Unknown'}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge className="text-xs">{(match.similarity * 100).toFixed(0)}% match</Badge>
                      {match.person.is_of_interest && (
                        <Badge className="bg-orange-600 text-white text-xs">Person of Interest</Badge>
                      )}
                      {match.person.trespass_issued && (
                        <Badge className="bg-red-700 text-white text-xs">Trespass Active</Badge>
                      )}
                      {match.person.risk_level && (
                        <Badge variant="outline" className="text-xs">Risk: {match.person.risk_level}</Badge>
                      )}
                    </div>
                    {match.person.notes && (
                      <p className="text-xs text-gray-600 mt-1">{match.person.notes}</p>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setLastMatches([])}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="recent">
          <TabsList>
            <TabsTrigger value="recent" className="gap-1">
              <History className="h-4 w-4" />
              Recent ({recentRecords?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="linked" className="gap-1">
              <UserCheck className="h-4 w-4" />
              Linked POI ({linkedRecords.length})
            </TabsTrigger>
            <TabsTrigger value="unlinked" className="gap-1">
              <Search className="h-4 w-4" />
              Unlinked ({unlinkedWithFaces.length})
            </TabsTrigger>
          </TabsList>

          {/* Recent captures */}
          <TabsContent value="recent" className="mt-4">
            <FaceRecordGrid
              records={recentRecords ?? []}
              emptyMessage="No face captures yet. Open the camera to start detecting faces."
              onOpenCamera={() => setCameraOpen(true)}
              onLinkPerson={(id, url) => setLinkDialog({ faceRecordId: id, photoUrl: url })}
            />
          </TabsContent>

          {/* Linked to POI */}
          <TabsContent value="linked" className="mt-4">
            <FaceRecordGrid
              records={linkedRecords}
              emptyMessage="No face captures are linked to person records yet. Use the camera to capture and link faces."
              onOpenCamera={() => setCameraOpen(true)}
              onLinkPerson={(id, url) => setLinkDialog({ faceRecordId: id, photoUrl: url })}
            />
          </TabsContent>

          {/* Unlinked with faces */}
          <TabsContent value="unlinked" className="mt-4">
            <FaceRecordGrid
              records={unlinkedWithFaces}
              emptyMessage="All face captures are linked to person records."
              onOpenCamera={() => setCameraOpen(true)}
              onLinkPerson={(id, url) => setLinkDialog({ faceRecordId: id, photoUrl: url })}
              showLinkButton
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Link to Person dialog ──────────────────────────────────── */}
      <Dialog open={!!linkDialog} onOpenChange={() => { setLinkDialog(null); setSelectedPersonId('') }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Link Face to Person Record
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {linkDialog?.photoUrl && (
              <div className="mx-auto w-24 h-24 rounded-lg overflow-hidden">
                <img src={linkDialog.photoUrl} alt="Face" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Select a person record to link this face capture to. This allows the system
                to automatically identify this person in future captures.
              </p>
              <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a person…" />
                </SelectTrigger>
                <SelectContent>
                  {personOptions.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <span>{p.full_name}</span>
                        {p.is_of_interest && (
                          <Badge className="bg-orange-600 text-white text-[10px] ml-1">POI</Badge>
                        )}
                        {p.trespass_notice_issued && (
                          <Badge className="bg-red-700 text-white text-[10px] ml-1">Trespass</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkDialog(null); setSelectedPersonId('') }}>
              Cancel
            </Button>
            <Button onClick={handleLinkToPerson} disabled={!selectedPersonId}>
              <Link2 className="h-4 w-4 mr-2" />
              Link to Person
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

// ── Face record grid sub-component ────────────────────────────────────────────

function FaceRecordGrid({
  records,
  emptyMessage,
  onOpenCamera,
  onLinkPerson,
  showLinkButton = false,
}: {
  records: FaceRecordRow[]
  emptyMessage: string
  onOpenCamera: () => void
  onLinkPerson: (faceRecordId: string, photoUrl: string) => void
  showLinkButton?: boolean
}) {
  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <ScanFace className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{emptyMessage}</p>
          <Button variant="outline" className="mt-4 gap-2" onClick={onOpenCamera}>
            <Camera className="h-4 w-4" />
            Start Capture
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {records.map(record => (
        <Card key={record.id} className={`overflow-hidden ${
          record.person_record_id ? 'ring-1 ring-green-400' : ''
        }`}>
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
              <User className="h-3 w-3 mr-1" />
              {record.face_count} face{record.face_count !== 1 ? 's' : ''}
            </Badge>
            {record.person_record_id && (
              <Badge className="absolute top-2 right-2 text-xs bg-green-600 text-white">
                <UserCheck className="h-3 w-3 mr-1" />
                Linked
              </Badge>
            )}
            {record.label && !record.person_record_id && (
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
            {/* Link button for unlinked records */}
            {(showLinkButton || !record.person_record_id) && record.face_count > 0 && !record.person_record_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2 text-xs gap-1"
                onClick={() => onLinkPerson(record.id, record.photo_url)}
              >
                <Link2 className="h-3 w-3" />
                Link to Person Record
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

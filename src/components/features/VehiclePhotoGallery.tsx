/**
 * VehiclePhotoGallery Component
 * All vehicle photos with selection and profile photo setting
 */

import { formatDate, formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { getObservationPhotoUrl } from '@/lib/photoUtils'
import { 
  Image as ImageIcon,
  Star,
  Calendar,
  MapPin,
  Check,
  Download,
  ExternalLink,
  Grid,
  List,
  Car,
} from 'lucide-react'
import { toast } from 'sonner'

interface VehiclePhotoGalleryProps {
  plateNumber: string
  allowSetProfilePhoto?: boolean
}

export function VehiclePhotoGallery({
  plateNumber,
  allowSetProfilePhoto = true,
}: VehiclePhotoGalleryProps) {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null)
  const [errorPhotoIds, setErrorPhotoIds] = useState<Set<string>>(new Set())

  const markPhotoError = (id: string) =>
    setErrorPhotoIds((prev) => new Set([...prev, id]))

  // Fetch vehicle photos
  const { data: photos, isLoading } = useQuery({
    queryKey: ['vehicle-photos', plateNumber],
    queryFn: async () => {
      const { data, error } = await (supabase.from('observations') as any)
        .select(`
          id:observation_id,
          photo,
          photo_url,
          photo_hash,
          recorded_at,
          zones!observations_zone_id_fkey (
            name
          ),
          gps_latitude,
          gps_longitude,
          is_compliant
        `)
        .eq('plate_number', plateNumber)
        .or('photo.not.is.null,photo_url.not.is.null')
        .order('recorded_at', { ascending: false })

      if (error) throw error

      // Resolve photo URL from whichever column has data (photo takes priority)
      return (data || []).map((row: any) => ({
        ...row,
        photo_url: getObservationPhotoUrl(row) ?? row.photo_url ?? row.photo,
      }))
    },
  })

  // Fetch current profile photo
  const { data: vehicle } = useQuery({
    queryKey: ['vehicle-profile-photo', plateNumber],
    queryFn: async () => {
      const { data, error } = await (supabase.from('canonical_vehicles') as any)
        .select('profile_photo')
        .eq('plate_number', plateNumber)
        .single()

      if (error) throw error
      return data
    },
  })

  // Set profile photo mutation
  const setProfilePhotoMutation = useMutation({
    mutationFn: async (photoUrl: string) => {
      const { data, error } = await (supabase.from('canonical_vehicles') as any)
        .update({
          profile_photo: photoUrl,
          profile_photo_selected_at: new Date().toISOString(),
        })
        .eq('plate_number', plateNumber)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-profile-photo', plateNumber] })
      queryClient.invalidateQueries({ queryKey: ['vehicle-details', plateNumber] })
      setSelectedPhoto(null)
      toast.success('Profile photo updated')
    },
    onError: (error: any) => {
      toast.error(`Failed to set profile photo: ${error.message}`)
    },
  })

  const handleSetProfilePhoto = (photoUrl: string) => {
    if (confirm('Set this as the vehicle profile photo?')) {
      setProfilePhotoMutation.mutate(photoUrl)
    }
  }

  const isProfilePhoto = (photoUrl: string) => {
    return (vehicle as any)?.profile_photo === photoUrl
  }

  const openLightbox = (photoUrl: string) => {
    setLightboxPhoto(photoUrl)
  }

  const closeLightbox = () => {
    setLightboxPhoto(null)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Photo Gallery
              </CardTitle>
              <CardDescription className="mt-1">
                All photos of {plateNumber} ({photos?.length || 0} total)
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading photos...
            </div>
          ) : photos && photos.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <div
                      className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border"
                      onClick={() => !errorPhotoIds.has(photo.id) && openLightbox(photo.photo_url)}
                    >
                      {errorPhotoIds.has(photo.id) ? (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <Car className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                      ) : (
                        <img
                          src={photo.photo_url}
                          alt={`Photo from ${formatDate(photo.recorded_at)}`}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          onError={() => markPhotoError(photo.id)}
                        />
                      )}
                      
                      {/* Overlay badges */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1">
                        {isProfilePhoto(photo.photo_url) && (
                          <Badge className="bg-yellow-500">
                            <Star className="h-3 w-3 mr-1" />
                            Profile
                          </Badge>
                        )}
                        {!photo.is_compliant && (
                          <Badge variant="destructive">Breach</Badge>
                        )}
                      </div>

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                        <div className="text-white text-xs text-center">
                          {formatDate(photo.recorded_at)}
                        </div>
                        {allowSetProfilePhoto && !isProfilePhoto(photo.photo_url) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSetProfilePhoto(photo.photo_url)
                            }}
                          >
                            <Star className="h-3 w-3 mr-1" />
                            Set Profile
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {photos.map((photo) => (
                  <Card key={photo.id}>
                    <CardContent className="pt-4">
                      <div className="flex gap-4">
                        {/* Thumbnail */}
                        <div
                          className="relative w-32 h-32 flex-shrink-0 cursor-pointer overflow-hidden rounded"
                          onClick={() => !errorPhotoIds.has(photo.id) && openLightbox(photo.photo_url)}
                        >
                          {errorPhotoIds.has(photo.id) ? (
                            <div className="w-full h-full flex items-center justify-center bg-muted rounded">
                              <Car className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                          ) : (
                            <img
                              src={photo.photo_url}
                              alt="Observation"
                              className="w-full h-full object-cover rounded"
                              onError={() => markPhotoError(photo.id)}
                            />
                          )}
                          {isProfilePhoto(photo.photo_url) && (
                            <div className="absolute top-1 right-1">
                              <Badge className="bg-yellow-500 text-xs">
                                <Star className="h-3 w-3" />
                              </Badge>
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {formatDateTime(photo.recorded_at)}
                            </span>
                          </div>
                          
                          {(photo.zones as any)?.name && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{(photo.zones as any).name}</span>
                            </div>
                          )}

                          {photo.gps_latitude && photo.gps_longitude && (
                            <div className="text-xs text-muted-foreground">
                              GPS: {photo.gps_latitude.toFixed(6)}, {photo.gps_longitude.toFixed(6)}
                            </div>
                          )}

                          <div className="flex gap-2 pt-2">
                            {allowSetProfilePhoto && !isProfilePhoto(photo.photo_url) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSetProfilePhoto(photo.photo_url)}
                              >
                                <Star className="h-3 w-3 mr-1" />
                                Set Profile
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(photo.photo_url, '_blank')}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No photos available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lightbox */}
      {lightboxPhoto && (
        <Dialog open={!!lightboxPhoto} onOpenChange={() => closeLightbox()}>
          <DialogContent className="max-w-4xl">
            <img
              src={lightboxPhoto}
              alt="Full size"
              className="w-full h-auto"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

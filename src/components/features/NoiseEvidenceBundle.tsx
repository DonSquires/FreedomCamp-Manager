/**
 * NoiseEvidenceBundle (B-08)
 *
 * Displays a structured, downloadable evidence bundle for a noise assessment.
 * Aggregates:
 *   - Address photo (address_photo_url)
 *   - Evidence photos array (photos[])
 *   - Assessment metadata (dB, matrix score, recommended action, times)
 *
 * The bundle can be expanded/collapsed and all individual photos can be
 * opened in a new tab. A "Download evidence" button opens each photo URL
 * in a new tab sequence so the officer can save them to device.
 *
 * Usage:
 *   <NoiseEvidenceBundle assessmentId={completedAssessmentId} />
 *
 * The component self-fetches the assessment row so it can be dropped anywhere.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Package,
  Camera,
  MapPin,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Download,
  FileText,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface NoiseAssessmentRow {
  id: string
  address: string
  assessed_at: string
  address_photo_url: string | null
  photos: string[] | null
  noise_level_db: number | null
  noise_source: string | null
  noise_type: string | null
  recommended_action: string
  matrix_total_score: number | null
  time_category: string
  officer_id: string
}

interface NoiseEvidenceBundleProps {
  /** ID of the noise_assessment to display evidence for. */
  assessmentId: string
  /** Optional callback when user clicks "Generate Notice PDF" (if wired in). */
  onGenerateNotice?: () => void
  className?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionLabel(action: string): string {
  const map: Record<string, string> = {
    no_action:          'No Action',
    verbal_warning:     'Verbal Warning',
    abatement_notice:   'Abatement Notice (AN)',
    direction_notice:   'Direction Notice (DN)',
    enforcement_notice: 'Enforcement Notice (END)',
  }
  return map[action] ?? action.replace(/_/g, ' ')
}

function actionBadgeColor(action: string): string {
  if (action === 'enforcement_notice') return 'bg-red-100 text-red-800 border-red-200'
  if (action === 'direction_notice')   return 'bg-orange-100 text-orange-800 border-orange-200'
  if (action === 'abatement_notice')   return 'bg-yellow-100 text-yellow-800 border-yellow-200'
  if (action === 'verbal_warning')     return 'bg-blue-100 text-blue-800 border-blue-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

function scoreLabel(score: number | null): string {
  if (score === null) return 'n/a'
  if (score === 0) return `${score} — No Noise`
  if (score <= 4) return `${score} — Acceptable`
  return `${score} — Excessive`
}

// ─── Component ────────────────────────────────────────────────────────────────
export function NoiseEvidenceBundle({
  assessmentId,
  onGenerateNotice,
  className = '',
}: NoiseEvidenceBundleProps) {
  const [open, setOpen] = useState(true)

  const { data: assessment, isLoading } = useQuery<NoiseAssessmentRow>({
    queryKey: ['noise-assessment-evidence', assessmentId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('noise_assessments') as any)
        .select(
          'id, address, assessed_at, address_photo_url, photos, noise_level_db, ' +
          'noise_source, noise_type, recommended_action, matrix_total_score, time_category, officer_id',
        )
        .eq('id', assessmentId)
        .single()
      if (error) throw error
      return data as NoiseAssessmentRow
    },
    enabled: !!assessmentId,
    staleTime: 60 * 1000,
  })

  if (isLoading || !assessment) return null

  const allPhotos: { label: string; url: string }[] = []
  if (assessment.address_photo_url) {
    allPhotos.push({ label: 'Address / Property', url: assessment.address_photo_url })
  }
  ;(assessment.photos ?? []).forEach((url, i) => {
    allPhotos.push({ label: `Evidence Photo ${i + 1}`, url })
  })

  const hasEvidence = allPhotos.length > 0

  const handleDownloadAll = () => {
    allPhotos.forEach(({ url }, i) => {
      // Stagger tab opens slightly so browsers don't block them all
      setTimeout(() => window.open(url, '_blank', 'noopener'), i * 150)
    })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 text-left focus:outline-none"
            >
              <CardTitle className="text-sm text-blue-800 dark:text-blue-300 flex items-center gap-2">
                <Package className="h-4 w-4 shrink-0" />
                Evidence Bundle
                {allPhotos.length > 0 && (
                  <Badge variant="outline" className="text-[10px] ml-1 border-blue-300 text-blue-700">
                    {allPhotos.length} item{allPhotos.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </CardTitle>
              {open
                ? <ChevronDown className="h-4 w-4 text-blue-600 shrink-0" />
                : <ChevronRight className="h-4 w-4 text-blue-600 shrink-0" />}
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            {/* Assessment metadata */}
            <div className="rounded-md bg-white dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800 px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-muted-foreground">Address</span>
                <p className="font-medium truncate">{assessment.address}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Assessed</span>
                <p className="font-medium">
                  {new Date(assessment.assessed_at).toLocaleString('en-NZ', {
                    timeZone: 'Pacific/Auckland',
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Noise level</span>
                <p className="font-medium">{assessment.noise_level_db != null ? `${assessment.noise_level_db} dB` : '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Matrix score</span>
                <p className="font-medium">{scoreLabel(assessment.matrix_total_score)}</p>
              </div>
              {assessment.noise_source && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Source</span>
                  <p className="font-medium">{assessment.noise_source}</p>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-muted-foreground">Action</span>
                <span className={`inline-block mt-0.5 text-[10px] border font-semibold rounded px-1.5 py-0.5 ${actionBadgeColor(assessment.recommended_action)}`}>
                  {actionLabel(assessment.recommended_action)}
                </span>
              </div>
            </div>

            {/* Evidence photos grid */}
            {hasEvidence ? (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Camera className="h-3 w-3" /> Photos
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {allPhotos.map(({ label, url }) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block rounded-md overflow-hidden border border-blue-100 hover:border-blue-400 transition-colors bg-white"
                      title={label}
                    >
                      <img
                        src={url}
                        alt={label}
                        className="w-full h-20 object-cover"
                        loading="lazy"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity">
                        <ExternalLink className="h-5 w-5 text-white" />
                      </div>
                      <p className="text-[9px] text-muted-foreground px-1 py-0.5 truncate bg-white">
                        {label}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
                <Camera className="h-3.5 w-3.5" />
                No photos attached to this assessment.
              </div>
            )}

            {/* Location link */}
            {assessment.address && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(assessment.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-blue-700 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                View location on Google Maps
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {/* Action row */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-blue-100">
              {hasEvidence && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs border-blue-200 text-blue-700"
                  onClick={handleDownloadAll}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download all photos
                </Button>
              )}
              {onGenerateNotice && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs border-blue-200 text-blue-700"
                  onClick={onGenerateNotice}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Generate Notice PDF
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

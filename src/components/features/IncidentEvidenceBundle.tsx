/**
 * IncidentEvidenceBundle (B-08)
 *
 * Displays a structured, downloadable evidence bundle for an incident.
 * Aggregates:
 *   - Incident metadata (type, severity, address, timestamp)
 *   - Primary photo + metadata.photos[]
 *   - Enforcement event photos + notes (if case linked)
 *   - GPS location link
 *
 * Officers can "Generate bundle" (browser print-to-PDF) or download all photos
 * with a single action.
 *
 * Usage:
 *   <IncidentEvidenceBundle incidentId={incident.id} />
 */

import { useState } from 'react'
import { useIncidentEvidence } from '@/hooks/useIncidentEvidence'
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
  Printer,
} from 'lucide-react'
import {
  buildPreferredMapUrlForAddress,
  buildPreferredMapUrlForCoordinates,
} from '@/lib/inhouseMapping'

interface IncidentEvidenceBundleProps {
  incidentId: string
  className?: string
}

function severityColour(severity: string | null): string {
  if (severity === 'high' || severity === 'critical') return 'bg-red-100 text-red-800 border-red-200'
  if (severity === 'medium') return 'bg-orange-100 text-orange-800 border-orange-200'
  if (severity === 'low') return 'bg-yellow-100 text-yellow-800 border-yellow-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

export function IncidentEvidenceBundle({ incidentId, className = '' }: IncidentEvidenceBundleProps) {
  const [open, setOpen] = useState(false)
  const { data: evidence, isLoading } = useIncidentEvidence(incidentId)

  if (isLoading) return null
  if (!evidence) return null

  const allPhotos = [...evidence.photos, ...evidence.enforcement_photos]
  const hasEvidence = allPhotos.length > 0 || (evidence.enforcement_notes.length > 0)

  if (!hasEvidence && !evidence.notes && !evidence.description) return null

  // HTML-escape helper to prevent XSS in generated PDF bundle
  function he(s: string | null | undefined): string {
    if (!s) return ''
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  const handleDownloadAll = () => {
    allPhotos.forEach(({ url }, i) => {
      setTimeout(() => window.open(url, '_blank', 'noopener'), i * 150)
    })
  }

  const handlePrintBundle = () => {
    // Open a print-friendly summary in a new window so officer can print to PDF
    const nzDate = evidence.created_at
      ? new Date(evidence.created_at).toLocaleString('en-NZ', {
          timeZone: 'Pacific/Auckland',
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : 'Unknown'

    const photoRows = allPhotos
      .map(({ label, url }) =>
        `<div style="margin:8px 0"><strong>${he(label)}</strong><br/><img src="${he(url)}" style="max-width:100%;max-height:300px;border:1px solid #ccc" /></div>`,
      )
      .join('')

    const noteRows = evidence.enforcement_notes
      .map((n) => `<li>${he(n)}</li>`)
      .join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Evidence Bundle</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
    .section { margin-bottom: 20px; }
    .section h2 { font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; }
    .badge { display:inline-block; padding:2px 8px; border:1px solid #ccc; border-radius:4px; font-size:11px; margin-right:6px; }
    @media print { button { display:none } }
  </style>
</head>
<body>
  <h1>Evidence Bundle</h1>
  <div class="meta">
    Incident ID: ${he(evidence.id)}<br/>
    Generated: ${new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}
  </div>
  <div class="section">
    <h2>Incident Details</h2>
    <span class="badge">Type: ${he(evidence.incident_type ?? 'Unknown')}</span>
    ${evidence.severity ? `<span class="badge">Severity: ${he(evidence.severity)}</span>` : ''}
    ${evidence.status ? `<span class="badge">Status: ${he(evidence.status)}</span>` : ''}
    ${evidence.plate_number ? `<span class="badge">Plate: ${he(evidence.plate_number)}</span>` : ''}
    <p><strong>Date/Time:</strong> ${he(nzDate)}</p>
    ${evidence.location_address ? `<p><strong>Location:</strong> ${he(evidence.location_address)}</p>` : ''}
    ${evidence.location_lat != null ? `<p><strong>GPS:</strong> ${evidence.location_lat.toFixed(6)}, ${evidence.location_lng?.toFixed(6)}</p>` : ''}
    ${evidence.description ? `<p><strong>Description:</strong> ${he(evidence.description)}</p>` : ''}
    ${evidence.notes ? `<p><strong>Notes:</strong> ${he(evidence.notes)}</p>` : ''}
  </div>
  ${noteRows ? `<div class="section"><h2>Enforcement Notes</h2><ul>${noteRows}</ul></div>` : ''}
  ${photoRows ? `<div class="section"><h2>Photos (${allPhotos.length})</h2>${photoRows}</div>` : ''}
  <p style="font-size:10px;color:#999;margin-top:32px">Field Compliance Manager — Confidential Document</p>
  <script>window.print()</script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=800,height=900')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <Card className="border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/10">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 text-left focus:outline-none"
            >
              <CardTitle className="text-sm text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                <Package className="h-4 w-4 shrink-0" />
                Evidence Bundle
                {allPhotos.length > 0 && (
                  <Badge variant="outline" className="text-[10px] ml-1 border-indigo-300 text-indigo-700">
                    {allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </CardTitle>
              {open
                ? <ChevronDown className="h-4 w-4 text-indigo-600 shrink-0" />
                : <ChevronRight className="h-4 w-4 text-indigo-600 shrink-0" />}
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            {/* Incident metadata */}
            <div className="rounded-md bg-white dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800 px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-muted-foreground">Type</span>
                <p className="font-medium">{evidence.incident_type ?? '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Date/Time</span>
                <p className="font-medium">
                  {evidence.created_at
                    ? new Date(evidence.created_at).toLocaleString('en-NZ', {
                        timeZone: 'Pacific/Auckland',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : '—'}
                </p>
              </div>
              {evidence.severity && (
                <div>
                  <span className="text-muted-foreground">Severity</span>
                  <span className={`inline-block mt-0.5 text-[10px] border font-semibold rounded px-1.5 py-0.5 ${severityColour(evidence.severity)}`}>
                    {evidence.severity}
                  </span>
                </div>
              )}
              {evidence.plate_number && (
                <div>
                  <span className="text-muted-foreground">Plate</span>
                  <p className="font-mono font-bold">{evidence.plate_number}</p>
                </div>
              )}
              {evidence.description && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Description</span>
                  <p className="font-medium">{evidence.description}</p>
                </div>
              )}
              {evidence.notes && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Officer Notes</span>
                  <p className="font-medium">{evidence.notes}</p>
                </div>
              )}
            </div>

            {/* Enforcement notes */}
            {evidence.enforcement_notes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Enforcement Notes
                </p>
                <ul className="space-y-1">
                  {evidence.enforcement_notes.map((note, i) => (
                    <li key={i} className="text-xs bg-white dark:bg-indigo-950/20 rounded border border-indigo-100 px-2 py-1">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Photos grid */}
            {allPhotos.length > 0 && (
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
                      className="group relative block rounded-md overflow-hidden border border-indigo-100 hover:border-indigo-400 transition-colors bg-white"
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
            )}

            {/* GPS location link */}
            {evidence.location_address && (
              <a
                href={buildPreferredMapUrlForAddress(evidence.location_address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-700 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                Open location on map
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {evidence.location_lat != null && evidence.location_lng != null && !evidence.location_address && (
              <a
                href={buildPreferredMapUrlForCoordinates(evidence.location_lat, evidence.location_lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-700 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {evidence.location_lat.toFixed(5)}, {evidence.location_lng.toFixed(5)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {/* Action row */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-indigo-100">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs border-indigo-200 text-indigo-700"
                onClick={handlePrintBundle}
              >
                <Printer className="h-3.5 w-3.5" />
                Generate bundle (PDF)
              </Button>
              {allPhotos.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs border-indigo-200 text-indigo-700"
                  onClick={handleDownloadAll}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download all photos
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

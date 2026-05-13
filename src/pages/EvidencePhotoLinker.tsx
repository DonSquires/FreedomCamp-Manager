import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { toast } from 'sonner'
import {
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Info,
  XCircle,
  Link2,
} from 'lucide-react'

interface LinkDetail {
  path: string
  status: string
  plate?: string
  vehicle_id?: string
  confidence?: number
  public_url?: string
  raw_plate?: string
  error?: string
  reason?: string
  existing_photo?: string
}

interface LinkResult {
  total: number
  processed: number
  matched: number
  updated: number
  no_plate: number
  not_in_db: number
  errors: number
  dry_run: boolean
  details: LinkDetail[]
}

const STATUS_COLOUR: Record<string, string> = {
  updated: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  dry_run_would_update: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  matched_no_update: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  not_in_db: 'bg-gray-100 text-gray-700 dark:bg-[#2A2A2A]/50 dark:text-gray-300',
  no_plate: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
  download_error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  lookup_error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  update_error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
}

export default function EvidencePhotoLinker() {
  const [pathPrefix, setPathPrefix] = useState('')
  const [minConfidence, setMinConfidence] = useState('0.7')
  const [limit, setLimit] = useState('20')
  const [forceUpdate, setForceUpdate] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [result, setResult] = useState<LinkResult | null>(null)

  const linkMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await edgeFunctions.linkEvidencePhotos({
        path_prefix: pathPrefix.trim() || undefined,
        min_confidence: Number(minConfidence),
        limit: Number(limit),
        force_update: forceUpdate,
        dry_run: dryRun,
      })
      if (error) throw new Error(String(error))
      return data as LinkResult
    },
    onSuccess: (data) => {
      setResult(data)
      if (data.dry_run) {
        toast.info(`Dry run complete — ${data.updated} photos would be linked to canonical records`)
      } else {
        toast.success(`Done — ${data.updated} vehicle profile photo(s) updated`)
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Link evidence photos failed')
    },
  })

  const isRunning = linkMutation.isPending

  return (
    <AppLayout
      title="Link Evidence Photos"
      description="Run ALPR on evidence bucket photos and associate them with canonical vehicle records"
      showBackButton
    >
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Info banner */}
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                  What this does
                </h3>
                <ul className="text-sm text-blue-800 dark:text-blue-200 mt-2 space-y-1 list-disc list-inside">
                  <li>Lists image files in the <strong>evidence</strong> storage bucket</li>
                  <li>Runs plate recognition (ALPR) on each photo</li>
                  <li>Matches the detected plate against <strong>canonical_vehicles</strong></li>
                  <li>Updates <code>profile_photo</code> / <code>profile_photo_url</code> when a match is found</li>
                  <li>Skips vehicles that already have a profile photo unless <strong>Force update</strong> is on</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Configuration
            </CardTitle>
            <CardDescription>
              Optionally narrow the scope before running. Leave blank to scan all files in the bucket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            <div>
              <Label htmlFor="path-prefix">Folder prefix (optional)</Label>
              <Input
                id="path-prefix"
                placeholder="e.g. abc123-officer-id or leave blank for all"
                value={pathPrefix}
                onChange={(e) => setPathPrefix(e.target.value)}
                disabled={isRunning}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Only photos under <code>evidence/&lt;prefix&gt;</code> will be processed
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="min-confidence">Minimum ALPR confidence (0–1)</Label>
                <Input
                  id="min-confidence"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(e.target.value)}
                  disabled={isRunning}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="limit">Max files per run (1–50)</Label>
                <Input
                  id="limit"
                  type="number"
                  min="1"
                  max="50"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  disabled={isRunning}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="flex flex-col gap-4 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="force-update">Force update</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Overwrite existing profile photos for matched vehicles
                  </p>
                </div>
                <Switch
                  id="force-update"
                  checked={forceUpdate}
                  onCheckedChange={setForceUpdate}
                  disabled={isRunning}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="dry-run">Dry run</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Preview results without writing any changes to the database
                  </p>
                </div>
                <Switch
                  id="dry-run"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className="pt-4 border-t">
              {dryRun && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Dry run mode — no database changes will be made
                </div>
              )}
              <Button
                onClick={() => linkMutation.mutate()}
                disabled={isRunning}
                className="w-full"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Running ALPR…
                  </>
                ) : (
                  <>
                    <Link2 className="h-5 w-5 mr-2" />
                    {dryRun ? 'Preview Links (Dry Run)' : 'Link Evidence Photos'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <>
            <Card className={result.errors > 0 && result.updated === 0 ? 'border-red-200 bg-red-50 dark:bg-red-900/10' : 'border-green-200 bg-green-50 dark:bg-green-900/10'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {result.updated > 0 || result.dry_run ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  {result.dry_run ? 'Dry Run Complete' : 'Processing Complete'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {[
                    { label: 'Files', value: result.total, colour: '' },
                    { label: 'Processed', value: result.processed, colour: '' },
                    { label: result.dry_run ? 'Would update' : 'Updated', value: result.updated, colour: 'text-green-600' },
                    { label: 'Matched', value: result.matched, colour: 'text-blue-600' },
                    { label: 'No plate', value: result.no_plate, colour: 'text-orange-600' },
                    { label: 'Not in DB', value: result.not_in_db, colour: 'text-gray-500' },
                  ].map(({ label, value, colour }) => (
                    <div key={label} className="bg-white dark:bg-[#1E1E1E] p-3 rounded-lg text-center">
                      <div className="text-xs text-gray-600">{label}</div>
                      <div className={`text-xl font-bold mt-1 ${colour}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {result.details.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>File Details</CardTitle>
                  <CardDescription>{result.details.length} file(s) processed</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {result.details.map((detail, idx) => (
                      <div key={idx} className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm">
                        <Badge
                          className={`shrink-0 text-xs font-medium ${STATUS_COLOUR[detail.status] ?? 'bg-gray-100 text-gray-700'}`}
                          variant="outline"
                        >
                          {detail.status.replace(/_/g, ' ')}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs text-muted-foreground truncate">{detail.path}</p>
                          {detail.plate && (
                            <p className="mt-0.5">
                              Plate: <strong>{detail.plate}</strong>
                              {typeof detail.confidence === 'number' && (
                                <span className="text-muted-foreground ml-2">
                                  ({Math.round(detail.confidence * 100)}% confidence)
                                </span>
                              )}
                            </p>
                          )}
                          {detail.raw_plate && !detail.plate && (
                            <p className="mt-0.5 text-muted-foreground">
                              Raw plate: {detail.raw_plate}
                              {typeof detail.confidence === 'number' && (
                                <span className="ml-2">({Math.round(detail.confidence * 100)}%)</span>
                              )}
                            </p>
                          )}
                          {detail.reason && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{detail.reason}</p>
                          )}
                          {detail.error && (
                            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 font-mono">{detail.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

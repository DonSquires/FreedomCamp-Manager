import { useCallback, useRef, useState } from 'react'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { BrainCircuit, Camera, CheckCircle2, Code2, Eye, Loader2, Upload, XCircle, AlertTriangle, Lightbulb, Smartphone, Accessibility, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeAnalysisResult {
  line_count: number
  accessibility: { aria_attributes: number; role_attributes: number; sr_only: number; focus_management: number; semantic_elements: number }
  layout: { flex_containers: number; grid_containers: number; responsive_classes: number; dark_mode_classes: number }
  components_used: Record<string, number>
  scores: { accessibility: number; responsiveness: number; design_consistency: number; human_friendliness: number }
  recommendations: Array<{ severity: 'high' | 'medium' | 'low'; area: string; message: string }>
}

interface VisionIssue {
  area: string
  severity: 'high' | 'medium' | 'low'
  description: string
  suggestion: string
}

interface VisionAnalysisResult {
  summary: string
  issues: VisionIssue[]
  overall_score_out_of_10: number
  top_3_improvements: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLOUR = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
} as const

const SCORE_COLOUR = (score: number) => {
  if (score >= 80) return 'text-green-600 dark:text-green-400'
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

const SCORE_10_COLOUR = (score: number) => SCORE_COLOUR(score * 10)

const PAGE_OPTIONS = [
  { value: '', label: '— paste custom code —' },
  { value: 'AdminPortal', label: 'Admin Portal' },
  { value: 'FieldOfficerPortal', label: 'Field Officer Portal' },
  { value: 'TeamChat', label: 'Team Chat' },
  { value: 'OfficerHomePage', label: 'Officer Home' },
  { value: 'LivePatrolMonitor', label: 'Live Patrol Monitor' },
  { value: 'DispatchConsole', label: 'Dispatch Console' },
  { value: 'BobAssistantStudio', label: 'Bob Assistant Studio' },
  { value: 'Compliance', label: 'Compliance' },
  { value: 'Reports', label: 'Reports' },
]

const INFERENCE_URL = import.meta.env.VITE_INFERENCE_SERVICE_URL || ''
const INFERENCE_KEY = import.meta.env.VITE_INFERENCE_API_KEY || ''

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BobUIReview() {
  const [activeTab, setActiveTab] = useState<'code' | 'vision'>('code')

  // Code analysis state
  const [selectedPage, setSelectedPage] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeResult, setCodeResult] = useState<CodeAnalysisResult | null>(null)

  // Vision state
  const [visionFocus, setVisionFocus] = useState('general')
  const [visionImageB64, setVisionImageB64] = useState<string | null>(null)
  const [visionPreview, setVisionPreview] = useState<string | null>(null)
  const [visionLoading, setVisionLoading] = useState(false)
  const [visionResult, setVisionResult] = useState<VisionAnalysisResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---------------------------------------------------------------------------
  // Code analysis
  // ---------------------------------------------------------------------------

  const loadPageCode = useCallback(async (pageName: string) => {
    if (!pageName) return
    setCodeLoading(true)
    try {
      // Fetch the raw source from GitHub (main branch)
      const url = `https://raw.githubusercontent.com/DonSquires/FreedomCamp-Manager/main/src/pages/${pageName}.tsx`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Could not fetch ${pageName}.tsx`)
      const text = await resp.text()
      setCodeInput(text)
    } catch (e: any) {
      toast.error(`Load failed: ${e.message}`)
    } finally {
      setCodeLoading(false)
    }
  }, [])

  const runCodeAnalysis = useCallback(async () => {
    if (!codeInput.trim()) {
      toast.error('Paste some component code first')
      return
    }
    setCodeLoading(true)
    setCodeResult(null)
    try {
      if (!INFERENCE_URL) throw new Error('VITE_INFERENCE_SERVICE_URL not configured')
      const resp = await fetch(`${INFERENCE_URL}/assess/ui`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(INFERENCE_KEY ? { 'x-api-key': INFERENCE_KEY } : {}),
        },
        body: JSON.stringify({ code: codeInput }),
      })
      if (!resp.ok) throw new Error(`Inference service error: ${resp.status}`)
      const data = await resp.json()
      if (!data.success) throw new Error(data.error || 'Analysis failed')
      setCodeResult(data.analysis)
      toast.success('Code analysis complete')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCodeLoading(false)
    }
  }, [codeInput])

  // ---------------------------------------------------------------------------
  // Vision analysis
  // ---------------------------------------------------------------------------

  const handleImageSelect = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setVisionPreview(dataUrl)
      // Strip the data:image/...;base64, prefix — Ollama wants raw base64
      const b64 = dataUrl.split(',')[1]
      setVisionImageB64(b64)
      setVisionResult(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) handleImageSelect(file)
  }, [handleImageSelect])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (item) {
      handleImageSelect(item.getAsFile()!)
    }
  }, [handleImageSelect])

  const captureScreenshot = useCallback(async () => {
    toast.info('Take a screenshot of the page you want reviewed, then paste it here (Ctrl+V / Cmd+V)')
  }, [])

  const runVisionAnalysis = useCallback(async () => {
    if (!visionImageB64) {
      toast.error('Upload or paste a screenshot first')
      return
    }
    setVisionLoading(true)
    setVisionResult(null)
    try {
      // Call the RunPod worker via the onspace-ai-chat Edge Function
      // (which proxies to the inference service / RunPod)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const resp = await supabase.functions.invoke('onspace-ai-chat', {
        body: {
          action: 'ui_vision',
          image_b64: visionImageB64,
          focus: visionFocus,
          context: 'FieldOps Manager — a NZ freedom camping enforcement admin tool used by field officers on mobile and desktop. Prioritise usability for officers using the app in the field on a phone at night.',
        },
      })
      if (resp.error) throw resp.error
      const data = resp.data
      if (!data?.success) throw new Error(data?.error || 'Vision analysis failed')

      const analysis = typeof data.analysis === 'object' ? data.analysis : null
      if (analysis) {
        setVisionResult(analysis)
      } else {
        // Raw text fallback
        setVisionResult({
          summary: data.raw_response || 'Analysis complete',
          issues: [],
          overall_score_out_of_10: 0,
          top_3_improvements: [],
        })
      }
      toast.success('Vision analysis complete')
    } catch (e: any) {
      toast.error(e.message || 'Vision analysis failed')
    } finally {
      setVisionLoading(false)
    }
  }, [visionImageB64, visionFocus])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BrainCircuit className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Bob UI Review</h1>
            <p className="text-sm text-muted-foreground">Bob-powered UI analysis — code quality, accessibility &amp; visual review</p>
          </div>
          <Badge variant="secondary" className="ml-auto">Beta</Badge>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'code' | 'vision')}>
          <TabsList className="grid grid-cols-2 w-full max-w-sm">
            <TabsTrigger value="code" className="gap-2"><Code2 className="h-4 w-4" />Code Analysis</TabsTrigger>
            <TabsTrigger value="vision" className="gap-2"><Eye className="h-4 w-4" />Visual Review</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------------- */}
          {/* CODE ANALYSIS TAB                                                 */}
          {/* ---------------------------------------------------------------- */}
          <TabsContent value="code" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Load a page
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Select value={selectedPage} onValueChange={(v) => { setSelectedPage(v); if (v) loadPageCode(v) }}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a page to auto-load..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_OPTIONS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={runCodeAnalysis} disabled={codeLoading || !codeInput.trim()}>
                    {codeLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BrainCircuit className="h-4 w-4 mr-2" />}
                    Analyse
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Or paste JSX/TSX code directly</Label>
                  <Textarea
                    className="font-mono text-xs h-40 resize-none"
                    placeholder="Paste component code here..."
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {codeResult && <CodeResultPanel result={codeResult} />}
          </TabsContent>

          {/* ---------------------------------------------------------------- */}
          {/* VISION TAB                                                        */}
          {/* ---------------------------------------------------------------- */}
          <TabsContent value="vision" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Camera className="h-4 w-4" /> Screenshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Select value={visionFocus} onValueChange={setVisionFocus}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General UX</SelectItem>
                      <SelectItem value="mobile">Mobile / Night Use</SelectItem>
                      <SelectItem value="accessibility">Accessibility</SelectItem>
                      <SelectItem value="clutter">Visual Clutter</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={captureScreenshot} className="gap-2">
                    <Camera className="h-4 w-4" /> How to screenshot
                  </Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                    <Upload className="h-4 w-4" /> Upload image
                  </Button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f) }} />
                </div>

                {/* Drop / paste zone */}
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onPaste={handlePaste}
                  onClick={() => fileInputRef.current?.click()}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                  role="button"
                  aria-label="Drop or paste screenshot here"
                >
                  {visionPreview ? (
                    <img src={visionPreview} alt="Screenshot preview" className="max-h-64 mx-auto rounded shadow" />
                  ) : (
                    <div className="space-y-2 text-muted-foreground">
                      <Upload className="h-8 w-8 mx-auto opacity-40" />
                      <p className="text-sm">Drop image here, paste (Ctrl+V), or click to upload</p>
                      <p className="text-xs">PNG, JPG, WEBP — screenshots work best</p>
                    </div>
                  )}
                </div>

                <Button onClick={runVisionAnalysis} disabled={visionLoading || !visionImageB64} className="w-full gap-2">
                  {visionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  {visionLoading ? 'Bob is reviewing...' : 'Ask Bob to review this screenshot'}
                </Button>
              </CardContent>
            </Card>

            {visionResult && <VisionResultPanel result={visionResult} />}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}

// ---------------------------------------------------------------------------
// CodeResultPanel
// ---------------------------------------------------------------------------

function CodeResultPanel({ result }: { result: CodeAnalysisResult }) {
  const { scores, recommendations, accessibility, layout, components_used } = result
  const recHigh = recommendations.filter(r => r.severity === 'high')
  const recMed  = recommendations.filter(r => r.severity === 'medium')
  const recLow  = recommendations.filter(r => r.severity === 'low')

  return (
    <div className="space-y-4">
      {/* Score cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Human-friendliness',  value: scores.human_friendliness,    icon: <BrainCircuit className="h-4 w-4" /> },
          { label: 'Accessibility',        value: scores.accessibility,          icon: <Accessibility className="h-4 w-4" /> },
          { label: 'Responsiveness',       value: scores.responsiveness,         icon: <Smartphone className="h-4 w-4" /> },
          { label: 'Design Consistency',   value: scores.design_consistency,     icon: <Layers className="h-4 w-4" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label}>
            <CardContent className="p-4 flex flex-col items-center gap-2">
              <div className="text-muted-foreground">{icon}</div>
              <span className={`text-2xl font-bold ${SCORE_COLOUR(value)}`}>{value}</span>
              <Progress value={value} className="h-1.5 w-full" />
              <span className="text-xs text-muted-foreground text-center">{label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              Recommendations
              {recHigh.length > 0 && <Badge variant="destructive">{recHigh.length} high</Badge>}
              {recMed.length > 0  && <Badge variant="secondary">{recMed.length} medium</Badge>}
              {recLow.length > 0  && <Badge variant="outline">{recLow.length} low</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...recHigh, ...recMed, ...recLow].map((rec, i) => (
              <div key={i} className="flex gap-3 items-start p-2 rounded-md bg-muted/40">
                {rec.severity === 'high'
                  ? <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  : rec.severity === 'medium'
                  ? <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
                  : <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
                <div className="space-y-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rec.area}</span>
                  <p className="text-sm">{rec.message}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Detail stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Accessibility</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 text-xs">
            {[
              ['ARIA attrs', accessibility.aria_attributes],
              ['Roles', accessibility.role_attributes],
              ['SR-only', accessibility.sr_only],
              ['Focus mgmt', accessibility.focus_management],
              ['Semantics', accessibility.semantic_elements],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className={Number(v) > 0 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Layout</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 text-xs">
            {[
              ['Flex', layout.flex_containers],
              ['Grid', layout.grid_containers],
              ['Responsive', layout.responsive_classes],
              ['Dark mode', layout.dark_mode_classes],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className={Number(v) > 0 ? 'font-medium' : 'text-muted-foreground'}>{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">shadcn/ui Components</CardTitle></CardHeader>
          <CardContent>
            {Object.keys(components_used).length === 0
              ? <p className="text-xs text-muted-foreground">No shadcn/ui components detected</p>
              : <div className="flex flex-wrap gap-1">
                  {Object.entries(components_used).map(([comp, count]) => (
                    <Badge key={comp} variant="secondary" className="text-xs">{comp} ×{count}</Badge>
                  ))}
                </div>
            }
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VisionResultPanel
// ---------------------------------------------------------------------------

function VisionResultPanel({ result }: { result: VisionAnalysisResult }) {
  const { summary, issues, overall_score_out_of_10, top_3_improvements } = result
  const score = overall_score_out_of_10 || 0

  return (
    <div className="space-y-4">
      {/* Score + summary */}
      <Card>
        <CardContent className="p-4 flex gap-4 items-start">
          <div className="text-center shrink-0">
            <span className={`text-4xl font-bold ${SCORE_10_COLOUR(score)}`}>{score}</span>
            <p className="text-xs text-muted-foreground mt-1">/ 10</p>
          </div>
          <Separator orientation="vertical" className="h-16" />
          <p className="text-sm leading-relaxed">{summary || 'No summary available'}</p>
        </CardContent>
      </Card>

      {/* Top 3 improvements */}
      {top_3_improvements?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-500" /> Top 3 Improvements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {top_3_improvements.map((imp, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-xs font-bold text-primary mt-0.5 shrink-0">{i + 1}.</span>
                <p className="text-sm">{imp}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Issues */}
      {issues?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Issues Found
              <Badge variant="secondary">{issues.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.map((issue, i) => (
              <div key={i} className="p-3 rounded-md bg-muted/40 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_COLOUR[issue.severity] || 'secondary'} className="text-xs">
                    {issue.severity}
                  </Badge>
                  <span className="text-xs font-medium">{issue.area}</span>
                </div>
                <p className="text-sm">{issue.description}</p>
                {issue.suggestion && (
                  <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
                    <Lightbulb className="h-3 w-3 mt-0.5 text-yellow-500 shrink-0" />
                    {issue.suggestion}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

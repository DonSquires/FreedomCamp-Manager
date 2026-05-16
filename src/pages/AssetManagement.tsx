/**
 * Asset Management
 *
 * Five-tab module:
 *   1. Overview       — KPI cards, low-stock alerts, overdue items
 *   2. Equipment      — officer_assets issue / return per officer
 *   3. Stock          — on-hand inventory, receive stock, movement log
 *   4. Stocktake      — count sessions, variance review, apply adjustments
 *   5. Key Management — key_sets check-out / return (Wilsar-style)
 *
 * Scanner support (three input modes for all dialogs):
 *   a) Camera — browser-native BarcodeDetector API (Chrome/Android/desktop)
 *   b) USB / Bluetooth wedge — keyboard buffer accumulation + Enter trigger
 *   c) Manual entry — always available as fallback
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, parseISO, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import {
  Package, AlertTriangle, Clock, Key, Tag, Layers, ClipboardList,
  Camera, Scan, CameraOff, Plus, RotateCcw, CheckCircle2,
  TrendingDown, ArrowDown, ArrowUp, Pencil, Search, Loader2,
  Barcode, Bluetooth, Usb, X,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AssetType = {
  id: string
  code: string | null
  name: string | null
  category: string | null
}

type OfficerAsset = {
  id: string
  officer_id: string
  asset_type_id: string
  serial_number: string | null
  asset_tag: string | null
  make: string | null
  model: string | null
  condition: string
  status: string
  issued_date: string | null
  expected_return: string | null
  returned_date: string | null
  return_condition: string | null
  return_notes: string | null
  notes: string | null
  custom_data: Record<string, unknown> | null
  asset_types: AssetType | null
  user_profiles: { full_name: string | null; email: string | null } | null
}

type AssetStock = {
  id: string
  asset_type_id: string
  location: string
  variant: string | null
  quantity_on_hand: number
  quantity_allocated: number
  quantity_reserved: number
  reorder_point: number | null
  min_stock_level: number | null
  last_stocktake_at: string | null
  notes: string | null
  asset_types: AssetType | null
}

type StockMovement = {
  id: string
  asset_stock_id: string
  movement_type: string
  quantity: number
  quantity_before: number
  quantity_after: number
  variant: string | null
  reference_number: string | null
  supplier: string | null
  reason: string | null
  notes: string | null
  performed_by: string | null
  created_at: string
  asset_stock: { asset_types: { name: string | null } | null } | null
  user_profiles: { full_name: string | null } | null
}

type Stocktake = {
  id: string
  name: string
  location: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  notes: string | null
  created_by: string | null
  user_profiles: { full_name: string | null } | null
}

type StocktakeLine = {
  id: string
  stocktake_id: string
  asset_type_id: string
  asset_stock_id: string | null
  location: string | null
  variant: string | null
  system_quantity: number
  counted_quantity: number | null
  variance: number | null
  adjustment_applied: boolean
  notes: string | null
  counted_at: string | null
  asset_types: AssetType | null
}

type KeySet = {
  id: string
  name: string
  status: string
  storage_location: string | null
  current_holder_id: string | null
  checked_out_at: string | null
  expected_return: string | null
  user_profiles: { full_name: string | null } | null
  client_sites: { name: string | null } | null
}

type KeyCustody = {
  id: string
  key_set_id: string
  officer_id: string
  checked_out_at: string
  returned_at: string | null
  expected_return: string | null
  checkout_purpose: string | null
  status: string
  key_sets: { name: string | null } | null
  user_profiles: { full_name: string | null; email: string | null } | null
}

type OfficerOption = { id: string; full_name: string | null; email: string | null }

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-800',
  returned: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  lost: 'bg-gray-100 text-gray-800',
  damaged: 'bg-orange-100 text-orange-800',
  checked_out: 'bg-blue-100 text-blue-800',
  available: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  receive: 'bg-green-100 text-green-800',
  issue: 'bg-blue-100 text-blue-800',
  return: 'bg-teal-100 text-teal-800',
  discard: 'bg-red-100 text-red-800',
  stocktake_adjustment: 'bg-purple-100 text-purple-800',
  initial: 'bg-gray-100 text-gray-800',
  transfer_in: 'bg-cyan-100 text-cyan-800',
  transfer_out: 'bg-orange-100 text-orange-800',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function isOverdue(dateStr: string | null) {
  if (!dateStr) return false
  return differenceInDays(new Date(), parseISO(dateStr)) > 0
}

// ─────────────────────────────────────────────
// BarcodeDetector feature detection
// ─────────────────────────────────────────────
type BarcodeDetectionResult = {
  rawValue?: string
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectionResult[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

type ScannerTestWindow = Window & {
  BarcodeDetector?: BarcodeDetectorCtor
  __ASSET_SCANNER_TEST_CODE__?: string
}

function getWindowWithScannerTypes(): ScannerTestWindow {
  return window as ScannerTestWindow
}

const hasBarcodeDetector = typeof getWindowWithScannerTypes().BarcodeDetector !== 'undefined'

type ScannerEngine = 'auto' | 'native' | 'zxing'

type ScannerSettings = {
  wedgeEnabled: boolean
  minLength: number
  maxGapMs: number
  trimWhitespace: boolean
  cameraEngine: ScannerEngine
}

const DEFAULT_SCANNER_SETTINGS: ScannerSettings = {
  wedgeEnabled: true,
  minLength: 3,
  maxGapMs: 50,
  trimWhitespace: true,
  cameraEngine: 'auto',
}

const SCANNER_SETTINGS_KEY = 'assetScannerSettings.v1'

function loadScannerSettings(): ScannerSettings {
  try {
    const raw = localStorage.getItem(SCANNER_SETTINGS_KEY)
    if (!raw) return DEFAULT_SCANNER_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      wedgeEnabled: parsed?.wedgeEnabled ?? DEFAULT_SCANNER_SETTINGS.wedgeEnabled,
      minLength: parsed?.minLength ?? DEFAULT_SCANNER_SETTINGS.minLength,
      maxGapMs: parsed?.maxGapMs ?? DEFAULT_SCANNER_SETTINGS.maxGapMs,
      trimWhitespace: parsed?.trimWhitespace ?? DEFAULT_SCANNER_SETTINGS.trimWhitespace,
      cameraEngine: parsed?.cameraEngine ?? DEFAULT_SCANNER_SETTINGS.cameraEngine,
    }
  } catch {
    return DEFAULT_SCANNER_SETTINGS
  }
}

function saveScannerSettings(settings: ScannerSettings) {
  localStorage.setItem(SCANNER_SETTINGS_KEY, JSON.stringify(settings))
}

// ─────────────────────────────────────────────
// useBarcodeScanner — keyboard-wedge listener
// Wedge scanners type characters very fast and finish with Enter.
// Characters arriving < 50 ms apart are treated as part of a scan.
// ─────────────────────────────────────────────
function useBarcodeScanner(
  onScan: (code: string) => void,
  settings: ScannerSettings,
  enabled = true,
) {
  const buffer = useRef('')
  const lastKey = useRef(0)

  useEffect(() => {
    if (!enabled || !settings.wedgeEnabled) return
    function handleKeyDown(e: KeyboardEvent) {
      const now = Date.now()
      const gap = now - lastKey.current
      lastKey.current = now

      // Reset buffer if gap is too large (human typing)
      if (gap > settings.maxGapMs && buffer.current.length > 0) {
        buffer.current = ''
      }

      if (e.key === 'Enter') {
        const code = settings.trimWhitespace ? buffer.current.trim() : buffer.current
        buffer.current = ''
        if (code.length >= settings.minLength) {
          onScan(code)
          e.preventDefault()
        }
        return
      }

      // Ignore modifier-only keys
      if (e.key.length === 1) {
        buffer.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onScan, enabled, settings])
}

// ─────────────────────────────────────────────
// CameraScanner component
// Uses BarcodeDetector API (no external library).
// Falls back gracefully if API is unavailable.
// ─────────────────────────────────────────────
type CameraScannerProps = {
  onScan: (code: string) => void
  onClose: () => void
  settings: ScannerSettings
}

function CameraScanner({ onScan, onClose, settings }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'native' | 'zxing' | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const scannedRef = useRef(false)

  function resolveEngine(): 'native' | 'zxing' {
    if (settings.cameraEngine === 'native') return 'native'
    if (settings.cameraEngine === 'zxing') return 'zxing'
    return hasBarcodeDetector ? 'native' : 'zxing'
  }

  async function start() {
    setError(null)
    scannedRef.current = false

    // Test hook for deterministic Playwright scan flows.
    const forcedCode = getWindowWithScannerTypes().__ASSET_SCANNER_TEST_CODE__
    if (typeof forcedCode === 'string' && forcedCode.length > 0) {
      onScan(forcedCode)
      return
    }

    const selectedEngine = resolveEngine()
    setEngine(selectedEngine)

    if (selectedEngine === 'native') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setActive(true)
        scanNative()
      } catch {
        setError('Camera access denied or unavailable.')
      }
      return
    }

    // ZXing fallback path: works on browsers without BarcodeDetector.
    try {
      const reader = new BrowserMultiFormatReader()
      zxingReaderRef.current = reader
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (!result || scannedRef.current) return
        scannedRef.current = true
        stop()
        onScan(result.getText())
      })
      zxingControlsRef.current = controls
      setActive(true)
    } catch {
      setError('Unable to start camera decoder. Check permissions and camera availability.')
    }
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
  }

  function scanNative() {
    if (!hasBarcodeDetector || scannedRef.current) return
    const BarcodeDetectorImpl = getWindowWithScannerTypes().BarcodeDetector
    if (!BarcodeDetectorImpl) return

    const detector = new BarcodeDetectorImpl({
      formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix'],
    })

    function frame() {
      if (!videoRef.current || scannedRef.current) return
      detector
        .detect(videoRef.current)
        .then((barcodes: BarcodeDetectionResult[]) => {
          if (barcodes.length > 0 && !scannedRef.current) {
            scannedRef.current = true
            stop()
            onScan(barcodes[0].rawValue)
          } else {
            rafRef.current = requestAnimationFrame(frame)
          }
        })
        .catch(() => {
          rafRef.current = requestAnimationFrame(frame)
        })
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  useEffect(() => () => stop(), [])

  return (
    <div className="space-y-3">
      <div className="relative bg-black rounded overflow-hidden" style={{ height: 240 }}>
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {active && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="border-2 border-green-400 w-48 h-28 rounded opacity-75" />
          </div>
        )}
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm">
            {error ?? 'Camera off'}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        Decoder engine: <strong>{engine ?? resolveEngine()}</strong>
      </div>
      <div className="flex gap-2">
        {!active ? (
          <Button size="sm" onClick={start} className="flex-1 gap-2">
            <Camera className="h-4 w-4" /> Start Camera
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => { stop(); onClose() }} className="flex-1 gap-2">
            <CameraOff className="h-4 w-4" /> Stop
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────
// BarcodeInputDialog
// Unified dialog: camera + wedge indicator + manual input
// ─────────────────────────────────────────────
type BarcodeInputDialogProps = {
  open: boolean
  title: string
  description?: string
  onScan: (code: string) => void
  onClose: () => void
}

function BarcodeInputDialog({ open, title, description, onScan, onClose }: BarcodeInputDialogProps) {
  const [manual, setManual] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [wedgeReceived, setWedgeReceived] = useState(false)
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SCANNER_SETTINGS)

  useEffect(() => {
    setSettings(loadScannerSettings())
  }, [open])

  function updateSettings(patch: Partial<ScannerSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveScannerSettings(next)
      return next
    })
  }

  useBarcodeScanner((code) => {
    if (!open) return
    setWedgeReceived(true)
    setTimeout(() => setWedgeReceived(false), 1500)
    onScan(code)
  }, settings, open)

  function submitManual() {
    const v = manual.trim()
    if (!v) return
    setManual('')
    onScan(v)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera */}
          <div>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
              onClick={() => setShowCamera((v) => !v)}
            >
              <Camera className="h-4 w-4" />
              {showCamera ? 'Hide Camera' : 'Scan with Camera (mobile / webcam)'}
            </button>
            {showCamera && (
              <CameraScanner
                onScan={(code) => { setShowCamera(false); onScan(code) }}
                onClose={() => setShowCamera(false)}
                settings={settings}
              />
            )}
          </div>

          <div>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowSettings((v) => !v)}
            >
              <Pencil className="h-4 w-4" />
              {showSettings ? 'Hide Scanner Settings' : 'Scanner Settings'}
            </button>
            {showSettings && (
              <div className="mt-2 border rounded p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Enable USB/Bluetooth wedge scanner</Label>
                  <Switch
                    checked={settings.wedgeEnabled}
                    onCheckedChange={(v) => updateSettings({ wedgeEnabled: v })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Min scan length</Label>
                    <Input
                      type="number"
                      min={1}
                      max={64}
                      value={settings.minLength}
                      onChange={(e) => updateSettings({ minLength: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Inter-key gap (ms)</Label>
                    <Input
                      type="number"
                      min={10}
                      max={500}
                      value={settings.maxGapMs}
                      onChange={(e) => updateSettings({ maxGapMs: Math.max(10, parseInt(e.target.value || '10', 10)) })}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Trim whitespace</Label>
                  <Switch
                    checked={settings.trimWhitespace}
                    onCheckedChange={(v) => updateSettings({ trimWhitespace: v })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">Camera engine</Label>
                  <Select
                    value={settings.cameraEngine}
                    onValueChange={(v: ScannerEngine) => updateSettings({ cameraEngine: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (recommended)</SelectItem>
                      <SelectItem value="native">Native BarcodeDetector</SelectItem>
                      <SelectItem value="zxing">ZXing fallback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Wedge scanner status */}
          <div className={`flex items-center gap-2 rounded p-2 text-sm transition-colors ${wedgeReceived ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'}`}>
            {wedgeReceived ? (
              <><CheckCircle2 className="h-4 w-4" /> Barcode received!</>
            ) : (
              <><Usb className="h-4 w-4" /><Bluetooth className="h-4 w-4" /> Point USB / Bluetooth scanner and scan now</>
            )}
          </div>

          <Separator />

          {/* Manual */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Enter code manually</Label>
            <div className="flex gap-2">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitManual()}
                placeholder="Type or paste barcode…"
                className="font-mono text-sm"
              />
              <Button size="sm" onClick={submitManual} disabled={!manual.trim()}>
                <Scan className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4 mr-1" />Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────
// OverviewTab
// ─────────────────────────────────────────────
function OverviewTab({
  assets,
  stock,
  keySets,
  custody,
}: {
  assets: OfficerAsset[]
  stock: AssetStock[]
  keySets: KeySet[]
  custody: KeyCustody[]
}) {
  const issued = assets.filter((a) => a.status === 'issued').length
  const overdue = assets.filter((a) => a.status === 'issued' && isOverdue(a.expected_return)).length
  const keysOut = keySets.filter((k) => k.status === 'checked_out').length
  const keysOverdue = keySets.filter((k) => k.status === 'checked_out' && isOverdue(k.expected_return)).length
  const lowStock = stock.filter((s) => s.reorder_point != null && s.quantity_on_hand <= s.reorder_point)

  const categoryCounts = assets.reduce<Record<string, number>>((acc, a) => {
    const cat = a.asset_types?.category ?? 'other'
    acc[cat] = (acc[cat] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Items Issued</p>
                <p className="text-2xl font-bold">{issued}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={overdue > 0 ? 'border-red-300' : ''}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-8 w-8 ${overdue > 0 ? 'text-red-500' : 'text-gray-400'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Overdue Returns</p>
                <p className="text-2xl font-bold">{overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={lowStock.length > 0 ? 'border-orange-300' : ''}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingDown className={`h-8 w-8 ${lowStock.length > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Low Stock Lines</p>
                <p className="text-2xl font-bold">{lowStock.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={keysOverdue > 0 ? 'border-red-300' : ''}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Key className={`h-8 w-8 ${keysOverdue > 0 ? 'text-red-500' : 'text-yellow-500'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Keys Out</p>
                <p className="text-2xl font-bold">{keysOut}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low stock alerts */}
      {lowStock.length > 0 && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-orange-700 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Low Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>On Hand</TableHead>
                  <TableHead>Reorder At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((s) => (
                  <TableRow key={s.id} className="bg-orange-50">
                    <TableCell className="text-sm font-medium">{s.asset_types?.name ?? s.asset_type_id}</TableCell>
                    <TableCell className="text-sm">{s.variant ?? '—'}</TableCell>
                    <TableCell className="text-sm">{s.location}</TableCell>
                    <TableCell className="text-sm font-bold text-orange-700">{s.quantity_on_hand}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.reorder_point}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Category counts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Equipment by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(categoryCounts).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm">
                <Tag className="h-3.5 w-3.5" />
                <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Overdue items */}
      {(overdue > 0 || keysOverdue > 0) && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Overdue Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Days Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets
                  .filter((a) => a.status === 'issued' && isOverdue(a.expected_return))
                  .map((a) => (
                    <TableRow key={a.id} className="bg-red-50">
                      <TableCell className="text-sm">{a.asset_types?.name ?? a.asset_type_id}</TableCell>
                      <TableCell className="text-sm">{a.user_profiles?.full_name ?? a.user_profiles?.email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{a.expected_return ? format(parseISO(a.expected_return), 'dd MMM yyyy') : '—'}</TableCell>
                      <TableCell className="text-sm font-bold text-red-600">
                        {a.expected_return ? differenceInDays(new Date(), parseISO(a.expected_return)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                {keySets
                  .filter((k) => k.status === 'checked_out' && isOverdue(k.expected_return))
                  .map((k) => (
                    <TableRow key={k.id} className="bg-red-50">
                      <TableCell className="text-sm">Key: {k.name}</TableCell>
                      <TableCell className="text-sm">{k.user_profiles?.full_name ?? custody.find((c) => c.key_set_id === k.id && c.status === 'checked_out')?.user_profiles?.full_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{k.expected_return ? format(parseISO(k.expected_return), 'dd MMM yyyy') : '—'}</TableCell>
                      <TableCell className="text-sm font-bold text-red-600">
                        {k.expected_return ? differenceInDays(new Date(), parseISO(k.expected_return)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// EquipmentTab
// ─────────────────────────────────────────────
function EquipmentTab({
  assets,
  assetTypes,
  officers,
  orgId,
  onRefresh,
  initialOfficerId,
  autoOpenIssue,
  onConsumedDeepLink,
}: {
  assets: OfficerAsset[]
  assetTypes: AssetType[]
  officers: OfficerOption[]
  orgId: string
  onRefresh: () => void
  initialOfficerId?: string
  autoOpenIssue?: boolean
  onConsumedDeepLink?: () => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showIssueDialog, setShowIssueDialog] = useState(false)
  const [showReturnDialog, setShowReturnDialog] = useState<OfficerAsset | null>(null)
  const [showScanDialog, setShowScanDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issueForm, setIssueForm] = useState({
    officer_id: '', asset_type_id: '', serial_number: '', asset_tag: '',
    make: '', model: '', condition: 'good', expected_return: '', notes: '', variant: '',
  })
  const [returnForm, setReturnForm] = useState({ return_condition: 'good', return_notes: '' })

  useEffect(() => {
    if (!autoOpenIssue || !initialOfficerId) return
    const exists = officers.some((o) => o.id === initialOfficerId)
    if (!exists) return

    setIssueForm((f) => ({ ...f, officer_id: initialOfficerId }))
    setShowIssueDialog(true)
    onConsumedDeepLink?.()
  }, [autoOpenIssue, initialOfficerId, officers, onConsumedDeepLink])

  const filtered = assets.filter((a) => {
    const matchSearch =
      !search ||
      a.user_profiles?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.user_profiles?.email?.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_types?.name?.toLowerCase().includes(search.toLowerCase()) ||
      (a.serial_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (a.asset_tag ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || a.status === statusFilter
    return matchSearch && matchStatus
  })

  // Handle a scanned asset_tag / serial — find matching issued asset and pre-fill return
  function handleScan(code: string) {
    setShowScanDialog(false)
    const found = assets.find(
      (a) => a.asset_tag === code || a.serial_number === code,
    )
    if (found) {
      if (found.status === 'issued') {
        setShowReturnDialog(found)
        toast.success(`Found: ${found.asset_types?.name} — ${found.user_profiles?.full_name ?? 'unknown officer'}`)
      } else {
        toast.info(`Asset found but status is "${found.status}"`)
      }
    } else {
      // Pre-fill issue dialog with scanned tag
      setIssueForm((f) => ({ ...f, asset_tag: code }))
      setShowIssueDialog(true)
      toast.info(`Barcode ${code} not matched — fill in remaining details to issue`)
    }
  }

  async function handleIssue() {
    if (!issueForm.officer_id || !issueForm.asset_type_id) {
      toast.error('Officer and asset type are required')
      return
    }
    setSaving(true)
    const { error } = await (supabase as any).from('officer_assets').insert({
      organization_id: orgId,
      officer_id: issueForm.officer_id,
      asset_type_id: issueForm.asset_type_id,
      serial_number: issueForm.serial_number || null,
      asset_tag: issueForm.asset_tag || null,
      make: issueForm.make || null,
      model: issueForm.model || null,
      condition: issueForm.condition,
      expected_return: issueForm.expected_return || null,
      notes: issueForm.notes || null,
      status: 'issued',
      issued_date: new Date().toISOString().split('T')[0],
      custom_data: issueForm.variant ? { variant: issueForm.variant } : null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Asset issued successfully')
    setShowIssueDialog(false)
    setIssueForm({ officer_id: '', asset_type_id: '', serial_number: '', asset_tag: '', make: '', model: '', condition: 'good', expected_return: '', notes: '', variant: '' })
    onRefresh()
  }

  async function handleReturn() {
    if (!showReturnDialog) return
    setSaving(true)
    const { error } = await (supabase as any)
      .from('officer_assets')
      .update({
        status: 'returned',
        returned_date: new Date().toISOString().split('T')[0],
        return_condition: returnForm.return_condition,
        return_notes: returnForm.return_notes || null,
      })
      .eq('id', showReturnDialog.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Asset returned')
    setShowReturnDialog(null)
    setReturnForm({ return_condition: 'good', return_notes: '' })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search officer, asset, serial…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
            <SelectItem value="damaged">Damaged</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowScanDialog(true)}>
          <Scan className="h-4 w-4" /> Scan
        </Button>
        <Button size="sm" className="gap-2" onClick={() => setShowIssueDialog(true)}>
          <Plus className="h-4 w-4" /> Issue Asset
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Officer</TableHead>
                <TableHead>Serial / Tag</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No assets found</TableCell></TableRow>
              )}
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm font-medium">{a.asset_types?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.user_profiles?.full_name ?? a.user_profiles?.email ?? '—'}</TableCell>
                  <TableCell className="text-sm font-mono text-xs">{a.asset_tag ?? a.serial_number ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.issued_date ? format(parseISO(a.issued_date), 'dd MMM yy') : '—'}</TableCell>
                  <TableCell className={`text-sm ${a.status === 'issued' && isOverdue(a.expected_return) ? 'text-red-600 font-semibold' : ''}`}>
                    {a.expected_return ? format(parseISO(a.expected_return), 'dd MMM yy') : '—'}
                  </TableCell>
                  <TableCell><Badge className={`text-xs ${STATUS_COLOURS[a.status] ?? ''}`}>{statusLabel(a.status)}</Badge></TableCell>
                  <TableCell>
                    {a.status === 'issued' && (
                      <Button size="sm" variant="outline" onClick={() => setShowReturnDialog(a)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Return
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Scan dialog */}
      <BarcodeInputDialog
        open={showScanDialog}
        title="Scan Asset"
        description="Scan asset tag or serial number to quickly find and return an item."
        onScan={handleScan}
        onClose={() => setShowScanDialog(false)}
      />

      {/* Issue dialog */}
      <Dialog open={showIssueDialog} onOpenChange={setShowIssueDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Asset to Officer</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Officer *</Label>
                <Select value={issueForm.officer_id} onValueChange={(v) => setIssueForm((f) => ({ ...f, officer_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                  <SelectContent>
                    {officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name ?? o.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Asset Type *</Label>
                <Select value={issueForm.asset_type_id} onValueChange={(v) => setIssueForm((f) => ({ ...f, asset_type_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Variant / Size</Label>
                <Input value={issueForm.variant} onChange={(e) => setIssueForm((f) => ({ ...f, variant: e.target.value }))} placeholder="e.g. XL, Navy" />
              </div>
              <div className="space-y-1.5">
                <Label>Asset Tag</Label>
                <Input value={issueForm.asset_tag} onChange={(e) => setIssueForm((f) => ({ ...f, asset_tag: e.target.value }))} placeholder="Scan or enter" />
              </div>
              <div className="space-y-1.5">
                <Label>Serial Number</Label>
                <Input value={issueForm.serial_number} onChange={(e) => setIssueForm((f) => ({ ...f, serial_number: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={issueForm.condition} onValueChange={(v) => setIssueForm((f) => ({ ...f, condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Expected Return</Label>
                <Input type="date" value={issueForm.expected_return} onChange={(e) => setIssueForm((f) => ({ ...f, expected_return: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <Textarea value={issueForm.notes} onChange={(e) => setIssueForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIssueDialog(false)}>Cancel</Button>
            <Button onClick={handleIssue} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Issue Asset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return dialog */}
      {showReturnDialog && (
        <Dialog open onOpenChange={() => setShowReturnDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Return Asset</DialogTitle>
              <DialogDescription>
                Returning <strong>{showReturnDialog.asset_types?.name}</strong> from <strong>{showReturnDialog.user_profiles?.full_name ?? showReturnDialog.user_profiles?.email ?? 'unknown'}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Return Condition</Label>
                <Select value={returnForm.return_condition} onValueChange={(v) => setReturnForm((f) => ({ ...f, return_condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Return Notes</Label>
                <Textarea value={returnForm.return_notes} onChange={(e) => setReturnForm((f) => ({ ...f, return_notes: e.target.value }))} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReturnDialog(null)}>Cancel</Button>
              <Button onClick={handleReturn} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Confirm Return</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// StockTab
// ─────────────────────────────────────────────
function StockTab({
  stock,
  movements,
  assetTypes,
  orgId,
  userId,
  onRefresh,
}: {
  stock: AssetStock[]
  movements: StockMovement[]
  assetTypes: AssetType[]
  orgId: string
  userId: string
  onRefresh: () => void
}) {
  const [showReceive, setShowReceive] = useState(false)
  const [showScanDialog, setShowScanDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    asset_type_id: '', variant: '', quantity: '', location: 'Main Depot',
    supplier: '', reference_number: '', unit_cost: '', notes: '',
  })

  const lowStock = stock.filter((s) => s.reorder_point != null && s.quantity_on_hand <= s.reorder_point)

  function handleScan(code: string) {
    setShowScanDialog(false)
    // Match barcode to asset type
    const type = assetTypes.find((t) => t.code === code)
    if (type) {
      setForm((f) => ({ ...f, asset_type_id: type.id }))
      setShowReceive(true)
      toast.success(`Matched: ${type.name}`)
    } else {
      toast.error(`No asset type found for barcode: ${code}`)
    }
  }

  async function handleReceive() {
    if (!form.asset_type_id || !form.quantity) {
      toast.error('Asset type and quantity are required')
      return
    }
    const qty = parseInt(form.quantity, 10)
    if (isNaN(qty) || qty <= 0) { toast.error('Quantity must be a positive number'); return }

    setSaving(true)

    // Upsert the stock row
    const { data: existingStock } = await (supabase as any)
      .from('asset_stock')
      .select('id, quantity_on_hand')
      .eq('organization_id', orgId)
      .eq('asset_type_id', form.asset_type_id)
      .eq('location', form.location)
      .is(form.variant ? 'variant' : null, form.variant || null)
      .maybeSingle()

    let stockId: string
    let qtyBefore: number

    if (existingStock) {
      stockId = existingStock.id
      qtyBefore = existingStock.quantity_on_hand
    } else {
      const { data: newStock, error: stockErr } = await (supabase as any)
        .from('asset_stock')
        .insert({
          organization_id: orgId,
          asset_type_id: form.asset_type_id,
          location: form.location,
          variant: form.variant || null,
          quantity_on_hand: 0,
        })
        .select('id')
        .single()
      if (stockErr) { toast.error(stockErr.message); setSaving(false); return }
      stockId = newStock.id
      qtyBefore = 0
    }

    const { error } = await (supabase as any).from('asset_stock_movements').insert({
      organization_id: orgId,
      asset_stock_id: stockId,
      asset_type_id: form.asset_type_id,
      variant: form.variant || null,
      movement_type: 'receive',
      quantity: qty,
      quantity_before: qtyBefore,
      quantity_after: qtyBefore + qty,
      location: form.location,
      supplier: form.supplier || null,
      reference_number: form.reference_number || null,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      quantity_received: qty,
      reason: 'Stock received',
      notes: form.notes || null,
      performed_by: userId,
    })

    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`${qty} × ${assetTypes.find((t) => t.id === form.asset_type_id)?.name ?? 'item'} received into stock`)
    setShowReceive(false)
    setForm({ asset_type_id: '', variant: '', quantity: '', location: 'Main Depot', supplier: '', reference_number: '', unit_cost: '', notes: '' })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowScanDialog(true)}>
          <Barcode className="h-4 w-4" /> Scan to Receive
        </Button>
        <Button size="sm" className="gap-2" onClick={() => setShowReceive(true)}>
          <ArrowDown className="h-4 w-4" /> Receive Stock
        </Button>
      </div>

      {lowStock.length > 0 && (
        <div className="rounded border border-orange-200 bg-orange-50 p-3 flex items-center gap-2 text-sm text-orange-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><strong>{lowStock.length}</strong> stock line{lowStock.length > 1 ? 's' : ''} at or below reorder point</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">On-Hand Stock</CardTitle>
          <CardDescription>Current inventory by asset type, variant and location</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Type</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Stocktake</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No stock records — use Receive Stock to add inventory</TableCell></TableRow>
              )}
              {stock.map((s) => {
                const isLow = s.reorder_point != null && s.quantity_on_hand <= s.reorder_point
                return (
                  <TableRow key={s.id} className={isLow ? 'bg-orange-50' : ''}>
                    <TableCell className="text-sm font-medium">{s.asset_types?.name ?? s.asset_type_id}</TableCell>
                    <TableCell className="text-sm">{s.variant ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{s.location}</TableCell>
                    <TableCell className={`text-right font-bold text-sm ${isLow ? 'text-orange-700' : ''}`}>{s.quantity_on_hand}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{s.quantity_allocated}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{s.quantity_reserved}</TableCell>
                    <TableCell>
                      {isLow
                        ? <Badge className="bg-orange-100 text-orange-800 text-xs">Low Stock</Badge>
                        : <Badge className="bg-green-100 text-green-800 text-xs">OK</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.last_stocktake_at ? format(parseISO(s.last_stocktake_at), 'dd MMM yy') : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent movements */}
      {movements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Movements</CardTitle>
            <CardDescription>Last 50 stock transactions</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell><Badge className={`text-xs ${STATUS_COLOURS[m.movement_type] ?? ''}`}>{statusLabel(m.movement_type)}</Badge></TableCell>
                    <TableCell className="text-sm">{m.asset_stock?.asset_types?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{m.variant ?? '—'}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${m.quantity < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{m.quantity_after}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.reference_number ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.user_profiles?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(parseISO(m.created_at), 'dd MMM yy HH:mm')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Scan dialog */}
      <BarcodeInputDialog
        open={showScanDialog}
        title="Scan Product Barcode"
        description="Scan the product barcode to auto-select the asset type."
        onScan={handleScan}
        onClose={() => setShowScanDialog(false)}
      />

      {/* Receive dialog */}
      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDown className="h-5 w-5 text-green-600" /> Receive Stock
            </DialogTitle>
            <DialogDescription>Record new stock arriving into inventory</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5 col-span-2">
              <Label>Asset Type *</Label>
              <Select value={form.asset_type_id} onValueChange={(v) => setForm((f) => ({ ...f, asset_type_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select asset type" /></SelectTrigger>
                <SelectContent>
                  {assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Variant / Size</Label>
              <Input value={form.variant} onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))} placeholder="e.g. XL, Navy, 32GB" />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity *</Label>
              <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Unit Cost ($)</Label>
              <Input type="number" min={0} step={0.01} value={form.unit_cost} onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Input value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>PO / Reference</Label>
              <Input value={form.reference_number} onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceive(false)}>Cancel</Button>
            <Button onClick={handleReceive} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowDown className="h-4 w-4 mr-2" />}
              Receive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────
// StocktakeTab
// ─────────────────────────────────────────────
function StocktakeTab({
  stocktakes,
  stock,
  assetTypes,
  orgId,
  userId,
  onRefresh,
}: {
  stocktakes: Stocktake[]
  stock: AssetStock[]
  assetTypes: AssetType[]
  orgId: string
  userId: string
  onRefresh: () => void
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [activeSession, setActiveSession] = useState<Stocktake | null>(null)
  const [lines, setLines] = useState<StocktakeLine[]>([])
  const [loadingLines, setLoadingLines] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showScanDialog, setShowScanDialog] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', location: '', notes: '' })

  // Count edits map: lineId -> counted_quantity string
  const [counts, setCounts] = useState<Record<string, string>>({})

  async function loadLines(sessionId: string) {
    setLoadingLines(true)
    const { data } = await (supabase as any)
      .from('asset_stocktake_lines')
      .select('*, asset_types(id,code,name,category)')
      .eq('stocktake_id', sessionId)
      .order('created_at')
    setLines((data ?? []) as StocktakeLine[])
    const initial: Record<string, string> = {}
    ;(data ?? []).forEach((l: StocktakeLine) => {
      initial[l.id] = l.counted_quantity != null ? String(l.counted_quantity) : ''
    })
    setCounts(initial)
    setLoadingLines(false)
  }

  async function openSession(session: Stocktake) {
    setActiveSession(session)
    await loadLines(session.id)
  }

  // Scan during count: find line by barcode → focus its count input
  function handleScan(code: string) {
    setShowScanDialog(false)
    if (!activeSession) return
    const type = assetTypes.find((t) => t.code === code)
    if (!type) { toast.error(`No asset type matched for barcode: ${code}`); return }
    const line = lines.find((l) => l.asset_type_id === type.id)
    if (!line) { toast.info(`${type.name} is not on this stocktake sheet — add it first`); return }
    // Focus the input for this line
    const el = document.getElementById(`count-${line.id}`)
    if (el) (el as HTMLInputElement).focus()
    toast.success(`Found line: ${type.name}`)
  }

  async function createSession() {
    if (!createForm.name) { toast.error('Name is required'); return }
    setSaving(true)
    const { data, error } = await (supabase as any)
      .from('asset_stocktakes')
      .insert({
        organization_id: orgId,
        name: createForm.name,
        location: createForm.location || null,
        notes: createForm.notes || null,
        status: 'draft',
        created_by: userId,
      })
      .select()
      .single()
    if (error) { toast.error(error.message); setSaving(false); return }

    // Auto-populate lines from current stock
    const locationFilter = createForm.location || null
    const relevantStock = locationFilter
      ? stock.filter((s) => s.location === locationFilter)
      : stock
    if (relevantStock.length > 0) {
      await (supabase as any).from('asset_stocktake_lines').insert(
        relevantStock.map((s) => ({
          organization_id: orgId,
          stocktake_id: data.id,
          asset_type_id: s.asset_type_id,
          asset_stock_id: s.id,
          location: s.location,
          variant: s.variant,
          system_quantity: s.quantity_on_hand,
        })),
      )
    }

    setSaving(false)
    toast.success('Stocktake session created')
    setShowCreate(false)
    setCreateForm({ name: '', location: '', notes: '' })
    onRefresh()
    openSession({ ...data, user_profiles: null } as Stocktake)
  }

  async function startSession(session: Stocktake) {
    setSaving(true)
    await (supabase as any)
      .from('asset_stocktakes')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', session.id)
    setSaving(false)
    onRefresh()
    setActiveSession((s) => s ? { ...s, status: 'in_progress' } : s)
  }

  async function saveCounts() {
    if (!activeSession) return
    setSaving(true)
    const updates = lines.map((l) => ({
      id: l.id,
      counted_quantity: counts[l.id] !== '' && counts[l.id] != null ? parseInt(counts[l.id], 10) : null,
      counted_at: new Date().toISOString(),
      counted_by: userId,
    }))
    for (const u of updates) {
      await (supabase as any).from('asset_stocktake_lines').update({
        counted_quantity: u.counted_quantity,
        counted_at: u.counted_at,
        counted_by: u.counted_by,
      }).eq('id', u.id)
    }
    await loadLines(activeSession.id)
    setSaving(false)
    toast.success('Counts saved')
  }

  async function applyAdjustments() {
    if (!activeSession) return
    const variances = lines.filter((l) => l.variance != null && l.variance !== 0 && !l.adjustment_applied)
    if (variances.length === 0) { toast.info('No unapplied variances'); return }
    setSaving(true)

    for (const line of variances) {
      if (!line.asset_stock_id) continue
      const stockRow = stock.find((s) => s.id === line.asset_stock_id)
      const qtyBefore = stockRow?.quantity_on_hand ?? line.system_quantity
      const qty = line.variance!

      const { data: mv, error } = await (supabase as any)
        .from('asset_stock_movements')
        .insert({
          organization_id: orgId,
          asset_stock_id: line.asset_stock_id,
          asset_type_id: line.asset_type_id,
          variant: line.variant,
          movement_type: 'stocktake_adjustment',
          quantity: qty,
          quantity_before: qtyBefore,
          quantity_after: Math.max(0, qtyBefore + qty),
          location: line.location,
          reason: `Stocktake adjustment — ${activeSession.name}`,
          performed_by: userId,
        })
        .select('id')
        .single()
      if (error) { toast.error(error.message); continue }

      await (supabase as any)
        .from('asset_stocktake_lines')
        .update({ adjustment_applied: true, adjustment_movement_id: mv.id })
        .eq('id', line.id)
    }

    // Mark complete if all lines adjusted
    await (supabase as any)
      .from('asset_stocktakes')
      .update({ status: 'completed', completed_at: new Date().toISOString(), completed_by: userId })
      .eq('id', activeSession.id)

    toast.success(`${variances.length} adjustment${variances.length > 1 ? 's' : ''} applied`)
    setSaving(false)
    onRefresh()
    await loadLines(activeSession.id)
    setActiveSession((s) => s ? { ...s, status: 'completed' } : s)
  }

  if (activeSession) {
    const totalLines = lines.length
    const counted = lines.filter((l) => l.counted_quantity != null).length
    const variances = lines.filter((l) => l.variance != null && l.variance !== 0)

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setActiveSession(null)}>← Back</Button>
          <h3 className="font-semibold">{activeSession.name}</h3>
          <Badge className={`text-xs ${STATUS_COLOURS[activeSession.status] ?? ''}`}>{statusLabel(activeSession.status)}</Badge>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowScanDialog(true)}>
              <Barcode className="h-4 w-4" /> Scan Item
            </Button>
            {activeSession.status === 'draft' && (
              <Button size="sm" onClick={() => startSession(activeSession)} disabled={saving}>Start Count</Button>
            )}
            {activeSession.status === 'in_progress' && (
              <>
                <Button variant="outline" size="sm" onClick={saveCounts} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save Counts
                </Button>
                <Button size="sm" onClick={applyAdjustments} disabled={saving || variances.length === 0} className="gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Apply Adjustments ({variances.length})
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          {counted}/{totalLines} lines counted · {variances.length} variance{variances.length !== 1 ? 's' : ''}
        </div>

        {loadingLines ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Type</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">System Qty</TableHead>
                    <TableHead className="text-right w-32">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Adjusted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const countVal = counts[l.id] ?? ''
                    const counted = countVal !== '' ? parseInt(countVal, 10) : null
                    const variance = counted != null ? counted - l.system_quantity : null
                    return (
                      <TableRow key={l.id} className={variance != null && variance !== 0 ? 'bg-yellow-50' : ''}>
                        <TableCell className="text-sm font-medium">{l.asset_types?.name ?? l.asset_type_id}</TableCell>
                        <TableCell className="text-sm">{l.variant ?? '—'}</TableCell>
                        <TableCell className="text-sm">{l.location ?? '—'}</TableCell>
                        <TableCell className="text-right text-sm">{l.system_quantity}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            id={`count-${l.id}`}
                            type="number"
                            min={0}
                            value={countVal}
                            onChange={(e) => setCounts((c) => ({ ...c, [l.id]: e.target.value }))}
                            className="w-24 text-right font-mono"
                            disabled={activeSession.status === 'completed'}
                          />
                        </TableCell>
                        <TableCell className={`text-right text-sm font-bold ${variance == null ? '' : variance < 0 ? 'text-red-600' : variance > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                          {variance == null ? '—' : variance > 0 ? `+${variance}` : variance}
                        </TableCell>
                        <TableCell>
                          {l.adjustment_applied
                            ? <Badge className="bg-green-100 text-green-800 text-xs">Applied</Badge>
                            : variance != null && variance !== 0
                              ? <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending</Badge>
                              : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <BarcodeInputDialog
          open={showScanDialog}
          title="Scan Item to Count"
          description="Scan an item's barcode to jump to its count row."
          onScan={handleScan}
          onClose={() => setShowScanDialog(false)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Stocktake
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocktakes.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No stocktake sessions yet</TableCell></TableRow>
              )}
              {stocktakes.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm">{s.location ?? 'All locations'}</TableCell>
                  <TableCell><Badge className={`text-xs ${STATUS_COLOURS[s.status] ?? ''}`}>{statusLabel(s.status)}</Badge></TableCell>
                  <TableCell className="text-sm">{s.user_profiles?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.started_at ? format(parseISO(s.started_at), 'dd MMM yy') : '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.completed_at ? format(parseISO(s.completed_at), 'dd MMM yy') : '—'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => openSession(s)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Stocktake Session</DialogTitle>
            <DialogDescription>Stock lines will be auto-populated from current on-hand quantities.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Session Name *</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Q2 2026 Uniform Count" />
            </div>
            <div className="space-y-1.5">
              <Label>Location Filter</Label>
              <Input value={createForm.location} onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))} placeholder="Leave blank for all locations" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createSession} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Create Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────
// KeyManagementTab
// ─────────────────────────────────────────────
function KeyManagementTab({
  keySets,
  custody,
  officers,
  orgId,
  onRefresh,
}: {
  keySets: KeySet[]
  custody: KeyCustody[]
  officers: OfficerOption[]
  orgId: string
  onRefresh: () => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCheckoutDialog, setShowCheckoutDialog] = useState<KeySet | null>(null)
  const [showReturnDialog, setShowReturnDialog] = useState<KeySet | null>(null)
  const [showScanDialog, setShowScanDialog] = useState(false)
  const [checkoutForm, setCheckoutForm] = useState({ officer_id: '', expected_return: '', purpose: '' })
  const [returnForm, setReturnForm] = useState({ return_condition: 'good', notes: '' })
  const [saving, setSaving] = useState(false)

  const filtered = keySets.filter((k) => {
    const matchSearch =
      !search ||
      k.name.toLowerCase().includes(search.toLowerCase()) ||
      (k.storage_location ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (k.user_profiles?.full_name ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || k.status === statusFilter
    return matchSearch && matchStatus
  })

  function handleScan(code: string) {
    setShowScanDialog(false)
    const keyset = keySets.find((k) => k.id === code || k.name === code)
    if (!keyset) { toast.error(`No key set found for barcode: ${code}`); return }
    if (keyset.status === 'available') {
      setShowCheckoutDialog(keyset)
      toast.success(`Key set found: ${keyset.name}`)
    } else if (keyset.status === 'checked_out') {
      setShowReturnDialog(keyset)
      toast.success(`Key set found: ${keyset.name}`)
    } else {
      toast.info(`Key set "${keyset.name}" status: ${keyset.status}`)
    }
  }

  async function handleCheckout() {
    if (!showCheckoutDialog || !checkoutForm.officer_id) { toast.error('Officer required'); return }
    setSaving(true)
    const { error: custodyErr } = await (supabase as any).from('key_custody').insert({
      organization_id: orgId,
      key_set_id: showCheckoutDialog.id,
      officer_id: checkoutForm.officer_id,
      checked_out_at: new Date().toISOString(),
      expected_return: checkoutForm.expected_return ? new Date(checkoutForm.expected_return).toISOString() : null,
      checkout_purpose: checkoutForm.purpose || null,
      status: 'checked_out',
    })
    if (custodyErr) { toast.error(custodyErr.message); setSaving(false); return }
    await (supabase as any).from('key_sets').update({
      status: 'checked_out',
      current_holder_id: checkoutForm.officer_id,
      checked_out_at: new Date().toISOString(),
      expected_return: checkoutForm.expected_return ? new Date(checkoutForm.expected_return).toISOString() : null,
    }).eq('id', showCheckoutDialog.id)
    setSaving(false)
    toast.success('Keys checked out')
    setShowCheckoutDialog(null)
    setCheckoutForm({ officer_id: '', expected_return: '', purpose: '' })
    onRefresh()
  }

  async function handleReturn() {
    if (!showReturnDialog) return
    setSaving(true)
    await (supabase as any).from('key_custody').update({
      returned_at: new Date().toISOString(),
      return_condition: returnForm.return_condition,
      return_notes: returnForm.notes || null,
      status: 'returned',
    }).eq('key_set_id', showReturnDialog.id).eq('status', 'checked_out')
    await (supabase as any).from('key_sets').update({
      status: 'available',
      current_holder_id: null,
      checked_out_at: null,
      expected_return: null,
    }).eq('id', showReturnDialog.id)
    setSaving(false)
    toast.success('Keys returned')
    setShowReturnDialog(null)
    setReturnForm({ return_condition: 'good', notes: '' })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search key sets…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="checked_out">Checked Out</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowScanDialog(true)}>
          <Scan className="h-4 w-4" /> Scan Key
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key Set</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Current Holder</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No key sets found</TableCell></TableRow>
              )}
              {filtered.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="text-sm font-medium">{k.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{k.storage_location ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{k.client_sites?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{k.user_profiles?.full_name ?? '—'}</TableCell>
                  <TableCell className={`text-sm ${k.status === 'checked_out' && isOverdue(k.expected_return) ? 'text-red-600 font-semibold' : ''}`}>
                    {k.expected_return ? format(parseISO(k.expected_return), 'dd MMM yy HH:mm') : '—'}
                  </TableCell>
                  <TableCell><Badge className={`text-xs ${STATUS_COLOURS[k.status] ?? ''}`}>{statusLabel(k.status)}</Badge></TableCell>
                  <TableCell>
                    {k.status === 'available' && (
                      <Button size="sm" variant="outline" onClick={() => setShowCheckoutDialog(k)}>
                        <ArrowUp className="h-3.5 w-3.5 mr-1" /> Check Out
                      </Button>
                    )}
                    {k.status === 'checked_out' && (
                      <Button size="sm" variant="outline" onClick={() => setShowReturnDialog(k)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Return
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent custody history */}
      {custody.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Custody History</CardTitle>
            <CardDescription>Last 20 check-out / return events</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key Set</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Checked Out</TableHead>
                  <TableHead>Returned</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {custody.slice(0, 20).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{c.key_sets?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{c.user_profiles?.full_name ?? c.user_profiles?.email ?? '—'}</TableCell>
                    <TableCell className="text-sm">{format(parseISO(c.checked_out_at), 'dd MMM yy HH:mm')}</TableCell>
                    <TableCell className="text-sm">{c.returned_at ? format(parseISO(c.returned_at), 'dd MMM yy HH:mm') : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.checkout_purpose ?? '—'}</TableCell>
                    <TableCell><Badge className={`text-xs ${STATUS_COLOURS[c.status] ?? ''}`}>{statusLabel(c.status)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <BarcodeInputDialog
        open={showScanDialog}
        title="Scan Key Set Barcode"
        description="Scan a key set's barcode to check it out or return it instantly."
        onScan={handleScan}
        onClose={() => setShowScanDialog(false)}
      />

      {/* Checkout dialog */}
      {showCheckoutDialog && (
        <Dialog open onOpenChange={() => setShowCheckoutDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Check Out Keys</DialogTitle>
              <DialogDescription>Issuing: <strong>{showCheckoutDialog.name}</strong></DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Officer *</Label>
                <Select value={checkoutForm.officer_id} onValueChange={(v) => setCheckoutForm((f) => ({ ...f, officer_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                  <SelectContent>
                    {officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name ?? o.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Purpose</Label>
                <Input value={checkoutForm.purpose} onChange={(e) => setCheckoutForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Night patrol — Rutherford Park" />
              </div>
              <div className="space-y-1.5">
                <Label>Expected Return</Label>
                <Input type="datetime-local" value={checkoutForm.expected_return} onChange={(e) => setCheckoutForm((f) => ({ ...f, expected_return: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCheckoutDialog(null)}>Cancel</Button>
              <Button onClick={handleCheckout} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowUp className="h-4 w-4 mr-2" />}
                Check Out
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Return dialog */}
      {showReturnDialog && (
        <Dialog open onOpenChange={() => setShowReturnDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Return Keys</DialogTitle>
              <DialogDescription>Returning: <strong>{showReturnDialog.name}</strong></DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Return Condition</Label>
                <Select value={returnForm.return_condition} onValueChange={(v) => setReturnForm((f) => ({ ...f, return_condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea value={returnForm.notes} onChange={(e) => setReturnForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReturnDialog(null)}>Cancel</Button>
              <Button onClick={handleReturn} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Confirm Return
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function AssetManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const orgId = user?.organization_id ?? ''
  const userId = user?.id ?? ''

  const requestedTab = searchParams.get('tab')
  const validTabs = new Set(['overview', 'equipment', 'stock', 'stocktake', 'keys'])
  const [activeTab, setActiveTab] = useState(validTabs.has(requestedTab || '') ? String(requestedTab) : 'overview')
  const deepLinkOfficerId = searchParams.get('officer_id') || ''
  const deepLinkIssue = searchParams.get('issue') === '1'

  useEffect(() => {
    const nextTab = searchParams.get('tab')
    if (nextTab && validTabs.has(nextTab) && nextTab !== activeTab) {
      setActiveTab(nextTab)
    }
  }, [searchParams, activeTab])

  const [loading, setLoading] = useState(true)
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [assets, setAssets] = useState<OfficerAsset[]>([])
  const [stock, setStock] = useState<AssetStock[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([])
  const [keySets, setKeySets] = useState<KeySet[]>([])
  const [custody, setCustody] = useState<KeyCustody[]>([])
  const [officers, setOfficers] = useState<OfficerOption[]>([])

  const [showCreateTypeDialog, setShowCreateTypeDialog] = useState(false)
  const [creatingType, setCreatingType] = useState(false)
  const [newTypeCode, setNewTypeCode] = useState('')
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeCategory, setNewTypeCategory] = useState<'uniform' | 'ppe' | 'communication' | 'computing' | 'vehicle' | 'tool' | 'access' | 'other'>('other')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)

    const [typesRes, assetsRes, stockRes, movRes, stocktakeRes, keySetsRes, custodyRes, officersRes] = await Promise.all([
      (supabase as any)
        .from('asset_types')
        .select('id, code, name, category')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('category').order('name'),
      (supabase as any)
        .from('officer_assets')
        .select('*, asset_types(id,code,name,category), user_profiles(full_name,email)')
        .eq('organization_id', orgId)
        .order('issued_date', { ascending: false })
        .limit(200),
      (supabase as any)
        .from('asset_stock')
        .select('*, asset_types(id,code,name,category)')
        .eq('organization_id', orgId)
        .order('location').order('asset_type_id'),
      (supabase as any)
        .from('asset_stock_movements')
        .select('*, asset_stock(asset_types(name)), user_profiles(full_name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50),
      (supabase as any)
        .from('asset_stocktakes')
        .select('*, user_profiles(full_name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('key_sets')
        .select('*, user_profiles(full_name), client_sites(name)')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name'),
      (supabase as any)
        .from('key_custody')
        .select('*, key_sets(name), user_profiles(full_name,email)')
        .eq('organization_id', orgId)
        .order('checked_out_at', { ascending: false })
        .limit(50),
      (supabase as any)
        .from('user_profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .in('role', ['officer', 'admin_officer', 'admin'])
        .order('full_name'),
    ])

    setAssetTypes(((typesRes.data ?? []) as unknown) as AssetType[])
    setAssets(((assetsRes.data ?? []) as unknown) as OfficerAsset[])
    setStock(((stockRes.data ?? []) as unknown) as AssetStock[])
    setMovements(((movRes.data ?? []) as unknown) as StockMovement[])
    setStocktakes(((stocktakeRes.data ?? []) as unknown) as Stocktake[])
    setKeySets(((keySetsRes.data ?? []) as unknown) as KeySet[])
    setCustody(((custodyRes.data ?? []) as unknown) as KeyCustody[])
    setOfficers(((officersRes.data ?? []) as unknown) as OfficerOption[])

    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function handleCreateAssetType() {
    const code = newTypeCode.trim().toUpperCase()
    const name = newTypeName.trim()

    if (!orgId) {
      toast.error('Organization context is required')
      return
    }
    if (!code || !name) {
      toast.error('Asset type code and name are required')
      return
    }

    setCreatingType(true)
    const { error } = await (supabase as any)
      .from('asset_types')
      .insert({
        organization_id: orgId,
        code,
        name,
        category: newTypeCategory,
        created_by: userId || null,
      })

    setCreatingType(false)

    if (error) {
      toast.error(error.message || 'Failed to create asset type')
      return
    }

    toast.success('Asset type created')
    setShowCreateTypeDialog(false)
    setNewTypeCode('')
    setNewTypeName('')
    setNewTypeCategory('other')
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Asset Management</h1>
          <p className="text-muted-foreground text-sm">Equipment, stock inventory, stocktakes and key management</p>
        </div>
        <Button onClick={() => setShowCreateTypeDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Asset Type
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value)
        const next = new URLSearchParams(searchParams)
        next.set('tab', value)
        setSearchParams(next)
      }}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="gap-2">
            <Package className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="equipment" className="gap-2">
            <Package className="h-4 w-4" /> Equipment
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-2">
            <Layers className="h-4 w-4" /> Stock
          </TabsTrigger>
          <TabsTrigger value="stocktake" className="gap-2">
            <ClipboardList className="h-4 w-4" /> Stocktake
          </TabsTrigger>
          <TabsTrigger value="keys" className="gap-2">
            <Key className="h-4 w-4" /> Key Management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab assets={assets} stock={stock} keySets={keySets} custody={custody} />
        </TabsContent>

        <TabsContent value="equipment" className="mt-4">
          <EquipmentTab
            assets={assets}
            assetTypes={assetTypes}
            officers={officers}
            orgId={orgId}
            onRefresh={load}
            initialOfficerId={deepLinkOfficerId}
            autoOpenIssue={deepLinkIssue}
            onConsumedDeepLink={() => {
              if (!deepLinkIssue && !deepLinkOfficerId) return
              const next = new URLSearchParams(searchParams)
              next.delete('issue')
              next.delete('officer_id')
              setSearchParams(next)
            }}
          />
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <StockTab stock={stock} movements={movements} assetTypes={assetTypes} orgId={orgId} userId={userId} onRefresh={load} />
        </TabsContent>

        <TabsContent value="stocktake" className="mt-4">
          <StocktakeTab stocktakes={stocktakes} stock={stock} assetTypes={assetTypes} orgId={orgId} userId={userId} onRefresh={load} />
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <KeyManagementTab keySets={keySets} custody={custody} officers={officers} orgId={orgId} onRefresh={load} />
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateTypeDialog} onOpenChange={setShowCreateTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Asset Type</DialogTitle>
            <DialogDescription>
              Create a reusable equipment type for assignment, stock, and stocktake workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input
                value={newTypeCode}
                onChange={(e) => setNewTypeCode(e.target.value)}
                placeholder="e.g. RADIO_HANDHELD"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="e.g. Handheld Radio"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={newTypeCategory} onValueChange={(v: any) => setNewTypeCategory(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniform">Uniform</SelectItem>
                  <SelectItem value="ppe">PPE</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                  <SelectItem value="computing">Computing</SelectItem>
                  <SelectItem value="vehicle">Vehicle</SelectItem>
                  <SelectItem value="tool">Tool</SelectItem>
                  <SelectItem value="access">Access</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateTypeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateAssetType} disabled={creatingType}>
              {creatingType ? 'Creating…' : 'Create Asset Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

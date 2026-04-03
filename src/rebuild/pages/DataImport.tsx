import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

type ImportType = 'observations' | 'zones' | 'vehicles'

interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
}

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

export default function CleanDataImport() {
  const { user } = useAuthStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importType, setImportType] = useState<ImportType>('observations')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const orgId = user?.organization_id ?? undefined

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setPreview(parseCsvRows(text).slice(0, 5))
    }
    reader.readAsText(f)
  }

  async function runImport() {
    if (!file || !orgId) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const text = await file.text()
      const rows = parseCsvRows(text)
      let inserted = 0, skipped = 0
      const errors: string[] = []

      if (importType === 'observations') {
        for (const row of rows) {
          if (!row.plate_number || !row.zone_id) { skipped++; continue }
          const { error: err } = await supabase.from('observations').insert({
            organization_id: orgId,
            plate_number: row.plate_number.toUpperCase(),
            zone_id: row.zone_id || null,
            recorded_at: row.observed_at || new Date().toISOString(),
            observation_notes: row.observation_notes || row.notes || null,
            photo_url: row.photo_url || null,
          })
          if (err) { errors.push(`Row ${inserted + skipped + 1}: ${err.message}`); skipped++ } else { inserted++ }
        }
      } else if (importType === 'vehicles') {
        for (const row of rows) {
          if (!row.plate_number) { skipped++; continue }
          const { error: err } = await supabase.from('canonical_vehicles').upsert({
            plate_number: row.plate_number.toUpperCase(),
            vehicle_make: row.make || null,
            vehicle_model: row.model || null,
            vehicle_color: row.colour || null,
          }, { onConflict: 'plate_number' })
          if (err) { errors.push(`Row ${inserted + skipped + 1}: ${err.message}`); skipped++ } else { inserted++ }
        }
      } else if (importType === 'zones') {
        for (const row of rows) {
          if (!row.zone_name) { skipped++; continue }
          const { error: err } = await supabase.from('zones').insert({
            organization_id: orgId,
            name: row.zone_name,
            zone_type: row.zone_type || 'freedom_camping',
            max_consecutive_nights: row.max_consecutive_nights ? parseInt(row.max_consecutive_nights) : null,
            nights_per_month: row.max_nights_per_month ? parseInt(row.max_nights_per_month) : null,
            self_contained_required: row.free_camping_allowed === 'true' ? false : null,
          })
          if (err) { errors.push(`Row ${inserted + skipped + 1}: ${err.message}`); skipped++ } else { inserted++ }
        }
      }

      setResult({ inserted, skipped, errors: errors.slice(0, 20) })
    } catch (e: any) {
      setError(e.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const templateColumns: Record<ImportType, string[]> = {
    observations: ['plate_number', 'zone_id', 'observed_at', 'observation_notes', 'photo_url'],
    vehicles: ['plate_number', 'plate_state', 'make', 'model', 'colour'],
    zones: ['zone_name', 'zone_type', 'free_camping_allowed', 'max_consecutive_nights', 'max_nights_per_month'],
  }

  function downloadTemplate() {
    const cols = templateColumns[importType]
    const csv = cols.join(',') + '\n' + cols.map(() => '').join(',')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `template-${importType}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Data Import</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Type selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Import type</label>
          <div className="flex gap-3">
            {(['observations', 'vehicles', 'zones'] as ImportType[]).map(t => (
              <button
                key={t}
                onClick={() => { setImportType(t); setFile(null); setPreview([]); setResult(null); if (fileRef.current) fileRef.current.value = '' }}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                  importType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Template download */}
        <div className="flex items-center gap-3">
          <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline">
            ⬇ Download CSV template
          </button>
          <span className="text-xs text-gray-400">Columns: {templateColumns[importType].join(', ')}</span>
        </div>

        {/* File upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Upload CSV</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {/* Preview */}
        {preview.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Preview (first 5 rows)</p>
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="text-xs min-w-full">
                <thead className="bg-gray-50">
                  <tr>{Object.keys(preview[0]).map(k => <th key={k} className="px-3 py-2 text-left text-gray-600 font-medium">{k}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => <td key={j} className="px-3 py-2 text-gray-700 max-w-xs truncate">{v || '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {file && (
          <button
            onClick={runImport}
            disabled={importing}
            className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {importing ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> Importing…</>
            ) : (
              `Import ${importType}`
            )}
          </button>
        )}
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="text-base font-semibold text-gray-800">Import Complete</h2>
          <div className="flex gap-6 text-sm">
            <div className="text-green-700">✓ <strong>{result.inserted}</strong> inserted</div>
            <div className="text-yellow-700">⚠ <strong>{result.skipped}</strong> skipped</div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-red-600">Errors ({result.errors.length}):</p>
              <ul className="text-xs text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

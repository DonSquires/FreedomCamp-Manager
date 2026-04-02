import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

type ReportType = 'observations' | 'breaches' | 'notices'
type Format = 'json' | 'csv'

interface ReportConfig {
  type: ReportType
  format: Format
  dateFrom: string
  dateTo: string
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function thirtyDaysAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default function CleanReports() {
  const { user } = useAuthStore()
  const [config, setConfig] = useState<ReportConfig>({
    type: 'observations',
    format: 'csv',
    dateFrom: thirtyDaysAgoStr(),
    dateTo: todayStr(),
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ rows: number; preview: any[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runReport() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const { data, error: err } = await supabase.functions.invoke('export-data', {
        body: {
          type: config.type,
          format: config.format,
          date_from: config.dateFrom ? new Date(config.dateFrom).toISOString() : undefined,
          date_to: config.dateTo ? new Date(config.dateTo + 'T23:59:59').toISOString() : undefined,
        },
      })
      if (err) throw err

      if (config.format === 'csv') {
        // Trigger CSV download
        const blob = new Blob([data], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${config.type}-${config.dateFrom}-${config.dateTo}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setResult({ rows: (data as string).split('\n').length - 1, preview: [] })
      } else {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        const rows = Array.isArray(parsed) ? parsed : parsed.data ?? []
        setResult({ rows: rows.length, preview: rows.slice(0, 10) })
      }
    } catch (e: any) {
      setError(e.message ?? 'Report failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Reports & Data Export</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-800">Configure Report</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Report type</label>
            <select
              value={config.type}
              onChange={e => setConfig(c => ({ ...c, type: e.target.value as ReportType }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="observations">Observations</option>
              <option value="breaches">Breach Alerts</option>
              <option value="notices">Infringement Notices</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Output format</label>
            <select
              value={config.format}
              onChange={e => setConfig(c => ({ ...c, format: e.target.value as Format }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="csv">CSV (download)</option>
              <option value="json">JSON (preview)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From date</label>
            <input
              type="date"
              value={config.dateFrom}
              onChange={e => setConfig(c => ({ ...c, dateFrom: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To date</label>
            <input
              type="date"
              value={config.dateTo}
              onChange={e => setConfig(c => ({ ...c, dateTo: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={runReport}
          disabled={running}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {running ? (
            <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> Generating…</>
          ) : (
            config.format === 'csv' ? '⬇ Download CSV' : '▶ Run Report'
          )}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">Results</h2>
            <span className="text-sm text-gray-500">{result.rows} rows</span>
          </div>
          {result.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border border-gray-200 rounded">
                <thead className="bg-gray-50 text-gray-600 uppercase">
                  <tr>
                    {Object.keys(result.preview[0]).map(k => (
                      <th key={k} className="px-3 py-2 text-left font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {Object.values(row).map((v: any, j) => (
                        <td key={j} className="px-3 py-2 text-gray-700 max-w-xs truncate">{v == null ? '—' : String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows > 10 && (
                <p className="text-xs text-gray-400 mt-2">Showing first 10 of {result.rows} rows. Download CSV for full data.</p>
              )}
            </div>
          )}
          {config.format === 'csv' && result.rows > 0 && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
              ✓ CSV downloaded successfully — {result.rows} rows exported.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

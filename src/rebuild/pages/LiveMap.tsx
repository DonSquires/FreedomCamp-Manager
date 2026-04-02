import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface PatrolLocation {
  patrol_id: string
  officer_id: string
  zone_id: string | null
  zone_name: string | null
  officer_name: string | null
  status: string
  latitude: number | null
  longitude: number | null
  last_seen_at: string | null
}

interface RecentObservation {
  observation_id: string
  plate_number: string | null
  zone_name: string | null
  compliance_status: string | null
  observed_at: string
  latitude: number | null
  longitude: number | null
}

export default function CleanLiveMap() {
  const { user } = useAuthStore()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  const [patrols, setPatrols] = useState<PatrolLocation[]>([])
  const [recentObs, setRecentObs] = useState<RecentObservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leafletLoaded, setLeafletLoaded] = useState(false)

  const orgId = user?.user_metadata?.org_id as string | undefined

  // Dynamically load Leaflet
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).L) { setLeafletLoaded(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setLeafletLoaded(true)
    document.head.appendChild(script)
  }, [])

  // Init map once Leaflet loads
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || mapRef.current) return
    const L = (window as any).L
    mapRef.current = L.map(mapContainerRef.current).setView([-41.2865, 174.7762], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
  }, [leafletLoaded])

  // Fetch live data
  async function fetchData() {
    if (!orgId) return
    setError(null)
    try {
      const [patrolRes, obsRes] = await Promise.all([
        supabase
          .from('patrols')
          .select('patrol_id, officer_id, zone_id, status, zones(zone_name)')
          .eq('org_id', orgId)
          .eq('status', 'active'),
        supabase
          .from('observations')
          .select('observation_id, plate_number, zone_id, compliance_status, observed_at, latitude, longitude, zones(zone_name)')
          .eq('org_id', orgId)
          .order('observed_at', { ascending: false })
          .limit(100),
      ])
      if (patrolRes.error) throw patrolRes.error
      if (obsRes.error) throw obsRes.error

      const patrolData = ((patrolRes.data ?? []) as any[]).map(p => ({
        patrol_id: p.patrol_id,
        officer_id: p.officer_id,
        zone_id: p.zone_id,
        zone_name: p.zones?.zone_name ?? null,
        officer_name: null,
        status: p.status,
        latitude: null,
        longitude: null,
        last_seen_at: null,
      }))
      setPatrols(patrolData)

      const obsData = ((obsRes.data ?? []) as any[]).map(o => ({
        observation_id: o.observation_id,
        plate_number: o.plate_number,
        zone_name: o.zones?.zone_name ?? null,
        compliance_status: o.compliance_status,
        observed_at: o.observed_at,
        latitude: o.latitude,
        longitude: o.longitude,
      }))
      setRecentObs(obsData)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load map data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [orgId]) // eslint-disable-line

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [orgId]) // eslint-disable-line

  // Update map markers when observations change
  useEffect(() => {
    if (!mapRef.current || !leafletLoaded) return
    const L = (window as any).L
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    recentObs.forEach(obs => {
      if (!obs.latitude || !obs.longitude) return
      const colour = obs.compliance_status === 'breach' ? '#ef4444'
        : obs.compliance_status === 'compliant' ? '#22c55e'
        : '#f59e0b'
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:10px;height:10px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
        iconSize: [10, 10],
      })
      const marker = L.marker([obs.latitude, obs.longitude], { icon })
        .addTo(mapRef.current)
        .bindPopup(`<b>${obs.plate_number ?? 'Unknown'}</b><br>${obs.zone_name ?? ''}<br>${obs.compliance_status ?? 'unknown'}<br><small>${new Date(obs.observed_at).toLocaleString('en-NZ')}</small>`)
      markersRef.current.push(marker)
    })
  }, [recentObs, leafletLoaded])

  const breachCount = recentObs.filter(o => o.compliance_status === 'breach').length
  const compliantCount = recentObs.filter(o => o.compliance_status === 'compliant').length

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">Live Patrol Map</h1>
          {loading && <span className="text-sm text-gray-400 animate-pulse">Updating…</span>}
        </div>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span>{compliantCount} compliant</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>{breachCount} breaches</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>{patrols.length} active patrols</span>
        </div>
      </div>

      {error && <div className="px-6 py-2 text-red-600 text-sm bg-red-50 border-b border-red-200">{error}</div>}

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div ref={mapContainerRef} className="flex-1 z-0" />

        {/* Side panel */}
        <div className="w-80 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0">
          {/* Active patrols */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Active Patrols ({patrols.length})</h2>
            {patrols.length === 0 ? (
              <p className="text-xs text-gray-400">No active patrols</p>
            ) : (
              <ul className="space-y-2">
                {patrols.map(p => (
                  <li key={p.patrol_id} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></span>
                    <span className="text-gray-700">{p.zone_name ?? 'Unknown zone'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent observations */}
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Observations</h2>
            <ul className="space-y-2">
              {recentObs.slice(0, 20).map(obs => (
                <li key={obs.observation_id} className="text-xs border-b border-gray-50 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-gray-800">{obs.plate_number ?? '—'}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                      obs.compliance_status === 'breach' ? 'bg-red-100 text-red-700'
                        : obs.compliance_status === 'compliant' ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>{obs.compliance_status ?? 'unknown'}</span>
                  </div>
                  <div className="text-gray-400 mt-0.5">{obs.zone_name ?? '—'} · {new Date(obs.observed_at).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

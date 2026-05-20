/**
 * JobMap — Interactive map view for dispatch jobs
 * 
 * Shows all active jobs as pins on a map, with:
 * - Color-coded markers by job type
 * - Click to open job details popup
 * - Acknowledge / En Route actions
 * - Google Maps directions link
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { JurisdictionMapViewport } from '@/components/features/JurisdictionMapViewport'
import { MapFocusToolbar } from '@/components/features/MapFocusToolbar'
import { OfflineTileControl } from '@/components/features/OfflineTileControl'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  MapPin,
  Navigation,
  Clock,
  Siren,
  CheckCircle,
  Car,
  Tent,
  ParkingSquare,
  Volume2,
  Shield,
  AlertTriangle,
  Phone,
  ExternalLink,
  RefreshCw,
  Layers,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import 'leaflet/dist/leaflet.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MapJob {
  id: string
  job_number: string
  job_type: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: string
  title: string
  description: string | null
  address: string | null
  gps_lat: number | null
  gps_lng: number | null
  caller_name: string | null
  caller_phone: string | null
  created_at: string
  dispatched_at: string | null
  acknowledged_at: string | null
  response_sla_minutes: number
  sla_breached: boolean
  assigned_to: string | null
  assigned_officer: {
    id: string
    first_name: string
    last_name: string
  } | null
  zone: { name: string } | null
  client_site: { name: string; address: string | null } | null
}

// ── Job Type Configuration ────────────────────────────────────────────────────

const JOB_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: typeof Siren }> = {
  alarm_response:     { label: 'Alarm Response',     color: '#dc2626', bgColor: '#fecaca', icon: Siren },
  patrol:             { label: 'Patrol Check',       color: '#2563eb', bgColor: '#dbeafe', icon: Shield },
  freedom_camping:    { label: 'Freedom Camping',    color: '#16a34a', bgColor: '#dcfce7', icon: Tent },
  parking:            { label: 'Parking',            color: '#9333ea', bgColor: '#f3e8ff', icon: ParkingSquare },
  noise_complaint:    { label: 'Noise Complaint',    color: '#ea580c', bgColor: '#ffedd5', icon: Volume2 },
  welfare_check:      { label: 'Welfare Check',      color: '#0891b2', bgColor: '#cffafe', icon: AlertTriangle },
  property_check:     { label: 'Property Check',     color: '#4f46e5', bgColor: '#e0e7ff', icon: Shield },
  suspicious_activity:{ label: 'Suspicious Activity',color: '#b91c1c', bgColor: '#fee2e2', icon: AlertTriangle },
  lock_unlock:        { label: 'Lock/Unlock',        color: '#059669', bgColor: '#d1fae5', icon: Shield },
  escort:             { label: 'Escort',             color: '#7c3aed', bgColor: '#ede9fe', icon: Shield },
  medical:            { label: 'Medical',            color: '#dc2626', bgColor: '#fecaca', icon: AlertTriangle },
  fire:               { label: 'Fire',               color: '#dc2626', bgColor: '#fecaca', icon: AlertTriangle },
  vandalism:          { label: 'Vandalism',          color: '#b91c1c', bgColor: '#fee2e2', icon: AlertTriangle },
  general:            { label: 'General',            color: '#6b7280', bgColor: '#f3f4f6', icon: MapPin },
  other:              { label: 'Other',              color: '#6b7280', bgColor: '#f3f4f6', icon: MapPin },
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:      { label: 'Pending',      color: 'bg-gray-100 text-gray-700' },
  dispatched:   { label: 'Dispatched',   color: 'bg-blue-100 text-blue-700' },
  acknowledged: { label: 'Acknowledged', color: 'bg-indigo-100 text-indigo-700' },
  en_route:     { label: 'En Route',     color: 'bg-cyan-100 text-cyan-700' },
  on_scene:     { label: 'On Scene',     color: 'bg-amber-100 text-amber-700' },
  completed:    { label: 'Completed',    color: 'bg-green-100 text-green-700' },
  cancelled:    { label: 'Cancelled',    color: 'bg-red-100 text-red-700' },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low:    { label: 'Low',    color: 'bg-slate-100 text-slate-600' },
  normal: { label: 'Normal', color: 'bg-blue-100 text-blue-600' },
  high:   { label: 'High',   color: 'bg-orange-100 text-orange-700' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700 animate-pulse' },
}

// ── Map Viewport Controller ───────────────────────────────────────────────────

function MapViewportController({ jobs, selectedJob }: { jobs: MapJob[]; selectedJob: string | null }) {
  const map = useMap()
  
  // Fit bounds to show all jobs when loaded
  useEffect(() => {
    const jobsWithGPS = jobs.filter(j => j.gps_lat && j.gps_lng)
    if (jobsWithGPS.length === 0) return
    
    if (selectedJob) {
      const job = jobsWithGPS.find(j => j.id === selectedJob)
      if (job) {
        map.setView([job.gps_lat!, job.gps_lng!], 15, { animate: true })
        return
      }
    }
    
    if (jobsWithGPS.length === 1) {
      map.setView([jobsWithGPS[0].gps_lat!, jobsWithGPS[0].gps_lng!], 14, { animate: true })
    } else {
      const bounds = jobsWithGPS.map(j => [j.gps_lat!, j.gps_lng!] as [number, number])
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true })
    }
  }, [map, jobs, selectedJob])
  
  return null
}

// ── Create custom marker icons ────────────────────────────────────────────────

function createJobIcon(jobType: string, priority: string, status: string): L.DivIcon {
  const config = JOB_TYPE_CONFIG[jobType] || JOB_TYPE_CONFIG.general
  const isUrgent = priority === 'urgent'
  const isHighPriority = priority === 'high' || priority === 'urgent'
  
  const pulseClass = isUrgent ? 'animate-ping' : ''
  const size = isHighPriority ? 36 : 28
  
  return L.divIcon({
    className: 'custom-job-marker',
    html: `
      <div class="relative">
        ${isUrgent ? `<div class="absolute inset-0 rounded-full ${pulseClass}" style="background-color: ${config.color}40;"></div>` : ''}
        <div 
          class="flex items-center justify-center rounded-full border-2 shadow-lg"
          style="
            width: ${size}px; 
            height: ${size}px; 
            background-color: ${config.bgColor};
            border-color: ${config.color};
          "
        >
          <svg 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="${config.color}" 
            stroke-width="2.5"
            style="width: ${size * 0.5}px; height: ${size * 0.5}px;"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function JobMap() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const orgId = user?.organization_id
  
  // State
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [typeFilters, setTypeFilters] = useState<string[]>([])
  const [statusFilters, setStatusFilters] = useState<string[]>(['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene'])
  const [showMyJobsOnly, setShowMyJobsOnly] = useState(false)
  
  // Default center (New Zealand)
  const defaultCenter: [number, number] = [-41.2865, 174.7762]
  
  // ── Fetch Jobs ──────────────────────────────────────────────────────────────
  
  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ['job-map-jobs', orgId, statusFilters, showMyJobsOnly],
    queryFn: async () => {
      let query = (supabase as any)
        .from('dispatch_jobs')
        .select(`
          id, job_number, job_type, priority, status, title, description,
          address, gps_lat, gps_lng, caller_name, caller_phone,
          created_at, dispatched_at, acknowledged_at, response_sla_minutes,
          sla_breached, assigned_to,
          assigned_officer:assigned_to(id, first_name, last_name),
          zone:zone_id(name),
          client_site:client_site_id(name, address)
        `)
        .eq('organization_id', orgId!)
        .in('status', statusFilters)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
      
      if (showMyJobsOnly && user?.id) {
        query = query.eq('assigned_to', user.id)
      }
      
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as MapJob[]
    },
    enabled: !!orgId && statusFilters.length > 0,
    refetchInterval: 30_000,
  })
  
  // Filter jobs
  const filteredJobs = useMemo(() => {
    let result = jobs
    if (typeFilters.length > 0) {
      result = result.filter(j => typeFilters.includes(j.job_type))
    }
    return result
  }, [jobs, typeFilters])
  
  // Jobs with GPS coordinates
  const jobsWithGPS = useMemo(() => 
    filteredJobs.filter(j => j.gps_lat != null && j.gps_lng != null),
    [filteredJobs]
  )
  
  // ── Update Job Status ───────────────────────────────────────────────────────
  
  const updateStatusMutation = useMutation({
    mutationFn: async ({ jobId, newStatus }: { jobId: string; newStatus: string }) => {
      const update: {
        status: string
        acknowledged_at?: string
        en_route_at?: string
        on_scene_at?: string
        completed_at?: string
      } = { status: newStatus }
      
      if (newStatus === 'acknowledged') update.acknowledged_at = new Date().toISOString()
      if (newStatus === 'en_route') update.en_route_at = new Date().toISOString()
      if (newStatus === 'on_scene') update.on_scene_at = new Date().toISOString()
      if (newStatus === 'completed') update.completed_at = new Date().toISOString()
      
      const { error } = await supabase
        .from('dispatch_jobs')
        .update(update)
        .eq('id', jobId)
      
      if (error) throw error
    },
    onSuccess: (_, { newStatus }) => {
      queryClient.invalidateQueries({ queryKey: ['job-map-jobs'] })
      toast.success(`Job status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
    },
    onError: (error: any) => {
      toast.error(`Failed to update status: ${error.message}`)
    },
  })
  
  // ── Open Google Maps Directions ─────────────────────────────────────────────
  
  const openDirections = useCallback((lat: number, lng: number, address?: string | null) => {
    const destination = address ? encodeURIComponent(address) : `${lat},${lng}`
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`
    window.open(url, '_blank')
  }, [])
  
  // ── Get next action for job status ──────────────────────────────────────────
  
  const getNextAction = (status: string): { label: string; nextStatus: string } | null => {
    const actions: Record<string, { label: string; nextStatus: string }> = {
      dispatched:   { label: 'Acknowledge', nextStatus: 'acknowledged' },
      acknowledged: { label: 'En Route',    nextStatus: 'en_route' },
      en_route:     { label: 'On Scene',    nextStatus: 'on_scene' },
      on_scene:     { label: 'Complete',    nextStatus: 'completed' },
    }
    return actions[status] || null
  }
  
  // ── Render ──────────────────────────────────────────────────────────────────
  
  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 text-blue-600" />
              Job Map
              {filteredJobs.length > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {filteredJobs.length} active
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              View all dispatch jobs on map • Click a pin to see details
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="h-4 w-4 mr-1.5" />
              Filters
              {(typeFilters.length > 0 || showMyJobsOnly) && (
                <Badge className="ml-1.5" variant="secondary">
                  {typeFilters.length + (showMyJobsOnly ? 1 : 0)}
                </Badge>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
            <OfflineTileControl minZoom={12} maxZoom={14} />
          </div>
        </div>
        
        {/* Filter Panel */}
        {showFilters && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Filter Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* My Jobs Only */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="my-jobs"
                  checked={showMyJobsOnly}
                  onCheckedChange={(checked) => setShowMyJobsOnly(!!checked)}
                />
                <Label htmlFor="my-jobs" className="text-sm">Show only my assigned jobs</Label>
              </div>
              
              {/* Job Type Filters */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Job Types</Label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(JOB_TYPE_CONFIG).map(([type, config]) => (
                    <Button
                      key={type}
                      size="sm"
                      variant={typeFilters.includes(type) ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => {
                        setTypeFilters(prev => 
                          prev.includes(type) 
                            ? prev.filter(t => t !== type)
                            : [...prev, type]
                        )
                      }}
                    >
                      {config.label}
                    </Button>
                  ))}
                </div>
              </div>
              
              {/* Status Filters */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Status</Label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STATUS_CONFIG).filter(([s]) => s !== 'completed' && s !== 'cancelled').map(([status, config]) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={statusFilters.includes(status) ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => {
                        setStatusFilters(prev => 
                          prev.includes(status) 
                            ? prev.filter(s => s !== status)
                            : [...prev, status]
                        )
                      }}
                    >
                      {config.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {[
            { label: 'Pending', count: filteredJobs.filter(j => j.status === 'pending').length, color: 'text-gray-600' },
            { label: 'Dispatched', count: filteredJobs.filter(j => j.status === 'dispatched').length, color: 'text-blue-600' },
            { label: 'En Route', count: filteredJobs.filter(j => j.status === 'en_route').length, color: 'text-cyan-600' },
            { label: 'On Scene', count: filteredJobs.filter(j => j.status === 'on_scene').length, color: 'text-amber-600' },
            { label: 'SLA Breached', count: filteredJobs.filter(j => j.sla_breached).length, color: 'text-red-600' },
            { label: 'On Map', count: jobsWithGPS.length, color: 'text-green-600' },
          ].map(stat => (
            <Card key={stat.label} className="p-3">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className={`text-xl font-bold ${stat.color}`}>{stat.count}</div>
            </Card>
          ))}
        </div>
        
        {/* Map */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Job Locations ({jobsWithGPS.length} on map)
              </CardTitle>
              <MapFocusToolbar onFocus={() => setFocusKey(k => k + 1)} className="gap-1.5" />
            </div>
            <CardDescription className="text-xs">
              Click a marker to view job details and take action
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                Loading jobs...
              </div>
            ) : jobsWithGPS.length === 0 ? (
              <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                No jobs with GPS coordinates to display
              </div>
            ) : (
              <div style={{ height: '500px' }}>
                <MapContainer
                  key={focusKey}
                  center={defaultCenter}
                  zoom={12}
                  style={{ height: '100%', width: '100%', borderRadius: '0 0 0.5rem 0.5rem' }}
                >
                  <JurisdictionMapViewport />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapViewportController jobs={jobsWithGPS} selectedJob={selectedJobId} />
                  
                  <MarkerClusterGroup
                    chunkedLoading
                    maxClusterRadius={40}
                    spiderfyOnMaxZoom
                  >
                    {jobsWithGPS.map(job => {
                      const typeConfig = JOB_TYPE_CONFIG[job.job_type] || JOB_TYPE_CONFIG.general
                      const statusConfig = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending
                      const priorityConfig = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG.normal
                      const nextAction = getNextAction(job.status)
                      const IconComponent = typeConfig.icon
                      
                      return (
                        <CircleMarker
                          key={job.id}
                          center={[job.gps_lat!, job.gps_lng!]}
                          radius={job.priority === 'urgent' ? 14 : job.priority === 'high' ? 12 : 10}
                          pathOptions={{
                            fillColor: typeConfig.color,
                            fillOpacity: 0.85,
                            color: job.sla_breached ? '#dc2626' : typeConfig.color,
                            weight: job.sla_breached ? 3 : 2,
                          }}
                          eventHandlers={{
                            click: () => setSelectedJobId(job.id),
                          }}
                        >
                          <Popup maxWidth={320} minWidth={280}>
                            <div className="space-y-3 p-1">
                              {/* Header */}
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-mono text-xs text-muted-foreground">
                                    {job.job_number}
                                  </div>
                                  <div className="font-semibold text-base">{job.title}</div>
                                </div>
                                <IconComponent 
                                  className="h-5 w-5 flex-shrink-0" 
                                  style={{ color: typeConfig.color }}
                                />
                              </div>
                              
                              {/* Badges */}
                              <div className="flex flex-wrap gap-1.5">
                                <Badge variant="outline" style={{ 
                                  backgroundColor: typeConfig.bgColor, 
                                  color: typeConfig.color,
                                  borderColor: typeConfig.color 
                                }}>
                                  {typeConfig.label}
                                </Badge>
                                <Badge className={statusConfig.color}>
                                  {statusConfig.label}
                                </Badge>
                                <Badge className={priorityConfig.color}>
                                  {priorityConfig.label}
                                </Badge>
                                {job.sla_breached && (
                                  <Badge variant="destructive" className="animate-pulse">
                                    SLA Breached
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Details */}
                              <div className="text-sm space-y-1.5">
                                {job.address && (
                                  <div className="flex items-start gap-2">
                                    <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                                    <span>{job.address}</span>
                                  </div>
                                )}
                                {job.zone?.name && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Layers className="h-3.5 w-3.5" />
                                    <span>{job.zone.name}</span>
                                  </div>
                                )}
                                {job.assigned_officer && (
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-3.5 w-3.5 text-blue-500" />
                                    <span>
                                      {job.assigned_officer.first_name} {job.assigned_officer.last_name}
                                    </span>
                                  </div>
                                )}
                                {job.caller_phone && (
                                  <div className="flex items-center gap-2">
                                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                    <a href={`tel:${job.caller_phone}`} className="text-blue-600 hover:underline">
                                      {job.caller_phone}
                                    </a>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                                  <Clock className="h-3 w-3" />
                                  <span>Created {formatDateTime(job.created_at)}</span>
                                </div>
                              </div>
                              
                              {job.description && (
                                <div className="text-sm text-muted-foreground bg-muted/50 rounded p-2">
                                  {job.description}
                                </div>
                              )}
                              
                              {/* Actions */}
                              <div className="flex flex-col gap-2 pt-2 border-t">
                                {/* Next Status Action */}
                                {nextAction && (
                                  <Button
                                    size="sm"
                                    className="w-full"
                                    onClick={() => updateStatusMutation.mutate({ 
                                      jobId: job.id, 
                                      newStatus: nextAction.nextStatus 
                                    })}
                                    disabled={updateStatusMutation.isPending}
                                  >
                                    {nextAction.nextStatus === 'acknowledged' && <CheckCircle className="h-4 w-4 mr-1.5" />}
                                    {nextAction.nextStatus === 'en_route' && <Car className="h-4 w-4 mr-1.5" />}
                                    {nextAction.nextStatus === 'on_scene' && <MapPin className="h-4 w-4 mr-1.5" />}
                                    {nextAction.nextStatus === 'completed' && <CheckCircle className="h-4 w-4 mr-1.5" />}
                                    {nextAction.label}
                                  </Button>
                                )}
                                
                                {/* Google Maps Directions */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => openDirections(job.gps_lat!, job.gps_lng!, job.address)}
                                >
                                  <Navigation className="h-4 w-4 mr-1.5" />
                                  Get Directions
                                  <ExternalLink className="h-3 w-3 ml-1.5 opacity-50" />
                                </Button>
                              </div>
                            </div>
                          </Popup>
                        </CircleMarker>
                      )
                    })}
                  </MarkerClusterGroup>
                </MapContainer>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Legend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Map Legend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {Object.entries(JOB_TYPE_CONFIG).slice(0, 8).map(([type, config]) => {
                const IconComponent = config.icon
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: config.bgColor, border: `2px solid ${config.color}` }}
                    >
                      <IconComponent className="w-2 h-2" style={{ color: config.color }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{config.label}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

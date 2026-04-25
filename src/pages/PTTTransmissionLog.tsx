/**
 * PTT Transmission Log — Audit, playback & compliance
 *
 * Shows all transmitted audio clips with officer info, timestamps, transcripts.
 * Supports filtering, playback via Supabase Storage URLs, and CSV export for compliance.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Download, Play, Pause, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatInTimeZone } from 'date-fns-tz'

interface TransmissionEntry {
  id: string
  callsign: string
  name: string
  channelName: string
  channelNumber: string | number
  durationSeconds: number
  createdAt: string
  clipUrl: string | null
  transcript: string | null
  isEmergency: boolean
}

interface AudioPlayerState {
  currentId: string | null
  isPlaying: boolean
  currentTime: number
}

export function PTTTransmissionLog() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const audioRef = useRef<HTMLAudioElement>(null)
  
  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [selectedOfficer, setSelectedOfficer] = useState<string>('all')
  const [transcriptSearch, setTranscriptSearch] = useState('')
  
  // Audio playback state
  const [audioPlayer, setAudioPlayer] = useState<AudioPlayerState>({
    currentId: null,
    isPlaying: false,
    currentTime: 0,
  })

  const orgId = user?.organization_id || ''

  // Fetch all transmission logs
  const { data: transmissions = [], isLoading, error } = useQuery({
    queryKey: ['ptt-transmission-log', orgId],
    queryFn: async () => {
      if (!orgId) return []
      
      const { data, error } = await (supabase as any)
        .from('ptt_transmission_log')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500)
      
      if (error) {
        // Treat missing table as empty for compatibility
        if (error.code === 'PGRST205' || error.code === '42P01') {
          return []
        }
        throw error
      }
      
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        callsign: r.speaker_callsign || r.speaker_name || 'Unknown',
        name: r.speaker_name || 'Unknown',
        channelName: r.channel_name || '',
        channelNumber: r.channel_number || '',
        durationSeconds: parseFloat(r.duration_seconds ?? '0'),
        createdAt: r.created_at || '',
        clipUrl: r.clip_url ?? null,
        transcript: r.transcript ?? null,
        isEmergency: r.is_emergency ?? false,
      }))
    },
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // Extract unique channels and officers
  const { channels, officers } = useMemo(() => {
    const channelSet = new Set<string>()
    const officerSet = new Set<string>()

    transmissions.forEach((t) => {
      if (t.channelName) channelSet.add(t.channelName)
      if (t.name) officerSet.add(t.name)
    })

    return {
      channels: Array.from(channelSet).sort(),
      officers: Array.from(officerSet).sort(),
    }
  }, [transmissions])

  // Apply filters
  const filteredTransmissions = useMemo(() => {
    return transmissions.filter((t) => {
      // Date range filter
      if (dateFrom) {
        const txDate = new Date(t.createdAt).toDateString()
        const fromDate = new Date(dateFrom).toDateString()
        if (txDate < fromDate) return false
      }
      if (dateTo) {
        const txDate = new Date(t.createdAt).toDateString()
        const toDate = new Date(dateTo).toDateString()
        if (txDate > toDate) return false
      }

      // Channel filter
      if (selectedChannel !== 'all' && t.channelName !== selectedChannel) {
        return false
      }

      // Officer filter
      if (selectedOfficer !== 'all' && t.name !== selectedOfficer) {
        return false
      }

      // Transcript search
      if (transcriptSearch.trim()) {
        const searchLower = transcriptSearch.toLowerCase()
        const transcriptMatch = (t.transcript || '').toLowerCase().includes(searchLower)
        const callsignMatch = t.callsign.toLowerCase().includes(searchLower)
        if (!transcriptMatch && !callsignMatch) return false
      }

      return true
    })
  }, [transmissions, dateFrom, dateTo, selectedChannel, selectedOfficer, transcriptSearch])

  // Audio playback handlers
  const playClip = useCallback((id: string, clipUrl: string) => {
    if (!audioRef.current) return

    if (audioPlayer.currentId === id && audioPlayer.isPlaying) {
      audioRef.current.pause()
      setAudioPlayer((s) => ({ ...s, isPlaying: false }))
    } else {
      audioRef.current.src = clipUrl
      audioRef.current.play()
      setAudioPlayer({
        currentId: id,
        isPlaying: true,
        currentTime: 0,
      })
    }
  }, [audioPlayer.currentId, audioPlayer.isPlaying])

  const handleAudioEnded = useCallback(() => {
    setAudioPlayer((s) => ({ ...s, isPlaying: false }))
  }, [])

  // Export CSV
  const exportToCSV = useCallback(() => {
    const headers = ['Timestamp (NZ)', 'Officer', 'Channel', 'Duration (s)', 'Emergency', 'Transcript']
    
    const rows = filteredTransmissions.map((t) => [
      formatInTimeZone(new Date(t.createdAt), 'Pacific/Auckland', 'yyyy-MM-dd HH:mm:ss'),
      t.name,
      t.channelName,
      t.durationSeconds.toFixed(1),
      t.isEmergency ? 'Yes' : 'No',
      t.transcript ? `"${(t.transcript || '').replace(/"/g, '""')}"` : '',
    ])

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ptt-transmission-log-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredTransmissions])

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">PTT Transmission Log</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filteredTransmissions.length} of {transmissions.length} transmissions
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={exportToCSV}
            variant="outline"
            size="sm"
            disabled={filteredTransmissions.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button
            onClick={() => navigate(-1)}
            variant="ghost"
            size="sm"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Date From */}
            <div>
              <label className="text-sm font-medium">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="text-sm font-medium">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Channel */}
            <div>
              <label className="text-sm font-medium">Channel</label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {channels.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Officer */}
            <div>
              <label className="text-sm font-medium">Officer</label>
              <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Officers</SelectItem>
                  {officers.map((of) => (
                    <SelectItem key={of} value={of}>
                      {of}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Transcript Search */}
            <div>
              <label className="text-sm font-medium">Search Transcript</label>
              <Input
                type="search"
                placeholder="Search..."
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transmissions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading transmissions...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-500">Error loading transmissions</div>
          ) : filteredTransmissions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No transmissions found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Timestamp (NZ)</TableHead>
                    <TableHead className="w-[120px]">Officer</TableHead>
                    <TableHead className="w-[100px]">Channel</TableHead>
                    <TableHead className="w-[80px] text-right">Duration</TableHead>
                    <TableHead className="w-[80px]">Type</TableHead>
                    <TableHead className="flex-1">Transcript</TableHead>
                    <TableHead className="w-[60px] text-center">Audio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransmissions.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-gray-50">
                      <TableCell className="text-sm font-mono">
                        {formatInTimeZone(
                          new Date(tx.createdAt),
                          'Pacific/Auckland',
                          'MMM dd HH:mm:ss'
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{tx.name}</TableCell>
                      <TableCell className="text-sm">{tx.channelName}</TableCell>
                      <TableCell className="text-sm text-right">
                        {tx.durationSeconds.toFixed(1)}s
                      </TableCell>
                      <TableCell>
                        {tx.isEmergency ? (
                          <Badge variant="destructive" className="bg-red-600">
                            🚨 Emergency
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Normal</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm max-w-xs truncate text-gray-600">
                        {tx.transcript ? (
                          <span title={tx.transcript}>{tx.transcript}</span>
                        ) : (
                          <span className="text-gray-400 italic">No transcript</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {tx.clipUrl ? (
                          <button
                            onClick={() => playClip(tx.id, tx.clipUrl!)}
                            className="inline-flex items-center justify-center p-2 hover:bg-gray-100 rounded"
                            title={
                              audioPlayer.currentId === tx.id && audioPlayer.isPlaying
                                ? 'Pause'
                                : 'Play'
                            }
                          >
                            {audioPlayer.currentId === tx.id && audioPlayer.isPlaying ? (
                              <Pause className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Play className="w-4 h-4 text-gray-600" />
                            )}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden audio player */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        crossOrigin="anonymous"
      />
    </div>
  )
}

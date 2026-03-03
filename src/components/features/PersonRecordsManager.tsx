import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Flag, MessageSquare, History, User, AlertTriangle, Calendar, Car } from 'lucide-react'

interface PersonRecord {
  id: string
  name?: string
  description?: string
  vehicle_plates: string[]
  first_seen: string
  last_seen: string
  total_observations: number
  breach_count: number
  notes?: string
  is_flagged?: boolean
  organization_id: string
}

interface PersonRecordsManagerProps {
  records: PersonRecord[]
  onFlagRecord?: (recordId: string, flagged: boolean) => void
  onAddNote?: (recordId: string, note: string) => void
  onViewHistory?: (recordId: string) => void
  loading?: boolean
}

function PersonRecordCard({
  record,
  onFlagRecord,
  onAddNote,
  onViewHistory,
}: {
  record: PersonRecord
  onFlagRecord?: (id: string, flagged: boolean) => void
  onAddNote?: (id: string, note: string) => void
  onViewHistory?: (id: string) => void
}) {
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteText, setNoteText] = useState('')

  const handleAddNote = () => {
    if (noteText.trim() && onAddNote) {
      onAddNote(record.id, noteText.trim())
      setNoteText('')
      setShowNoteInput(false)
    }
  }

  return (
    <Card className={`transition-shadow hover:shadow-md ${record.is_flagged ? 'border-red-300' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <User className="h-4 w-4 text-gray-500" />
            {record.name ?? 'Unknown Person'}
            {record.is_flagged && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                <Flag className="h-3 w-3 mr-1" />
                Flagged
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-gray-500">Observations:</span>
            <span className="font-semibold">{record.total_observations}</span>
            {record.breach_count > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 ml-1">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {record.breach_count} Breach{record.breach_count !== 1 ? 'es' : ''}
              </Badge>
            )}
          </div>
        </div>
        {record.description && (
          <p className="text-sm text-gray-500 mt-1">{record.description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {record.vehicle_plates.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <Car className="h-3 w-3 text-gray-400" />
            {record.vehicle_plates.map(plate => (
              <Badge key={plate} variant="secondary" className="text-xs font-mono">
                {plate}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            First seen: {new Date(record.first_seen).toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Last seen: {new Date(record.last_seen).toLocaleDateString()}
          </span>
        </div>

        {record.notes && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 border">{record.notes}</p>
        )}

        {showNoteInput && (
          <div className="space-y-2">
            <textarea
              className="w-full text-sm border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-gray-300"
              rows={2}
              placeholder="Enter note…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddNote} disabled={!noteText.trim()}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowNoteInput(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1 border-t flex-wrap">
          {onFlagRecord && (
            <Button
              size="sm"
              variant="outline"
              className={record.is_flagged ? 'text-red-600 border-red-200 hover:bg-red-50' : ''}
              onClick={() => onFlagRecord(record.id, !record.is_flagged)}
            >
              <Flag className="h-3 w-3 mr-1" />
              {record.is_flagged ? 'Unflag' : 'Flag'}
            </Button>
          )}
          {onAddNote && !showNoteInput && (
            <Button size="sm" variant="outline" onClick={() => setShowNoteInput(true)}>
              <MessageSquare className="h-3 w-3 mr-1" />
              Add Note
            </Button>
          )}
          {onViewHistory && (
            <Button size="sm" variant="outline" onClick={() => onViewHistory(record.id)}>
              <History className="h-3 w-3 mr-1" />
              View History
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function PersonRecordsManager({ records, onFlagRecord, onAddNote, onViewHistory, loading = false }: PersonRecordsManagerProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        Loading records…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
        <User className="h-10 w-10" />
        <p className="text-sm">No person records found.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {records.map(record => (
        <PersonRecordCard
          key={record.id}
          record={record}
          onFlagRecord={onFlagRecord}
          onAddNote={onAddNote}
          onViewHistory={onViewHistory}
        />
      ))}
    </div>
  )
}

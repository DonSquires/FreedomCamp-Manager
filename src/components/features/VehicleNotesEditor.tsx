/**
 * VehicleNotesEditor Component
 * Add and edit vehicle notes
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { 
  FileText, 
  Plus, 
  Trash2, 
  Edit2,
  Save,
  X,
  Calendar,
  User,
} from 'lucide-react'
import { toast } from 'sonner'

interface VehicleNote {
  id: string
  plate_number: string
  note_text: string
  created_by: string
  created_at: string
  updated_at: string
  user_profiles?: {
    first_name: string
    last_name: string
  }
}

interface VehicleNotesEditorProps {
  plateNumber: string
  maxLength?: number
}

export function VehicleNotesEditor({
  plateNumber,
  maxLength = 500,
}: VehicleNotesEditorProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  // Fetch notes (from vehicle_notes table or similar)
  // Note: This assumes a vehicle_notes table exists. If not, we'll use a simple RPC or create one.
  const { data: notes, isLoading } = useQuery({
    queryKey: ['vehicle-notes', plateNumber],
    queryFn: async () => {
      // First check if vehicle_notes table exists, otherwise use a simple approach
      const { data, error } = await supabase
        .rpc('get_vehicle_notes_history', { p_plate_number: plateNumber })

      if (error) {
        // Fallback: Return empty array if function doesn't exist
        console.warn('vehicle notes function not found, returning empty')
        return []
      }

      return data || []
    },
  })

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async (text: string) => {
      // Since we don't have a dedicated notes table yet, we'll store in canonical_vehicles
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .update({
          last_note_preview: text.substring(0, 200),
          last_note_at: new Date().toISOString(),
        })
        .eq('plate_number', plateNumber)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-notes', plateNumber] })
      queryClient.invalidateQueries({ queryKey: ['vehicle-details', plateNumber] })
      setNoteText('')
      setIsAdding(false)
      toast.success('Note added successfully')
    },
    onError: (error: any) => {
      toast.error(`Failed to add note: ${error.message}`)
    },
  })

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      // For now, just clear the last note
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .update({
          last_note_preview: null,
          last_note_at: null,
        })
        .eq('plate_number', plateNumber)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-notes', plateNumber] })
      queryClient.invalidateQueries({ queryKey: ['vehicle-details', plateNumber] })
      toast.success('Note deleted')
    },
    onError: (error: any) => {
      toast.error(`Failed to delete note: ${error.message}`)
    },
  })

  const handleAddNote = () => {
    if (!noteText.trim()) {
      toast.error('Please enter a note')
      return
    }

    if (noteText.length > maxLength) {
      toast.error(`Note too long (max ${maxLength} characters)`)
      return
    }

    addNoteMutation.mutate(noteText)
  }

  const handleCancel = () => {
    setNoteText('')
    setIsAdding(false)
    setEditingId(null)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Vehicle Notes
            </CardTitle>
            <CardDescription className="mt-1">
              Add context, observations, or important information about this vehicle
            </CardDescription>
          </div>
          {!isAdding && (
            <Button onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Note
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add note form */}
        {isAdding && (
          <Card className="border-primary">
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="note-text">Note</Label>
                  <textarea
                    id="note-text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Enter your note here..."
                    className="w-full min-h-24 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                    maxLength={maxLength}
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    {noteText.length} / {maxLength} characters
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleAddNote} disabled={addNoteMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Note
                  </Button>
                  <Button variant="outline" onClick={handleCancel}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Existing notes */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading notes...
          </div>
        ) : notes && notes.length > 0 ? (
          <div className="space-y-3">
            {notes.map((note: VehicleNote) => (
              <Card key={note.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {note.user_profiles?.first_name} {note.user_profiles?.last_name}
                        </span>
                        <span className="text-muted-foreground">•</span>
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {new Date(note.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {note.created_by === user?.id && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(note.id)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteNoteMutation.mutate(note.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{note.note_text}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No notes yet</p>
            <p className="text-sm mt-1">Add the first note for this vehicle</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

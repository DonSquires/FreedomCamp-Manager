/**
 * PostShiftFeedback – Deputy-style end-of-shift mood check.
 *
 * Shown as a dialog when an officer's shift ends (manual logout or app timeout).
 * Officer rates their shift 1–5 and optionally leaves a note.
 * Data is written to officer_shifts.shift_rating + shift_feedback.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface Props {
  shiftId: string | null
  open: boolean
  onClose: () => void
}

const RATINGS = [
  { value: 1, emoji: '😞', label: 'Tough'    },
  { value: 2, emoji: '😐', label: 'Okay'     },
  { value: 3, emoji: '🙂', label: 'Good'     },
  { value: 4, emoji: '😊', label: 'Great'    },
  { value: 5, emoji: '🌟', label: 'Excellent' },
]

export function PostShiftFeedback({ shiftId, open, onClose }: Props) {
  const [rating, setRating]     = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')

  const submit = useMutation({
    mutationFn: async () => {
      if (!shiftId) return
      const { error } = await (supabase
        .from('officer_shifts') as any)
        .update({
          shift_rating:   rating,
          shift_feedback: feedback.trim() || null,
        })
        .eq('id', shiftId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift feedback saved – thanks!')
      onClose()
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Could not save feedback')
    },
  })

  function handleSkip() {
    onClose()
  }

  function handleSubmit() {
    if (!rating) { toast.error('Please select a rating'); return }
    submit.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleSkip() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg">How was your shift?</DialogTitle>
          <DialogDescription className="text-center text-sm">
            Your feedback helps us improve rostering and support.
          </DialogDescription>
        </DialogHeader>

        {/* Star / emoji rating */}
        <div className="flex justify-center gap-2 py-2">
          {RATINGS.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRating(r.value)}
              className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 border-2 transition-all ${
                rating === r.value
                  ? 'border-primary bg-primary/10 scale-110 shadow-md'
                  : 'border-transparent hover:border-muted-foreground/30'
              }`}
            >
              <span className="text-2xl">{r.emoji}</span>
              <span className="text-[10px] text-muted-foreground">{r.label}</span>
            </button>
          ))}
        </div>

        {/* Optional note */}
        <Textarea
          placeholder="Anything to flag? (optional)"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          rows={2}
          className="text-sm"
        />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkip} disabled={submit.isPending}>
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={submit.isPending || !rating} className="flex-1">
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

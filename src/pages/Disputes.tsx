import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { AlertTriangle } from 'lucide-react'

type DisputeRow = {
  id: string
  source_type: string
  source_reference: string | null
  plate_number: string | null
  claimant_name: string | null
  claimant_email: string | null
  claimant_phone: string | null
  message: string
  request_homeless_review: boolean
  hardship_context: string | null
  evidence_statement: string | null
  status: string
  admin_notes: string | null
  submitted_at: string
}

const STATUSES = ['received', 'under_review', 'info_requested', 'upheld', 'varied', 'rejected', 'closed']

function DisputeCard({
  d,
  onSave,
  saving,
}: {
  d: DisputeRow
  onSave: (id: string, status: string, notes: string) => void
  saving: boolean
}) {
  const [status, setStatus] = useState(d.status)
  const [notes, setNotes] = useState(d.admin_notes || '')

  return (
    <Card key={d.id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{d.source_type.replace(/_/g, ' ')}</span>
          <Badge variant="outline">{d.status}</Badge>
          {d.request_homeless_review && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Homeless review requested
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p><strong>Reference:</strong> {d.source_reference || 'n/a'} · <strong>Plate:</strong> {d.plate_number || 'n/a'}</p>
        <p><strong>Claimant:</strong> {d.claimant_name || 'Unknown'} · {d.claimant_email || 'no email'} · {d.claimant_phone || 'no phone'}</p>
        <p><strong>Submitted:</strong> {new Date(d.submitted_at).toLocaleString('en-NZ')}</p>
        <div className="rounded border p-3 bg-muted/20">
          <p className="font-medium mb-1">Dispute message</p>
          <p className="whitespace-pre-wrap">{d.message}</p>
        </div>

        {d.request_homeless_review && (
          <div className="rounded border p-3 bg-amber-50 border-amber-300">
            <p className="font-medium mb-1">Homeless / hardship context</p>
            <p className="whitespace-pre-wrap">{d.hardship_context || 'No additional context provided.'}</p>
            {d.evidence_statement && (
              <>
                <p className="font-medium mt-2 mb-1">Evidence statement</p>
                <p className="whitespace-pre-wrap">{d.evidence_statement}</p>
              </>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Admin notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <Button onClick={() => onSave(d.id, status, notes)} disabled={saving}>
          Save Review Update
        </Button>
      </CardContent>
    </Card>
  )
}

export default function Disputes() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: disputes = [], isLoading } = useQuery({
    queryKey: ['dispute-intake', user?.organization_id, statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('dispute_intake')
        .select('id, source_type, source_reference, plate_number, claimant_name, claimant_email, claimant_phone, message, request_homeless_review, hardship_context, evidence_statement, status, admin_notes, submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(200)

      if (user?.role !== 'master' && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      }
      if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter)
      }

      const { data, error } = await q
      if (error) throw error
      return (data || []) as DisputeRow[]
    },
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, admin_notes }: { id: string; status: string; admin_notes: string }) => {
      const { error } = await (supabase as any)
        .from('dispute_intake')
        .update({ status, admin_notes })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Dispute updated')
      queryClient.invalidateQueries({ queryKey: ['dispute-intake'] })
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update dispute'),
  })

  return (
    <AppLayout title="Disputes" description="Review recipient disputes and homeless/hardship requests">
      <div className="mb-4 flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading disputes…</CardContent></Card>
      ) : disputes.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No disputes found.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {disputes.map((d) => (
            <DisputeCard
              key={d.id}
              d={d}
              onSave={(id, status, admin_notes) => updateMutation.mutate({ id, status, admin_notes })}
              saving={updateMutation.isPending}
            />
          ))}
        </div>
      )}
    </AppLayout>
  )
}

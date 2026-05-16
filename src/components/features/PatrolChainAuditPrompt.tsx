import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ClipboardList, Loader2 } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

type PatrolRouteChain = {
  id: string
  name: string
  status: string
  patrol_route_id: string | null
  custom_data: Record<string, unknown> | null
}

interface PatrolChainAuditPromptProps {
  open: boolean
  title: string
  description?: string
  organizationId: string | null
  patrolRouteId: string | null
  patrolRouteName?: string | null
  patrolRouteCode?: string | null
  shiftPhase: 'start' | 'end'
  onCancel: () => void
  onConfirm: (chainIds: string[]) => Promise<void>
}

export function PatrolChainAuditPrompt({
  open,
  title,
  description,
  organizationId,
  patrolRouteId,
  patrolRouteName,
  patrolRouteCode,
  shiftPhase,
  onCancel,
  onConfirm,
}: PatrolChainAuditPromptProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const { data: chains = [], isLoading } = useQuery<PatrolRouteChain[]>({
    queryKey: ['patrol-chain-audit-prompt', organizationId, patrolRouteId],
    queryFn: async () => {
      if (!organizationId || !patrolRouteId) return []

      const { data, error } = await (supabase as any)
        .from('key_sets')
        .select('id, name, status, patrol_route_id, custom_data')
        .eq('organization_id', organizationId)
        .eq('patrol_route_id', patrolRouteId)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return ((data ?? []) as unknown) as PatrolRouteChain[]
    },
    enabled: open && !!organizationId && !!patrolRouteId,
  })

  useEffect(() => {
    if (!open) return
    setSelectedIds(chains.map((chain) => chain.id))
  }, [chains, open])

  const allSelected = chains.length > 0 && selectedIds.length === chains.length

  const headerLabel = useMemo(() => {
    const pieces = [patrolRouteCode, patrolRouteName].filter(Boolean)
    return pieces.length > 0 ? pieces.join(' · ') : 'assigned patrol route'
  }, [patrolRouteCode, patrolRouteName])

  async function handleConfirm() {
    setSubmitting(true)
    try {
      await onConfirm(selectedIds)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>
            {description ?? `${shiftPhase === 'start' ? 'Confirm the chain before the patrol starts.' : 'Confirm the chain before the patrol ends.'}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CalendarDays className="h-4 w-4" /> {headerLabel}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Patrol chains are assigned to patrol routes. Verify the chain for this route before continuing.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">Active chains on this route</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => setSelectedIds(allSelected ? [] : chains.map((chain) => chain.id))}
                disabled={chains.length === 0}
              >
                {allSelected ? 'Clear' : 'Select all'}
              </Button>
            </div>
            <ScrollArea className="h-56 rounded-md border">
              <div className="space-y-2 p-3">
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading route chains…
                  </div>
                )}
                {!isLoading && chains.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active chains are assigned to this patrol route.</p>
                )}
                {chains.map((chain) => {
                  const barcode = String(chain.custom_data?.chain_barcode ?? chain.custom_data?.barcode ?? '—')
                  const checked = selectedIds.includes(chain.id)
                  return (
                    <label key={chain.id} className="flex items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/40">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setSelectedIds((current) =>
                            next
                              ? Array.from(new Set([...current, chain.id]))
                              : current.filter((id) => id !== chain.id)
                          )
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{chain.name}</span>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{chain.status}</Badge>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">{barcode}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirm Audit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

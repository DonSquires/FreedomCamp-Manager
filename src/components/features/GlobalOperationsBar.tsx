import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOperationsStore, type Operation } from '@/stores/operationsStore'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  Activity,
  Trash2,
} from 'lucide-react'

function OperationRow({ op, onDismiss }: { op: Operation; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const elapsed = op.completedAt
    ? Math.round((op.completedAt - op.startedAt) / 1000)
    : Math.round((Date.now() - op.startedAt) / 1000)

  return (
    <div className="border-t border-gray-200 dark:border-[#9E9E9E]/20 first:border-t-0">
      <div className="flex items-center gap-2 px-3 py-2 min-h-[44px]">
        {/* Status icon */}
        {op.status === 'running' && (
          <RefreshCw className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
        )}
        {op.status === 'completed' && (
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
        )}
        {op.status === 'failed' && (
          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}

        {/* Label + progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{op.label}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {op.status === 'running'
                ? `${op.progress}%`
                : op.status === 'completed'
                  ? `Done in ${elapsed}s`
                  : 'Failed'}
            </span>
          </div>
          {op.status === 'running' && (
            <Progress value={op.progress} className="h-1.5 mt-1" />
          )}
        </div>

        {/* Expand toggle for details */}
        {(op.liveProgress || op.result) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        {/* Dismiss (only for completed/failed) */}
        {op.status !== 'running' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss operation"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2">
          {op.status === 'running' && op.liveProgress && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Target" value={op.liveProgress.total} />
              <Stat label="Processed" value={op.liveProgress.processed} />
              <Stat label="Changed" value={op.liveProgress.changed} color="text-orange-600" />
              <Stat label="Breaches" value={op.liveProgress.breachesCreated} color="text-red-600" />
              <Stat label="Dismissed" value={op.liveProgress.breachesDismissed} color="text-green-600" />
              <Stat label="Skipped" value={op.liveProgress.skippedNoRules} color="text-blue-600" />
            </div>
          )}

          {op.result && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat label="Processed" value={op.result.observations_processed} />
                <Stat label="Changed" value={op.result.compliance_changed} color="text-orange-600" />
                <Stat label="Breaches" value={op.result.breaches_created} color="text-red-600" />
                <Stat label="Dismissed" value={op.result.breaches_dismissed} color="text-green-600" />
                <Stat label="Skipped" value={op.result.skipped_no_rules} color="text-blue-600" />
                <Stat label="Duration" value={`${op.result.duration_seconds}s`} color="text-purple-600" />
              </div>
              {op.result.error_message && (
                <p className="text-xs text-red-600 truncate">{op.result.error_message}</p>
              )}
              {op.status === 'completed' && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => navigate('/compliance-recalculation')}
                >
                  View full results →
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number | string
  color?: string
}) {
  return (
    <div className="bg-muted/50 rounded px-2 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className={`font-semibold ${color ?? ''}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

export function GlobalOperationsBar() {
  const { operations, dismissOperation, clearCompleted } = useOperationsStore()
  const [collapsed, setCollapsed] = useState(false)

  if (operations.length === 0) return null

  const activeCount = operations.filter((op) => op.status === 'running').length
  const completedCount = operations.filter((op) => op.status !== 'running').length

  return (
    <div
      role="region"
      aria-label="Operations progress"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 dark:border-[#9E9E9E]/20 bg-white dark:bg-[#1A1A1A] shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-[#1E1E1E]">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 cursor-pointer select-none text-left"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
        >
          <Activity className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold">
            Operations
            {activeCount > 0 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {activeCount} running
              </span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-1">
          {completedCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Clear completed"
              aria-label="Clear completed operations"
              onClick={() => clearCompleted()}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <button
            type="button"
            className="p-0.5"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? 'Expand operations' : 'Collapse operations'}
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>
      {collapsed && activeCount > 0 && (
        <div className="px-3 py-1.5">
          {operations
            .filter((op) => op.status === 'running')
            .map((op) => (
              <div key={op.id} className="flex items-center gap-2">
                <RefreshCw className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
                <span className="text-xs truncate flex-1">{op.label}</span>
                <span className="text-xs text-muted-foreground">{op.progress}%</span>
              </div>
            ))}
        </div>
      )}

      {/* Expanded list */}
      {!collapsed && (
        <div className="max-h-[50vh] overflow-y-auto">
          {operations.map((op) => (
            <OperationRow
              key={op.id}
              op={op}
              onDismiss={() => dismissOperation(op.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

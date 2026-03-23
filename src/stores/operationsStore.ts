import { create } from 'zustand'

export interface OperationProgress {
  total: number
  processed: number
  changed: number
  breachesCreated: number
  breachesDismissed: number
  skippedNoRules: number
}

export interface OperationResult {
  observations_processed: number
  zones_corrected?: number
  duplicates_removed?: number
  vehicle_details_refreshed?: number
  compliance_changed: number
  breaches_created: number
  breaches_dismissed: number
  skipped_no_rules: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

export interface Operation {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
  progress: number
  liveProgress: OperationProgress | null
  result: OperationResult | null
  startedAt: number
  completedAt: number | null
}

interface OperationsState {
  operations: Operation[]

  startOperation: (id: string, label: string) => void
  updateProgress: (id: string, progress: number, liveProgress?: OperationProgress) => void
  completeOperation: (id: string, result: OperationResult) => void
  failOperation: (id: string, errorMessage: string) => void
  dismissOperation: (id: string) => void
  clearCompleted: () => void
  hasActiveOperations: () => boolean
}

export const useOperationsStore = create<OperationsState>()((set, get) => ({
  operations: [],

  startOperation: (id, label) => {
    set((state) => ({
      operations: [
        ...state.operations.filter((op) => op.id !== id),
        {
          id,
          label,
          status: 'running',
          progress: 0,
          liveProgress: null,
          result: null,
          startedAt: Date.now(),
          completedAt: null,
        },
      ],
    }))
  },

  updateProgress: (id, progress, liveProgress) => {
    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === id ? { ...op, progress, liveProgress: liveProgress ?? op.liveProgress } : op,
      ),
    }))
  },

  completeOperation: (id, result) => {
    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === id
          ? { ...op, status: 'completed', progress: 100, result, completedAt: Date.now() }
          : op,
      ),
    }))
  },

  failOperation: (id, errorMessage) => {
    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === id
          ? {
              ...op,
              status: 'failed',
              completedAt: Date.now(),
              result: op.result
                ? { ...op.result, status: 'failed', error_message: errorMessage }
                : {
                    observations_processed: op.liveProgress?.processed ?? 0,
                    compliance_changed: op.liveProgress?.changed ?? 0,
                    breaches_created: op.liveProgress?.breachesCreated ?? 0,
                    breaches_dismissed: op.liveProgress?.breachesDismissed ?? 0,
                    skipped_no_rules: op.liveProgress?.skippedNoRules ?? 0,
                    duration_seconds: Math.round((Date.now() - op.startedAt) / 1000),
                    status: 'failed',
                    error_message: errorMessage,
                  },
            }
          : op,
      ),
    }))
  },

  dismissOperation: (id) => {
    set((state) => ({
      operations: state.operations.filter((op) => op.id !== id),
    }))
  },

  clearCompleted: () => {
    set((state) => ({
      operations: state.operations.filter((op) => op.status === 'running'),
    }))
  },

  hasActiveOperations: () => {
    return get().operations.some((op) => op.status === 'running')
  },
}))

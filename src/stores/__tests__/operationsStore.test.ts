import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOperationsStore, type OperationResult, type OperationProgress } from '../operationsStore'

beforeEach(() => {
  useOperationsStore.setState({ operations: [] })
})

const makeResult = (overrides: Partial<OperationResult> = {}): OperationResult => ({
  observations_processed: 100,
  compliance_changed: 5,
  breaches_created: 2,
  breaches_dismissed: 1,
  skipped_no_rules: 3,
  duration_seconds: 10,
  status: 'completed',
  ...overrides,
})

// ── startOperation ────────────────────────────────────────────────────────────

describe('startOperation', () => {
  it('adds an operation in "running" status', () => {
    useOperationsStore.getState().startOperation('op-1', 'Reprocess observations')
    const ops = useOperationsStore.getState().operations
    expect(ops).toHaveLength(1)
    expect(ops[0].id).toBe('op-1')
    expect(ops[0].label).toBe('Reprocess observations')
    expect(ops[0].status).toBe('running')
    expect(ops[0].progress).toBe(0)
    expect(ops[0].result).toBeNull()
    expect(ops[0].liveProgress).toBeNull()
  })

  it('replaces an existing operation with the same id', () => {
    useOperationsStore.getState().startOperation('op-1', 'First run')
    useOperationsStore.getState().startOperation('op-1', 'Retry run')
    const ops = useOperationsStore.getState().operations
    expect(ops).toHaveLength(1)
    expect(ops[0].label).toBe('Retry run')
  })

  it('records a startedAt timestamp', () => {
    const before = Date.now()
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const after = Date.now()
    const { startedAt } = useOperationsStore.getState().operations[0]
    expect(startedAt).toBeGreaterThanOrEqual(before)
    expect(startedAt).toBeLessThanOrEqual(after)
  })
})

// ── updateProgress ────────────────────────────────────────────────────────────

describe('updateProgress', () => {
  it('updates the progress percentage', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().updateProgress('op-1', 50)
    const op = useOperationsStore.getState().operations[0]
    expect(op.progress).toBe(50)
  })

  it('stores live progress object when provided', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const liveProgress: OperationProgress = {
      total: 200,
      processed: 100,
      changed: 10,
      breachesCreated: 3,
      breachesDismissed: 1,
      skippedNoRules: 5,
    }
    useOperationsStore.getState().updateProgress('op-1', 50, liveProgress)
    expect(useOperationsStore.getState().operations[0].liveProgress).toEqual(liveProgress)
  })

  it('retains previous liveProgress if none supplied', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const liveProgress: OperationProgress = {
      total: 100, processed: 50, changed: 5, breachesCreated: 1, breachesDismissed: 0, skippedNoRules: 2,
    }
    useOperationsStore.getState().updateProgress('op-1', 25, liveProgress)
    useOperationsStore.getState().updateProgress('op-1', 75)
    expect(useOperationsStore.getState().operations[0].liveProgress).toEqual(liveProgress)
  })

  it('does not affect other operations', () => {
    useOperationsStore.getState().startOperation('op-1', 'A')
    useOperationsStore.getState().startOperation('op-2', 'B')
    useOperationsStore.getState().updateProgress('op-1', 60)
    const op2 = useOperationsStore.getState().operations.find((o) => o.id === 'op-2')
    expect(op2?.progress).toBe(0)
  })
})

// ── completeOperation ─────────────────────────────────────────────────────────

describe('completeOperation', () => {
  it('sets status to "completed" and progress to 100', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().completeOperation('op-1', makeResult())
    const op = useOperationsStore.getState().operations[0]
    expect(op.status).toBe('completed')
    expect(op.progress).toBe(100)
  })

  it('stores the result', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const result = makeResult({ observations_processed: 42 })
    useOperationsStore.getState().completeOperation('op-1', result)
    expect(useOperationsStore.getState().operations[0].result).toEqual(result)
  })

  it('records completedAt timestamp', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const before = Date.now()
    useOperationsStore.getState().completeOperation('op-1', makeResult())
    const after = Date.now()
    const { completedAt } = useOperationsStore.getState().operations[0]
    expect(completedAt).toBeGreaterThanOrEqual(before)
    expect(completedAt).toBeLessThanOrEqual(after)
  })
})

// ── failOperation ─────────────────────────────────────────────────────────────

describe('failOperation', () => {
  it('sets status to "failed"', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().failOperation('op-1', 'Something went wrong')
    expect(useOperationsStore.getState().operations[0].status).toBe('failed')
  })

  it('sets error_message on the result', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().failOperation('op-1', 'Timeout')
    const op = useOperationsStore.getState().operations[0]
    expect(op.result?.error_message).toBe('Timeout')
    expect(op.result?.status).toBe('failed')
  })

  it('preserves liveProgress counts in the result when there is no existing result', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const liveProgress: OperationProgress = {
      total: 100, processed: 40, changed: 8, breachesCreated: 2, breachesDismissed: 1, skippedNoRules: 3,
    }
    useOperationsStore.getState().updateProgress('op-1', 40, liveProgress)
    useOperationsStore.getState().failOperation('op-1', 'Error')
    const result = useOperationsStore.getState().operations[0].result
    expect(result?.observations_processed).toBe(40)
    expect(result?.compliance_changed).toBe(8)
  })

  it('records completedAt timestamp', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    const before = Date.now()
    useOperationsStore.getState().failOperation('op-1', 'Error')
    const after = Date.now()
    const { completedAt } = useOperationsStore.getState().operations[0]
    expect(completedAt).toBeGreaterThanOrEqual(before)
    expect(completedAt).toBeLessThanOrEqual(after)
  })
})

// ── dismissOperation ──────────────────────────────────────────────────────────

describe('dismissOperation', () => {
  it('removes the operation from the list', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().dismissOperation('op-1')
    expect(useOperationsStore.getState().operations).toHaveLength(0)
  })

  it('only removes the targeted operation', () => {
    useOperationsStore.getState().startOperation('op-1', 'A')
    useOperationsStore.getState().startOperation('op-2', 'B')
    useOperationsStore.getState().dismissOperation('op-1')
    const ops = useOperationsStore.getState().operations
    expect(ops).toHaveLength(1)
    expect(ops[0].id).toBe('op-2')
  })
})

// ── clearCompleted ────────────────────────────────────────────────────────────

describe('clearCompleted', () => {
  it('removes completed operations', () => {
    useOperationsStore.getState().startOperation('op-1', 'Running')
    useOperationsStore.getState().startOperation('op-2', 'Done')
    useOperationsStore.getState().completeOperation('op-2', makeResult())
    useOperationsStore.getState().clearCompleted()
    const ops = useOperationsStore.getState().operations
    expect(ops).toHaveLength(1)
    expect(ops[0].id).toBe('op-1')
  })

  it('removes failed operations', () => {
    useOperationsStore.getState().startOperation('op-1', 'Running')
    useOperationsStore.getState().startOperation('op-2', 'Failed')
    useOperationsStore.getState().failOperation('op-2', 'Error')
    useOperationsStore.getState().clearCompleted()
    const ops = useOperationsStore.getState().operations
    expect(ops).toHaveLength(1)
    expect(ops[0].id).toBe('op-1')
  })

  it('keeps running operations', () => {
    useOperationsStore.getState().startOperation('op-1', 'Still running')
    useOperationsStore.getState().clearCompleted()
    expect(useOperationsStore.getState().operations).toHaveLength(1)
  })
})

// ── hasActiveOperations ───────────────────────────────────────────────────────

describe('hasActiveOperations', () => {
  it('returns false when no operations', () => {
    expect(useOperationsStore.getState().hasActiveOperations()).toBe(false)
  })

  it('returns true when there is a running operation', () => {
    useOperationsStore.getState().startOperation('op-1', 'Active')
    expect(useOperationsStore.getState().hasActiveOperations()).toBe(true)
  })

  it('returns false after all operations are completed', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().completeOperation('op-1', makeResult())
    expect(useOperationsStore.getState().hasActiveOperations()).toBe(false)
  })

  it('returns false after all operations are failed', () => {
    useOperationsStore.getState().startOperation('op-1', 'Test')
    useOperationsStore.getState().failOperation('op-1', 'Error')
    expect(useOperationsStore.getState().hasActiveOperations()).toBe(false)
  })

  it('returns true when at least one operation is still running', () => {
    useOperationsStore.getState().startOperation('op-1', 'Running')
    useOperationsStore.getState().startOperation('op-2', 'Done')
    useOperationsStore.getState().completeOperation('op-2', makeResult())
    expect(useOperationsStore.getState().hasActiveOperations()).toBe(true)
  })
})

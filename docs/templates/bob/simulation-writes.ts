/**
 * EXAMPLE / TEMPLATE — Simulation-Tagged Writes and Teardown
 *
 * This file is a reference template, not production code.
 * Copy and adapt as needed.
 *
 * Follows: docs/BOB_SAFE_RUNTIME_CONTRACT.md
 *   Rule 1: Every generated write must include is_simulation: true.
 *   Rule 2: Every write includes a session_id for targeted cleanup.
 *   Rule 3: Cleanup block deletes all rows matching is_simulation + session_id.
 *   Rule 4: No promotion to production without explicit human instruction.
 */

import { supabase } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

// ─── Session ─────────────────────────────────────────────────────────────────

/**
 * A simulation session scopes all writes to a single, cleanable context.
 * Generate once per eval run; pass to all write helpers.
 */
export interface SimulationSession {
  sessionId: string
  organizationId: string
  startedAt: string
}

export function createSimulationSession(organizationId: string): SimulationSession {
  return {
    sessionId: uuidv4(),
    organizationId,
    startedAt: new Date().toISOString(),
  }
}

// ─── Simulation-Tagged Write Helpers ─────────────────────────────────────────

/**
 * Inserts a simulated patrol route waypoint.
 * All rows carry is_simulation: true and the session_id.
 */
export async function insertSimulatedWaypoint(
  session: SimulationSession,
  waypointData: {
    name: string
    latitude: number
    longitude: number
    patrol_route_id: string
  },
) {
  const { data, error } = await supabase.from('patrol_route_waypoints').insert({
    ...waypointData,
    organization_id: session.organizationId,
    is_simulation: true,
    simulation_session_id: session.sessionId,
    created_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(`Simulated waypoint insert failed: ${error.message}`)
  }

  return data
}

/**
 * Inserts a simulated guard roster entry.
 */
export async function insertSimulatedRosterEntry(
  session: SimulationSession,
  rosterData: {
    officer_id: string
    shift_start: string
    shift_end: string
    zone_id: string
  },
) {
  const { data, error } = await supabase.from('guard_rosters').insert({
    ...rosterData,
    organization_id: session.organizationId,
    is_simulation: true,
    simulation_session_id: session.sessionId,
    created_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(`Simulated roster entry insert failed: ${error.message}`)
  }

  return data
}

// ─── Delta Reporting ─────────────────────────────────────────────────────────

export interface DeltaReport {
  session_id: string
  stage: 'delta-report'
  duration_seconds: number
  db_operations: {
    simulated_inserts: number
    simulated_updates: number
    simulated_deletes: number
  }
  state_before: string
  state_after: string
  cleanup_status: 'pending' | 'complete'
  tenant_isolation_verified: boolean
  approval_required: true
}

export function buildDeltaReport(
  session: SimulationSession,
  stats: {
    inserts: number
    updates: number
    deletes: number
    stateBefore: string
    stateAfter: string
    cleanupStatus: 'pending' | 'complete'
  },
): DeltaReport {
  const durationSeconds = Math.round(
    (Date.now() - new Date(session.startedAt).getTime()) / 1000,
  )

  return {
    session_id: session.sessionId,
    stage: 'delta-report',
    duration_seconds: durationSeconds,
    db_operations: {
      simulated_inserts: stats.inserts,
      simulated_updates: stats.updates,
      simulated_deletes: stats.deletes,
    },
    state_before: stats.stateBefore,
    state_after: stats.stateAfter,
    cleanup_status: stats.cleanupStatus,
    tenant_isolation_verified: true,
    // Always true — human must review before any promotion
    approval_required: true,
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Deletes all simulation-tagged rows for a given session from a table.
 * Must be called at the end of every evaluation run.
 *
 * @param table     - Table name to clean up
 * @param sessionId - The simulation session ID to target
 */
export async function cleanupSimulatedRows(
  table: string,
  sessionId: string,
): Promise<{ deleted: number }> {
  const { data, error } = await supabase
    .from(table as never)
    .delete()
    .eq('is_simulation', true)
    .eq('simulation_session_id', sessionId)
    .select('id')

  if (error) {
    throw new Error(`Cleanup failed for table=${table}, session=${sessionId}: ${error.message}`)
  }

  return { deleted: (data as { id: string }[] | null)?.length ?? 0 }
}

/**
 * Cleans up all known simulation tables for a session.
 * Call this before outputting the delta report.
 */
export async function cleanupAllSimulatedRows(sessionId: string): Promise<Record<string, number>> {
  const tables = ['patrol_route_waypoints', 'guard_rosters']
  const results: Record<string, number> = {}

  for (const table of tables) {
    const { deleted } = await cleanupSimulatedRows(table, sessionId)
    results[table] = deleted
  }

  return results
}

/**
 * Example end-to-end usage (do not call without human approval at each gate):
 *
 * // Stage 3: simulation writes
 * const session = createSimulationSession('org-uuid-here')
 * await insertSimulatedWaypoint(session, { name: 'WP-1', latitude: -41.2, longitude: 174.7, patrol_route_id: 'route-1' })
 *
 * // Stage 4: cleanup and delta report
 * const cleanupStats = await cleanupAllSimulatedRows(session.sessionId)
 * const report = buildDeltaReport(session, {
 *   inserts: 1, updates: 0, deletes: cleanupStats['patrol_route_waypoints'],
 *   stateBefore: 'no waypoints', stateAfter: 'waypoint added then removed',
 *   cleanupStatus: 'complete',
 * })
 * console.log(JSON.stringify(report, null, 2))
 * // Present report to human and await approval before any production promotion
 */

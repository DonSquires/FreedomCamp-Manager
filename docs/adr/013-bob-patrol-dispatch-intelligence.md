# ADR 013: Bob Patrol & Dispatch Intelligence Architecture

**Date:** 2026-05-10  
**Status:** Accepted  
**Scope:** Bob AI Assistant, Patrol Operations, Historical Data Analysis  
**Author:** FieldOps Manager Development Team

## Context

Freedom camping enforcement operations require deep analysis of:
1. **Patrol setup briefs** from contracts (facility extraction, shift compliance, compliance evaluation)
2. **Historical performance data** (root-cause diagnostics for missed patrols, routing inefficiency, on-site time variance)
3. **Alarm/dispatch job classification** (noise_control, alarm_activation, ATM maintenance, fire alerts, late-to-close jobs)
4. **Deterministic mapping** (before Bob tries to automate, pre-review data and flag structuring issues)

The system needed to move beyond hope-and-verify Bob interactions to pre-classification, plan verification, and self-correcting workflow loops.

## Decision

We implemented a three-layer architecture:

### Layer 1: Patrol Setup Blueprint (`src/lib/bobSetupBlueprint.ts`)
- **Extract** facility requirements, patrol shift templates, SOP steps, and compliance blockers from pasted contract/schedule text
- **Evaluate** patrol shift compliance (task time + break time + travel time vs. shift window)
- **Review** historical performance (misses, routing distance, on-site variance, dispatch lag)
- **Classify** performance issues into actionable categories:
  - `officer_execution`: Missed or incomplete jobs
  - `route_design`: Inefficient stop sequencing or geography
  - `onsite_time`: Inconsistent dwell time vs. standard
  - `schedule_design`: Timeline pressure or dispatch lag

**Key Functions:**
- `coercePatrolSetupBlueprint()` — Parse raw text into structured blueprint
- `looksLikePatrolSetupBrief()` — Pre-detect if input is likely a patrol contract
- `evaluatePatrolShiftCompliance()` — Score shifts against task/break/travel constraints
- `reviewHistoricalPatrolPerformance()` — Analyze row-level metrics and flag patterns
- `formatHistoricalPerformanceAdminFeedback()` — Human-readable admin decisions with approval gates

**Design Rationale:**
- Deterministic parsing reduces Bob hallucination risk
- Pre-computed compliance scores let Bob recommend fixes with evidence
- Issue classification directs Bob toward targeted corrective actions

### Layer 2: Historical Dispatch Intelligence (`src/lib/historicalDispatchIntelligence.ts`)
- **Classify** each historical dispatch row into a job type (noise_control, alarm_activation, atm_maintenance, etc.)
- **Pre-review** placement hints to guide Bob's mapping decisions
- **Verify** Bob's output plan against expected mappings before insertion
- **Auto-correct** if Bob misses target locations or job_type mismatch

**Key Functions:**
- `classifyHistoricalDispatchJob()` — Deterministic keyword-based classifier with confidence scores
- `buildHistoricalDispatchPlacementReview()` — Parse tabular data and flag training gaps (missing despatch IDs, timestamps)
- `verifyBobDispatchPlacementPlan()` — Compare Bob's JSON plan against expected classifications and emit errors

**Design Rationale:**
- Pre-classification removes ambiguity from Bob's job type assignment
- Verification loop auto-detects mismatches and sends correction prompts
- Training tips guide future data structuring without human intervention

### Layer 3: Fallback Patrol Zones (`src/lib/patrolZoneFallbacks.ts`)
- Hardcoded geofence fallbacks for common deployment areas (Nelson 587, Richmond 586, Motueka 583, Day shift 585)
- Activated when Bob setup blueprint detects shift codes or geographic markers
- Provides deterministic zone boundaries when new site coordinates are unavailable

**Design Rationale:**
- Eliminates data-missing issues during rapid onboarding
- Allows pilot operations to start without complete geofence data
- Fallbacks can be overridden by explicit user uploads

## Implementation Details

### Test Coverage
- **bobSetupBlueprint.test.ts** (279 lines, 6 tests):
  - Detect patrol briefs from multi-format input
  - Coerce parsed data into stable blueprint structure
  - Evaluate compliance against shift windows
  - Format user-facing summaries and admin feedback
  - Identify historical data placement readiness
  - Diagnose performance patterns (execution, routing, timing)

- **historicalDispatchIntelligence.test.ts** (92 lines, 3 tests):
  - Classify noise, alarm, and ATM jobs with confidence
  - Build placement review from tabular data
  - Verify Bob's plan matches expected mappings

- **patrolZoneFallbacks.test.ts** (35 lines, 2 tests):
  - Resolve fallback patrol zones by shift code or facility name
  - Chain fallbacks (Nelson > Richmond > Motueka > Day shift)

### Integration Points
1. **Bob chat UI** (`src/pages/AiAnalysis.tsx`):
   - Embedded historical_alarm_dispatch_data intake mode
   - Pre-review hints in prompt before Bob responds
   - Automatic plan verification and correction prompts

2. **Bob assistant studio** (`src/pages/BobAssistantStudio.tsx`):
   - Organization-wide patrol option analysis
   - Historical performance diagnostics in patrol brief flow
   - Formatted admin feedback for approval decisions

3. **PTT Radio** (`src/pages/PTTRadio.tsx`):
   - Global filter org fallback for multiplex mode routing
   - Diplomatic/tactical mode resolution based on client org delegation

## Consequences

**Benefits:**
- Bob can now self-diagnose and request corrections when plan validation fails
- Historical performance analysis is fully automated and deterministic
- Admins have evidence-based recommendations for schedule/routing changes
- New dispatch data can be classified without manual intervention

**Risks & Mitigations:**
- **Keyword-based classifier may have false positives** → Mitigation: Training tips flag ambiguous rows; Bob verification step catches logical errors
- **Pre-review hints may bias Bob toward specific mappings** → Mitigation: Hints are placed *after* target_locations list, allowing Bob to override with evidence
- **Fallback patrol zones may be too coarse for precise operations** → Mitigation: Fallbacks only activate when explicit zones are unavailable; user can upload correct boundaries

## Related ADRs
- [ADR 001: Autonomous Learning Loop](001-autonomous-learning-loop.md) — Bob's self-correction framework
- [ADR 003: PTT Radio Service Topology](003-ptt-radio-service-topology.md) — Multiplex mode delegation

## References
- Patrol Setup Blueprint: `src/lib/bobSetupBlueprint.ts` (910 lines)
- Dispatch Intelligence: `src/lib/historicalDispatchIntelligence.ts` (292 lines)
- Fallback Zones: `src/lib/patrolZoneFallbacks.ts` (121 lines)
- Test Suite: `src/lib/__tests__/{bob,dispatch,fallback}.test.ts` (406 lines)

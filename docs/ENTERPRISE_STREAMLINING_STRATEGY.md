# Enterprise Streamlining Strategy
## Bob as USS Enterprise Command Center

**Vision**: Transform FieldOps Manager from segregated portals to a unified command interface, with Bob as the omnipresent AI nerve center (like Data/R2D2/C3PO across the Enterprise).

---

## Current State Assessment

### Problem 1: Fragmented Portal Architecture
```
Current: Click-heavy siloed experience
├── Admin Portal
│   ├── Compliance dashboard
│   ├── Enforcement actions
│   └── Reports
├── FieldOfficer Portal
│   ├── Patrol tracking
│   ├── Incident reports
│   └── Scanning
├── Parking Officer Portal
├── Noise Officer Portal
├── Biosecurity Officer Portal
└── ... 8 more portals

Result: Officers stuck in wrong portal, context switches painful
```

### Problem 2: Bob is Isolated
- Bob exists in **separate UI pages** (BobAssistantStudio, ChatStudio)
- Must **exit workflow** to access Bob
- No **portal-aware context** ("I'm in dispatch, show me active incidents")
- **Intent parsing** exists but doesn't bridge to portals
- **Command vocabulary** isn't unified across officer types

### Problem 3: No Unified Crew Coordination
- Each officer type sees their own silo
- **Shift handoffs** are manual, fragmented
- **Cross-team events** (welfare alerts, critical incidents) lose context
- **Voice-first operations** (radio dispatch, verbal orders) aren't leveraged

---

## Enterprise Streamlining Roadmap

### Phase 1: Unified Command Interface (Weeks 1–2)
**Goal**: Bob becomes the primary interface; portals are specialized views.

#### 1A: Embed Bob Everywhere
```typescript
// Every portal gets a persistent Bob sidebar/modal
// Example: FieldOfficerPortal

<AppLayout>
  <MainContent>
    <LivePatrolMap />
  </MainContent>
  
  <BobCommandPanel 
    context={{
      portalType: 'field_officer',
      activeIncidents: [...],
      currentLocation: [lat, lng],
      roster: [...]
    }}
  />
</AppLayout>
```

**Deliverables**:
- New `<BobContextualPanel>` component (embedded, not modal)
- Portal context manager (knows which portal, what data is visible)
- Unified voice input (always listening for wake word across portals)

#### 1B: Portal-Aware Intent Routing
```typescript
// Bob understands portal context
"Show me today's incidents" → 
  If in /admin → Admin compliance dashboard
  If in /field-officer → Field-scoped incidents only
  If in /parking-officer → Parking violations

"Escalate this to dispatch" →
  Automatically route to admin/dispatch and create incident

"Call my officer" →
  Use current roster context to find officer
```

**Deliverables**:
- Extend `bobIntentParser.ts` with portal context
- Add portal-scoped data projections
- Build intent-to-action routing table

---

### Phase 2: Unified Crew Operations (Weeks 3–4)
**Goal**: Officers coordinate through Bob; portals are just views.

#### 2A: Shift Coordination Hub
```
"Bob, brief me on today"
  ✓ Current roster (who's working)
  ✓ My assigned zones/locations
  ✓ Priority incidents in my area
  ✓ Welfare status of crew
  ✓ Any vehicle/equipment issues
  
"Handoff to Officer Jones"
  → Bob updates shift context
  → Transfers incident state
  → Notifies Officer Jones
```

**Deliverables**:
- Shift briefing edge function (consolidated view)
- Handoff workflow with Bob mediation
- Welfare context propagation

#### 2B: Critical Event Escalation
```
Officer on patrol: "I need backup at Richmond Mall"
  ↓
Bob: "Alerting dispatch and nearby officers..."
  ↓
Bob (to Officer Smith): "Officer Green needs support at Richmond Mall"
  ↓
Officer Smith: "Acknowledged, 2 minutes out"
  ↓
Admin (dispatch): Live update to incident view
```

**Deliverables**:
- Unified incident escalation pipeline
- Cross-officer notification (via Bob voice)
- Real-time admin visibility

#### 2C: Voice-First Dispatch
```
Officer: "Bob, what's my next checkpoint?"
Bob: "Checkpoint 7, 500 meters ahead. Turn right."
  
Officer: "Any incidents nearby?"
Bob: "One minor noise complaint at 123 Main, reported 5 minutes ago."

Officer: "I'll check it out"
Bob: "Updating dispatch. ETA?"

Officer: "5 minutes"
Bob: "Dispatch notified."
```

**Deliverables**:
- Navigation guidance integration
- Contextual incident suggestions
- ETA tracking

---

### Phase 3: Fail-Closed Governance (Weeks 5–6)
**Goal**: Bob actions respect role constraints; prevent privilege escalation.

#### 3A: Bob Action Authorization
```typescript
// Before any Bob action, check:
1. Does this officer's role permit this action?
2. Is this incident visible to this org?
3. Does this cross role boundaries (escalate approval)?

// Example:
Officer asks: "Create a parking violation"
→ Check: Is officer a ParkingOfficer or Admin? ✓
→ Check: Is incident in officer's zone? ✓
→ Proceed

Officer asks: "Delete all incidents"
→ Check: Is officer admin? ✗
→ Deny: "Only admins can bulk delete"
```

**Deliverables**:
- Bob action authorization layer
- Role-based command filtering
- Audit trail for all Bob-initiated mutations

#### 3B: Governance Gates for New Portals
```
When adding a new officer specialization:
  ✓ Define role in auth (e.g., 'dog_control_officer')
  ✓ Add portal route guard
  ✓ Register Bob intents for new role
  ✓ CI gate: Verify role doesn't escalate permissions
  ✓ Test: Cross-role incident visibility
```

**Deliverables**:
- New portal checklist
- Bob intent registration template
- Automated role drift detection

---

## Implementation Priority Matrix

| Phase | Component | Priority | Effort | Impact | Start |
|-------|-----------|----------|--------|--------|-------|
| 1A | BobContextualPanel | ⭐⭐⭐⭐⭐ | 2d | 🟢 High | Week 1 |
| 1B | Portal-aware intent routing | ⭐⭐⭐⭐⭐ | 3d | 🟢 High | Week 2 |
| 2A | Shift coordination hub | ⭐⭐⭐⭐ | 4d | 🟡 Medium | Week 3 |
| 2B | Critical event escalation | ⭐⭐⭐⭐⭐ | 3d | 🟢 High | Week 3 |
| 2C | Voice-first dispatch | ⭐⭐⭐ | 5d | 🟡 Medium | Week 4 |
| 3A | Bob action authorization | ⭐⭐⭐⭐⭐ | 4d | 🟢 High | Week 5 |
| 3B | Governance gates for new portals | ⭐⭐⭐⭐ | 2d | 🟡 Medium | Week 5 |

---

## Key Architecture Changes

### 1. Bob Context Stack
```typescript
// New context provider
interface BobPortalContext {
  portalType: 'admin' | 'field_officer' | 'parking' | 'noise' | ...
  organizationId: string
  userId: string
  visibleIncidents: Incident[]
  currentLocation?: [lat: number, lng: number]
  availableActions: BobAction[]
  roleConstraints: RoleConstraint[]
}

// Broadcast to embedded Bob panels
export const BobContextProvider = ({ children, context }) => (
  <BobContext.Provider value={context}>
    {children}
  </BobContext.Provider>
)
```

### 2. Unified Intent Routing
```typescript
// Enhanced intent parser
export interface PortalAwareIntent {
  baseIntent: string // 'escalate', 'navigate', 'list_incidents'
  portalContext: BobPortalContext
  specificAction: () => Promise<any> // Portal-specific handler
  authGate: () => boolean // Role check
}

// Routed by portal type
const intentHandlers = {
  'escalate': {
    'admin': handleAdminEscalation,
    'field_officer': handleFieldEscalation,
    'parking_officer': handleParkingEscalation,
  },
  'navigate': {
    'field_officer': handleFieldNavigation,
    'parking_officer': handleParkingNavigation,
  },
  ...
}
```

### 3. Cross-Portal Event Bus
```typescript
// Bob-mediated events across portals
export const bobEventBus = {
  SHIFT_HANDOFF: 'shift:handoff',
  INCIDENT_ESCALATED: 'incident:escalated',
  OFFICER_WELFARE_ALERT: 'welfare:alert',
  CRITICAL_EVENT: 'event:critical',
}

// Any portal can subscribe
useBobEvent('incident:escalated', (incident) => {
  // Update my view
  // Notify Bob of my awareness
})
```

---

## Success Criteria

| Criteria | Metric | Target |
|----------|--------|--------|
| **Portal Context Awareness** | Bob correctly identifies active portal | 100% |
| **Voice Completion Rate** | % of voice commands executed vs. clarified | >85% |
| **Officer Satisfaction** | Time to complete task (voice vs. click) | Voice -60% |
| **Escalation Speed** | Time from "need backup" to dispatcher notified | <30s |
| **Role Compliance** | Unauthorized Bob actions caught by gate | 0 escape |
| **Cross-Portal Handoff** | Context preserved across portal switch | 100% |

---

## Blocking Issues to Resolve

1. **Multi-Portal Session State**: How do we maintain Bob context when officer switches portals?
   - Solution: Store in Redux/Zustand + broadcast via event bus

2. **Voice Overlap**: Multiple officers using voice commands in same location?
   - Solution: Wake word + device identification (already implemented, just needs portal awareness)

3. **Permission Edge Cases**: Can a parking officer ask Bob to view a biosecurity incident?
   - Solution: FieldOps Manager already enforces RLS; Bob just respects existing rules

4. **Portal Navigation Equity**: Should all portals feel equally accessible?
   - Solution: Unified portal search (already exists), Bob integration makes it primary

---

## Migration Path (No Downtime)

1. **Week 1**: Deploy embedded Bob panels (opt-in via feature flag)
2. **Week 2**: Portal-aware intent routing (feature-flagged)
3. **Week 3–4**: Crew operations (expanded feature flag cohorts)
4. **Week 5**: Full rollout + legacy portal exit paths (if needed)
5. **Week 6**: Governance gates + documentation

---

## Sample Conversation Flows

### Example 1: Field Officer Start of Shift
```
Officer (voice): "Hey Bob, brief me"

Bob: "Good morning. Today's roster shows 8 officers active.
     Your zone is Richmond Mall + Salisbury Hub.
     One outstanding noise complaint at Richmond Mall from yesterday.
     Three officers on your team today.
     Vehicle 7 has low fuel — service when convenient.
     Current temperature 22°C, clear skies."

Officer: "Navigate to Richmond Mall"

Bob: "Starting navigation. Distance: 4.2 km, ETA 8 minutes."
     [Updates map, starts voice guidance]

Officer (5 min later): "Arrived"

Bob: "Updating dispatch. Anything urgent?"

Officer: "Show me today's incidents"

Bob: [Shows in-car display]
     "Five incidents in your zone. Two need follow-up."

Officer: "Details on incident 3"

Bob: [Reads incident details, photos, notes]

Officer: "I'll go check it out"

Bob: "Updating dispatch, notifying admin. Report back when done."
```

### Example 2: Critical Escalation
```
Officer Jones (radio): "Dispatch, I've got a situation. Requires backup."

Bob (to Dispatch): "Officer Jones requesting backup at Salisbury Hub."

Dispatch Admin (in AdminPortal): [Sees real-time alert]
  "Roger that. Assigning Officer Smith to support."

Bob (to Officer Smith): "You're assigned to support Officer Jones at Salisbury Hub. ETA?"

Officer Smith: "5 minutes"

Bob (to Officer Jones): "Support incoming, Officer Smith, 5 minutes."

Bob (to Dispatch): "Both officers aware. Tracking."

[When resolved]

Officer Jones: "Situation resolved"

Bob: "Updating incident status to resolved. Dispatch confirmed."
```

### Example 3: End of Shift Handoff
```
Officer Green: "Bob, end of shift"

Bob: "Shift summary:
     - 4 incidents handled
     - 2 escalated to admin
     - Vehicle 7 returned, fuel low
     - No welfare alerts
     - Handoff?"

Officer Green: "Transfer to Officer Blue"

Bob: "Officer Blue, incoming handoff from Officer Green.
     Green handled 4 incidents today, 2 escalated.
     Taking over Richmond Mall + Salisbury Hub."

Officer Blue: "Acknowledged. Starting now."

Bob: "Welcome, Officer Blue. Zone briefing available on demand."
```

---

## Questions for Refinement

1. Should voice commands work across ALL portals or stay segregated by role?
   - **Recommendation**: Start with role-scoped (field officer can't issue parking citations via voice)
   
2. How do we handle "Bob, show me everything" without violating RLS?
   - **Recommendation**: Respect RLS, return "You don't have access to X incidents"

3. Should admins be able to give Bob commands that affect multiple officers?
   - **Recommendation**: Yes, but audit trail + approval gate for critical actions

4. Mobile-first or desktop-first for Bob integration?
   - **Recommendation**: Voice-first (works on both), then tactile interface second

---

## Next Steps

- [ ] Finalize context architecture (Redux/Zustand integration)
- [ ] Prototype BobContextualPanel component
- [ ] Define intent routing table for all portal types
- [ ] Create event bus implementation
- [ ] Begin Phase 1A implementation
- [ ] Test with field officers (user feedback loop)

---

**Estimated Timeline**: 6 weeks (full rollout)  
**Team Size**: 2 engineers + 1 QA  
**Risk Level**: 🟡 Medium (architectural change, but non-breaking)

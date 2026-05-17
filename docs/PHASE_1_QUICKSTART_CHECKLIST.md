# Phase 1: Unified Command Interface — Quick Start Checklist

**Goal**: Bob becomes the primary interface; officers interact via voice/Bob commands instead of portal navigation.

**Timeline**: 2 weeks  
**Deliverables**: Embedded Bob panels + Portal-aware intent routing  
**Feature Flag**: `BOB_UNIFIED_COMMAND_ALPHA`

---

## Week 1: Embedded Bob Context Panel

### 1.1 Portal Context Infrastructure
- [ ] Create `src/contexts/BobPortalContext.tsx`
  ```typescript
  export interface BobPortalContext {
    portalType: 'admin' | 'field_officer' | 'parking_officer' | 'noise_officer' | 'biosecurity_officer'
    organizationId: string
    userId: string
    currentLocation?: { lat: number; lng: number }
    visibleIncidents: Incident[]
    roster: Officer[]
    availableActions: string[]
  }
  
  export const BobPortalContextProvider = ({ children, context }) => (
    <BobPortalContext.Provider value={context}>
      {children}
    </BobPortalContext.Provider>
  )
  ```

- [ ] Add context provider to each portal's `AppLayout`
  - [ ] AdminPortal.tsx
  - [ ] FieldOfficerPortal.tsx
  - [ ] ParkingOfficerPortal.tsx
  - [ ] NoiseOfficerPortal.tsx
  - [ ] BiosecurityOfficerPortal.tsx

- [ ] Create `src/stores/bobContextStore.ts` (Zustand)
  - Syncs portal state to Bob
  - Subscribes to incident updates
  - Broadcasts location changes

### 1.2 Embedded Panel Component
- [ ] Create `src/components/features/BobContextualPanel.tsx`
  - Persistent sidebar or collapsible panel (not modal)
  - Voice input always visible
  - Respects `BOB_UNIFIED_COMMAND_ALPHA` flag
  - Shows active portal context badge ("You're in: Field Officer")

- [ ] Wire into AppLayout
  ```typescript
  <AppLayout>
    <MainContent>{children}</MainContent>
    {featureFlags.bobUnifiedCommandAlpha && <BobContextualPanel />}
  </AppLayout>
  ```

- [ ] Design specs
  - Sidebar: 320px width, slides in from right
  - Voice indicator: Always shows mic status
  - Context chip: "You're in: Field Officer — Richmond Mall"
  - Quick actions: [Navigate] [Escalate] [Report] [Ask Bob]

### 1.3 Voice State Propagation
- [ ] Update `useBobBrain.ts` hook
  - Add context parameter
  - Pass portal type to Bob
  - Include visible incidents in prompt

- [ ] Add to `BobAssistantStudio.tsx`
  ```typescript
  const portalContext = useBobPortalContext()
  // When speaking, include context:
  // "User is in field_officer portal, Richmond Mall zone, 3 active incidents nearby"
  ```

---

## Week 2: Portal-Aware Intent Routing

### 2.1 Enhanced Intent Parser
- [ ] Extend `src/services/bobIntentParser.ts`
  ```typescript
  export interface PortalAwareIntent {
    baseIntent: 'escalate' | 'navigate' | 'list_incidents' | 'create_report' | 'check_incident'
    portalContext: BobPortalContext
    parameters: Record<string, string>
    handler: () => Promise<CommandResult>
    authGate: () => boolean
  }
  
  export async function parsePortalAwareCommand(
    rawText: string,
    context: BobPortalContext,
    officer: string,
    orgId: string
  ): Promise<PortalAwareIntent>
  ```

- [ ] Tests
  - [ ] "Show incidents" in /admin → Admin-scoped
  - [ ] "Show incidents" in /field-officer → Field-scoped
  - [ ] "Navigate to zone" in /field-officer → OK
  - [ ] "Navigate to zone" in /admin → Deny

### 2.2 Portal-Specific Intent Handlers
- [ ] Create `src/services/bobIntentHandlers/` directory
  ```
  ├── admin-intents.ts
  │   ├── handleEscalation (admin-specific)
  │   ├── handleReportGeneration
  │   └── handleRosterUpdate
  ├── field-officer-intents.ts
  │   ├── handleNavigation
  │   ├── handleIncidentReport
  │   └── handleBackupRequest
  ├── parking-officer-intents.ts
  │   ├── handleViolationEntry
  │   └── handleAppeal
  └── shared-intents.ts
      ├── handleIncidentQuery
      └── handleOfficerStatus
  ```

- [ ] Implement for each portal
  - [ ] Admin: Escalate, bulk ops, report generation
  - [ ] Field Officer: Navigate, incident report, backup request
  - [ ] Parking Officer: Create violation, check plate, note
  - [ ] Noise Officer: Assessment creation, follow-up
  - [ ] Biosecurity Officer: Assessment, site inspection

### 2.3 Intent Routing Table
- [ ] Create `src/lib/bobIntentRoutingTable.ts`
  ```typescript
  const routingTable: Record<string, Record<string, Function>> = {
    'escalate': {
      'admin': handleAdminEscalation,
      'field_officer': handleFieldEscalation,
      'parking_officer': handleParkingEscalation,
    },
    'navigate': {
      'field_officer': handleFieldNavigation,
      'parking_officer': handleParkingNavigation,
    },
    'report': {
      'admin': handleAdminReport,
      'field_officer': handleFieldReport,
      'parking_officer': handleParkingViolation,
      'noise_officer': handleNoiseReport,
    },
    'query': {
      // All portals can query (RLS enforces visibility)
      '*': handleIncidentQuery,
    },
  }
  ```

### 2.4 Authorization Gate
- [ ] Create `src/lib/bobActionAuthorization.ts`
  ```typescript
  export function checkBobActionAuthorization(
    action: string,
    portalType: string,
    userRole: string,
    orgId: string
  ): { allowed: boolean; reason?: string }
  ```

- [ ] Checks
  - Officer can't delete incidents
  - Parking officer can't create noise assessments
  - Admin can bulk-escalate
  - Cross-org access blocked

### 2.5 Edge Function Enhancement
- [ ] Update `supabase/functions/bob-multimodal-gateway/index.ts`
  - Accept portal context in request
  - Route to correct handler
  - Enforce authorization before execution

- [ ] Add context to request
  ```typescript
  await edgeFunctions.bobGateway({
    messages: [...],
    context: {
      portalType: 'field_officer',
      currentLocation: [lat, lng],
      visibleIncidents: [...],
    }
  })
  ```

### 2.6 Testing & Validation
- [ ] Unit tests for intent parsing
  - [ ] Portal context routed correctly
  - [ ] Authorization gates enforced
  - [ ] Handler functions called for correct portal

- [ ] E2E tests
  - [ ] Officer in /field-officer says "escalate this"
  - [ ] Admin sees escalated incident in real-time
  - [ ] Officer in /parking-officer can't escalate (unauthorized)

- [ ] Voice command test cases
  - [ ] "Show me today's incidents" (varies by portal)
  - [ ] "Navigate to checkpoint 3" (field officer only)
  - [ ] "Create violation" (parking officer only)
  - [ ] "Brief me" (should work across portals)

---

## Week 2: Feature Flag & Rollout

- [ ] Add to `src/lib/featureFlags.ts`
  ```typescript
  BOB_UNIFIED_COMMAND_ALPHA: env.isDev || isInCohort('alpha_testers')
  ```

- [ ] Create docs: `docs/BOB_UNIFIED_COMMAND_SETUP.md`
  - Enable Bob panels via feature flag
  - Test portal-aware intents
  - Troubleshooting guide

- [ ] Deploy to staging
  - Test with field officer team
  - Gather feedback
  - Refine handler logic

---

## Validation Checklist

Before marking Phase 1 complete:

- [ ] All portals have embedded Bob panel
- [ ] Voice input works in all portals
- [ ] Portal context is correctly passed to Bob
- [ ] Intent routing respects portal context
- [ ] Authorization gates prevent role escalation
- [ ] Cross-portal incident queries respect RLS
- [ ] Mobile/responsive design maintained
- [ ] No performance regression
- [ ] Accessibility maintained (ARIA labels on new components)
- [ ] Feature flag toggle working

---

## File Checklist

**New Files**:
- [ ] `src/contexts/BobPortalContext.tsx`
- [ ] `src/components/features/BobContextualPanel.tsx`
- [ ] `src/stores/bobContextStore.ts`
- [ ] `src/services/bobIntentHandlers/admin-intents.ts`
- [ ] `src/services/bobIntentHandlers/field-officer-intents.ts`
- [ ] `src/services/bobIntentHandlers/parking-officer-intents.ts`
- [ ] `src/services/bobIntentHandlers/noise-officer-intents.ts`
- [ ] `src/services/bobIntentHandlers/biosecurity-officer-intents.ts`
- [ ] `src/lib/bobIntentRoutingTable.ts`
- [ ] `src/lib/bobActionAuthorization.ts`
- [ ] `supabase/functions/bob-multimodal-gateway/portal-context.ts` (helper)
- [ ] `tests/e2e/bob-unified-portal-context.ts`
- [ ] `docs/BOB_UNIFIED_COMMAND_SETUP.md`

**Modified Files**:
- [ ] `src/pages/AdminPortal.tsx` (add context provider)
- [ ] `src/pages/FieldOfficerPortal.tsx` (add context provider)
- [ ] `src/pages/ParkingOfficerPortal.tsx` (add context provider)
- [ ] `src/pages/NoiseOfficerPortal.tsx` (add context provider)
- [ ] `src/pages/BiosecurityOfficerPortal.tsx` (add context provider)
- [ ] `src/services/bobIntentParser.ts` (extend with portal context)
- [ ] `src/hooks/useBobBrain.ts` (add context parameter)
- [ ] `src/components/features/AppLayout.tsx` (embed panel)
- [ ] `supabase/functions/bob-multimodal-gateway/index.ts` (accept portal context)
- [ ] `package.json` (update test script)

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Portal context not syncing | Start with Zustand store, simple pub/sub pattern |
| Authorization gate complexity | Start with deny-by-default, whitelist intents |
| Voice command ambiguity | Enhance prompt with full portal context in system message |
| RLS bypass | Test cross-org queries; validate in edge function |
| Performance degradation | Lazy-load BobContextualPanel, cache intent routing |

---

## Success Metrics (Week 2 Exit)

- Officers can ask Bob to show incidents (filtered by role/zone)
- Officers can ask Bob to navigate (field officer only)
- Officers can ask Bob to escalate (authorized only)
- All existing portal functionality still works
- No 404s or permission errors
- Voice recognition accuracy >90% in field conditions

---

## Next Phase Trigger

Proceed to Phase 2 (Crew Operations) when:
- [ ] Phase 1 deployed to staging ✅
- [ ] Field officer user testing complete ✅
- [ ] No critical authorization bypasses found ✅
- [ ] Response time < 2 seconds for most intents ✅
- [ ] Feature flag stable across cohorts ✅

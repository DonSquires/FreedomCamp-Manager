/**
 * orgClientTemplate.ts
 *
 * Canonical template for onboarding a national security company hierarchy into
 * FieldOps Manager.  Derived from the First Security / Nelson City Council /
 * Downer-LINZ real-world data provided on 2026-05-14.
 *
 * Template pattern
 * ────────────────
 *   Level 1  National security company   (organization_type = 'security_company')
 *   Level 2  Branch                      (organization_type = 'service_provider',
 *                                          parent = Level 1)
 *   Level 3  Client org / council / crown (organization_type = 'client',
 *                                          parent = responsible branch)
 *
 * Each branch owns:
 *   - dispatch zones  (zones table, organization_id = branch)
 *   - staff / officers (user_profiles, employer_organization_id = branch)
 *
 * Each client owns:
 *   - sites / locations (client_sites, organization_id = client)
 *   - freedom camping zones, noise control areas, guarding posts, etc.
 *   - geofence polygons (zones.geometry JSONB)
 *
 * Photo reingest
 * ──────────────
 * Stored trial photos from freedom camping patrols are linked to the branch
 * org (organization_id = branch).  Running Photo Reingest scoped to that org
 * recovers ALPR / NZSCV / compliance enrichment from those photos and
 * populates observations for the correct client sites.
 *
 * Historical import
 * ─────────────────
 * Patrol / alarm / noise-control dispatch exports from First Security's
 * internal system (Wilsar / Rapid / custom CSV) should be imported via
 * /import-historical.  The bureau ID prefix identifies the branch and contract:
 *
 *   FSG-NCC          → First Security Nelson, Nelson City Council contract
 *   FSGS-NSN-AR-DB   → First Security Nelson, alarm response (direct bill)
 *   FSGS-NSN-MPP-DB  → First Security Nelson, mobile patrol (direct bill)
 *   FSGS-NSN-NCO     → First Security Nelson, noise control
 *   FSG-QT-*         → First Security Queenstown (Downer / LINZ contract)
 */

export type OrgType =
  | 'security_company'
  | 'service_provider'
  | 'client'
  | 'operator'
  | 'owner'

export interface OrgNode {
  /** Stable literal UUID matching the migration seed */
  id: string
  name: string
  organizationType: OrgType
  organizationLevel: 1 | 2 | 3
  parentId: string | null
  address?: string
  region?: string
  notes?: string
}

export interface DispatchZoneRef {
  id: string
  organizationId: string  // branch that owns the zone
  name: string
  dispatchCode: string    // e.g. '585', '584', '587'
  description?: string
}

export interface ClientSiteRef {
  organizationId: string  // client that owns the site
  zoneId: string | null   // dispatch zone for patrol routing
  name: string
  siteCode: string | null // client ID from dispatch export
  siteType:
    | 'general'
    | 'freedom_camping'
    | 'guarding'
    | 'parking'
    | 'noise_control'
    | 'event'
    | 'infrastructure'
  city?: string
  gpsLat?: number
  gpsLng?: number
  notes?: string
}

export interface OrgHierarchyContext {
  branchId: string
  branchName: string
  governingOrganization: string
  deliveryContract: string
  ownershipNotes: string[]
  operationalRule: string
}

// ─── First Security template instance ────────────────────────────────────────

export const FIRST_SECURITY_ORG_TEMPLATE = {
  // Level 1 — National
  national: {
    id: 'b8566654-4b1b-4cea-b55e-73791ec418ea',
    name: 'First Security',
    organizationType: 'security_company' as OrgType,
    organizationLevel: 1 as const,
    parentId: null,
  } satisfies OrgNode,

  // Level 2 — Branches
  branches: {
    nelson: {
      id: '11111111-0001-0001-0001-000000000002',
      name: 'First Security Nelson',
      organizationType: 'service_provider' as OrgType,
      organizationLevel: 2 as const,
      parentId: 'b8566654-4b1b-4cea-b55e-73791ec418ea',
      address: 'Nelson, Tasman, New Zealand',
      region: 'Nelson/Tasman',
    } satisfies OrgNode,

    queenstown: {
      id: '11111111-0001-0001-0001-000000000003',
      name: 'First Security Queenstown',
      organizationType: 'service_provider' as OrgType,
      organizationLevel: 2 as const,
      parentId: 'b8566654-4b1b-4cea-b55e-73791ec418ea',
      address: 'Queenstown, Otago, New Zealand',
      region: 'Queenstown-Lakes',
    } satisfies OrgNode,

    blenheim: {
      id: '2179cc99-9f08-4db5-92e5-3ed229881608',
      name: 'First Security - Blenheim',
      organizationType: 'service_provider' as OrgType,
      organizationLevel: 2 as const,
      parentId: 'b8566654-4b1b-4cea-b55e-73791ec418ea',
      address: 'Blenheim, Marlborough, New Zealand',
      region: 'Marlborough',
      notes: 'Parking enforcement delivery branch for Marlborough Roads / Marlborough District Council.',
    } satisfies OrgNode,
  },

  // Level 3 — Clients
  clients: {
    nelsonCityCouncil: {
      id: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      name: 'Nelson City Council',
      organizationType: 'client' as OrgType,
      organizationLevel: 3 as const,
      parentId: '11111111-0001-0001-0001-000000000002', // Nelson branch
      address: 'Civic House, 110 Trafalgar Street, Nelson 7010',
      region: 'Nelson',
    } satisfies OrgNode,

    downerLinz: {
      id: '57804ca8-ecc2-4b0b-91a7-3b54ad513191',
      name: 'Downer / LINZ',
      organizationType: 'client' as OrgType,
      organizationLevel: 3 as const,
      parentId: '11111111-0001-0001-0001-000000000003', // Queenstown branch
      address: 'Queenstown, Otago, New Zealand',
      region: 'Queenstown-Lakes',
    } satisfies OrgNode,

    marlboroughDistrictCouncil: {
      id: 'c1653f72-91ae-4a70-9b79-e0ceb11b8ff6',
      name: 'Marlborough District Council',
      organizationType: 'client' as OrgType,
      organizationLevel: 3 as const,
      parentId: '2179cc99-9f08-4db5-92e5-3ed229881608',
      address: '15 Seymour Street, Blenheim 7201',
      region: 'Marlborough',
      notes: 'Governing client organization for Marlborough Roads parking operations. Joint-delivery context includes NZTA ownership participation.',
    } satisfies OrgNode,
  },

  // Dispatch zones owned by Nelson branch
  nelsonZones: [
    {
      id: '22222222-0001-0001-0585-000000000001',
      organizationId: '11111111-0001-0001-0001-000000000002',
      name: 'Nelson Zone 585',
      dispatchCode: '585',
      description: 'Day-shift coverage zone (Nelson/Richmond/Motueka)',
    },
    {
      id: '22222222-0001-0001-0584-000000000001',
      organizationId: '11111111-0001-0001-0001-000000000002',
      name: 'Nelson Zone 584',
      dispatchCode: '584',
      description: 'Alternate/night coverage zone (Nelson area)',
    },
    {
      id: '22222222-0001-0001-0587-000000000001',
      organizationId: '11111111-0001-0001-0001-000000000002',
      name: 'Nelson Zone 587',
      dispatchCode: '587',
      description: 'Noise control zone (Nelson City Council)',
    },
  ] satisfies DispatchZoneRef[],

  // NCC client sites known from patrol/dispatch data
  nccSites: [
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0585-000000000001',
      name: 'The Refinery',
      siteCode: 'NCC200',
      siteType: 'general',
      city: 'Nelson',
    },
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0585-000000000001',
      name: 'EX 4 Seasons',
      siteCode: 'NCC400',
      siteType: 'general',
      city: 'Nelson',
    },
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0585-000000000001',
      name: 'Nayland College',
      siteCode: 'NA5661',
      siteType: 'general',
      city: 'Nelson',
    },
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0585-000000000001',
      name: 'Fulton Hogan Nelson',
      siteCode: null,
      siteType: 'infrastructure',
      city: 'Nelson',
    },
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0585-000000000001',
      name: 'Washington Valley Reserve',
      siteCode: null,
      siteType: 'freedom_camping',
      city: 'Nelson',
    },
    {
      organizationId: 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993',
      zoneId: '22222222-0001-0001-0587-000000000001',
      name: 'Nelson Noise Control Patrol Area',
      siteCode: 'NCCNOISE',
      siteType: 'noise_control',
      city: 'Nelson',
    },
  ] satisfies ClientSiteRef[],
} as const

export const FIRST_SECURITY_PARKING_HIERARCHY: Record<string, OrgHierarchyContext> = {
  '2179cc99-9f08-4db5-92e5-3ed229881608': {
    branchId: '2179cc99-9f08-4db5-92e5-3ed229881608',
    branchName: 'First Security - Blenheim',
    governingOrganization: 'Marlborough District Council',
    deliveryContract: 'Marlborough Roads parking enforcement delivery',
    ownershipNotes: [
      'Marlborough Roads is jointly owned by Marlborough District Council and NZTA.',
      'Marlborough District Council is the governing organization for Bob parking setup decisions.',
      'First Security - Blenheim is the delivering branch for the contract.',
    ],
    operationalRule: 'For parking setup, create client sites under Marlborough District Council, keep delivery ownership under First Security - Blenheim, and treat NZTA as a joint-ownership stakeholder rather than the governing org.',
  },
  'c1653f72-91ae-4a70-9b79-e0ceb11b8ff6': {
    branchId: '2179cc99-9f08-4db5-92e5-3ed229881608',
    branchName: 'First Security - Blenheim',
    governingOrganization: 'Marlborough District Council',
    deliveryContract: 'Marlborough Roads parking enforcement delivery',
    ownershipNotes: [
      'Marlborough Roads is jointly owned by Marlborough District Council and NZTA.',
      'Marlborough District Council is the governing organization for Bob parking setup decisions.',
      'First Security - Blenheim is the delivering branch for the contract.',
    ],
    operationalRule: 'For parking setup, create client sites under Marlborough District Council, keep delivery ownership under First Security - Blenheim, and treat NZTA as a joint-ownership stakeholder rather than the governing org.',
  },
}

export function getFirstSecurityParkingHierarchyContext(orgId: string | null | undefined): OrgHierarchyContext | null {
  if (!orgId) return null
  return FIRST_SECURITY_PARKING_HIERARCHY[orgId] ?? null
}

/**
 * Returns the bureau prefix → branch mapping so historical import parsers
 * can resolve the correct organization_id for each row.
 */
export const BUREAU_PREFIX_TO_BRANCH: Record<string, string> = {
  'FSG-NCC':        FIRST_SECURITY_ORG_TEMPLATE.branches.nelson.id,
  'FSGS-NSN-AR-DB': FIRST_SECURITY_ORG_TEMPLATE.branches.nelson.id,
  'FSGS-NSN-MPP-DB':FIRST_SECURITY_ORG_TEMPLATE.branches.nelson.id,
  'FSGS-NSN-NCO':   FIRST_SECURITY_ORG_TEMPLATE.branches.nelson.id,
  'FSG-QT':         FIRST_SECURITY_ORG_TEMPLATE.branches.queenstown.id,
}

/**
 * Returns the bureau prefix → client mapping (for sites owned by the client).
 */
export const BUREAU_PREFIX_TO_CLIENT: Record<string, string> = {
  'FSG-NCC':        FIRST_SECURITY_ORG_TEMPLATE.clients.nelsonCityCouncil.id,
  'FSGS-NSN-AR-DB': FIRST_SECURITY_ORG_TEMPLATE.clients.nelsonCityCouncil.id,
  'FSGS-NSN-MPP-DB':FIRST_SECURITY_ORG_TEMPLATE.clients.nelsonCityCouncil.id,
  'FSGS-NSN-NCO':   FIRST_SECURITY_ORG_TEMPLATE.clients.nelsonCityCouncil.id,
  'FSG-QT':         FIRST_SECURITY_ORG_TEMPLATE.clients.downerLinz.id,
}

/**
 * Returns the dispatch zone code → zone UUID mapping for import routing.
 */
export const DISPATCH_CODE_TO_ZONE_ID: Record<string, string> = Object.fromEntries(
  FIRST_SECURITY_ORG_TEMPLATE.nelsonZones.map((z) => [z.dispatchCode, z.id]),
)

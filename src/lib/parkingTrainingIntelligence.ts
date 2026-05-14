export interface ParkingTrainingFocus {
  enforcementAreas: string[]
  reservedParkingLocations: string[]
  operationalHotspots: string[]
  zoningRules: string[]
  legalReferences: string[]
  includesMapReferences: boolean
}

export interface ParkingOperationalSnapshot {
  organizationName?: string | null
  liveParkingZoneCount: number
  liveParkingZoneNames: string[]
  liveClientSiteCount: number
  liveClientSiteNames: string[]
}

const DOC_NAME_PATTERN = /(parking|warden|marlborough|blenheim)/i
const DOC_CONTENT_PATTERN = /Marlborough District Council|Parking Officer|Blenheim Enforcement area|Time Restricted Parking in CBD|loading zone|mobility permit/i

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function collectMatchingLines(lines: string[], patterns: RegExp[], limit = 8): string[] {
  return uniqueNonEmpty(
    lines.filter((line) => patterns.some((pattern) => pattern.test(line))).slice(0, limit),
  )
}

export function looksLikeParkingTrainingDocument(raw: string, fileName = ''): boolean {
  const sample = `${fileName}\n${raw}`
  return DOC_NAME_PATTERN.test(fileName) && DOC_CONTENT_PATTERN.test(sample)
    || DOC_CONTENT_PATTERN.test(sample)
}

export function buildParkingTrainingFocus(raw: string): ParkingTrainingFocus {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const enforcementAreas = collectMatchingLines(lines, [
    /Blenheim Enforcement area/i,
    /Area Street Names and Zones within the Blenheim Enforcement Area/i,
    /Alfred St\s*[\u2013-]/i,
    /Auckland St, Blenheim/i,
    /Blenheim Central Business Area/i,
    /Time Restricted Parking in CBD/i,
    /Clubs of Marlborough/i,
  ])

  const reservedParkingLocations = collectMatchingLines(lines, [
    /Kinross Street car park, Blenheim/i,
    /Seymour Street car park, Blenheim/i,
    /Wynen Street car park, Blenheim/i,
    /Alfred Street car park building, Blenheim/i,
    /Reserved car park spaces/i,
  ])

  const operationalHotspots = collectMatchingLines(lines, [
    /loading zone/i,
    /mobility parking/i,
    /mobility permit/i,
    /kerbside meters/i,
    /pay the required Parking fee/i,
    /meter/i,
    /reserved parking/i,
    /Time Restrictions are introduced/i,
  ], 10)

  const zoningRules = collectMatchingLines(lines, [
    /Zone parking restrictions only require signage/i,
    /not more than 200 metres/i,
    /General Requirements for Signing Parking Zones/i,
    /Where the zone starts with the words/i,
    /Within the zone: At intervals sufficient/i,
    /Vehicles are allowed to legally park for the restriction time displayed on the sign/i,
    /A clear photo showing complete vehicle parked within the restriction/i,
  ], 10)

  const legalReferences = collectMatchingLines(lines, [
    /Land Transport Act 1998/i,
    /Land Transport \(Road User\) Rule 2004/i,
    /Land Transport \(Motor Vehicle Registration/i,
    /Land Transport \(Offences/i,
    /Marlborough District Council By-Law/i,
    /128E Powers of parking wardens/i,
  ], 10)

  const includesMapReferences = /\bmap\b/i.test(raw) || /Blenheim Enforcement area/i.test(raw) || /Picton Map/i.test(raw)

  return {
    enforcementAreas,
    reservedParkingLocations,
    operationalHotspots,
    zoningRules,
    legalReferences,
    includesMapReferences,
  }
}

export function formatParkingTrainingFocusSummary(
  focus: ParkingTrainingFocus,
  snapshot?: ParkingOperationalSnapshot | null,
): string {
  const lines: string[] = ['Parking training intake is ready for Blenheim/Marlborough parking operations.']

  if (snapshot) {
    lines.push(`Selected organization: ${snapshot.organizationName || 'Unknown organization'}.`)
    lines.push(`Active parking zones in the live build: ${snapshot.liveParkingZoneCount}.`)
    if (snapshot.liveParkingZoneCount > 0) {
      lines.push(`Live parking zones: ${snapshot.liveParkingZoneNames.join(', ')}.`)
    } else {
      lines.push('No active parking_zones are configured yet, so the manual is the interim zoning source for Bob until realignment seeds dedicated parking zones.')
    }
    lines.push(`Active client sites in the live build: ${snapshot.liveClientSiteCount}.`)
    if (snapshot.liveClientSiteCount > 0) {
      lines.push(`Client site context: ${snapshot.liveClientSiteNames.join(', ')}.`)
    }
  }

  if (focus.includesMapReferences) {
    lines.push('The source document includes map or enforcement-area references that should be treated as zoning guidance.')
  }

  if (focus.enforcementAreas.length > 0) {
    lines.push(`Blenheim enforcement focus areas: ${focus.enforcementAreas.join('; ')}.`)
  }

  if (focus.reservedParkingLocations.length > 0) {
    lines.push(`Reserved parking locations: ${focus.reservedParkingLocations.join('; ')}.`)
  }

  if (focus.operationalHotspots.length > 0) {
    lines.push(`Operational hotspots: ${focus.operationalHotspots.join('; ')}.`)
  }

  if (focus.zoningRules.length > 0) {
    lines.push(`Zoning rules to preserve: ${focus.zoningRules.join('; ')}.`)
  }

  if (focus.legalReferences.length > 0) {
    lines.push(`Legal references detected: ${focus.legalReferences.join('; ')}.`)
  }

  lines.push('When the user provides setup instructions, Bob should draft client sites, linked zones, and geofence blockers from this material rather than treating parking as a generic chat-only topic.')
  return lines.join('\n')
}
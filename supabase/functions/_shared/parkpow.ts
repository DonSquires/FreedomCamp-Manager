/**
 * ParkPow API Client
 *
 * ParkPow (https://parkpow.com) is the parent company of Plate Recognizer and
 * provides full parking-management / enforcement-workflow infrastructure:
 *
 *   • Watchlists     — flag plates as banned, stolen, VIP, enforcement targets
 *   • Permits        — manage per-lot vehicle exemptions (authorised vehicles)
 *   • Sessions       — record vehicle entry/exit per lot with timestamps
 *   • Violations     — formal violation records pushed to enforcement workflows
 *   • Webhooks       — real-time push events when cameras detect plates
 *
 * Secret name in Supabase: PARKPOW_API_TOKEN  (already configured ✅)
 * Base URL:                https://app.parkpow.com/api/v1/
 *
 * Integration flow for FreedomCamp:
 *   1. Plate Recognizer reads plate from image        (PLATERECOGNIZER_TOKEN)
 *   2. ParkPow watchlist check → is this plate flagged?  (PARKPOW_API_TOKEN)
 *   3. ParkPow permit check  → is this vehicle exempt?
 *   4. Create ParkPow session (vehicle entered zone)
 *   5. On breach → push violation to ParkPow for enforcement workflow
 */

const PARKPOW_BASE_URL = "https://app.parkpow.com/api/v1";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParkPowLot {
  id: number;
  name: string;
  external_id?: string; // our zone UUID stored here
  camera_ids?: string[];
}

export interface ParkPowVehicle {
  id: number;
  license_plate: string;
  list: "allow" | "block" | "unknown";
  description?: string;
  custom_fields?: Record<string, string>;
}

export interface ParkPowSession {
  id: number;
  license_plate: string;
  lot: number;
  entry_time: string;      // ISO 8601
  exit_time?: string;      // ISO 8601 — null if still inside
  duration_seconds?: number;
  is_violation?: boolean;
}

export interface ParkPowViolation {
  id: number;
  session: number;
  license_plate: string;
  lot: number;
  reason: string;
  created_at: string;
  status: "open" | "disputed" | "resolved";
}

export interface ParkPowWatchlistResult {
  is_flagged: boolean;           // on the "block" list
  is_permitted: boolean;         // on the "allow" list
  vehicle?: ParkPowVehicle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
// ─────────────────────────────────────────────────────────────────────────────

function getToken(): string | null {
  return Deno.env.get("PARKPOW_API_TOKEN") ?? null;
}

function headers(): HeadersInit {
  const token = getToken();
  if (!token) throw new Error("PARKPOW_API_TOKEN not configured in Supabase secrets");
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
}

async function parkpowFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${PARKPOW_BASE_URL}${path}`;
  const resp = await fetch(url, { ...options, headers: headers() });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ParkPow API error ${resp.status} on ${path}: ${body}`);
  }

  // 204 No Content
  if (resp.status === 204) return undefined as T;

  return resp.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lots (Zones)
// ─────────────────────────────────────────────────────────────────────────────

/** List all lots in ParkPow account. */
export async function listLots(): Promise<ParkPowLot[]> {
  const data = await parkpowFetch<{ results: ParkPowLot[] }>("/lots/");
  return data.results ?? [];
}

/** Create a lot in ParkPow (called when a new zone is created in FreedomCamp). */
export async function createLot(params: {
  name: string;
  external_id: string; // zone UUID from FreedomCamp
}): Promise<ParkPowLot> {
  return parkpowFetch<ParkPowLot>("/lots/", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist / Vehicle Lists
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check a plate against ParkPow watchlists.
 *
 * Returns:
 *   is_flagged:   true  → plate is on the "block" list (enforcement target)
 *   is_permitted: true  → plate is on the "allow" list (exempt / authorised)
 */
export async function checkWatchlist(
  plate: string,
): Promise<ParkPowWatchlistResult> {
  try {
    const data = await parkpowFetch<{ results: ParkPowVehicle[] }>(
      `/vehicles/?license_plate=${encodeURIComponent(plate.toUpperCase())}`,
    );

    const vehicle = (data.results ?? [])[0];
    if (!vehicle) {
      return { is_flagged: false, is_permitted: false };
    }

    return {
      is_flagged: vehicle.list === "block",
      is_permitted: vehicle.list === "allow",
      vehicle,
    };
  } catch (err) {
    // Watchlist check is non-fatal — log and continue
    console.warn("⚠️  ParkPow watchlist check failed (non-fatal):", err);
    return { is_flagged: false, is_permitted: false };
  }
}

/**
 * Add a plate to the ParkPow block list (flagged / enforcement target).
 * Called when an officer manually flags a vehicle.
 */
export async function blockVehicle(
  plate: string,
  description?: string,
): Promise<ParkPowVehicle> {
  return parkpowFetch<ParkPowVehicle>("/vehicles/", {
    method: "POST",
    body: JSON.stringify({
      license_plate: plate.toUpperCase(),
      list: "block",
      description: description ?? "Flagged via FreedomCamp Manager",
    }),
  });
}

/**
 * Add a plate to the ParkPow allow list (permitted / exempt vehicle).
 * Called when a vehicle is granted a compliance exemption.
 */
export async function permitVehicle(
  plate: string,
  description?: string,
): Promise<ParkPowVehicle> {
  return parkpowFetch<ParkPowVehicle>("/vehicles/", {
    method: "POST",
    body: JSON.stringify({
      license_plate: plate.toUpperCase(),
      list: "allow",
      description: description ?? "Exempt via FreedomCamp Manager",
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions (Vehicle Entry / Exit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start a ParkPow session (vehicle observed entering / present in a zone).
 * Returns the ParkPow session ID to store in observations.parkpow_session_id.
 */
export async function createSession(params: {
  lot_id: number;
  plate: string;
  entry_time: string; // ISO 8601
  camera_id?: string;
}): Promise<ParkPowSession> {
  return parkpowFetch<ParkPowSession>("/sessions/", {
    method: "POST",
    body: JSON.stringify({
      lot: params.lot_id,
      license_plate: params.plate.toUpperCase(),
      entry_time: params.entry_time,
      camera_id: params.camera_id,
    }),
  });
}

/** Close a ParkPow session (vehicle no longer observed). */
export async function closeSession(
  sessionId: number,
  exitTime: string,
): Promise<ParkPowSession> {
  return parkpowFetch<ParkPowSession>(`/sessions/${sessionId}/`, {
    method: "PATCH",
    body: JSON.stringify({ exit_time: exitTime }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Violations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push a compliance breach to ParkPow as a formal violation.
 *
 * This triggers ParkPow's enforcement workflow:
 *   - Generates a violation record in the ParkPow dashboard
 *   - Can trigger email/SMS alerts to enforcement officers
 *   - Feeds into ParkPow's reporting and escalation pipelines
 *
 * Returns the ParkPow violation ID to store in observations.parkpow_violation_id.
 */
export async function createViolation(params: {
  session_id: number;
  reason: string;  // e.g. "Compliance breach: no valid permit", "Overstay > 72h"
}): Promise<ParkPowViolation> {
  return parkpowFetch<ParkPowViolation>("/violations/", {
    method: "POST",
    body: JSON.stringify({
      session: params.session_id,
      reason: params.reason,
    }),
  });
}

export function isParkPowEnabled(): boolean {
  return Boolean(getToken());
}

/**
 * Shared helpers for observation insert operations.
 * 
 * Handles common edge cases:
 * - COALESCE type mismatch errors from triggers
 * - Schema cache misses for optional columns
 * - Adaptive retry logic
 * - Last-resort RPC bypass when triggers are broken
 */

/**
 * Detects COALESCE type mismatch errors from database triggers.
 * These occur when the trigger function expects INTEGER but the column is TEXT.
 * Error pattern: "COALESCE types integer and text cannot be matched"
 */
export function isCoalesceTypeMismatchError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : (error as any)?.message || (error as any)?.error || "";
  return /coalesce types .* integer and text cannot be matched/i.test(String(message));
}

/**
 * Detects legacy table-reference failures where stale trigger/function bodies
 * still reference vehicle_observations_v2 after the table rename.
 */
export function isLegacyVehicleObservationsRelationError(error: unknown): boolean {
  const parts = [
    typeof error === "string" ? error : "",
    (error as any)?.message,
    (error as any)?.details,
    (error as any)?.hint,
    (error as any)?.error,
    (error as any)?.code,
  ].filter(Boolean);

  const msg = String(parts.join(" ")).toLowerCase();
  const referencesLegacyTable = msg.includes("vehicle_observations_v2");
  const looksLikeMissingRelation =
    msg.includes("relation") ||
    msg.includes("does not exist") ||
    msg.includes("does not exitst") ||
    msg.includes("undefined_table") ||
    msg.includes("42p01");

  return referencesLegacyTable && looksLikeMissingRelation;
}

/**
 * Detects missing schema column errors.
 * Error pattern: "Could not find the 'column_name' column of 'table_name' in the schema cache"
 */
export function extractMissingSchemaColumn(error: unknown): string | null {
  const message =
    typeof error === "string"
      ? error
      : (error as any)?.message || (error as any)?.error || "";
  const match = String(message).match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : null;
}

/**
 * Columns that may cause COALESCE type mismatch errors in triggers when
 * the column types have drifted. These are safe to omit from the payload
 * (the trigger function will use defaults).
 *
 * NOTE: Removing these columns from the INSERT payload does NOT fix the
 * error if the trigger function itself uses COALESCE(NEW.column, literal)
 * on a drifted column type — the trigger still accesses NEW.column via the
 * column DEFAULT, which has the same type mismatch.  When this happens,
 * the safe_insert_observation RPC (which bypasses triggers) is the only
 * recovery path.
 */
export const COMPLIANCE_DRIFT_COLUMNS = new Set([
  "nights_stayed_this_month",
  "consecutive_nights",
  "is_compliant",
  "self_contained",
  "breach_type",
  "breach_reason",
]);

/**
 * Columns that MAY be absent on older/partial DB instances and should be
 * stripped from INSERT/UPDATE payloads when a schema-cache miss is detected.
 *
 * Schema Extract #8 (2026-03-15) confirmed the following are NOW PRESENT in
 * the live observations table:
 *   processing_status, processing_started_at, processing_completed_at,
 *   processing_error, plate_confidence, vehicle_make_confidence,
 *   vehicle_model_confidence, vehicle_color_confidence,
 *   sticker_presence, sticker_color, sticker_bbox,
 *   sticker_detection_confidence, sticker_color_confidence,
 *   movement_moved, movement_background_similarity,
 *   movement_vehicle_bbox_iou, movement_decision, previous_observation_id
 *   (all added by migrations 20260312000010 and 20260401000001)
 *
 * They remain listed here as a safety net: if the adaptive insert ever gets a
 * schema-cache miss for one of these names (e.g. on a staging DB that hasn't
 * received the migration yet), the column is stripped and the insert retries.
 * Listing a column here does NOT prevent it from being written on a DB where
 * the column exists — it only strips it on a schema-cache-miss error.
 *
 * DO NOT add columns that must always be written.
 */
export const OPTIONAL_SCHEMA_COLUMNS = new Set([
  // weather_conditions: migration 20260220000004 added this column but it is
  // NOT present in the live DB (Schema Extract #20 confirmed absent).
  // Listed here as a safety net: if a payload includes it, a schema-cache-miss
  // error will be handled by stripping the column and retrying.
  "weather_conditions",
  // AI processing pipeline — added by 20260312000010 & 20260401000001
  "processing_status",
  "processing_started_at",
  "processing_completed_at",
  "processing_error",
  "plate_confidence",
  "vehicle_make_confidence",
  "vehicle_model_confidence",
  "vehicle_color_confidence",
  // Sticker detection — added by 20260312000010
  "sticker_presence",
  "sticker_color",
  "sticker_bbox",
  "sticker_detection_confidence",
  "sticker_color_confidence",
  // Movement comparison — added by 20260312000010
  "movement_moved",
  "movement_background_similarity",
  "movement_vehicle_bbox_iou",
  "movement_decision",
  "previous_observation_id",
  // Embedding columns — present in live DB
  "vehicle_embedding",
  "embedding_quality",
  "embedding_model_version",
  "embedding_created_at",
]);

/**
 * Performs an adaptive insert into the observations table.
 * Handles COALESCE type mismatch errors and schema cache misses.
 *
 * Recovery chain:
 *   1. Strip missing-schema columns and retry
 *   2. Strip compliance-drift columns and retry
 *   3. Call safe_insert_observation RPC (bypasses triggers entirely)
 * 
 * @param supabase - Supabase client (must support .from() and .rpc())
 * @param data - Observation data to insert
 * @returns Object with data, error, and droppedColumns
 */
export async function adaptiveObservationInsert(
  supabase: { from: (table: string) => any; rpc?: (fn: string, params: any) => any },
  data: Record<string, unknown>,
  maxAttempts = 8,
): Promise<{
  data: unknown;
  error: unknown;
  droppedColumns: string[];
}> {
  const payload = { ...data };
  const droppedColumns: string[] = [];
  let coalesceRetried = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: result, error } = await supabase
      .from("observations")
      .insert(payload)
      .select("*")
      .single();

    if (!error) {
      if (droppedColumns.length > 0) {
        console.log("📝 Adaptive observation insert dropped columns:", droppedColumns);
      }
      return { data: result, error: null, droppedColumns };
    }

    lastError = error;

    // Handle missing schema column errors.
    // Drop ANY unrecognised column (not just those pre-listed in
    // OPTIONAL_SCHEMA_COLUMNS) so that insert attempts never stall on an
    // unknown-column schema-cache miss.
    const missingCol = extractMissingSchemaColumn(error);
    if (missingCol && (missingCol in payload)) {
      console.warn(`⚠️ Schema cache missing column '${missingCol}' — dropping from INSERT and retrying`);
      delete payload[missingCol];
      droppedColumns.push(missingCol);
      continue;
    }

    // Handle COALESCE type mismatch errors - drop compliance columns and retry
    if (!coalesceRetried && isCoalesceTypeMismatchError(error)) {
      console.warn("⚠️ COALESCE type mismatch detected — dropping compliance columns and retrying");
      for (const col of COMPLIANCE_DRIFT_COLUMNS) {
        if (col in payload) {
          delete payload[col];
          droppedColumns.push(col);
        }
      }
      coalesceRetried = true;
      continue;
    }

    // Can't recover via payload changes — break and fall through to RPC
    console.error("❌ Observation insert failed (non-retryable):", {
      error: (error as any)?.message,
      code: (error as any)?.code,
      attempt: attempt + 1,
      droppedColumns,
    });
    break;
  }

  // ── Last-resort: safe_insert_observation RPC (bypasses triggers) ──
  // Attempt the RPC for ANY unrecoverable error, not just specific known
  // types. The RPC runs inline (no triggers) so it sidesteps schema-cache
  // drift, trigger COALESCE errors, and legacy-table reference failures.
  if (supabase.rpc) {
    if (isLegacyVehicleObservationsRelationError(lastError)) {
      console.warn("⚠️ Legacy vehicle_observations_v2 reference — trying safe_insert_observation RPC");
    } else if (isCoalesceTypeMismatchError(lastError)) {
      console.warn("⚠️ COALESCE trigger error persists — trying safe_insert_observation RPC");
    } else {
      console.warn("⚠️ Insert failed after retries — falling back to safe_insert_observation RPC", {
        error: (lastError as any)?.message,
        code: (lastError as any)?.code,
      });
    }

    try {
      const rpcPayload: Record<string, unknown> = {
        plate_number: data.plate_number ?? "PROCESSING...",
        photo: data.photo ?? data.photo_url,     // col 9
        photo_url: data.photo_url ?? data.photo, // col 50
        photo_hash: data.photo_hash ?? null,
        recorded_at: data.recorded_at,
        zone_id: data.zone_id,
        organization_id: data.organization_id,
        gps_latitude: data.gps_latitude,
        gps_longitude: data.gps_longitude,
        gps_accuracy: data.gps_accuracy ?? null,
        recorded_by: data.recorded_by,
        idempotency_key: data.idempotency_key ?? null,
      };

      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "safe_insert_observation",
        { p_data: rpcPayload }
      );

      if (!rpcError && rpcResult) {
        console.log("✅ Observation created via safe_insert_observation RPC");
        return { data: rpcResult, error: null, droppedColumns };
      }
      console.error("❌ safe_insert_observation RPC failed:", (rpcError as any)?.message ?? rpcError);
    } catch (rpcErr: any) {
      console.error("❌ safe_insert_observation RPC exception:", rpcErr?.message);
    }
  }

  return { data: null, error: lastError, droppedColumns };
}

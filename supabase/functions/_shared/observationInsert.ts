/**
 * Shared helpers for observation insert operations.
 * 
 * Handles common edge cases:
 * - COALESCE type mismatch errors from triggers
 * - Schema cache misses for optional columns
 * - Adaptive retry logic
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
 * Optional columns that may not be in the schema cache yet.
 * Safe to drop and retry the insert.
 */
export const OPTIONAL_SCHEMA_COLUMNS = new Set([
  "weather_conditions",
  "processing_status",
  "processing_started_at",
  "processing_completed_at",
  "processing_error",
  "plate_confidence",
  "vehicle_make_confidence",
  "vehicle_model_confidence",
  "vehicle_color_confidence",
  "sticker_presence",
  "sticker_color",
  "sticker_bbox",
  "sticker_detection_confidence",
  "sticker_color_confidence",
  "movement_moved",
  "movement_background_similarity",
  "movement_vehicle_bbox_iou",
  "movement_decision",
  "incident_id",
  "previous_observation_id",
  "vehicle_embedding",
  "embedding_quality",
  "embedding_model_version",
  "embedding_created_at",
]);

/**
 * Performs an adaptive insert into the observations table.
 * Handles COALESCE type mismatch errors and schema cache misses.
 * 
 * @param supabase - Supabase client
 * @param data - Observation data to insert
 * @returns Object with data, error, and droppedColumns
 */
export async function adaptiveObservationInsert(
  supabase: { from: (table: string) => any },
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

    // Handle missing schema column errors - drop column and retry
    const missingCol = extractMissingSchemaColumn(error);
    if (missingCol && OPTIONAL_SCHEMA_COLUMNS.has(missingCol) && (missingCol in payload)) {
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

    // Can't recover - return error
    console.error("❌ Observation insert failed after retries:", {
      error: (error as any)?.message,
      attempt: attempt + 1,
      droppedColumns,
    });
    return { data: null, error, droppedColumns };
  }

  return { data: null, error: new Error("Max retry attempts exceeded"), droppedColumns };
}

#!/usr/bin/env sh
set -eu

# Match ParkPow session photos to existing observations by plate + timestamp.
# Default mode is dry-run; set APPLY=true to update observations.photo_url when empty.
#
# Optional env loading:
#   If env vars are not already exported, this script will auto-load from
#   the first existing file in this order:
#     1) .env.parkpow
#     2) .env.local
#     3) .env
#
# Required env vars:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   PARKPOW_API_TOKEN
#
# Optional env vars:
#   DATE_FROM=YYYY-MM-DD           (default: today-7d UTC)
#   DATE_TO=YYYY-MM-DD             (default: today UTC)
#   WINDOW_MINUTES=60              (+/- matching window around recorded_at)
#   LIMIT=500                      (max observations to scan)
#   APPLY=false                    (set true to write photo_url when null)
#   REQUIRE_EMPTY_PHOTO=true       (when true, only scan observations where photo_url is null)
#   TARGET_BUCKET=scans            (bucket to store imported photos)
#   PARKPOW_BASE_URL               (default https://api.parkpow.com/api/v1)

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
PARKPOW_API_TOKEN="${PARKPOW_API_TOKEN:-}"

DATE_FROM="${DATE_FROM:-}"
DATE_TO="${DATE_TO:-}"
WINDOW_MINUTES="${WINDOW_MINUTES:-60}"
LIMIT="${LIMIT:-500}"
APPLY="${APPLY:-false}"
REQUIRE_EMPTY_PHOTO="${REQUIRE_EMPTY_PHOTO:-true}"
TARGET_BUCKET="${TARGET_BUCKET:-scans}"
PARKPOW_BASE_URL="${PARKPOW_BASE_URL:-https://api.parkpow.com/api/v1}"
OBS_KEY_COL=""
PHOTO_COL=""
HAS_PARKPOW_SESSION_COL="false"

# Auto-load env vars from common local env files if credentials are not already set.
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$PARKPOW_API_TOKEN" ]; then
  for env_file in .env.parkpow .env.local .env; do
    if [ -f "$env_file" ]; then
      echo "Loading env vars from $env_file"
      # shellcheck disable=SC1090
      set -a
      . "$env_file"
      set +a
      SUPABASE_URL="${SUPABASE_URL:-}"
      SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
      PARKPOW_API_TOKEN="${PARKPOW_API_TOKEN:-}"
      break
    fi
  done
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$PARKPOW_API_TOKEN" ]; then
  echo "Missing required env vars."
  echo "Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PARKPOW_API_TOKEN"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script."
  exit 1
fi

if [ -z "$DATE_FROM" ]; then
  DATE_FROM="$(date -u -d '7 days ago' +%F 2>/dev/null || date -u +%F)"
fi
if [ -z "$DATE_TO" ]; then
  DATE_TO="$(date -u +%F)"
fi

echo "Starting ParkPow photo match..."
echo "date_from=$DATE_FROM date_to=$DATE_TO window_minutes=$WINDOW_MINUTES limit=$LIMIT apply=$APPLY require_empty_photo=$REQUIRE_EMPTY_PHOTO target_bucket=$TARGET_BUCKET parkpow_base_url=$PARKPOW_BASE_URL"

OBS_ENDPOINT="$SUPABASE_URL/rest/v1/observations"
REST_HEADERS="-H apikey:$SUPABASE_SERVICE_ROLE_KEY -H Authorization:Bearer\ $SUPABASE_SERVICE_ROLE_KEY"

detect_obs_key_col() {
  status_id="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$OBS_ENDPOINT?select=id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_id" = "200" ]; then
    OBS_KEY_COL="id"
    return 0
  fi

  status_obs_id="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$OBS_ENDPOINT?select=observation_id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_obs_id" = "200" ]; then
    OBS_KEY_COL="observation_id"
    return 0
  fi

  echo "Could not detect observation key column (tried id and observation_id)." >&2
  return 1
}

detect_photo_col() {
  status_photo_url="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$OBS_ENDPOINT?select=photo_url&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_photo_url" = "200" ]; then
    PHOTO_COL="photo_url"
    return 0
  fi

  status_photo="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$OBS_ENDPOINT?select=photo&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_photo" = "200" ]; then
    PHOTO_COL="photo"
    return 0
  fi

  echo "Could not detect photo column (tried photo_url and photo)." >&2
  return 1
}

detect_optional_parkpow_col() {
  status_session="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$OBS_ENDPOINT?select=parkpow_session_id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_session" = "200" ]; then
    HAS_PARKPOW_SESSION_COL="true"
  else
    HAS_PARKPOW_SESSION_COL="false"
  fi
}

detect_obs_key_col
detect_photo_col
detect_optional_parkpow_col
echo "Detected observations key column: $OBS_KEY_COL"
echo "Detected observations photo column: $PHOTO_COL"
echo "Detected parkpow_session_id column: $HAS_PARKPOW_SESSION_COL"

# Build observation query.
obs_query="select=${OBS_KEY_COL},plate_number,recorded_at,${PHOTO_COL},recorded_by&order=recorded_at.asc&limit=${LIMIT}"
obs_query="$obs_query&recorded_at=gte.${DATE_FROM}T00:00:00Z&recorded_at=lte.${DATE_TO}T23:59:59Z"
obs_query="$obs_query&plate_number=not.is.null"

if [ "$REQUIRE_EMPTY_PHOTO" = "true" ]; then
  obs_query="$obs_query&${PHOTO_COL}=is.null"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

obs_file="$tmp_dir/observations.json"
curl -sS "$OBS_ENDPOINT?$obs_query" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" > "$obs_file"

obs_count="$(jq 'length' "$obs_file")"
echo "Observations loaded: $obs_count"

if [ "$obs_count" -eq 0 ]; then
  echo "No observations found in scope."
  exit 0
fi

matches_file="$tmp_dir/matches.ndjson"
: > "$matches_file"

# Extract a photo URL from a ParkPow session object using common key patterns.
extract_photo_url() {
  jq -r '
    .image_url // .snapshot_url // .plate_image_url // .vehicle_image_url //
    .camera_image_url // .photo_url //
    (.images[0].url // .images[0].image_url // .images[0].snapshot_url // empty) //
    (.captures[0].image_url // .captures[0].url // empty) //
    (.metadata.image_url // .metadata.snapshot_url // empty) //
    empty
  ' 2>/dev/null
}

i=0
while [ "$i" -lt "$obs_count" ]; do
  obs="$(jq -c ".[$i]" "$obs_file")"
  i=$((i + 1))

  obs_id="$(printf '%s' "$obs" | jq -r --arg key "$OBS_KEY_COL" '.[$key]')"
  plate="$(printf '%s' "$obs" | jq -r '.plate_number')"
  recorded_at="$(printf '%s' "$obs" | jq -r '.recorded_at')"
  current_photo="$(printf '%s' "$obs" | jq -r --arg p "$PHOTO_COL" '.[$p] // ""')"
  recorded_by="$(printf '%s' "$obs" | jq -r '.recorded_by // "parkpow-import"')"

  # If photo already exists and REQUIRE_EMPTY_PHOTO=false, skip updating but still allow diagnostics.
  if [ "$REQUIRE_EMPTY_PHOTO" != "true" ] && [ -n "$current_photo" ] && [ "$APPLY" = "true" ]; then
    continue
  fi

  # Query ParkPow sessions for the plate. We use a broad request then choose best by time delta.
  sessions_resp="$(curl -sS "${PARKPOW_BASE_URL}/sessions/?license_plate=$(printf '%s' "$plate" | tr '[:lower:]' '[:upper:]')&limit=100" \
    -H "Authorization: Token $PARKPOW_API_TOKEN" \
    -H "Content-Type: application/json")"

  # Handle non-standard errors from ParkPow.
  has_results="$(printf '%s' "$sessions_resp" | jq 'has("results")' 2>/dev/null || echo false)"
  if [ "$has_results" != "true" ]; then
    continue
  fi

  # Pick session with smallest absolute difference to recorded_at.
  best="$(printf '%s' "$sessions_resp" | jq -c --arg t "$recorded_at" '
    (.results // [])
    | map(
        . as $s
        | ($s.entry_time // $s.created_at // $s.time // null) as $ts
        | select($ts != null)
        | . + {
            _epoch: ($ts | fromdateiso8601),
            _delta: (((($ts | fromdateiso8601) - ($t | fromdateiso8601)) | if . < 0 then -. else . end))
          }
      )
    | sort_by(._delta)
    | .[0] // empty
  ' 2>/dev/null || true)"

  if [ -z "$best" ]; then
    continue
  fi

  best_delta="$(printf '%s' "$best" | jq -r '._delta // 999999')"
  # Enforce time window threshold.
  max_delta="$((WINDOW_MINUTES * 60))"
  if [ "$best_delta" -gt "$max_delta" ]; then
    continue
  fi

  photo_url="$(printf '%s' "$best" | extract_photo_url || true)"
  if [ -z "$photo_url" ] || [ "$photo_url" = "null" ]; then
    continue
  fi

  session_id="$(printf '%s' "$best" | jq -r '.id // empty')"

  printf '%s\n' "$(jq -cn \
    --arg id "$obs_id" \
    --arg plate "$plate" \
    --arg recorded_at "$recorded_at" \
    --arg recorded_by "$recorded_by" \
    --arg photo_url "$photo_url" \
    --arg session_id "$session_id" \
    --argjson delta "$best_delta" \
    '{id:$id, plate_number:$plate, recorded_at:$recorded_at, recorded_by:$recorded_by, matched_photo_url:$photo_url, matched_session_id:$session_id, delta_seconds:$delta}')" >> "$matches_file"
done

match_count="$(wc -l < "$matches_file" | tr -d ' ')"
echo "Matches found: $match_count"

if [ "$match_count" -eq 0 ]; then
  echo "No ParkPow photo matches found in scope."
  exit 0
fi

echo "Sample matches (first 10):"
jq -s '.[0:10]' "$matches_file"

if [ "$APPLY" != "true" ]; then
  echo "Dry run complete. Set APPLY=true to write matched photo_url to observations where currently null."
  exit 0
fi

applied=0
failed=0
while IFS= read -r m; do
  obs_id="$(printf '%s' "$m" | jq -r '.id')"
  photo_url_external="$(printf '%s' "$m" | jq -r '.matched_photo_url')"
  session_id="$(printf '%s' "$m" | jq -r '.matched_session_id')"
  recorded_by="$(printf '%s' "$m" | jq -r '.recorded_by // "parkpow-import"')"

  # Download ParkPow image and store in scans bucket to align with normal scan flow.
  ts_epoch="$(date -u +%s)"
  rand_suffix="$(dd if=/dev/urandom bs=4 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  object_path="${recorded_by}/${ts_epoch}-${rand_suffix}.jpg"
  tmp_img="$tmp_dir/img-$obs_id.jpg"

  dl_status="$(curl -sS -L -o "$tmp_img" -w "%{http_code}" \
    -H "Authorization: Token $PARKPOW_API_TOKEN" \
    "$photo_url_external")"

  if [ "$dl_status" -lt 200 ] || [ "$dl_status" -ge 300 ] || [ ! -s "$tmp_img" ]; then
    failed=$((failed + 1))
    echo "Failed to download ParkPow image for observation $obs_id (HTTP $dl_status)" >&2
    continue
  fi

  upload_status="$(curl -sS -o "$tmp_dir/upload-$obs_id.json" -w "%{http_code}" \
    -X POST "$SUPABASE_URL/storage/v1/object/$TARGET_BUCKET/$object_path" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "x-upsert: false" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$tmp_img")"

  if [ "$upload_status" -lt 200 ] || [ "$upload_status" -ge 300 ]; then
    failed=$((failed + 1))
    echo "Failed to upload image to bucket for observation $obs_id (HTTP $upload_status)" >&2
    continue
  fi

  photo_url="${SUPABASE_URL}/storage/v1/object/public/${TARGET_BUCKET}/${object_path}"

  if [ "$HAS_PARKPOW_SESSION_COL" = "true" ]; then
    payload="$(jq -cn --arg p "$photo_url" --arg sid "$session_id" --arg photo_col "$PHOTO_COL" '
      {
        ($photo_col): $p,
        parkpow_session_id: (if $sid == "" then null else ($sid|tonumber) end)
      }')"
  else
    payload="$(jq -cn --arg p "$photo_url" --arg photo_col "$PHOTO_COL" '
      {
        ($photo_col): $p
      }')"
  fi

  status="$(curl -sS -o "$tmp_dir/update-$obs_id.json" -w "%{http_code}" \
    -X PATCH "$SUPABASE_URL/rest/v1/observations?${OBS_KEY_COL}=eq.$obs_id&${PHOTO_COL}=is.null" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$payload")"

  if [ "$status" = "204" ]; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
  fi
done < "$matches_file"

echo "Apply summary: applied=$applied failed=$failed"
if [ "$failed" -gt 0 ]; then
  exit 1
fi

echo "ParkPow photo backfill complete."

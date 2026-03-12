#!/usr/bin/env sh
set -eu

# Reconcile observations zone/org/user UUIDs in projects where
# public.reassign_observations_to_current_zones does not exist.
#
# Required env vars:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#
# Optional env vars:
#   APPLY=true|false  (default false)
#   BATCH_SIZE=1000

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
APPLY="${APPLY:-false}"
BATCH_SIZE="${BATCH_SIZE:-1000}"
OBS_TABLE=""
OBS_ID_COL=""

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" >&2
  exit 1
fi

detect_table() {
  status_observations="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$SUPABASE_URL/rest/v1/observations?select=observation_id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_observations" = "200" ]; then
    OBS_TABLE="observations"
    OBS_ID_COL="observation_id"
    return 0
  fi

  status_v2="$(curl -sS -o /dev/null -w "%{http_code}" \
    "$SUPABASE_URL/rest/v1/observations?select=observation_id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")"

  if [ "$status_v2" = "200" ]; then
    OBS_TABLE="observations"
    OBS_ID_COL="observation_id"
    return 0
  fi

  echo "Could not find observations table (checked observations and observations)." >&2
  return 1
}

detect_table
echo "Using source table: $OBS_TABLE (id column: $OBS_ID_COL)"

tmp_dir="$(mktemp -d)"
zones_file="$tmp_dir/zones.json"
users_file="$tmp_dir/users.json"
updates_file="$tmp_dir/updates.ndjson"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

echo "Fetching zones..."
curl -sS "$SUPABASE_URL/rest/v1/zones?select=id,name,organization_id,is_active,created_at&limit=10000" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  > "$zones_file"

echo "Fetching user profiles..."
curl -sS "$SUPABASE_URL/rest/v1/user_profiles?select=id,email,first_name,last_name,organization_id,is_active&limit=10000" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  > "$users_file"

: > "$updates_file"

offset=0
total_scanned=0

echo "Scanning observations in batches of $BATCH_SIZE..."
while :; do
  batch_file="$tmp_dir/batch-$offset.json"
    curl -sS "$SUPABASE_URL/rest/v1/$OBS_TABLE?select=$OBS_ID_COL,zone_id,organization_id,recorded_by,recorded_at&order=recorded_at.asc&limit=$BATCH_SIZE&offset=$offset" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    > "$batch_file"

  batch_count="$(jq 'length' "$batch_file")"
  [ "$batch_count" -eq 0 ] && break

  total_scanned=$((total_scanned + batch_count))

  jq -c \
    --slurpfile zones "$zones_file" \
    --slurpfile users "$users_file" '
    def norm: ascii_downcase | gsub("^\\s+|\\s+$"; "");

    def by_id($arr):
      reduce $arr[] as $it ({}; .[$it.id] = $it);

    def active_zones_by_name($arr):
      reduce $arr[] as $z ({};
        if ($z.is_active == true and ($z.name // "") != "") then
          .[($z.name | norm)] = ((.[($z.name | norm)] // []) + [$z])
        else . end
      );

    def active_users_by_email($arr):
      reduce $arr[] as $u ({};
        if (($u.email // "") != "" and ($u.is_active // true) == true) then
          .[($u.email | ascii_downcase)] = ((.[($u.email | ascii_downcase)] // []) + [$u])
        else . end
      );

    def pick_zone($zones_by_name; $zone_name; $preferred_org):
      ($zones_by_name[($zone_name | norm)] // [])
      | sort_by((if .organization_id == $preferred_org then 0 else 1 end), (.created_at // ""), .id)
      | .[0];

    def pick_user($users_by_id; $active_users_by_email; $old_user_id; $preferred_org):
      if $old_user_id == null then null
      else
        ($users_by_id[$old_user_id] // null) as $old
        | if $old == null then null
          elif (($old.is_active // true) == true) then $old.id
          elif (($old.email // "") == "") then null
          else
            ($active_users_by_email[($old.email | ascii_downcase)] // [])
            | sort_by((if .organization_id == $preferred_org then 0 else 1 end), .id)
            | (.[0].id // null)
          end
      end;

    ($zones[0] // []) as $zones_arr
    | ($users[0] // []) as $users_arr
    | by_id($zones_arr) as $zones_by_id
    | active_zones_by_name($zones_arr) as $zones_by_name
    | by_id($users_arr) as $users_by_id
    | active_users_by_email($users_arr) as $active_users_by_email
    | .[]
    | . as $obs
    | ($zones_by_id[$obs.zone_id] // null) as $old_zone
    | ($old_zone.name // null) as $zone_name
    | if $zone_name == null then empty
      else
        ($old_zone.organization_id // $obs.organization_id) as $source_org
        | pick_zone($zones_by_name; $zone_name; $source_org) as $new_zone
        | if $new_zone == null then empty
          else
            ($new_zone.organization_id // $obs.organization_id) as $new_org_id
            | pick_user($users_by_id; $active_users_by_email; $obs.recorded_by; $new_org_id) as $new_recorded_by_candidate
            | ($new_recorded_by_candidate // $obs.recorded_by) as $new_recorded_by
            | {
                  obs_id: ($obs.id // $obs.observation_id),
                zone_id: ($new_zone.id // $obs.zone_id),
                organization_id: $new_org_id,
                recorded_by: $new_recorded_by,
                change_zone: (($new_zone.id // $obs.zone_id) != $obs.zone_id),
                change_org: ($new_org_id != $obs.organization_id),
                change_user: ($new_recorded_by != $obs.recorded_by),
                source_zone_name: $zone_name
              }
            | select(.change_zone or .change_org or .change_user)
          end
      end
  ' "$batch_file" >> "$updates_file"

  if [ "$batch_count" -lt "$BATCH_SIZE" ]; then
    break
  fi
  offset=$((offset + BATCH_SIZE))
done

total_updates="$(wc -l < "$updates_file" | tr -d ' ')"
zone_updates="$(jq -s '[.[] | select(.change_zone)] | length' "$updates_file")"
org_updates="$(jq -s '[.[] | select(.change_org)] | length' "$updates_file")"
user_updates="$(jq -s '[.[] | select(.change_user)] | length' "$updates_file")"

echo "Dry-run summary:"
echo "  scanned: $total_scanned"
echo "  updatable_rows: $total_updates"
echo "  zone_updates: $zone_updates"
echo "  org_updates: $org_updates"
echo "  user_updates: $user_updates"

if [ "$total_updates" -gt 0 ]; then
  echo "Sample changes (first 10):"
  jq -s '.[0:10]' "$updates_file"
fi

if [ "$APPLY" != "true" ]; then
  echo "Dry run complete. Set APPLY=true to persist updates."
  exit 0
fi

echo "Applying updates..."
applied=0
failed=0

while IFS= read -r line; do
    obs_id="$(printf '%s' "$line" | jq -r '.obs_id')"
  payload="$(printf '%s' "$line" | jq -c '{zone_id, organization_id, recorded_by}')"

  status="$(curl -sS -o "$tmp_dir/resp-$obs_id.json" -w "%{http_code}" \
      -X PATCH "$SUPABASE_URL/rest/v1/$OBS_TABLE?$OBS_ID_COL=eq.$obs_id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$payload")"

  if [ "$status" = "204" ]; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
    err_preview="$(head -c 300 "$tmp_dir/resp-$obs_id.json" || true)"
    echo "Update failed for $obs_id (HTTP $status): $err_preview" >&2
  fi
done < "$updates_file"

echo "Apply summary:"
echo "  attempted: $total_updates"
echo "  applied: $applied"
echo "  failed: $failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi

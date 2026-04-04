#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?Set GH_TOKEN with repo + workflow permissions}"

REPO="DonSquires/FreedomCamp-Manager"
WF="db-run-migrations.yml"
REF="main"
API="https://api.github.com"

apply_one() {
  local file="$1"
  echo "Dispatching: $file"
  curl -sS -X POST \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO/actions/workflows/$WF/dispatches" \
    -d "{\"ref\":\"$REF\",\"inputs\":{\"action\":\"apply-one\",\"migration_file\":\"$file\"}}"

  local run_id status conclusion
  for _ in $(seq 1 120); do
    sleep 5
    json=$(curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
      "$API/repos/$REPO/actions/workflows/$WF/runs?event=workflow_dispatch&per_page=5")
    run_id=$(printf '%s' "$json" | jq -r '.workflow_runs[0].id')
    status=$(printf '%s' "$json" | jq -r '.workflow_runs[0].status')
    conclusion=$(printf '%s' "$json" | jq -r '.workflow_runs[0].conclusion')
    if [[ "$status" == "completed" ]]; then
      echo "RUN $run_id => $conclusion ($file)"
      [[ "$conclusion" == "success" ]]
      return
    fi
  done

  echo "Timed out waiting for workflow run for: $file" >&2
  exit 1
}

apply_one "20260219000002_evidence_integrity_and_legal_compliance.sql"
apply_one "20260220000005_core_pipeline_rebuild.sql"
apply_one "20260302000003_patrol_checkpoints.sql"
apply_one "20260302000004_privacy_curtain.sql"

echo "Schema gap replay workflow sequence completed."

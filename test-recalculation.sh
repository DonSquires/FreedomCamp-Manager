#!/bin/bash

# Test recalculate-all-compliance Edge Function
# Replace these values with your actual credentials

SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co"
ANON_KEY="YOUR_ANON_KEY_HERE"
USER_JWT="YOUR_JWT_TOKEN_HERE"

# Test with minimal payload (BUILD scope, all time)
echo "Testing recalculate-all-compliance Edge Function..."
echo ""

curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-all-compliance" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{
    "scope": "BUILD",
    "zoneIds": null,
    "orgIds": null,
    "dateRangeStart": null,
    "dateRangeEnd": null,
    "performedBy": "test-user-id"
  }'

echo ""
echo ""
echo "Expected: HTTP/2 200 with JSON response"
echo "If 401: Check JWT token"
echo "If 403: Check user has admin/master role"
echo "If 404: Edge Function not deployed"
echo "If 500: Check function logs: supabase functions logs recalculate-all-compliance --tail"

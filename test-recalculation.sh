#!/bin/bash

# Test recalculate-compliance Edge Function
# Replace these values with your actual credentials

SUPABASE_URL="https://kxwjcupuxnnbnzcgmkoi.supabase.co"
ANON_KEY="YOUR_ANON_KEY_HERE"
USER_JWT="YOUR_JWT_TOKEN_HERE"

echo "Testing recalculate-compliance Edge Function..."
echo ""

# Test 1: Full rebuild (all orgs, all time)
echo "--- Test 1: Full rebuild ---"
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-compliance" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{}'

echo ""
echo ""

# Test 2: Single organisation
echo "--- Test 2: Single organisation ---"
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-compliance" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{"organization_id": "YOUR_ORG_ID_HERE"}'

echo ""
echo ""

# Test 3: Date range
echo "--- Test 3: Date range ---"
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/recalculate-compliance" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${ANON_KEY}" \
  --data '{"date_from": "2026-01-01", "date_to": "2026-03-31"}'

echo ""
echo ""
echo "Expected: HTTP/2 200 with JSON response containing observations_processed, compliance_changed"
echo "If 401: Check JWT token"
echo "If 403: Check user has admin/master/admin_officer role"
echo "If 404: Edge Function not deployed — run: supabase functions deploy recalculate-compliance"
echo "If 500: Check function logs: supabase functions logs recalculate-compliance --tail"

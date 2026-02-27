#!/bin/bash

# Railway Inference Service Stress Test Runner
# Run with: bash tests/run-stress-test.sh

echo "🚀 Starting Railway Inference Service Stress Test..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
  echo "❌ Error: .env file not found"
  echo "Please create .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"
  exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Run the test with tsx (TypeScript runner)
npx tsx tests/railway-stress-test.ts

echo ""
echo "✅ Stress test complete!"

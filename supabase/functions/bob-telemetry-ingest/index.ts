/**
 * Bob Service Test Telemetry Ingest
 * 
 * Edge function that receives and persists Bob service test results
 * for monitoring and auditing purposes.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface TestRunPayload {
  test_tier: string
  duration_ms: number
  passed: boolean
  failed_reason?: string
  test_count: number
  pass_count: number
  skip_count: number
  workflow_id?: string
  branch?: string
  commit_sha?: string
  environment?: string
  test_cases?: Array<{
    test_name: string
    status: 'passed' | 'failed' | 'skipped' | 'timeout'
    duration_ms?: number
    error_message?: string
  }>
  coverage?: {
    surface: string
    coverage_percent: number
    lines_tested: number
    lines_total: number
    critical_path: boolean
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Only POST allowed' }), {
        status: 405,
        headers: corsHeaders,
      })
    }

    const payload: TestRunPayload = await req.json()

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Insert test run record
    const { data: runData, error: runError } = await supabase
      .from('bob_service_test_runs')
      .insert({
        test_tier: payload.test_tier,
        duration_ms: payload.duration_ms,
        passed: payload.passed,
        failed_reason: payload.failed_reason,
        test_count: payload.test_count,
        pass_count: payload.pass_count,
        skip_count: payload.skip_count,
        workflow_id: payload.workflow_id,
        branch: payload.branch,
        commit_sha: payload.commit_sha,
        environment: payload.environment || 'staging',
      })
      .select()
      .single()

    if (runError) {
      throw new Error(`Failed to insert test run: ${runError.message}`)
    }

    // Insert individual test cases
    if (payload.test_cases && payload.test_cases.length > 0) {
      const testCaseRecords = payload.test_cases.map((tc) => ({
        test_run_id: runData.id,
        test_name: tc.test_name,
        test_tier: payload.test_tier,
        status: tc.status,
        duration_ms: tc.duration_ms,
        error_message: tc.error_message,
      }))

      const { error: tcError } = await supabase
        .from('bob_service_test_cases')
        .insert(testCaseRecords)

      if (tcError) {
        console.error(`Warning: Failed to insert test cases: ${tcError.message}`)
        // Non-fatal; continue
      }
    }

    // Insert coverage data if provided
    if (payload.coverage) {
      const { error: covError } = await supabase
        .from('bob_service_coverage')
        .insert({
          test_run_id: runData.id,
          surface: payload.coverage.surface,
          coverage_percent: payload.coverage.coverage_percent,
          lines_tested: payload.coverage.lines_tested,
          lines_total: payload.coverage.lines_total,
          critical_path: payload.coverage.critical_path,
        })

      if (covError) {
        console.error(`Warning: Failed to insert coverage data: ${covError.message}`)
        // Non-fatal; continue
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        test_run_id: runData.id,
        message: `Bob service test telemetry recorded (${payload.test_tier})`,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    )
  } catch (error) {
    console.error('Telemetry ingest error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 400,
        headers: corsHeaders,
      }
    )
  }
})

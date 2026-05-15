/**
 * Vercel Webhook Ingest Handler
 * 
 * Receives deployment and build events from Vercel and logs them
 * for Bob's operational awareness and release tracking.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vercelWebhookSecret = Deno.env.get('VERCEL_WEBHOOK_SECRET')!

interface VercelDeploymentEvent {
  type: 'deployment.created' | 'deployment.succeeded' | 'deployment.failed'
  id: string
  deploymentId: string
  url: string
  projectId: string
  projectName: string
  environment: string
  gitCommitSha?: string
  gitCommitMessage?: string
  gitBranch?: string
  creator: {
    username: string
  }
  createdAt: number
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

    // Validate webhook signature
    const signature = req.headers.get('x-vercel-signature')
    if (!signature || signature !== vercelWebhookSecret) {
      console.warn('Vercel webhook signature mismatch or missing')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const payload: VercelDeploymentEvent = await req.json()

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Log deployment event
    const { error } = await supabase
      .from('deployment_events')
      .insert({
        event_type: payload.type,
        deployment_id: payload.deploymentId,
        project_name: payload.projectName,
        url: payload.url,
        environment: payload.environment,
        status: payload.type === 'deployment.succeeded' ? 'success' : payload.type === 'deployment.failed' ? 'failed' : 'pending',
        git_commit_sha: payload.gitCommitSha,
        git_branch: payload.gitBranch,
        creator: payload.creator?.username,
        created_at: new Date(payload.createdAt).toISOString(),
      })

    if (error) {
      console.error('Failed to log deployment event:', error)
      // Non-fatal; still return success
    }

    // If deployment succeeded and on production, notify Bob
    if (payload.type === 'deployment.succeeded' && payload.environment === 'production') {
      console.log(`Production deployment success: ${payload.url}`)
      // Could trigger Bob notification or health check here
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Vercel deployment event recorded: ${payload.type}`,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    )
  } catch (error) {
    console.error('Vercel webhook error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 400,
        headers: corsHeaders,
      }
    )
  }
})

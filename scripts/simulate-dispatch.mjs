import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function injectMockDispatch() {
  console.log('Initializing realtime dispatch injector...')

  const targetOfficerId = process.env.TEST_OFFICER_ID || '8c7b5b2a-acf1-48c7-bd2c-640maine697'
  const mockIncident = {
    assigned_officer_id: targetOfficerId,
    type: 'Enforcement Breaches',
    raw_desc: 'Commercial alarm trigger at Salisbury Road Industrial Hub, Richmond',
    priority: 'CRITICAL',
    status: 'unassigned',
  }

  const { data, error } = await supabase
    .from('incidents')
    .insert([mockIncident])
    .select('id, assigned_officer_id, type, priority, status')
    .single()

  if (error) {
    console.error('Dispatch injection failed:', error.message)
    process.exit(1)
  }

  console.log(`Dispatch injected successfully: ${data.id}`)
  console.log(`Assigned officer: ${data.assigned_officer_id}`)
  console.log('Verify the active realtime consumer receives the new incident.')
}

injectMockDispatch().catch((error) => {
  console.error('Unexpected dispatch injection error:', error)
  process.exit(1)
})
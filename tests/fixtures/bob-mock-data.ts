/**
 * Bob Service Test Fixtures
 * Mock data and helper utilities for Bob testing
 */

export const BOB_MOCK_RESPONSES = {
  operational_greeting: {
    response: [
      'Review Findings',
      'Request acknowledged and routed to operational context.',
      '',
      'Assessment',
      'Standard operational query detected. Preparing structured response.',
      '',
      'Action Plan',
      '1. Assess current patrol status.',
      '2. Route to appropriate workflow.',
      '3. Provide next steps.',
    ].join('\n'),
    provider: 'mock-suite',
    actionChecklist: [
      'Assess patrol status',
      'Route workflow',
      'Provide next steps',
    ],
  },

  code_change_task: {
    task_id: 'bob-task-mock-001',
    status: 'queued',
    bob_plan: [
      'OBSERVE: Inspect failing test and codebase around the error location.',
      'LOCALISE: Narrow down the root cause with grep and targeted reads.',
      'HYPOTHESISE: Form a repair hypothesis based on the error pattern.',
      'MINIMISE: Create a minimal test case that reproduces the bug.',
      'APPLY: Generate and apply the patch.',
      'VERIFY: Run the test suite to confirm success.',
      'RECORD: Write a summary to the audit log.',
    ].join('\n'),
    execution_mode: 'standard',
    github_assist_required: false,
  },

  compliance_draft: {
    document_type: 'Infringement Notice',
    title: 'Infringement Notice - Freedom Camping Act 2011',
    sections: [
      {
        heading: 'Breach Summary',
        content:
          'Officer identified commercial vehicle parked in non-compliant zone for 12+ hours without permit.',
      },
      {
        heading: 'Regulatory Basis',
        content:
          'Freedom Camping Act 2011 s15; Local Bylaw section 4.2.',
      },
      {
        heading: 'Infringement Fee',
        content: 'NZ$200 (standard tier)',
      },
    ],
  },

  import_intake_result: {
    message: 'Bob intake package created and staged for review.',
    records_inserted: 3,
    batchId: 'batch-mock-20260515-001',
    storagePath: 'bob-intake/org-001/vehicles/1715792400000-vehicles-export.xlsx',
    assistantBrief: [
      'Detected 3 vehicle records with compliance history.',
      'All plates valid and matched to existing vehicle profiles.',
      'Recommend: Route to VehicleManagement for bulk update.',
    ].join('\n'),
    recommendedRoute: {
      path: '/vehicles',
      label: 'Manage Vehicles',
    },
  },

  dispatch_incident: {
    id: 'incident-mock-20260515',
    assigned_officer_id: '8c7b5b2a-acf1-48c7-bd2c-640maine697',
    type: 'Enforcement Breaches',
    raw_desc:
      'Commercial alarm trigger at Salisbury Road Industrial Hub, Richmond',
    priority: 'CRITICAL',
    status: 'unassigned',
    created_at: new Date().toISOString(),
    gps_lat: -37.785,
    gps_lng: 175.278,
  },

  bob_approval_proposal: {
    id: 'proposal-mock-001',
    title: 'Generate Site H&S Plan for Queen Street Deployment',
    description:
      'Bob proposes generating a WorkSafe-compliant H&S plan for the upcoming Queen Street patrol shift.',
    impact_level: 'medium',
    status: 'pending_approval',
    approval_due_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    requested_by: 'bob-assistant',
    route: '/bob-assistant',
  },

  patrol_setup_blueprint: {
    patrol_id: 'patrol-mock-001',
    shift_code: 'QS-2026-05-15-A',
    site_name: 'Queen Street Retail Precinct',
    zone_id: 'zone-auckland-cbd',
    officer_ids: ['officer-001', 'officer-002'],
    start_time: '06:00',
    end_time: '14:00',
    weather_context: 'Partly cloudy, 16°C, light winds',
    hazard_assessment: {
      environmental: ['Foot traffic congestion', 'Vehicle movement'],
      biological: [],
      operational: ['High-visibility requirement'],
    },
    compliance_checklist: [
      'Check-in via PTT radio',
      'Scan initial zone perimeter',
      'Report hourly status',
      'Post-shift compliance upload',
    ],
  },

  bob_learning_snapshot: {
    session_id: 'session-mock-001',
    user_id: 'user-mock-001',
    organization_id: 'org-001',
    turns_captured: 5,
    feedback_score: 4.2,
    hallucination_patterns: [],
    lessons_learned: [
      'Bob correctly identified compliance gaps in vehicle registration.',
      'Multi-tenant RLS isolation remained intact across all queries.',
    ],
  },
}

export const BOB_MOCK_EDGE_FUNCTIONS = {
  'onspace-ai-chat': async (requestBody: any) => {
    const message = (requestBody?.messages?.[requestBody.messages.length - 1]?.content || '').toLowerCase()

    // Route to appropriate mock response
    if (message.includes('h&s') || message.includes('plan')) {
      return { data: BOB_MOCK_RESPONSES.compliance_draft }
    }
    if (message.includes('code') || message.includes('fix')) {
      return { data: BOB_MOCK_RESPONSES.code_change_task }
    }
    if (message.includes('import') || message.includes('intake')) {
      return { data: BOB_MOCK_RESPONSES.import_intake_result }
    }

    return { data: BOB_MOCK_RESPONSES.operational_greeting }
  },

  'grandmaster-studio': async (requestBody: any) => {
    const action = requestBody?.action

    if (action === 'code_task_submit') {
      return { data: BOB_MOCK_RESPONSES.code_change_task }
    }
    if (action === 'doctor_health') {
      return {
        data: {
          status: 'healthy',
          provider: 'runpod-inference',
          latency_ms: 245,
        },
      }
    }

    return { data: { status: 'ok' } }
  },

  'simulate-dispatch': async (requestBody: any) => {
    return { data: BOB_MOCK_RESPONSES.dispatch_incident }
  },
}

export const BOB_TEST_USERS = {
  officer: {
    id: 'user-officer-mock',
    email: 'officer@ironeagle.test',
    role: 'officer',
    organization_id: 'org-001',
    first_name: 'Field',
    last_name: 'Officer',
  },

  admin: {
    id: 'user-admin-mock',
    email: 'admin@ironeagle.test',
    role: 'admin',
    organization_id: 'org-001',
    first_name: 'Admin',
    last_name: 'User',
  },

  master: {
    id: 'user-master-mock',
    email: 'master@ironeagle.test',
    role: 'master',
    organization_id: 'org-001',
    first_name: 'Master',
    last_name: 'Operator',
  },

  grand_master: {
    id: 'user-grandmaster-mock',
    email: 'don@ironeagle.test',
    role: 'grand_master',
    organization_id: 'org-001',
    first_name: 'Don',
    last_name: 'Squires',
  },
}

export const BOB_TEST_ORGANIZATIONS = {
  ironeagle_main: {
    id: 'org-001',
    name: 'Iron Eagle Security Main',
    organization_type: 'client',
    is_active: true,
  },

  ironeagle_staging: {
    id: 'org-staging',
    name: 'Iron Eagle Security Staging',
    organization_type: 'client',
    is_active: true,
  },
}

export const BOB_TEST_ZONES = {
  auckland_cbd: {
    id: 'zone-auckland-cbd',
    name: 'Auckland CBD',
    organization_id: 'org-001',
    geofence_polygon: [
      [-36.8445, 174.7633],
      [-36.8485, 174.7633],
      [-36.8485, 174.7753],
      [-36.8445, 174.7753],
    ],
    is_active: true,
  },
}

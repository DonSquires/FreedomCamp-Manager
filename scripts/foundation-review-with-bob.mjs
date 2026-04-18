#!/usr/bin/env node
// Shared conversation log - visible to both Agent and User

import { BobSession } from './agent-bob-bridge.mjs';

async function runFoundationReview() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   FOUNDATION-UP CODEBASE REVIEW                               ║
║   Agent ↔ Bob Collaboration (User can guide)                 ║
╚═══════════════════════════════════════════════════════════════╝
`);

  try {
    const session = new BobSession({
      context: {
        workdir: process.cwd(),
        projectSize: '~80 page components, 45+ Edge Functions, 70+ migrations',
        stack: 'React 18 + TypeScript + Vite + Supabase + Node services',
        timestamp: new Date().toISOString(),
      },
    });

    // ==== TURN 1: Priority Assessment ====
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│ AGENT: Requesting Bob's critical review priorities          │
└─────────────────────────────────────────────────────────────┘
`);

    const priority = await session.exchange(
      `We're doing a foundation-up stability review of FreedomCamp-Manager:
- Large TypeScript SPA (React 18, Vite, Supabase)
- ~80 page components, 45+ Edge Functions, 70+ DB migrations
- Multi-org support, live patrol monitoring, geofencing, compliance reporting
- Three services: main frontend, inference (Bob/ONNX), proxy (NZSCV vehicle scanning)
- Node24+ standardization, Bob model verification, edge AI safety guards recently completed

What are the TOP 3-5 critical areas we must validate first for system stability and security?`
    );

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│ BOB'S ASSESSMENT:                                            │
└─────────────────────────────────────────────────────────────┘
${priority}

⏸️  AWAITING USER GUIDANCE:
   - Does this align with your concerns?
   - Should we adjust priorities before proceeding?
   - Any specific areas you want emphasized?
`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

runFoundationReview();

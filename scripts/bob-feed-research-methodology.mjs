#!/usr/bin/env node

/**
 * bob-feed-research-methodology.mjs
 *
 * Training feeder: Research Methodology, Critical Thinking, Fact-Checking
 *
 * Trains Bob how to:
 * - Distinguish facts from opinion, speculation, hearsay, propaganda
 * - Verify data and find primary sources
 * - Spot misinformation and red flags
 * - Perform rigorous, evidence-based research
 * - Label confidence levels in his own responses
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-research-methodology.mjs
 */

import fetch from 'node-fetch'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()

if (!BOB_URL || !API_KEY) {
  console.error('Error: Missing BOB_SERVICE_URL and BOB_INFERENCE_API_KEY')
  process.exit(1)
}

const bulletins = [
  {
    type: 'system',
    title: 'Foundations of Evidence-Based Research',
    summary: 'The research hierarchy: facts vs. informed opinion vs. speculation vs. hearsay vs. propaganda. How to categorize claims and label confidence levels.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'critical-thinking',
      priority: 'high',
      applies_to: ['market-research', 'technical-analysis', 'competitive-review'],
    },
  },
  {
    type: 'system',
    title: 'Primary vs. Secondary Sources',
    summary: 'How to evaluate source type: government documents, surveys, expert interviews (primary) vs. news, analysis, blogs (secondary). When to trust each.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 2)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'source-evaluation',
      priority: 'high',
      applies_to: ['fact-checking', 'evidence-gathering'],
    },
  },
  {
    type: 'system',
    title: 'Fact-Checking & Verification Techniques',
    summary: 'Verification checklist: Can you find the fact in 2+ independent sources? Is the source current? Does citation match the claim? Red flags for propaganda and misinformation.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 3)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'fact-checking',
      priority: 'high',
      applies_to: ['market-analysis', 'competitor-review', 'technical-validation'],
      techniques: ['two-source-minimum', 'recency-check', 'conflict-of-interest', 'red-flag-identification'],
    },
  },
  {
    type: 'system',
    title: 'NZ-Specific Fact-Checking Resources',
    summary: 'Authoritative NZ sources: legislation.govt.nz, Stats NZ, LGNZ, council websites, Stuff, RNZ. Fact-checking sites: Snopes, FactCheck.org. Sector-specific resources for councils, business, procurement.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 4)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'nz-resources',
      priority: 'high',
      applies_to: ['nz-market-research', 'client-outreach', 'procurement-analysis'],
      key_sources: [
        'legislation.govt.nz',
        'stats.nz',
        'lgnz.co.nz',
        'council.govt.nz',
        'rnz.co.nz',
        'gets.govt.nz',
      ],
    },
  },
  {
    type: 'system',
    title: 'Labeling Your Own Research in Client-Facing Communication',
    summary: 'Four-level response framework: FACT (verified, sourced), INFORMED OPINION (grounded in facts), SPECULATION (untested hypothesis), UNVERIFIED (needs checking). Templates for research-heavy responses.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 5)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'client-communication',
      priority: 'critical',
      applies_to: ['market-research-delivery', 'strategic-advice', 'competitive-analysis'],
      critical_rule: 'Always label confidence level; never present speculation as fact',
    },
  },
  {
    type: 'system',
    title: 'Red Flags & Critical Thinking Exercises',
    summary: '32 red flag checklist: source, evidence, language, logic, transparency flags. Exercise: Evaluate propaganda example. Assessment framework for spotting bias.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 6)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'propaganda-detection',
      priority: 'high',
      applies_to: ['misinformation-identification', 'competitor-claims-analysis', 'market-validation'],
      techniques: [
        'no-sources-check',
        'vague-language-detection',
        'false-urgency-identification',
        'logical-fallacy-recognition',
        'citation-verification',
      ],
    },
  },
  {
    type: 'system',
    title: 'How to Use AI Responsibly When Researching',
    summary: 'What AI is good at: summarizing, identifying patterns, drafting, hypothesizing. What AI is bad at: hallucinating sources, confident incorrectness, real-time data. Best practices for AI-assisted research.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 7)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'ai-safety',
      priority: 'critical',
      applies_to: ['self-awareness', 'correct-output', 'limitation-acknowledgment'],
      critical_rules: [
        'Always verify AI outputs against primary sources',
        'Never cite AI as a source; cite primary sources only',
        'When uncertain, disclose uncertainty',
        'Ask for reasoning, not just conclusions',
      ],
    },
  },
  {
    type: 'system',
    title: 'Building Your Own Research Framework',
    summary: 'Research protocol for market analysis: define question precisely, identify primary sources, verify with 2+ sources, note gaps, separate fact from interpretation, publish reasoning. Protocol for technical verification.',
    source: 'BOB_RESEARCH_METHODOLOGY_TRAINING.md (Bulletin 8)',
    effective_date: '2026-04-22',
    metadata: {
      module: 'research-methodology',
      domain: 'research-protocol',
      priority: 'high',
      applies_to: ['market-research', 'technical-analysis', 'competitive-review', 'verification-loops'],
      frameworks: ['market-analysis', 'technical-validation', 'verification-loop'],
    },
  },
]

async function ingestBulletins() {
  console.log(`\n📚 Ingesting Research Methodology Training (${bulletins.length} bulletins)...\n`)

  let succeeded = 0
  let failed = 0

  for (const bulletin of bulletins) {
    try {
      const response = await fetch(`${BOB_URL}/intel/ingest-bulletin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ bulletin }),
      })

      if (response.ok) {
        console.log(`✅ ${bulletin.title}`)
        succeeded += 1
      } else {
        console.log(`❌ ${bulletin.title} (HTTP ${response.status})`)
        failed += 1
      }
    } catch (err) {
      console.log(`❌ ${bulletin.title} (Error: ${err.message})`)
      failed += 1
    }
  }

  console.log(`\n✅ Ingested: ${succeeded}/${bulletins.length}`)
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`)
    process.exit(1)
  }

  console.log('\n💡 Bob now understands:')
  console.log('   • How to distinguish facts from speculation')
  console.log('   • Where to find NZ government & fact-checking sources')
  console.log('   • How to verify claims using 2+ independent sources')
  console.log('   • Red flags for propaganda & misinformation')
  console.log('   • How to label confidence levels in his responses')
  console.log('   • His own limitations as an AI')
  console.log('\n🎯 For market research, Bob will now:')
  console.log('   1. Start with official NZ sources (LGNZ, legislation, council data)')
  console.log('   2. Verify claims in 2+ independent sources')
  console.log('   3. Label findings: FACT / OPINION / SPECULATION / UNVERIFIED')
  console.log('   4. Provide URLs for user verification')
  console.log('   5. Acknowledge data gaps and limitations\n')
}

ingestBulletins()

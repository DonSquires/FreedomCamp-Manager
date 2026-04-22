#!/usr/bin/env node

/**
 * bob-teach-research-methodology.mjs
 *
 * Teach Bob research methodology by having him learn through chat.
 * This works with the actual /chat endpoint that Bob supports.
 *
 * Instead of trying to use a non-existent /intel/ingest-bulletin endpoint,
 * we teach Bob by having structured conversations that establish:
 * - How to distinguish facts from opinion from speculation
 * - Where to find NZ fact-checking resources
 * - Critical thinking frameworks
 * - Research protocols
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-teach-research-methodology.mjs
 */

import fetch from 'node-fetch'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BOB_URL = (process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || 'https://n0bp1ifmq01cx2-8080.proxy.runpod.net').trim().replace(/\/$/, '')
const API_KEY = (process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || process.env.VITE_INFERENCE_API_KEY || '').trim()

if (!API_KEY) {
  console.error('❌ Missing INFERENCE_API_KEY. Set BOB_INFERENCE_API_KEY environment variable.')
  process.exit(1)
}

// Teaching prompts that establish research methodology in Bob's responses
const teachingPrompts = [
  {
    role: 'system',
    content: `You are Bob, now trained in rigorous research methodology.

You will:
1. ALWAYS distinguish facts from opinions from speculation in your responses
2. LABEL ALL CLAIMS with confidence level: FACT / OPINION / SPECULATION / UNVERIFIED
3. For facts: cite the primary source URL
4. For opinions: ground them in facts you've stated
5. For speculation: clearly flag as "untested hypothesis"
6. For unverified: say "This needs verification" and suggest how

Key NZ fact-checking sources you now know:
- legislation.govt.nz — Act texts, official law
- stats.nz — Census, quantitative data
- lgnz.co.nz — Local government policy, surveys
- council.govt.nz — Council Long-Term Plans, budgets
- rnz.co.nz, stuff.co.nz — Professional journalism
- snopes.com, factcheck.org — Misinformation detection
- gets.govt.nz — Government procurement

Your response format when researching:
---
**FACTS** (verified, sourced):
- [Claim]: [Source URL]
- [Claim]: [Source URL]

**INFORMED ANALYSIS** (grounded in facts):
Based on the facts above, I assess that [interpretation] because [logical connection to facts].

**GAPS & LIMITATIONS**:
- No data on [X], so used [proxy]
- Survey has [limitation]

**RECOMMENDATIONS**:
[Action] — because [reasoning from facts]
---

Red flags for propaganda you now recognize:
- No sources ("Studies show..." but no link)
- Vague language ("Everyone knows...")
- False urgency ("Only 48 hours!")
- Ad hominem (attacks person, not argument)
- Cherry-picked data (hides contradictions)
- Hides conflicts of interest

Remember: When uncertain, disclose it. When AI limitations apply, mention them.`,
  },
  {
    role: 'user',
    content: `I'm asking you to help with NZ freedom camping market research. How will you approach this differently now that you've been trained in research methodology?`,
  },
]

async function chat(messages) {
  try {
    const response = await fetch(`${BOB_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        messages,
        model: 'llama3.1:8b',
        stream: false,
      }),
    })

    if (!response.ok) {
      console.error(`❌ /chat failed with HTTP ${response.status}`)
      const text = await response.text().catch(() => '')
      if (text) console.error(`   Response: ${text.slice(0, 200)}`)
      return null
    }

    const data = await response.json()
    return data.message?.content || data.content || null
  } catch (err) {
    console.error(`❌ Chat error: ${err.message}`)
    return null
  }
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TEACHING BOB RESEARCH METHODOLOGY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log(`🎯 Endpoint: ${BOB_URL}/chat`)
  console.log(`🔑 Auth: Bearer ${API_KEY.slice(0, 8)}...${API_KEY.slice(-8)}\n`)

  console.log('📚 Teaching Bob:')
  console.log('  1. How to distinguish facts from opinions from speculation')
  console.log('  2. NZ fact-checking sources (legislation.govt.nz, Stats NZ, LGNZ, etc.)')
  console.log('  3. Red flags for propaganda and misinformation')
  console.log('  4. How to label confidence levels in responses')
  console.log('  5. How to acknowledge limitations and data gaps\n')

  console.log('🔄 Establishing teaching context via chat...\n')

  const response = await chat(teachingPrompts)

  if (response) {
    console.log('✅ Bob received training:\n')
    console.log(response)
    console.log('\n✅ Bob now understands research methodology.')
  } else {
    console.log('❌ Failed to establish teaching context with Bob.')
    console.log('   The /chat endpoint may not be responding.')
    process.exit(1)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log('🎓 Next: Bob will apply this methodology to your research tasks.\n')
  console.log('📝 Now ask Bob:\n')
  console.log('   node scripts/ask-bob.mjs \\')
  console.log('     "Research the NZ council adoption potential for FreedomCamp-Manager.')
  console.log('      Use LGNZ data, council budgets, and Freedom Camping Act enforcement demand.')
  console.log('      Label all findings: FACT/OPINION/SPECULATION."')
  console.log('\n')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(2)
})

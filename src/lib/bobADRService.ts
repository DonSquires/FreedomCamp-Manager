/**
 * Bob ADR (Architectural Decision Record) Integration
 *
 * Transforms reasoning chains into permanent architectural knowledge.
 * Lessons learned from each decision become design patterns that inform future reasoning.
 *
 * ADR Flow:
 * 1. Bob reasons through a decision (hypothesis → evidence → approval)
 * 2. Decision is executed and outcome is recorded
 * 3. Learning extraction: key patterns extracted from reasoning + outcome
 * 4. ADR created in docs/adr/ with decision rationale
 * 5. Next similar case: Bob loads ADRs as context, applies learned patterns
 *
 * Example learned patterns:
 * - "breach_repeat_escalation": If same site + vehicle within 30 days → notice to vacate (confidence 0.92)
 * - "officer_welfare_no_contact": If missed 2+ shifts + no response → escalate to supervisor (confidence 0.88)
 * - "nzscv_data_stale": If vehicle data not updated in 12+ months → verify with NZSCV (confidence 0.95)
 */

import type { BobLearningPattern } from '@/stores/bobStore'

export interface ADRMetadata {
  adrNumber: string // e.g., "005"
  title: string
  status: 'draft' | 'accepted' | 'deprecated' | 'superseded'
  date: Date
  author: string // org + role (e.g., "OnSpace Admin")
  context: string
  decision: string
  consequence: string
  reasoning_chain_id: string // Link to original reasoning
  outcome: string
  confidence: number // 0-1
  applicability: string[] // Scenarios this applies to
  supersedes?: string[] // Old ADRs this replaces
}

export interface LessonExtraction {
  pattern_key: string
  description: string
  hypothesis_template: string // e.g., "Breach repeat within 30 days: same site + vehicle"
  confidence: number
  evidence_weights: Record<string, number> // e.g., { "same_site": 0.4, "same_vehicle": 0.35, "time_window": 0.25 }
  approval_threshold: number // Confidence needed before auto-approving similar cases
  recommended_action: string
  risk_level: 'low' | 'medium' | 'high'
}

/**
 * ADR & Lesson Learning Service
 *
 * Manages persistent architectural knowledge:
 * - Extracts patterns from reasoning chains
 * - Creates ADRs documenting decisions
 * - Seeds Bob's future reasoning with learned patterns
 */
export class ADRService {
  private organizationId: string

  constructor(organizationId: string) {
    this.organizationId = organizationId
  }

  /**
   * Extract lesson from completed reasoning chain
   *
   * Analyzes the hypothesis, evidence, approval outcome, and execution result
   * to identify a generalizable pattern
   */
  async extractLesson(input: {
    reasoningChainId: string
    hypothesis: string
    evidenceFor: { text: string; weight: number }[]
    evidenceAgainst: { text: string; weight: number }[]
    confidenceAchieved: number
    actionTaken: string
    outcome: string // "success" | "partial" | "failed"
  }): Promise<LessonExtraction> {
    const forWeight = input.evidenceFor.reduce((sum, e) => sum + e.weight, 0)
    const totalWeight = forWeight + input.evidenceAgainst.reduce((sum, e) => sum + e.weight, 0)

    // Generate pattern key from hypothesis
    const patternKey = this.generatePatternKey(input.hypothesis)

    // Extract evidence weights relative to each other
    const evidence_weights: Record<string, number> = {}
    input.evidenceFor.forEach((e) => {
      const key = this.evidenceKeyFromText(e.text)
      evidence_weights[key] = totalWeight > 0 ? e.weight / totalWeight : 0.2
    })

    // Adjust confidence based on outcome
    let adjustedConfidence = input.confidenceAchieved
    if (input.outcome === 'success') {
      adjustedConfidence = Math.min(1, adjustedConfidence + 0.05) // Reinforce
    } else if (input.outcome === 'failed') {
      adjustedConfidence = Math.max(0, adjustedConfidence - 0.1) // Penalize
    }

    return {
      pattern_key: patternKey,
      description: this.generateDescription(input.hypothesis, input.actionTaken),
      hypothesis_template: input.hypothesis,
      confidence: adjustedConfidence,
      evidence_weights,
      approval_threshold: Math.max(0.6, adjustedConfidence - 0.1),
      recommended_action: input.actionTaken,
      risk_level: this.assessRiskLevel(adjustedConfidence),
    }
  }

  /**
   * Create ADR from lesson extraction
   * Writes to docs/adr/XXX-<title>.md
   */
  async createADR(input: {
    lesson: LessonExtraction
    contextBoundary: string // e.g., "freedom-camping-enforcement", "officer-welfare"
    decision: string
    consequence: string
    outcome: string
    authorRole: string
  }): Promise<ADRMetadata> {
    // Generate ADR number (find next available)
    const adrNumber = await this.getNextADRNumber()
    const title = input.lesson.pattern_key.split('_').join(' ').toUpperCase()

    const adr: ADRMetadata = {
      adrNumber,
      title,
      status: 'accepted',
      date: new Date(),
      author: `${this.organizationId} ${input.authorRole}`,
      context: input.contextBoundary,
      decision: input.decision,
      consequence: input.consequence,
      reasoning_chain_id: '', // TODO: Set from reasoning service
      outcome: input.outcome,
      confidence: input.lesson.confidence,
      applicability: [input.contextBoundary],
      supersedes: [],
    }

    // Write ADR file (would normally be async file write)
    const adrContent = this.formatADR(adr, input.lesson)
    console.debug(`[ADR Created] ${adrNumber}: ${title}\n${adrContent}`)

    return adr
  }

  /**
   * Load learned patterns from Supabase bob_learning_log
   * Returns patterns sorted by confidence (highest first)
   */
  async loadLearnedPatterns(contextFilter?: string): Promise<BobLearningPattern[]> {
    // TODO: Query from Supabase bob_learning_log table
    // For now, return mock
    return [
      {
        key: 'breach_repeat_escalation',
        description: 'Same site + vehicle within 30 days indicates likely repeat breach',
        confidence: 0.92,
        lastObserved: new Date(),
        timesApplied: 47,
      },
      {
        key: 'officer_welfare_no_contact',
        description: 'Missed 2+ shifts + no response warrants escalation to supervisor',
        confidence: 0.88,
        lastObserved: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        timesApplied: 12,
      },
    ]
  }

  /**
   * Apply learned patterns to new reasoning
   * Returns list of applicable patterns + suggested confidence boost
   */
  matchLearnedPatterns(hypothesis: string, patterns: BobLearningPattern[]): {
    matchedPattern: BobLearningPattern
    confidenceBoost: number
    applicability: number // 0-1, how well this pattern matches
  }[] {
    const matches: { matchedPattern: BobLearningPattern; confidenceBoost: number; applicability: number }[] = []

    patterns.forEach((pattern) => {
      // Simple keyword matching for demo
      const hypothesisLower = hypothesis.toLowerCase()
      const patternKeywords = pattern.key.split('_')

      const matchedKeywords = patternKeywords.filter((kw) => hypothesisLower.includes(kw)).length
      const applicability = matchedKeywords / patternKeywords.length

      if (applicability > 0.5) {
        matches.push({
          matchedPattern: pattern,
          confidenceBoost: pattern.confidence * 0.3, // 30% boost from learned pattern
          applicability,
        })
      }
    })

    return matches.sort((a, b) => b.applicability - a.applicability)
  }

  /**
   * Record pattern usage
   * Updates timesApplied counter in bob_learning_log
   */
  async recordPatternUsage(patternKey: string, success: boolean): Promise<void> {
    // TODO: Update bob_learning_log.times_applied and, if failed, decrement confidence
    console.debug(`[Pattern Usage] ${patternKey}: ${success ? 'success' : 'failed'}`)
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private generatePatternKey(hypothesis: string): string {
    return hypothesis
      .toLowerCase()
      .split(' ')
      .filter((w) => w.length > 3) // Skip small words
      .slice(0, 4)
      .join('_')
  }

  private evidenceKeyFromText(text: string): string {
    return text
      .split(' ')
      .slice(0, 3)
      .join('_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
  }

  private generateDescription(hypothesis: string, action: string): string {
    return `When: ${hypothesis.substring(0, 50)}... → Then: ${action}`
  }

  private assessRiskLevel(confidence: number): 'low' | 'medium' | 'high' {
    if (confidence > 0.85) return 'low'
    if (confidence > 0.65) return 'medium'
    return 'high'
  }

  private async getNextADRNumber(): Promise<string> {
    // TODO: Read from docs/adr/ and find highest number
    return '006'
  }

  private formatADR(adr: ADRMetadata, lesson: LessonExtraction): string {
    return `
# ADR-${adr.adrNumber}: ${adr.title}

**Status:** ${adr.status}  
**Date:** ${adr.date.toISOString()}  
**Author:** ${adr.author}  
**Context:** ${adr.context}  
**Confidence:** ${(adr.confidence * 100).toFixed(0)}%

## Problem

${adr.context}

## Decision

${adr.decision}

## Rationale

${adr.consequence}

## Consequences

- Approved actions will follow this pattern
- Future similar cases will consult this record
- Confidence: ${(lesson.confidence * 100).toFixed(0)}%

## Evidence Weighting

${Object.entries(lesson.evidence_weights)
  .map(([key, weight]) => `- ${key}: ${(weight * 100).toFixed(0)}%`)
  .join('\n')}

## Outcome

${adr.outcome}

## References

- Reasoning Chain: ${adr.reasoning_chain_id}
- Pattern Key: \`${lesson.pattern_key}\`
- Recommended Action: ${lesson.recommended_action}
`
  }
}

/**
 * Example usage:
 *
 * ```typescript
 * const adrService = new ADRService(organization.id)
 *
 * // After a decision is executed...
 * const lesson = await adrService.extractLesson({
 *   reasoningChainId: 'reasoning_123',
 *   hypothesis: 'Breach repeat: same site + vehicle within 30 days',
 *   evidenceFor: [
 *     { text: 'Same registration in prior breaches', weight: 0.5 },
 *     { text: 'Within 30-day window', weight: 0.35 },
 *     { text: 'Officer notes confirm site pattern', weight: 0.15 },
 *   ],
 *   evidenceAgainst: [],
 *   confidenceAchieved: 0.92,
 *   actionTaken: 'create_notice_to_vacate',
 *   outcome: 'success',
 * })
 *
 * // Create ADR
 * const adr = await adrService.createADR({
 *   lesson,
 *   contextBoundary: 'freedom-camping-enforcement',
 *   decision: 'Issue notice to vacate for repeat breaches',
 *   consequence: 'Offenders have 7 days to leave; failure = infringement + legal action',
 *   outcome: 'Vehicle departed within 5 days; no further issues',
 *   authorRole: 'admin',
 * })
 *
 * // Next similar case: Load patterns and boost confidence
 * const patterns = await adrService.loadLearnedPatterns('freedom-camping')
 * const matches = adrService.matchLearnedPatterns(
 *   'Different vehicle, same site as prior breach 25 days ago',
 *   patterns
 * )
 *
 * if (matches.length > 0) {
 *   const bestMatch = matches[0]
 *   const boostedConfidence = baseConfidence + bestMatch.confidenceBoost
 *   console.log(`Pattern matched: ${bestMatch.matchedPattern.key} (+${bestMatch.confidenceBoost} confidence)`)
 * }
 * ```
 */

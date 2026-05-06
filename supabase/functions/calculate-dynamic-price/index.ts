/**
 * calculate-dynamic-price — B-32 Dynamic Pricing Engine
 *
 * Given a zone_id and a target datetime (ISO-8601, interpreted in
 * Pacific/Auckland), returns the effective parking fee for that moment
 * by applying any matching pricing_rules for the organisation.
 *
 * Rule evaluation order (highest priority first):
 *   1. Zone-specific rule with matching day_of_week AND hour range
 *   2. Zone-specific rule with matching day_of_week only
 *   3. Zone-specific rule with matching hour range only
 *   4. Zone-specific rule with no time restrictions
 *   5. Org-wide rule (zone_id IS NULL) following same precedence
 *
 * If a matching rule has flat_override_nzd set, that value is returned
 * directly. Otherwise the zone's base fee_nzd is multiplied by the
 * rule's multiplier.  If no rules match, the zone's fee_nzd is returned
 * as-is (or 0 if null).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestBody {
  zone_id: string
  datetime_iso?: string  // defaults to now() in NZ time if omitted
}

interface PricingRule {
  id: string
  zone_id: string | null
  label: string
  day_of_week: number | null
  hour_from: number | null
  hour_to: number | null
  multiplier: number
  flat_override_nzd: number | null
  is_active: boolean
}

interface ZoneRow {
  id: string
  name: string
  fee_nzd: number | null
}

function toNZDatetime(isoString: string): { dayOfWeek: number; hour: number } {
  const nzTime = new Date(
    new Date(isoString).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
  )
  return { dayOfWeek: nzTime.getDay(), hour: nzTime.getHours() }
}

function ruleScore(rule: PricingRule): number {
  // Higher score = more specific = higher priority
  let score = 0
  if (rule.zone_id !== null) score += 4   // zone-specific beats org-wide
  if (rule.day_of_week !== null) score += 2
  if (rule.hour_from !== null) score += 1
  return score
}

function ruleMatches(rule: PricingRule, dayOfWeek: number, hour: number): boolean {
  if (!rule.is_active) return false
  if (rule.day_of_week !== null && rule.day_of_week !== dayOfWeek) return false
  if (rule.hour_from !== null && rule.hour_to !== null) {
    if (rule.hour_from <= rule.hour_to) {
      if (hour < rule.hour_from || hour >= rule.hour_to) return false
    } else {
      // Wraps midnight
      if (hour < rule.hour_from && hour >= rule.hour_to) return false
    }
  }
  return true
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: RequestBody = await req.json()
    const { zone_id, datetime_iso } = body

    if (!zone_id) {
      return new Response(JSON.stringify({ error: 'zone_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      }
    )

    // Resolve effective datetime in NZ timezone
    const targetIso = datetime_iso ?? new Date().toISOString()
    const { dayOfWeek, hour } = toNZDatetime(targetIso)

    // Fetch zone base fee
    const { data: zoneData, error: zoneErr } = await supabase
      .from('zones')
      .select('id, name, fee_nzd')
      .eq('id', zone_id)
      .single()

    if (zoneErr || !zoneData) {
      return new Response(JSON.stringify({ error: 'Zone not found', details: zoneErr?.message }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const zone = zoneData as ZoneRow
    const baseFee = zone.fee_nzd ?? 0

    // Fetch all active pricing rules for this org (zone-specific + org-wide)
    const { data: rulesData } = await supabase
      .from('pricing_rules')
      .select('id, zone_id, label, day_of_week, hour_from, hour_to, multiplier, flat_override_nzd, is_active')
      .or(`zone_id.eq.${zone_id},zone_id.is.null`)
      .eq('is_active', true)

    const rules: PricingRule[] = (rulesData ?? []) as PricingRule[]

    // Find best-matching rule
    const matching = rules
      .filter((r) => ruleMatches(r, dayOfWeek, hour))
      .sort((a, b) => ruleScore(b) - ruleScore(a))

    const bestRule = matching[0] ?? null

    let effectiveFee: number
    let appliedRuleId: string | null = null
    let appliedRuleLabel: string | null = null

    if (bestRule) {
      appliedRuleId = bestRule.id
      appliedRuleLabel = bestRule.label
      if (bestRule.flat_override_nzd !== null) {
        effectiveFee = bestRule.flat_override_nzd
      } else {
        effectiveFee = Math.round(baseFee * bestRule.multiplier * 100) / 100
      }
    } else {
      effectiveFee = baseFee
    }

    return new Response(
      JSON.stringify({
        zone_id: zone.id,
        zone_name: zone.name,
        base_fee_nzd: baseFee,
        effective_fee_nzd: effectiveFee,
        applied_rule_id: appliedRuleId,
        applied_rule_label: appliedRuleLabel,
        day_of_week: dayOfWeek,
        hour,
        evaluated_at: targetIso,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

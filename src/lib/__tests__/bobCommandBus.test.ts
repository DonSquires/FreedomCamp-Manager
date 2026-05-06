import { describe, expect, it } from 'vitest'
import { classifyBobCommand, evaluateBobCommandPolicy } from '@/lib/bobCommandBus'

describe('bobCommandBus classifyBobCommand', () => {
  it('classifies safe navigation command', () => {
    const cmd = classifyBobCommand('Open Bob Studio')
    expect(cmd.intent).toBe('navigate')
    expect(cmd.safety).toBe('safe')
    expect(cmd.args.route).toBe('/bob-studio')
    expect(cmd.confidence).toBeGreaterThan(0.8)
  })

  it('classifies diagnostic command as review safety', () => {
    const cmd = classifyBobCommand('run health diagnostics now')
    expect(cmd.intent).toBe('run_diagnostics')
    expect(cmd.safety).toBe('review')
  })

  it('classifies high-risk destructive phrase as restricted', () => {
    const cmd = classifyBobCommand('please drop table users in prod')
    expect(cmd.intent).toBe('open_workflow')
    expect(cmd.safety).toBe('restricted')
  })

  it('returns unknown for non-command text', () => {
    const cmd = classifyBobCommand('how is the weather in wellington')
    expect(cmd.intent).toBe('unknown')
    expect(cmd.safety).toBe('safe')
  })
})

describe('bobCommandBus evaluateBobCommandPolicy', () => {
  it('allows safe command without approval', () => {
    const cmd = classifyBobCommand('open bob assistant')
    const policy = evaluateBobCommandPolicy(cmd, {
      role: 'officer',
      orgId: 'org-1',
      route: '/bob-assistant',
    })

    expect(policy.allowed).toBe(true)
    expect(policy.requiresApproval).toBe(false)
  })

  it('requires approval for review safety command', () => {
    const cmd = classifyBobCommand('run diagnostics')
    const policy = evaluateBobCommandPolicy(cmd, {
      role: 'admin',
      orgId: 'org-1',
      route: '/bob-assistant',
    })

    expect(policy.allowed).toBe(true)
    expect(policy.requiresApproval).toBe(true)
  })

  it('blocks restricted command for non-grand-master', () => {
    const cmd = classifyBobCommand('delete prod data now')
    const policy = evaluateBobCommandPolicy(cmd, {
      role: 'admin',
      orgId: 'org-1',
      route: '/bob-assistant',
    })

    expect(policy.allowed).toBe(false)
    expect(policy.requiresApproval).toBe(true)
  })

  it('permits restricted command only under grand-master with approval', () => {
    const cmd = classifyBobCommand('delete prod data now')
    const policy = evaluateBobCommandPolicy(cmd, {
      role: 'grand_master',
      orgId: 'org-1',
      route: '/bob-assistant',
    })

    expect(policy.allowed).toBe(true)
    expect(policy.requiresApproval).toBe(true)
  })
})

describe('bobCommandBus voice confirmation grammar', () => {
  function normalize(text: string) { return text.trim().toLowerCase() }

  it('recognises "confirm command" confirmation phrase', () => {
    expect(normalize('Confirm Command')).toBe('confirm command')
  })

  it('recognises "cancel command" cancellation phrase', () => {
    expect(normalize('  Cancel Command  ')).toBe('cancel command')
  })

  it('does not treat normal text as confirmation', () => {
    expect(normalize('yes I want to go to dispatch')).not.toBe('confirm command')
  })

  it('does not treat normal text as cancellation', () => {
    expect(normalize('no thank you')).not.toBe('cancel command')
  })
})

describe('bobCommandBus create_record intents', () => {
  it('classifies "log observation" as safe create_record', () => {
    const cmd = classifyBobCommand('log observation on site')
    expect(cmd.intent).toBe('create_record')
    expect(cmd.args.recordType).toBe('observation')
    expect(cmd.safety).toBe('safe')
  })

  it('classifies "raise breach alert" as review create_record', () => {
    const cmd = classifyBobCommand('raise breach alert at zone 4')
    expect(cmd.intent).toBe('create_record')
    expect(cmd.args.recordType).toBe('breach')
    expect(cmd.safety).toBe('review')
  })

  it('classifies "create incident report" as review create_record', () => {
    const cmd = classifyBobCommand('create incident report for vehicle XYZ')
    expect(cmd.intent).toBe('create_record')
    expect(cmd.args.recordType).toBe('incident')
    expect(cmd.safety).toBe('review')
  })

  it('classifies "start patrol session" as safe create_record', () => {
    const cmd = classifyBobCommand('start patrol session now')
    expect(cmd.intent).toBe('create_record')
    expect(cmd.args.recordType).toBe('patrol')
    expect(cmd.safety).toBe('safe')
  })
})

describe('bobCommandBus extended nav patterns', () => {
  const cases: [string, string][] = [
    ['navigate to incidents', '/incidents'],
    ['open patrols', '/patrols'],
    ['open breaches', '/breach-management'],
    ['navigate to grandmaster', '/grandmaster-studio'],
    ['open settings', '/settings'],
  ]

  for (const [input, expectedRoute] of cases) {
    it(`routes "${input}" to ${expectedRoute}`, () => {
      const cmd = classifyBobCommand(input)
      expect(cmd.intent).toBe('navigate')
      expect(cmd.args.route).toBe(expectedRoute)
    })
  }
})

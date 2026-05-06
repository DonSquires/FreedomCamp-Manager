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

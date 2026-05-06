import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readWorkspaceFile(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath)
  return fs.readFileSync(absolute, 'utf-8')
}

describe('Bob governance regression guards', () => {
  it('enforces immutable system policy handling in onspace-ai-chat', () => {
    const source = readWorkspaceFile('supabase/functions/onspace-ai-chat/index.ts')

    expect(source).toContain('const immutableSystemPrompt =')
    expect(source).toContain('[Caller context note]')
    expect(source).toContain("messages = [{ role: 'system', content: immutableSystemPrompt }, ...prependedHistory, ...sanitizedMessages]")
    expect(source).toContain("{ role: 'system', content: immutableSystemPrompt }")

    // Prior bypass pattern must not return.
    expect(source).not.toContain("const hasSystem = rawMessages[0]?.role === 'system'")
  })

  it('keeps officer-assist command restriction in Bob Assistant Studio', () => {
    const source = readWorkspaceFile('src/pages/BobAssistantStudio.tsx')

    expect(source).toMatch(/effectivePolicy\.mode === 'officer_assist'[\s\S]*command\.intent !== 'unknown'/)
    expect(source).toContain('Officer assist mode is active.')
    expect(source).toContain('Please escalate to master/grand master for run actions.')
  })

  it('uses shared bobGateway contract across Bob UI surfaces', () => {
    const uiReviewSource = readWorkspaceFile('src/pages/BobUIReview.tsx')
    const bobStudioSource = readWorkspaceFile('src/pages/BobStudio.tsx')
    const aiAnalysisSource = readWorkspaceFile('src/pages/AiAnalysis.tsx')
    const bobAssistantSource = readWorkspaceFile('src/pages/BobAssistantStudio.tsx')

    expect(uiReviewSource).toContain('edgeFunctions.bobGateway(')
    expect(bobStudioSource).toContain('edgeFunctions.bobGateway(')

    for (const source of [uiReviewSource, bobStudioSource, aiAnalysisSource, bobAssistantSource]) {
      expect(source).not.toContain("supabase.functions.invoke('onspace-ai-chat'")
      expect(source).not.toContain('/functions/v1/onspace-ai-chat')
    }
  })

  it('injects grounded schema, route, and mutation summaries into bobGateway', () => {
    const gatewaySource = readWorkspaceFile('src/lib/edgeFunctions.ts')
    const schemaSource = readWorkspaceFile('src/lib/bobSchemaRegistry.ts')
    const routeMapSource = readWorkspaceFile('src/lib/bobRouteEntityMap.ts')
    const mutationCatalogSource = readWorkspaceFile('src/lib/bobMutationCatalog.ts')

    expect(schemaSource).toContain('export const BOB_SCHEMA_REGISTRY')
    expect(routeMapSource).toContain('export const BOB_ROUTE_ENTITY_MAP')
    expect(mutationCatalogSource).toContain('export const BOB_MUTATION_CATALOG')

    expect(gatewaySource).toContain('Bob operational map (grounded):')
    expect(gatewaySource).toContain('schema_registry_summary')
    expect(gatewaySource).toContain('route_entity_map_summary')
    expect(gatewaySource).toContain('mutation_catalog_summary')
    expect(gatewaySource).toContain("role: 'assistant' as const, content: operationalContextNote")
  })

  it('enforces mutation catalog policy and returns execution review metadata', () => {
    const gatewaySource = readWorkspaceFile('src/lib/edgeFunctions.ts')
    const mutationCatalogSource = readWorkspaceFile('src/lib/bobMutationCatalog.ts')
    const bobAssistantSource = readWorkspaceFile('src/pages/BobAssistantStudio.tsx')
    const aiAnalysisSource = readWorkspaceFile('src/pages/AiAnalysis.tsx')

    expect(mutationCatalogSource).toContain('export function assertBobMutationAccess')
    expect(gatewaySource).toContain('Bob mutation contract blocked by policy:')
    expect(gatewaySource).toContain('executionReview')
    expect(bobAssistantSource).toContain('Execution Review')
    expect(aiAnalysisSource).toContain('Execution Review')
  })

  it('enforces requested mutation contracts server-side for Bob mutation endpoints', () => {
    const onspaceSource = readWorkspaceFile('supabase/functions/onspace-ai-chat/index.ts')
    const grandmasterSource = readWorkspaceFile('supabase/functions/grandmaster-studio/index.ts')
    const codeTaskSource = readWorkspaceFile('supabase/functions/bob-code-change-task/index.ts')

    expect(onspaceSource).toContain('requested_mutation_contract')
    expect(onspaceSource).toContain('Mutation contract blocked by server policy:')

    expect(grandmasterSource).toContain('ACTION_MUTATION_CONTRACT_MAP')
    expect(grandmasterSource).toContain('Missing required mutation contract')
    expect(grandmasterSource).toContain('Mutation contract blocked by server policy:')

    expect(codeTaskSource).toContain('REQUIRED_MUTATION_CONTRACT')
    expect(codeTaskSource).toContain('Missing required mutation contract')
    expect(codeTaskSource).toContain('Mutation contract blocked by server policy:')
  })
})

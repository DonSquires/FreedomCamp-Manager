import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPromptGuardrails,
  buildSchemaAwareBlueprint,
  inferPortalTypeFromIntent,
} from './schemaContextRouter.js';

test('routes smoke intent to smoke assessment domain', () => {
  assert.equal(inferPortalTypeFromIntent('run smoke assessment for zone 4'), 'smoke_assessment');
});

test('builds minimized blueprint with selected tables', () => {
  const payload = [
    'table smoke_assessments(id uuid, zone_id uuid)',
    'table smoke_notices(id uuid, zone_id uuid)',
    'table zones(id uuid, name text)',
    'table properties(id uuid, address text)',
    'table access_credentials(id uuid)',
  ].join('\n');

  const result = buildSchemaAwareBlueprint({
    intentText: 'smoke compliance check',
    masterSchemaPayload: payload,
    maxBytes: 1024,
  });

  assert.equal(result.portalType, 'smoke_assessment');
  assert.match(result.minimizedSchema, /smoke_assessments/i);
  assert.match(result.minimizedSchema, /smoke_notices/i);
  assert.ok(result.bytes <= 1024);
});

test('truncates oversized prompts under strict byte policy', () => {
  const veryLargeBlueprint = 'table alpha(id uuid)\n'.repeat(2000);
  const userMessage = [
    'Reference Blueprints (Tier A):',
    veryLargeBlueprint,
    'System Operational Rules:',
    'Always use authenticated role context.',
  ].join('\n');

  const guarded = applyPromptGuardrails('', userMessage, {
    maxContextBytes: 4096,
    strictMode: true,
    fallbackAction: 'truncate_blueprints',
  });

  assert.equal(guarded.truncated, true);
  assert.ok(guarded.totalBytesAfter <= 4096);
  assert.match(guarded.userMessage, /TRUNCATED_BLUEPRINTS/);
});
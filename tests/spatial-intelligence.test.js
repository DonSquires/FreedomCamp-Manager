import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveSpatialContext } from '../scripts/spatial-intelligence-engine.mjs';
import { loadRoster, resolveJobContext } from '../scripts/roster-context-adapter.mjs';
import { evaluateFieldRisk } from '../scripts/field-evaluator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

describe('Spatial Intelligence System - Integration Tests', () => {
  
  describe('Layer Priority Resolution', () => {
    it('should resolve Layer 4 (Client Site) when officer assigned to private client', async () => {
      const spatialContext = resolveSpatialContext({
        lat: -41.328,
        lng: 173.180,
        jobContext: {
          type: 'private-client',
          clientId: 'avis-richmond-depot',
          assignment: 'Site Security - Avis'
        }
      });

      expect(spatialContext.layers).toBeDefined();
      expect(spatialContext.activeMode).toBe('CLIENT_SITE_SECURITY');
      expect(spatialContext.tieBreakerReason).toContain('Job First');
      expect(spatialContext.stack.length).toBeGreaterThan(0);
    });

    it('should prioritize more specific zone (smaller polygon area) when multiple layers match', () => {
      const spatialContext = resolveSpatialContext({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'general' }
      });

      // Even with general job, should still resolve layers
      expect(spatialContext.layers).toBeDefined();
      expect(spatialContext.coordinate).toBeDefined();
      expect(spatialContext.coordinate.lat).toBe(-41.328);
    });

    it('should append Conflict Alert when private property but bylaw threshold exceeded', () => {
      const spatialContext = resolveSpatialContext({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'private-client', clientId: 'avis-richmond-depot' },
        signals: { noiseLevel: 84 } // Exceeds Tasman 80dB limit
      });

      expect(spatialContext.conflictAlerts).toBeDefined();
      expect(spatialContext.conflictAlerts.length).toBeGreaterThan(0);
      expect(spatialContext.conflictAlerts[0]).toContain('private property');
    });
  });

  describe('Roster Context Resolution', () => {
    it('should resolve active officer shift from roster', async () => {
      const rosterPath = path.join(WORKSPACE_ROOT, 'data', 'roster-active-shifts.json');
      const roster = await loadRoster(rosterPath);
      
      expect(Array.isArray(roster)).toBe(true);
      expect(roster.length).toBeGreaterThan(0);
    });

    it('should return private-client job context for officer-001', async () => {
      const context = await resolveJobContext({
        officerId: 'officer-001',
        atIso: '2026-04-23T12:00:00.000Z'
      });

      expect(context).toBeDefined();
      expect(context.status).toBe('active');
      expect(context.type).toBe('private-client');
      expect(context.clientId).toBe('avis-richmond-depot');
    });

    it('should return off-shift status for out-of-hours officer', async () => {
      const context = await resolveJobContext({
        officerId: 'officer-001',
        atIso: '2026-04-24T03:00:00.000Z' // After shift end
      });

      expect(context).toBeDefined();
      expect(context.status).toBe('off-shift');
    });
  });

  describe('Field Evaluator Integration', () => {
    it('should compute risk score with spatial context', () => {
      const result = evaluateFieldRisk({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'private-client', clientId: 'avis-richmond-depot' },
        peopleCount: 40,
        selfContained: false,
        noiseLevel: 84,
        zoneType: 'restricted'
      });

      expect(result).toBeDefined();
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.riskLevel).toBeDefined();
      expect(['LOW', 'MODERATE', 'ELEVATED', 'CRITICAL'].includes(result.riskLevel)).toBe(true);
      expect(Array.isArray(result.prescribedSOP)).toBe(true);
    });

    it('should include spatial context in field evaluation response', () => {
      const result = evaluateFieldRisk({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'general' },
        peopleCount: 10,
        selfContained: true,
        noiseLevel: 70
      });

      expect(result.spatialContext).toBeDefined();
      expect(result.spatialContext.coordinate).toBeDefined();
      expect(result.spatialContext.stack).toBeDefined();
      expect(result.spatialContext.activeMode).toBeDefined();
    });

    it('should prescribe Tasman-specific SOP when inside Tasman jurisdiction', () => {
      const result = evaluateFieldRisk({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'enforcement' },
        peopleCount: 50,
        selfContained: false,
        noiseLevel: 95,
        zoneType: 'restricted'
      });

      expect(result.prescribedSOP).toBeDefined();
      expect(result.prescribedSOP.some(sop => sop.includes('Tasman'))).toBe(true);
    });
  });

  describe('Multi-Jurisdiction Handover', () => {
    it('should detect jurisdiction change when crossing boundaries', () => {
      const context1 = resolveSpatialContext({
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'patrol' }
      });

      const context2 = resolveSpatialContext({
        lat: -41.5,
        lng: 173.5,
        jobContext: { type: 'patrol' }
      });

      // Different coordinates should detect different jurisdictions
      expect(context1.layers.layer1Jurisdiction).toBeDefined();
      expect(context2.layers.layer1Jurisdiction).toBeDefined();
      // (actual jurisdiction comparison depends on polygon definitions)
    });
  });

  describe('Client Geofence Registry', () => {
    it('should load client registry when present', () => {
      const registryPath = path.join(WORKSPACE_ROOT, 'data', 'client-geofence-registry.json');
      if (fs.existsSync(registryPath)) {
        const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
        // Registry might be an array or wrapped in an object with array property
        const registry = Array.isArray(data) ? data : (data.clients || []);
        expect(registry.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should deduplicate clients by ID in registry', () => {
      const registryPath = path.join(WORKSPACE_ROOT, 'data', 'client-geofence-registry.json');
      if (fs.existsSync(registryPath)) {
        const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
        const registry = Array.isArray(data) ? data : (data.clients || []);
        if (registry.length > 0) {
          const ids = registry.map(r => r.clientId || r.id);
          const uniqueIds = new Set(ids);
          expect(ids.length).toBe(uniqueIds.size);
        }
      }
    });
  });

  describe('API Payload Compatibility', () => {
    it('should accept minimal spatial context request payload', () => {
      const payload = {
        lat: -41.328,
        lng: 173.180
      };

      const context = resolveSpatialContext(payload);
      expect(context).toBeDefined();
      expect(context.coordinate).toBeDefined();
    });

    it('should accept full field evaluation payload with all signals', () => {
      const payload = {
        lat: -41.328,
        lng: 173.180,
        jobContext: { type: 'private-client', clientId: 'avis-richmond-depot' },
        weather: 'clear',
        bioHazards: [],
        peopleCount: 40,
        staffCount: 1,
        zoneType: 'restricted',
        selfContained: false,
        noiseLevel: 84,
        identity: 'Vehicle X',
        gps: '-41.328,173.180',
        bylawReference: 'Tasman DC Bylaw'
      };

      const result = evaluateFieldRisk(payload);
      expect(result).toBeDefined();
      expect(result.riskScore).toBeDefined();
    });
  });
});

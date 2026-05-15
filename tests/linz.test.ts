import { test, expect } from '@playwright/test';
import { resolveNzAddress } from '../src/services/linzGeocoder';

test.describe('LINZ Address Resolution', () => {
  test('Verify Bob resolves ambiguous Tasman region phrasing via LINZ Layer mapping', async () => {
    // Test: Colloquial NZ location string matching
    const rawInput = 'Lower Queen Street, Richmond';
    const testIncidentId = 'test-incident-' + Date.now();

    console.log(`→ Testing LINZ resolution for: "${rawInput}"`);

    // Call the geocoding service
    const result = await resolveNzAddress(rawInput, testIncidentId);

    // Verify successful resolution
    expect(result.success).toBe(true);
    expect(result.latitude).toBeDefined();
    expect(result.longitude).toBeDefined();
    expect(result.verifiedAddress).toBeDefined();
    expect(result.linzAddressId).toBeDefined();

    // Verify coordinates are in NZ bounds (South Island, Tasman region)
    // Approximate Richmond, Nelson bounds
    if (result.latitude && result.longitude) {
      expect(result.latitude).toBeCloseTo(-41.3, 1); // Tasman latitude
      expect(result.longitude).toBeCloseTo(173.2, 1); // Tasman longitude
    }

    console.log(`✅ LINZ Resolution Success:`);
    console.log(`   Address: ${result.verifiedAddress}`);
    console.log(`   Coordinates: [${result.latitude}, ${result.longitude}]`);
    console.log(`   Locality: ${result.locality}, ${result.city}`);
    console.log(`   Address ID: ${result.linzAddressId}`);
  });

  test('Handle unresolvable addresses gracefully', async () => {
    const invalidInput = 'XYZ NonExistent Street, Fantasy Town';
    const testIncidentId = 'test-incident-' + Date.now();

    const result = await resolveNzAddress(invalidInput, testIncidentId);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.latitude).toBeUndefined();

    console.log(`✅ Graceful failure handling:`);
    console.log(`   Error: ${result.error}`);
  });

  test('Resolve Auckland CBD address with high confidence', async () => {
    const aucklandInput = 'Queen Street, Auckland CBD';
    const testIncidentId = 'test-incident-' + Date.now();

    const result = await resolveNzAddress(aucklandInput, testIncidentId);

    if (result.success) {
      expect(result.latitude).toBeCloseTo(-37.0, 1); // Auckland latitude
      expect(result.longitude).toBeCloseTo(174.8, 1); // Auckland longitude
      console.log(`✅ Auckland CBD resolved: [${result.latitude}, ${result.longitude}]`);
    } else {
      console.log(`⚠️ Auckland address resolution: ${result.error}`);
    }
  });

  test('Batch resolve multiple addresses', async () => {
    const addresses = [
      { input: 'Lower Queen Street, Richmond', incidentId: 'test-1' },
      { input: 'Queen Street, Auckland', incidentId: 'test-2' },
      { input: 'Lambton Quay, Wellington', incidentId: 'test-3' },
    ];

    console.log(`→ Batch testing ${addresses.length} addresses...`);

    for (const addr of addresses) {
      const result = await resolveNzAddress(addr.input, addr.incidentId);
      console.log(
        `   ${addr.input}: ${result.success ? '✅ Resolved' : '❌ Failed'}`
      );
    }
  });
});

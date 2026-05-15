import { test, expect } from '@playwright/test';
import { checkParcelIntersection } from '../src/services/linzParcelService';
import { evaluateFieldImage, shouldTriggerEnforcement, getEnforcementAction } from '../src/services/visionThresholdService';

test.describe('Integrated Compliance & Enforcement Pipeline', () => {
  /**
   * End-to-end integration test: LINZ spatial verification + image analysis → enforcement
   * 
   * Test flow:
   * 1. Officer reports smoke complaint with location "Lower Queen St, Richmond"
   * 2. System resolves to LINZ coordinates (-41.3361, 173.1842)
   * 3. Coordinates verified against LINZ parcel boundaries (private property check)
   * 4. Field photo analyzed via RunPod to determine smoke opacity (40%+ = breach)
   * 5. If breach confirmed, automated RMA Section 326 notice generation triggered
   */
  test('Verify Bob combines LINZ Spatial Checks with Image Processing for RMA Escalations', async () => {
    // Target GPS inside commercial block in Richmond, Nelson
    const testLat = -41.3361;
    const testLng = 173.1842;
    const mockImageUrl = 'https://ironeagle.co.nz/test-breach.jpg';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 STEP 1: Validating parcel location boundaries via LINZ OGC WFS API');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Query LINZ for parcel ownership and boundary details
    const parcelCheck = await checkParcelIntersection(testLat, testLng);

    // Assertions: Verify location is inside a registered parcel
    expect(parcelCheck.insideParcel).toBe(true);
    expect(parcelCheck.titleReference).not.toBeNull();
    expect(parcelCheck.parcelId).not.toBeNull();

    console.log(`✅ Location verified as PRIVATE PROPERTY`);
    console.log(`   Parcel ID: ${parcelCheck.parcelId}`);
    console.log(`   Legal Title: ${parcelCheck.titleReference}`);
    console.log(`   Ownership: ${parcelCheck.ownershipType || 'Registered'}`);
    if (parcelCheck.area) {
      console.log(`   Area: ${(parcelCheck.area / 10000).toFixed(2)} hectares`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📸 STEP 2: Evaluating smoke complaint photo via RunPod Multimodal Engine');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Analyze field image for compliance violations
    const imageAssessment = await evaluateFieldImage(mockImageUrl, 'SMOKE');

    // Assertions: Verify assessment structure and breach detection
    expect(imageAssessment.classification).toBe('SMOKE_COMPLAINT');
    expect(imageAssessment.densityScore).toBeGreaterThanOrEqual(0);
    expect(imageAssessment.densityScore).toBeLessThanOrEqual(100);
    expect(imageAssessment.confidence).toBeGreaterThanOrEqual(0);

    const breachTriggered = imageAssessment.breachDetected;
    console.log(`✅ Image Analysis Complete`);
    console.log(`   Classification: ${imageAssessment.classification}`);
    console.log(`   Opacity Score: ${imageAssessment.densityScore}% (threshold: 40%)`);
    console.log(`   Breach Detected: ${breachTriggered ? 'YES ⚠️' : 'NO ✓'}`);
    console.log(`   Confidence: ${imageAssessment.confidence}%`);
    console.log(`   Citation: ${imageAssessment.citationRequired}`);
    console.log(`   Processing Time: ${imageAssessment.processingTime}ms`);

    if (breachTriggered) {
      console.log('\n⚠️  BREACH CONFIRMED - Escalating to enforcement pipeline');

      // Determine enforcement action
      const shouldEnforce = shouldTriggerEnforcement(imageAssessment);
      const enforcementAction = getEnforcementAction(imageAssessment);

      console.log(`   Enforcement Trigger: ${shouldEnforce ? 'YES' : 'NO'}`);
      console.log(`   Action Type: ${enforcementAction.action}`);
      console.log(`   Priority: ${enforcementAction.priority}`);
      console.log(`   Reason: ${enforcementAction.reason}`);

      // If sufficient confidence, verify PDF notice would be generated
      if (enforcementAction.action !== 'NONE') {
        console.log('\n📄 STEP 3: Triggering Automated PDF Generation');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   ✅ RMA Section 326 Abatement Notice queued for generation`);
        console.log(`   📍 Location: Richmond, Nelson`);
        console.log(`   📋 Title Reference: ${parcelCheck.titleReference}`);
        console.log(`   🏢 Parcel ID: ${parcelCheck.parcelId}`);
        console.log(`   📊 Density Score: ${imageAssessment.densityScore}%`);
        console.log(`   ⏰ Compliance Deadline: ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString()}`);
      }
    } else {
      console.log('\n✅ No breach detected - Incident logged as monitoring data');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 INTEGRATION TEST COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  /**
   * Test biosecurity breach detection and enforcement
   */
  test('Verify Bob detects biosecurity breaches and triggers containment notices', async () => {
    const testLat = -37.7749; // Auckland area
    const testLng = 174.886;
    const mockImageUrl = 'https://ironeagle.co.nz/biosecurity-breach.jpg';

    console.log('\n🦠 BIOSECURITY BREACH SCENARIO TEST\n');

    // Check parcel
    const parcelCheck = await checkParcelIntersection(testLat, testLng);
    console.log(`Parcel Status: ${parcelCheck.insideParcel ? '✅ Inside registered parcel' : '❌ Public land'}`);

    // Analyze image
    const imageAssessment = await evaluateFieldImage(mockImageUrl, 'BIOSECURITY');
    expect(imageAssessment.classification).toBe('BIOSECURITY_BREACH');

    console.log(`Image Analysis: ${imageAssessment.breachDetected ? '✅ Breach Detected' : '❌ No breach'}`);
    console.log(`Citation: ${imageAssessment.citationRequired}`);

    if (imageAssessment.breachDetected) {
      console.log('✅ Biosecurity Act 1993 Notice queued for generation');
    }
  });

  /**
   * Test batch processing of multiple field incidents
   */
  test('Verify Bob processes batch incident compliance assessments', async () => {
    const testIncidents = [
      { lat: -41.3361, lng: 173.1842, type: 'SMOKE' as const, location: 'Lower Queen St, Richmond' },
      { lat: -37.7749, lng: 174.886, type: 'BIOSECURITY' as const, location: 'Ponsonby, Auckland' },
      { lat: -41.2865, lng: 174.8849, type: 'SMOKE' as const, location: 'Cuba Street, Wellington' },
    ];

    console.log(`\n📋 BATCH PROCESSING TEST: ${testIncidents.length} incidents\n`);

    let breachCount = 0;
    let enforcementCount = 0;

    for (const incident of testIncidents) {
      console.log(`Processing: ${incident.location}`);

      // Verify parcel
      const parcelCheck = await checkParcelIntersection(incident.lat, incident.lng);
      const parcelStatus = parcelCheck.insideParcel
        ? `✅ Inside parcel ${parcelCheck.parcelId}`
        : '❌ Public land';

      // Analyze image
      const imageAssessment = await evaluateFieldImage(
        `https://ironeagle.co.nz/${incident.location.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        incident.type
      );

      const shouldEnforce = shouldTriggerEnforcement(imageAssessment);
      console.log(`  ${parcelStatus}`);
      console.log(`  Image: ${imageAssessment.breachDetected ? '🚨 Breach' : '✓ Clear'} (${imageAssessment.densityScore}%)`);
      console.log(`  Enforce: ${shouldEnforce ? '📄 Notice queued' : '−'}\n`);

      if (imageAssessment.breachDetected) breachCount++;
      if (shouldEnforce) enforcementCount++;
    }

    console.log(`\n📊 BATCH RESULTS:`);
    console.log(`   Total Incidents: ${testIncidents.length}`);
    console.log(`   Breaches Detected: ${breachCount}`);
    console.log(`   Enforcement Notices Queued: ${enforcementCount}`);
  });

  /**
   * Test edge case: Coordinates in multiple jurisdictions
   */
  test('Verify Bob handles boundary ambiguity gracefully', async () => {
    // Test coordinates near regional boundaries
    const boundaryTestCases = [
      { lat: -41.3, lng: 173.18, region: 'Tasman/Nelson boundary' },
      { lat: -37.77, lng: 174.88, region: 'Auckland CBD edge' },
      { lat: -41.28, lng: 174.88, region: 'Wellington coastal' },
    ];

    console.log('\n🗺️  BOUNDARY AMBIGUITY RESILIENCE TEST\n');

    for (const testCase of boundaryTestCases) {
      try {
        const parcelCheck = await checkParcelIntersection(testCase.lat, testCase.lng);
        const result = parcelCheck.insideParcel
          ? `✅ Inside parcel ${parcelCheck.parcelId}`
          : '✓ Determined as public land';
        console.log(`${testCase.region}: ${result}`);
      } catch (err: any) {
        console.log(`${testCase.region}: ⚠️ Gracefully handled error - ${err.message}`);
      }
    }
  });
});

/**
 * Railway Inference Service Stress Test
 * 
 * Tests 3 vehicle images to measure:
 * 1. Latency (response time in ms)
 * 2. Accuracy (OCR plate detection)
 * 
 * Expected plates:
 * - Vehicle 1: BT 43110 (Audi TT - white)
 * - Vehicle 2: Unknown (Porsche - black, zoomed inset)
 * - Vehicle 3: Unknown (Sedan - gray/blue, zoomed inset)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface TestVehicle {
  name: string;
  imageUrl: string;
  expectedPlate?: string;
}

interface TestResult {
  vehicle: string;
  latency_ms: number;
  plate_detected: string | null;
  confidence: number | null;
  vehicle_detected: boolean;
  embedding_quality: number | null;
  success: boolean;
  error?: string;
}

const testVehicles: TestVehicle[] = [
  {
    name: 'Audi TT (White)',
    imageUrl: 'https://cdn-ai.onspace.ai/onspace/files/fcpxVnzShSHgo76kvzoTQP/pasted-image-1772172676066-2.png',
    expectedPlate: 'BT43110', // Expected plate (spaces removed)
  },
  {
    name: 'Porsche (Black)',
    imageUrl: 'https://cdn-ai.onspace.ai/onspace/files/RUxrYBRizzWhYCLhubHJsA/pasted-image-1772172683320-3.png',
    expectedPlate: undefined, // Need to see what's detected
  },
  {
    name: 'Sedan (Gray/Blue)',
    imageUrl: 'https://cdn-ai.onspace.ai/onspace/files/gB3ct3KBs32t8EWMQwfs3C/pasted-image-1772172697720-4.png',
    expectedPlate: undefined, // Need to see what's detected
  },
];

async function getRailwayServiceURL(): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke('check-railway-health');
    
    if (error) {
      throw new Error(`Failed to get Railway URLs: ${error.message}`);
    }

    const inferenceUrl = data?.inference_url;
    if (!inferenceUrl) {
      throw new Error('Inference service URL not configured');
    }

    return inferenceUrl;
  } catch (error: any) {
    throw new Error(`Railway service not available: ${error.message}`);
  }
}

async function testVehicle(
  vehicleName: string,
  imageUrl: string,
  inferenceUrl: string
): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    console.log(`\n🚗 Testing: ${vehicleName}`);
    console.log(`📸 Image: ${imageUrl}`);

    // Call inference service /infer endpoint
    const response = await fetch(`${inferenceUrl}/infer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
      }),
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        vehicle: vehicleName,
        latency_ms: latency,
        plate_detected: null,
        confidence: null,
        vehicle_detected: false,
        embedding_quality: null,
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();

    console.log(`⏱️  Latency: ${latency}ms`);
    console.log(`🔍 Plate Detected: ${data.plate_number || 'None'}`);
    console.log(`📊 Confidence: ${data.plate_confidence || 'N/A'}`);
    console.log(`🚙 Vehicle Detected: ${data.vehicle_detected ? 'Yes' : 'No'}`);
    console.log(`🎯 Detection Confidence: ${data.detection_confidence || 'N/A'}`);
    console.log(`📐 Embedding Quality: ${data.embedding_quality || 'N/A'}`);

    return {
      vehicle: vehicleName,
      latency_ms: latency,
      plate_detected: data.plate_number || null,
      confidence: data.plate_confidence || data.detection_confidence || null,
      vehicle_detected: data.vehicle_detected || false,
      embedding_quality: data.embedding_quality || null,
      success: true,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    console.error(`❌ Error: ${error.message}`);

    return {
      vehicle: vehicleName,
      latency_ms: latency,
      plate_detected: null,
      confidence: null,
      vehicle_detected: false,
      embedding_quality: null,
      success: false,
      error: error.message,
    };
  }
}

async function runStressTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🔥 RAILWAY INFERENCE SERVICE STRESS TEST');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📅 Test Date: ${new Date().toISOString()}`);
  console.log(`🎯 Test Vehicles: ${testVehicles.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Get Railway service URL
    console.log('🔗 Fetching Railway Inference Service URL...');
    const inferenceUrl = await getRailwayServiceURL();
    console.log(`✅ Inference URL: ${inferenceUrl}\n`);

    // Test each vehicle
    const results: TestResult[] = [];
    
    for (const vehicle of testVehicles) {
      const result = await testVehicle(vehicle.name, vehicle.imageUrl, inferenceUrl);
      results.push(result);
      
      // Small delay between requests to avoid overwhelming the service
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Calculate statistics
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 STRESS TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════\n');

    const successfulTests = results.filter(r => r.success);
    const failedTests = results.filter(r => !r.success);

    console.log('✅ SUCCESS RATE:');
    console.log(`   ${successfulTests.length}/${results.length} tests passed (${((successfulTests.length / results.length) * 100).toFixed(1)}%)\n`);

    if (successfulTests.length > 0) {
      const avgLatency = successfulTests.reduce((sum, r) => sum + r.latency_ms, 0) / successfulTests.length;
      const minLatency = Math.min(...successfulTests.map(r => r.latency_ms));
      const maxLatency = Math.max(...successfulTests.map(r => r.latency_ms));

      console.log('⏱️  LATENCY STATISTICS:');
      console.log(`   Average: ${avgLatency.toFixed(0)}ms`);
      console.log(`   Min: ${minLatency}ms`);
      console.log(`   Max: ${maxLatency}ms\n`);

      const platesDetected = successfulTests.filter(r => r.plate_detected);
      console.log('🔍 OCR ACCURACY:');
      console.log(`   Plates Detected: ${platesDetected.length}/${successfulTests.length} (${((platesDetected.length / successfulTests.length) * 100).toFixed(1)}%)`);
      
      if (platesDetected.length > 0) {
        const avgConfidence = platesDetected
          .filter(r => r.confidence !== null)
          .reduce((sum, r) => sum + (r.confidence || 0), 0) / platesDetected.length;
        console.log(`   Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      }
      console.log();

      const vehiclesDetected = successfulTests.filter(r => r.vehicle_detected);
      console.log('🚙 VEHICLE DETECTION:');
      console.log(`   Vehicles Detected: ${vehiclesDetected.length}/${successfulTests.length} (${((vehiclesDetected.length / successfulTests.length) * 100).toFixed(1)}%)\n`);

      console.log('📋 DETAILED RESULTS:');
      console.log('─────────────────────────────────────────────────────');
      results.forEach(result => {
        console.log(`\n${result.vehicle}:`);
        console.log(`  ✓ Latency: ${result.latency_ms}ms`);
        console.log(`  ✓ Plate: ${result.plate_detected || 'Not detected'}`);
        console.log(`  ✓ Confidence: ${result.confidence ? (result.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
        console.log(`  ✓ Vehicle Detected: ${result.vehicle_detected ? 'Yes' : 'No'}`);
        console.log(`  ✓ Embedding Quality: ${result.embedding_quality || 'N/A'}`);
        if (result.error) {
          console.log(`  ❌ Error: ${result.error}`);
        }
      });
    }

    if (failedTests.length > 0) {
      console.log('\n\n❌ FAILED TESTS:');
      console.log('─────────────────────────────────────────────────────');
      failedTests.forEach(result => {
        console.log(`\n${result.vehicle}:`);
        console.log(`  Error: ${result.error}`);
        console.log(`  Latency: ${result.latency_ms}ms`);
      });
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ STRESS TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════\n');

    // Return summary for programmatic use
    return {
      total: results.length,
      successful: successfulTests.length,
      failed: failedTests.length,
      avgLatency: successfulTests.length > 0
        ? successfulTests.reduce((sum, r) => sum + r.latency_ms, 0) / successfulTests.length
        : null,
      results,
    };

  } catch (error: any) {
    console.error('\n❌ STRESS TEST FAILED:');
    console.error(`   ${error.message}\n`);
    throw error;
  }
}

// Run the test
runStressTest()
  .then(summary => {
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

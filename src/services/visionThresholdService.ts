/**
 * Vision Threshold Service
 * Processes field imagery using RunPod Serverless multimodal engine
 * Outputs strict risk classification integers for automated compliance enforcement
 * Stage 2b of the 3-stage dispatch verification pipeline
 */

export interface AssessmentMatrix {
  classification: 'SMOKE_COMPLAINT' | 'BIOSECURITY_BREACH' | 'UNKNOWN';
  densityScore: number; // Range 0-100
  breachDetected: boolean;
  citationRequired: string;
  confidence: number; // Range 0-100
  processingTime: number; // milliseconds
}

const RUNPOD_ENDPOINT = process.env.VITE_RUNPOD_SERVERLESS_ENDPOINT_URL;
const RUNPOD_API_KEY = process.env.VITE_RUNPOD_API_KEY;

/**
 * Evaluates field imagery against strict compliance thresholds
 * Returns RMA citation requirements if breach detected
 */
export async function evaluateFieldImage(
  imageUrl: string,
  classificationType: 'SMOKE' | 'BIOSECURITY'
): Promise<AssessmentMatrix> {
  const startTime = Date.now();

  try {
    if (!RUNPOD_ENDPOINT || !RUNPOD_API_KEY) {
      throw new Error('RunPod configuration missing from environment');
    }

    // Dispatch payload to serverless Vision inference template on RunPod
    const runpodResponse = await fetch(
      `${RUNPOD_ENDPOINT}/runsync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
        body: JSON.stringify({
          input: {
            image: imageUrl,
            task: classificationType,
            system_prompt:
              'Analyze enforcement imagery matching NZ RMA parameters. Output strictly structured JSON.',
          },
        }),
      }
    );

    if (!runpodResponse.ok) {
      throw new Error(
        `RunPod API failed with status: ${runpodResponse.status}`
      );
    }

    const rawResult = await runpodResponse.json();
    const assessment = rawResult.output;

    // Apply strict compliance thresholds to determine breach status
    let breachDetected = false;
    let citationRequired = 'None';
    let densityScore = assessment.densityScore || 0;

    if (classificationType === 'SMOKE') {
      // Threshold: Smoke opacity matching Ringelmann density index scales >= 40% triggers RMA s326
      breachDetected = densityScore >= 40;
      citationRequired = breachDetected
        ? 'Resource Management Act (RMA) Section 326'
        : 'None';
    } else if (classificationType === 'BIOSECURITY') {
      // Binary presence trigger for classified biosecurity hazards
      breachDetected = assessment.hazardDetected === true;
      citationRequired = breachDetected
        ? 'Biosecurity Act 1993 Controls'
        : 'None';
    }

    const processingTime = Date.now() - startTime;

    return {
      classification:
        classificationType === 'SMOKE'
          ? 'SMOKE_COMPLAINT'
          : 'BIOSECURITY_BREACH',
      densityScore,
      breachDetected,
      citationRequired,
      confidence: assessment.confidence || 0,
      processingTime,
    };
  } catch (error: any) {
    console.error('Vision Threshold Processing Error:', error.message);

    // Return safe default: no breach assumed on processing failure
    return {
      classification: 'UNKNOWN',
      densityScore: 0,
      breachDetected: false,
      citationRequired: 'Error: Processing Failed',
      confidence: 0,
      processingTime: Date.now() - startTime,
    };
  }
}

/**
 * Batch process multiple images
 */
export async function evaluateFieldImageBatch(
  images: Array<{ url: string; type: 'SMOKE' | 'BIOSECURITY' }>
): Promise<AssessmentMatrix[]> {
  return Promise.all(images.map(({ url, type }) => evaluateFieldImage(url, type)));
}

/**
 * Determine if assessment should trigger automated enforcement notice
 */
export function shouldTriggerEnforcement(assessment: AssessmentMatrix): boolean {
  // Triggers when breach detected AND confidence sufficient
  return assessment.breachDetected && assessment.confidence >= 70;
}

/**
 * Map assessment to RMA enforcement action
 */
export function getEnforcementAction(assessment: AssessmentMatrix): {
  action: 'NOTICE' | 'CITATION' | 'NONE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
} {
  if (!shouldTriggerEnforcement(assessment)) {
    return {
      action: 'NONE',
      priority: 'LOW',
      reason: 'Assessment below enforcement threshold',
    };
  }

  if (assessment.densityScore >= 70) {
    return {
      action: 'CITATION',
      priority: 'HIGH',
      reason: `High-severity breach (${assessment.densityScore}%) - ${assessment.citationRequired}`,
    };
  }

  return {
    action: 'NOTICE',
    priority: 'MEDIUM',
    reason: `Moderate breach (${assessment.densityScore}%) - ${assessment.citationRequired}`,
  };
}

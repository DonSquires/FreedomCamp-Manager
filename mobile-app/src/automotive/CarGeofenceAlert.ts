/**
 * CarGeofenceAlert
 * Android Auto voice warning module that triggers when a patrol vehicle
 * enters a LINZ-verified high-risk parcel boundary.
 *
 * Integrates with:
 *  - linzParcelService  → authoritative NZ parcel data (LINZ Layer 50785)
 *  - Railway Bob API    → risk ledger for known high-risk parcel IDs
 *  - Android Auto TTS   → in-vehicle voice announcement via car speakers
 */

import { checkParcelIntersection } from '../services/linzParcelService';

/** Minimal typing for the react-native-android-auto CarContext surface */
interface CarAndroidAutoContext {
  env: {
    RAILWAY_BOB_API_URL: string;
  };
  getCarService(serviceId: string): CarTtsModule | null;
}

interface CarTtsModule {
  speak(
    message: string,
    options: { queueMode: number; streamType: number }
  ): void;
}

interface ParcelRiskResponse {
  isHighRisk: boolean;
  riskLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason?: string;
  lastIncidentDate?: string;
}

const CAR_TTS_SERVICE = 'car_text_to_speech_service';

export class CarGeofenceAlert {
  private readonly carContext: CarAndroidAutoContext;
  private lastCheckedParcelId: string | null = null;
  private isProcessing = false;

  constructor(context: CarAndroidAutoContext) {
    this.carContext = context;
  }

  /**
   * Called on every GPS coordinate update from the vehicle hardware.
   * Debounces concurrent calls and only re-queries when the parcel changes.
   */
  public async evaluateCarMovement(
    latitude: number,
    longitude: number
  ): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Stage 1: Cross-reference coordinates with LINZ Parcel boundaries API
      const parcelResult = await checkParcelIntersection(latitude, longitude);

      if (
        parcelResult.insideParcel &&
        parcelResult.parcelId !== null &&
        parcelResult.parcelId !== this.lastCheckedParcelId
      ) {
        this.lastCheckedParcelId = parcelResult.parcelId;

        // Stage 2: Query Bob's operational risk ledger for this parcel
        const riskData = await this.fetchParcelRisk(parcelResult.parcelId);

        if (riskData?.isHighRisk) {
          const level = riskData.riskLevel ?? 'HIGH';
          const reason = riskData.reason ?? 'prior enforcement history';

          // Stage 3: Announce alert via vehicle speaker system
          this.triggerAutomotiveVoiceAlert(
            `Warning. Entering ${level.toLowerCase()} risk boundary zone. ` +
            `Title number ${parcelResult.titleReference ?? 'unknown'}. ` +
            `Risk assessment: ${reason}. Bob recommends securing immediate backup.`
          );
        }
      } else if (!parcelResult.insideParcel) {
        // Clear tracking index when on public road or unregistered land
        this.lastCheckedParcelId = null;
      }
    } catch (err) {
      console.error('Automotive geofence evaluation failed:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fetch parcel risk classification from Railway Bob API
   */
  private async fetchParcelRisk(
    parcelId: string
  ): Promise<ParcelRiskResponse | null> {
    try {
      const url = `${this.carContext.env.RAILWAY_BOB_API_URL}/api/parcel-risk/${encodeURIComponent(parcelId)}`;
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 s timeout; car UI cannot block
      });

      if (!response.ok) return null;
      return (await response.json()) as ParcelRiskResponse;
    } catch {
      // Non-fatal: network unavailable in remote areas is expected
      return null;
    }
  }

  /**
   * Route a text string to the Android Auto Text-To-Speech engine.
   * Uses STREAM_ALARM (type 4) priority so the alert overrides active audio.
   */
  private triggerAutomotiveVoiceAlert(message: string): void {
    const carTts = this.carContext.getCarService(CAR_TTS_SERVICE);

    if (carTts) {
      carTts.speak(message, {
        queueMode: 0,   // QUEUE_FLUSH — interrupt any current speech immediately
        streamType: 4,  // STREAM_ALARM — highest in-vehicle audio priority
      });
    } else {
      console.warn(
        'CarGeofenceAlert: vehicle TTS module unavailable — cannot announce geofence warning'
      );
    }
  }

  /** Reset tracking state (e.g. on shift start or app resume) */
  public reset(): void {
    this.lastCheckedParcelId = null;
    this.isProcessing = false;
  }
}

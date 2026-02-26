import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { v4 as uuidv4 } from 'uuid';

export const PlateScanner = ({ zoneId }: { zoneId: string | null }) => {
  const [uploading, setUploading] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);

  const handleCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || event.target.files.length === 0) return;
      
      const file = event.target.files[0];
      setUploading(true);
      setScanResult(null);

      // 1. REQUISITE: Upload to Storage First (Evidence Retention)
      const fileName = `${zoneId || 'unknown'}/${new Date().toISOString()}_${uuidv4()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('evidence_bin') // New restricted bucket
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // 2. EXECUTE: Call Unified Edge Function
      // This matches your 'plate-scanner-complete' spec
      const { data: functionData, error: functionError } = await supabase.functions
        .invoke('plate-scanner-complete', {
          body: { 
            image_path: uploadData.path,
            zone_id: zoneId,
            gps_lat: -41.2, // Replace with real navigator.geolocation
            gps_lng: 174.7 
          }
        });

      if (functionError) throw functionError;

      // 3. RESULT: Display Compliance Data (from 'compliance_results' join)
      setScanResult(functionData);

    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Camera Trigger */}
      <div className="border-2 border-dashed border-gray-400 rounded-xl p-8 text-center bg-white">
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          onChange={handleCapture}
          className="hidden" 
          id="cameraInput"
          disabled={uploading}
        />
        <label htmlFor="cameraInput" className="block w-full h-full cursor-pointer">
          {uploading ? (
            <div className="text-blue-600 font-bold animate-pulse">Processing...</div>
          ) : (
            <div className="text-gray-600">
              <div className="text-4xl mb-2">📷</div>
              <span className="font-semibold">Tap to Scan Vehicle</span>
            </div>
          )}
        </label>
      </div>

      {/* Result Card - Driven by 'compliance_results' schema */}
      {scanResult && (
        <div className={`p-4 rounded-lg border-l-4 shadow-sm bg-white ${
          scanResult.is_compliant ? 'border-green-500' : 'border-red-500'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-2xl font-bold font-mono">{scanResult.plate_number}</h3>
              <p className="text-sm text-gray-500">{scanResult.vehicle_make} • {scanResult.vehicle_color}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-white text-sm font-bold ${
              scanResult.is_compliant ? 'bg-green-600' : 'bg-red-600'
            }`}>
              {scanResult.is_compliant ? 'COMPLIANT' : 'BREACH'}
            </span>
          </div>

          {/* Breach Details (if any) */}
          {!scanResult.is_compliant && (
            <div className="mt-4 p-3 bg-red-50 text-red-800 text-sm rounded">
              <strong>Violation:</strong> {scanResult.breach_reason}
              <br />
              <button className="mt-2 w-full bg-red-600 text-white py-2 rounded font-bold">
                Issue Infringement
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

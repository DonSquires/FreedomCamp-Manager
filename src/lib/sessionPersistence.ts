/**
 * Session Persistence Utilities
 * Save/restore scan history across app reloads
 */

import { SessionScan } from '@/components/features/SessionList';

const SESSION_STORAGE_KEY = 'field_officer_session';
const SESSION_START_KEY = 'session_start_time';

export interface SessionData {
  scans: SessionScan[];
  startTime: number;
  lastUpdate: number;
  totalScans: number;
  complianceRate: number;
  flaggedCount: number;
  zonesCovered: string[];
}

/**
 * Save session data to localStorage
 */
export function saveSession(scans: SessionScan[]): void {
  try {
    const startTime = getSessionStartTime();
    const compliantCount = scans.filter(s => s.isCompliant).length;
    const flaggedCount = scans.filter(s => s.isFlagged).length;
    const zonesCovered = Array.from(new Set(scans.map(s => s.zoneName)));

    const sessionData: SessionData = {
      scans,
      startTime,
      lastUpdate: Date.now(),
      totalScans: scans.length,
      complianceRate: scans.length > 0 ? Math.round((compliantCount / scans.length) * 100) : 0,
      flaggedCount,
      zonesCovered,
    };

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

/**
 * Load session data from localStorage
 * Automatically removes records older than 24 hours
 */
export function loadSession(): SessionData | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return null;

    const data: SessionData = JSON.parse(stored);
    
    // Convert timestamp strings back to Date objects
    data.scans = data.scans.map(scan => ({
      ...scan,
      timestamp: new Date(scan.timestamp),
    }));

    // Filter out records older than 24 hours (24-hour retention per record)
    const now = Date.now();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    
    const filteredScans = data.scans.filter(scan => {
      const scanTime = new Date(scan.timestamp).getTime();
      return scanTime >= twentyFourHoursAgo;
    });
    
    // Log cleanup if any records were removed
    const removed = data.scans.length - filteredScans.length;
    if (removed > 0) {
      console.log(`🧹 24-hour retention cleanup: Removed ${removed} expired record${removed !== 1 ? 's' : ''}`);
    }
    
    // Update with filtered scans
    data.scans = filteredScans;
    data.totalScans = filteredScans.length;
    
    // Recalculate stats with filtered data
    const compliantCount = filteredScans.filter(s => s.isCompliant).length;
    data.complianceRate = filteredScans.length > 0 ? Math.round((compliantCount / filteredScans.length) * 100) : 0;
    data.flaggedCount = filteredScans.filter(s => s.isFlagged).length;
    data.zonesCovered = Array.from(new Set(filteredScans.map(s => s.zoneName)));
    
    // Save filtered data back to localStorage
    if (filteredScans.length > 0) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } else {
      // Clear storage if no records left
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }

    return data;
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
}

/**
 * Clear session data
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(SESSION_START_KEY);
  } catch (error) {
    console.error('Failed to clear session:', error);
  }
}

/**
 * Get or initialize session start time
 */
export function getSessionStartTime(): number {
  try {
    const stored = localStorage.getItem(SESSION_START_KEY);
    if (stored) {
      return parseInt(stored, 10);
    }

    const now = Date.now();
    localStorage.setItem(SESSION_START_KEY, now.toString());
    return now;
  } catch (error) {
    console.error('Failed to get session start time:', error);
    return Date.now();
  }
}

/**
 * Get session duration in minutes
 */
export function getSessionDuration(): number {
  const startTime = getSessionStartTime();
  const now = Date.now();
  return Math.floor((now - startTime) / 60000);
}

/**
 * Get time remaining until record expires (24 hours from scan time)
 * @param scanTimestamp - The timestamp when the record was scanned
 * @returns Object with hours, minutes remaining, and expired flag
 */
export function getTimeUntilExpiry(scanTimestamp: Date): {
  hours: number;
  minutes: number;
  expired: boolean;
  totalMinutes: number;
} {
  const now = Date.now();
  const scanTime = new Date(scanTimestamp).getTime();
  const expiryTime = scanTime + (24 * 60 * 60 * 1000); // 24 hours from scan
  const remainingMs = expiryTime - now;
  
  if (remainingMs <= 0) {
    return { hours: 0, minutes: 0, expired: true, totalMinutes: 0 };
  }
  
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  return { hours, minutes, expired: false, totalMinutes };
}

/**
 * Format time until expiry as human-readable string
 */
export function formatTimeUntilExpiry(scanTimestamp: Date): string {
  const { hours, minutes, expired } = getTimeUntilExpiry(scanTimestamp);
  
  if (expired) {
    return 'Expired';
  }
  
  if (hours >= 1) {
    return `${hours}h ${minutes}m remaining`;
  }
  
  return `${minutes}m remaining`;
}

/**
 * Export session data as CSV with full import compatibility
 * Format matches import-historical-data Edge Function requirements
 */
export function exportSessionCSV(scans: SessionScan[]): string {
  const headers = [
    'legacy_id',
    'source_table',
    'plate_text',
    'happened_at',
    'zone_id',
    'zone_name',
    'organization_id',
    'gps_latitude',
    'gps_longitude',
    'gps_accuracy',
    'vehicle_make',
    'vehicle_model',
    'vehicle_color',
    'self_contained',
    'is_compliant',
    'homelessness_status',
    'hs_issues',
    'image_links',
    'notes',
    'recorded_by_email',
    'detection_confidence',
    'plate_source',
    'is_flagged',
    'requires_followup',
    'prior_observations_count',
  ];

  const rows = scans.map(scan => [
    scan.id || '',
    'session_export',
    scan.plateNumber || '',
    scan.timestamp.toISOString(),
    scan.zoneId || '',
    scan.zoneName || '',
    scan.organizationId || '',
    '', // gps_latitude - requires additional data
    '', // gps_longitude - requires additional data
    scan.gpsAccuracy?.toString() || '',
    scan.vehicleMake || '',
    scan.vehicleModel || '',
    scan.vehicleColor || '',
    scan.isSelfContained ? 'true' : 'false',
    scan.isCompliant ? 'true' : 'false',
    scan.isHomeless ? 'confirmed' : 'unknown',
    scan.hasHSIssue ? 'true' : 'false',
    '', // image_links - requires additional data from database
    '', // notes - requires additional data
    '', // recorded_by_email - requires user lookup
    '', // detection_confidence
    scan.detectionMethod || 'manual',
    scan.isFlagged ? 'true' : 'false',
    scan.requiresFollowup ? 'true' : 'false',
    scan.priorObservationsCount?.toString() || '0',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      const escaped = cell.replace(/"/g, '""');
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(',')),
  ].join('\n');

  return csv;
}

/**
 * Export session data as JSON
 */
export function exportSessionJSON(scans: SessionScan[]): string {
  const sessionData: SessionData = {
    scans,
    startTime: getSessionStartTime(),
    lastUpdate: Date.now(),
    totalScans: scans.length,
    complianceRate: scans.length > 0 
      ? Math.round((scans.filter(s => s.isCompliant).length / scans.length) * 100) 
      : 0,
    flaggedCount: scans.filter(s => s.isFlagged).length,
    zonesCovered: Array.from(new Set(scans.map(s => s.zoneName))),
  };

  return JSON.stringify(sessionData, null, 2);
}

/**
 * Download file to device
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download file:', error);
    throw error;
  }
}

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flag,
  FileDown,
  Loader2,
  Car,
  TrendingUp,
  Calendar,
  Home,
  Shield,
  Camera,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useZones } from '@/hooks/useZones';
import { format, subDays, addDays } from 'date-fns';

interface VehicleObservation {
  observation_id: string;
  plate_number: string;
  zone_id: string;
  recorded_at: string;
  is_compliant: boolean;
  self_contained: boolean;
  officer_notes: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  breach_warning: boolean;
  breach_type: string | null;
  photo: string | null;
}

interface SessionStats {
  totalVehicles: number;
  compliantVehicles: number;
  nonCompliantVehicles: number;
  complianceRate: number;
  zonesCovered: string[];
  followupsRequested: number;
  urgentFollowups: number;
  selfContainedChecks: number;
  homelessEncounters: number;
  behavioralIssues: number;
  evidencePhotos: number;
  firstCheckTime: string | null;
  lastCheckTime: string | null;
  duration: string;
}

// Helper function to get operational day start (6am)
const getOperationalDayStart = (date: Date): Date => {
  const opDay = new Date(date);
  opDay.setHours(6, 0, 0, 0);
  return opDay;
};

// Helper function to get operational day end (6am next day)
const getOperationalDayEnd = (date: Date): Date => {
  const opDay = new Date(date);
  opDay.setDate(opDay.getDate() + 1);
  opDay.setHours(6, 0, 0, 0);
  return opDay;
};

// Get previous operational day (yesterday 6am to today 6am)
const getPreviousOperationalDay = (): Date => {
  const now = new Date();
  const currentHour = now.getHours();
  
  // If it's before 6am, use day before yesterday
  // If it's after 6am, use yesterday
  if (currentHour < 6) {
    return subDays(now, 2);
  } else {
    return subDays(now, 1);
  }
};

export function PatrolSessionSummary() {
  const { user } = useAuthStore();
  const { data: zones = [] } = useZones();
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [records, setRecords] = useState<VehicleObservation[]>([]);
  
  // Default to previous operational day
  const [selectedDate, setSelectedDate] = useState<Date>(getPreviousOperationalDay());
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [useCustomRange, setUseCustomRange] = useState(false);
  
  const [stats, setStats] = useState<SessionStats>({
    totalVehicles: 0,
    compliantVehicles: 0,
    nonCompliantVehicles: 0,
    complianceRate: 0,
    zonesCovered: [],
    followupsRequested: 0,
    urgentFollowups: 0,
    selfContainedChecks: 0,
    homelessEncounters: 0,
    behavioralIssues: 0,
    evidencePhotos: 0,
    firstCheckTime: null,
    lastCheckTime: null,
    duration: '0h 0m',
  });

  useEffect(() => {
    if (useCustomRange && startDate && endDate) {
      loadCustomRangeSummary();
    } else {
      loadDaySummary();
    }
  }, [user, selectedDate, useCustomRange, startDate, endDate]);

  const loadDaySummary = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      // Operational day: 6am to 6am next day
      const opDayStart = getOperationalDayStart(selectedDate);
      const opDayEnd = getOperationalDayEnd(selectedDate);

      console.log('Loading patrol summary for operational day:');
      console.log('Start:', opDayStart.toISOString());
      console.log('End:', opDayEnd.toISOString());

      const { data, error } = await supabase
        .from('observations')
        .select('*')
        .eq('recorded_by', user.id)
        .gte('recorded_at', opDayStart.toISOString())
        .lt('recorded_at', opDayEnd.toISOString())
        .order('recorded_at', { ascending: true });

      if (error) throw error;

      processRecords(data || []);
    } catch (error: any) {
      toast.error('Failed to load summary: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadCustomRangeSummary = async () => {
    if (!user || !startDate || !endDate) return;

    setIsLoading(true);
    try {
      const rangeStart = new Date(startDate);
      rangeStart.setHours(6, 0, 0, 0);
      
      const rangeEnd = new Date(endDate);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      rangeEnd.setHours(6, 0, 0, 0);

      console.log('Loading patrol summary for custom range:');
      console.log('Start:', rangeStart.toISOString());
      console.log('End:', rangeEnd.toISOString());

      const { data, error } = await supabase
        .from('observations')
        .select('*')
        .eq('recorded_by', user.id)
        .gte('recorded_at', rangeStart.toISOString())
        .lt('recorded_at', rangeEnd.toISOString())
        .order('recorded_at', { ascending: true });

      if (error) throw error;

      processRecords(data || []);
    } catch (error: any) {
      toast.error('Failed to load summary: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const processRecords = async (vehicleRecords: VehicleObservation[]) => {
    setRecords(vehicleRecords);

    // Get real-time compliance statistics for this patrol session
    const opDayStart = useCustomRange && startDate
      ? new Date(startDate)
      : getOperationalDayStart(selectedDate);
    opDayStart.setHours(6, 0, 0, 0);

    const opDayEnd = useCustomRange && endDate
      ? new Date(endDate)
      : getOperationalDayEnd(selectedDate);
    opDayEnd.setDate(opDayEnd.getDate() + 1);
    opDayEnd.setHours(6, 0, 0, 0);

    let realTimeCompliance: any = null;
    try {
      const { data } = await supabase.functions.invoke('get-compliance-statistics', {
        body: {
          organizationId: user?.organization_id || 'all',
          startDate: opDayStart.toISOString().split('T')[0],
          endDate: opDayEnd.toISOString().split('T')[0],
        },
      });
      realTimeCompliance = data?.stats;
    } catch (error) {
      console.error('Failed to load real-time compliance:', error);
    }

    // Calculate statistics (use real-time if available, otherwise calculate from records)
    const totalVehicles = vehicleRecords.length;
    const compliantVehicles = realTimeCompliance?.compliantVehicles ?? vehicleRecords.filter(r => r.is_compliant).length;
    const nonCompliantVehicles = realTimeCompliance?.nonCompliantVehicles ?? (totalVehicles - compliantVehicles);
    const complianceRate = realTimeCompliance?.averageComplianceRate ?? (totalVehicles > 0 ? (compliantVehicles / totalVehicles) * 100 : 0);

    const uniqueZones = [...new Set(vehicleRecords.map(r => r.zone_id))];
    const followupsRequested = vehicleRecords.filter(r => r.requires_followup).length;
    const urgentFollowups = vehicleRecords.filter(
      r => r.requires_followup && (r.followup_priority === 'high' || r.followup_priority === 'urgent')
    ).length;
    const selfContainedChecks = vehicleRecords.filter(r => r.self_contained).length;
    const homelessEncounters = vehicleRecords.filter(r => 
      r.officer_notes?.toLowerCase().includes('homeless') || r.has_homeless_claim
    ).length;
    const behavioralIssues = vehicleRecords.filter(r => 
      r.breach_warning || r.has_incident
    ).length;
    const evidencePhotos = vehicleRecords.filter(r => r.photo).length;

    let duration = '0h 0m';
    let firstCheckTime = null;
    let lastCheckTime = null;

    if (vehicleRecords.length > 0) {
      firstCheckTime = vehicleRecords[0].recorded_at;
      lastCheckTime = vehicleRecords[vehicleRecords.length - 1].recorded_at;

      const first = new Date(firstCheckTime);
      const last = new Date(lastCheckTime);
      const diffMs = last.getTime() - first.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      duration = `${hours}h ${minutes}m`;
    }

    setStats({
      totalVehicles,
      compliantVehicles,
      nonCompliantVehicles,
      complianceRate,
      zonesCovered: uniqueZones,
      followupsRequested,
      urgentFollowups,
      selfContainedChecks,
      homelessEncounters,
      behavioralIssues,
      evidencePhotos,
      firstCheckTime,
      lastCheckTime,
      duration,
    });
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    try {
      toast.info('📸 Generating report with photos...');

      // Group records by zone for better organization
      const recordsByZone = stats.zonesCovered.map(zoneId => {
        const zone = zones.find(z => z.id === zoneId);
        const zoneRecords = records.filter(r => r.zone_id === zoneId);
        return { zone, records: zoneRecords };
      });

      // Convert evidence photos to base64 for embedding
      const recordsWithPhotos = await Promise.all(
        records.map(async (record) => {
          if (!record.photo) {
            return { ...record, photosBase64: [] };
          }

          try {
            const response = await fetch(record.photo);
            const blob = await response.blob();
            const photoBase64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            return { ...record, photosBase64: [photoBase64] };
          } catch (err) {
            console.error('Failed to load photo:', record.photo, err);
            return { ...record, photosBase64: [] };
          }
        })
      );

      const reportDateRange = useCustomRange && startDate && endDate
        ? `${format(new Date(startDate), 'MMM d, yyyy')} - ${format(new Date(endDate), 'MMM d, yyyy')}`
        : `${format(getOperationalDayStart(selectedDate), 'MMM d, yyyy')} 06:00 - ${format(getOperationalDayEnd(selectedDate), 'MMM d, yyyy')} 06:00`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Patrol Report - ${reportDateRange}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: Arial, Helvetica, sans-serif;
              padding: 20px;
              max-width: 900px;
              margin: 0 auto;
              background: white;
              color: #000;
            }
            .header {
              text-align: center;
              border-bottom: 4px solid #000;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
              color: #000;
            }
            .header p {
              margin: 5px 0;
              color: #333;
              font-size: 14px;
            }
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 15px;
              margin-bottom: 30px;
            }
            .stat-card {
              border: 2px solid #000;
              padding: 15px;
              text-align: center;
              background: #f9f9f9;
            }
            .stat-label {
              font-size: 11px;
              color: #666;
              text-transform: uppercase;
              margin-bottom: 8px;
              font-weight: 600;
            }
            .stat-value {
              font-size: 32px;
              font-weight: bold;
              color: #000;
            }
            .zone-section {
              margin-bottom: 40px;
              page-break-inside: avoid;
            }
            .zone-header {
              background: #000;
              color: white;
              padding: 12px 15px;
              margin-bottom: 15px;
              font-size: 18px;
              font-weight: bold;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .vehicle-record {
              border: 2px solid #ddd;
              padding: 15px;
              margin-bottom: 20px;
              background: white;
              page-break-inside: avoid;
            }
            .vehicle-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 12px;
              padding-bottom: 10px;
              border-bottom: 2px solid #eee;
            }
            .plate-number {
              font-size: 24px;
              font-weight: bold;
              color: #000;
              letter-spacing: 2px;
            }
            .badge {
              display: inline-block;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .badge-compliant {
              background: #16a34a;
              color: white;
            }
            .badge-violation {
              background: #dc2626;
              color: white;
            }
            .vehicle-details {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
              margin-bottom: 15px;
            }
            .detail-item {
              font-size: 13px;
              padding: 8px;
              background: #f9f9f9;
              border-left: 3px solid #000;
            }
            .detail-label {
              font-weight: 600;
              color: #000;
              display: inline-block;
              min-width: 120px;
            }
            .detail-value {
              color: #333;
            }
            .evidence-section {
              margin-top: 15px;
              padding-top: 15px;
              border-top: 2px solid #eee;
            }
            .evidence-label {
              font-weight: 700;
              font-size: 14px;
              margin-bottom: 10px;
              color: #000;
              text-transform: uppercase;
            }
            .evidence-photos {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 10px;
            }
            .evidence-photo {
              width: 100%;
              height: 200px;
              object-fit: cover;
              border: 2px solid #ddd;
              border-radius: 4px;
            }
            .notes {
              background: #fffbeb;
              border-left: 4px solid #f59e0b;
              padding: 12px;
              margin-top: 10px;
              font-size: 13px;
              line-height: 1.5;
            }
            .flags {
              margin-top: 10px;
            }
            .flag-badge {
              display: inline-block;
              background: #dc2626;
              color: white;
              padding: 4px 8px;
              border-radius: 3px;
              font-size: 11px;
              font-weight: 600;
              margin-right: 5px;
              margin-bottom: 5px;
            }
            .footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 4px solid #000;
              text-align: center;
              font-size: 12px;
              color: #666;
            }
            .handover-notes {
              background: #f0f9ff;
              border: 3px solid #0284c7;
              padding: 20px;
              margin: 30px 0;
              page-break-inside: avoid;
            }
            .handover-title {
              font-size: 18px;
              font-weight: bold;
              color: #0284c7;
              margin-bottom: 15px;
              text-transform: uppercase;
            }
            .handover-item {
              margin-bottom: 10px;
              padding-left: 20px;
              position: relative;
              font-size: 14px;
              line-height: 1.6;
            }
            .handover-item:before {
              content: '▸';
              position: absolute;
              left: 0;
              color: #0284c7;
              font-weight: bold;
            }
            @media print {
              body {
                padding: 15px;
              }
              .vehicle-record {
                page-break-inside: avoid;
              }
              .zone-section {
                page-break-after: auto;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🚔 PATROL REPORT</h1>
            <p><strong>Date:</strong> ${reportDateRange}</p>
            <p><strong>Officer:</strong> ${user?.first_name} ${user?.last_name}</p>
            <p><strong>Shift Duration:</strong> ${stats.duration} | <strong>Period:</strong> ${stats.firstCheckTime ? new Date(stats.firstCheckTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : '--:--'} - ${stats.lastCheckTime ? new Date(stats.lastCheckTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</p>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Vehicles</div>
              <div class="stat-value">${stats.totalVehicles}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Compliant</div>
              <div class="stat-value" style="color: #16a34a;">${stats.compliantVehicles}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Violations</div>
              <div class="stat-value" style="color: #dc2626;">${stats.nonCompliantVehicles}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Follow-ups</div>
              <div class="stat-value" style="color: #ea580c;">${stats.followupsRequested}</div>
            </div>
          </div>

          ${stats.behavioralIssues > 0 || stats.followupsRequested > 0 || stats.nonCompliantVehicles > 0 ? `
          <div class="handover-notes">
            <div class="handover-title">⚠️ Handover Notes for Next Shift</div>
            ${stats.nonCompliantVehicles > 0 ? `<div class="handover-item"><strong>${stats.nonCompliantVehicles} vehicles</strong> in violation - review records below for details and evidence photos</div>` : ''}
            ${stats.urgentFollowups > 0 ? `<div class="handover-item"><strong>${stats.urgentFollowups} URGENT follow-ups</strong> required - flagged as high priority</div>` : ''}
            ${stats.behavioralIssues > 0 ? `<div class="handover-item"><strong>${stats.behavioralIssues} behavioral incidents</strong> reported - see flagged vehicles below</div>` : ''}
            ${stats.homelessEncounters > 0 ? `<div class="handover-item"><strong>${stats.homelessEncounters} homeless claims</strong> received - verify compliance status</div>` : ''}
            <div class="handover-item">Total evidence photos collected: <strong>${stats.evidencePhotos}</strong></div>
            <div class="handover-item">Zones patrolled: <strong>${stats.zonesCovered.length}</strong> areas covered during shift</div>
          </div>
          ` : ''}

          ${recordsByZone.map(({ zone, records: zoneRecords }) => `
            <div class="zone-section">
              <div class="zone-header">
                <span>📍 ${zone?.name || 'Unknown Zone'}</span>
                <span>${zoneRecords.length} vehicle${zoneRecords.length !== 1 ? 's' : ''}</span>
              </div>
              ${zoneRecords.map(record => {
                const recordWithPhotos = recordsWithPhotos.find(r => r.id === record.id);
                const photos = recordWithPhotos?.photosBase64 || [];
                return `
                  <div class="vehicle-record">
                    <div class="vehicle-header">
                      <div class="plate-number">${record.plate_number}</div>
                      <div class="badge ${record.is_compliant ? 'badge-compliant' : 'badge-violation'}">
                        ${record.is_compliant ? '✓ COMPLIANT' : '✗ VIOLATION'}
                      </div>
                    </div>
                    
                    <div class="vehicle-details">
                      <div class="detail-item">
                        <span class="detail-label">Time Recorded:</span>
                        <span class="detail-value">${new Date(record.recorded_at).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      </div>
                      <div class="detail-item">
                        <span class="detail-label">Self-Contained:</span>
                        <span class="detail-value">${record.self_contained ? 'Yes ✓' : 'No ✗'}</span>
                      </div>
                      ${record.vehicle_make || record.vehicle_model ? `
                      <div class="detail-item">
                        <span class="detail-label">Vehicle:</span>
                        <span class="detail-value">${[record.vehicle_color, record.vehicle_make, record.vehicle_model].filter(Boolean).join(' ')}</span>
                      </div>
                      ` : ''}
                      ${record.breach_warning ? `
                      <div class="detail-item">
                        <span class="detail-label">Breach Type:</span>
                        <span class="detail-value" style="color: #dc2626; font-weight: 700;">${record.breach_type?.toUpperCase() || 'WARNING'}</span>
                      </div>
                      ` : ''}
                      ${record.gps_latitude && record.gps_longitude ? `
                      <div class="detail-item">
                        <span class="detail-label">GPS Location:</span>
                        <span class="detail-value">${record.gps_latitude.toFixed(6)}, ${record.gps_longitude.toFixed(6)}</span>
                      </div>
                      ` : ''}
                    </div>

                    ${record.breach_warning ? `
                    <div class="flags">
                      <strong style="font-size: 13px; color: #dc2626;">⚠️ Breach Warning:</strong><br>
                      <span class="flag-badge">${record.breach_type || 'VIOLATION DETECTED'}</span>
                    </div>
                    ` : ''}

                    ${record.officer_notes ? `
                    <div class="notes">
                      <strong>Officer Notes:</strong><br>
                      ${record.officer_notes}
                    </div>
                    ` : ''}

                    ${photos.length > 0 ? `
                    <div class="evidence-section">
                      <div class="evidence-label">📸 Evidence Photos (${photos.length})</div>
                      <div class="evidence-photos">
                        ${photos.map((photoBase64: string) => `
                          <img src="${photoBase64}" alt="Evidence photo" class="evidence-photo" />
                        `).join('')}
                      </div>
                    </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')}

          <div class="footer">
            <p><strong>FreedomCamp Manager - Patrol Operations</strong></p>
            <p>Generated: ${new Date().toLocaleString('en-NZ', { dateStyle: 'full', timeStyle: 'long' })}</p>
            <p>This report is generated for official use and court proceedings</p>
            <p style="margin-top: 10px; font-style: italic;">Officer: ${user?.first_name} ${user?.last_name} | Shift: ${stats.duration} | Vehicles: ${stats.totalVehicles} | Evidence Photos: ${stats.evidencePhotos}</p>
          </div>
        </body>
        </html>
      `;

      // Create a blob and trigger download
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.href = url;
      link.download = `patrol-report-${timestamp}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('✅ Patrol report downloaded! Open on computer and print as PDF', {
        duration: 5000,
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to generate report. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Calendar className="h-8 w-8" />
            Patrol Summary
          </h1>
          <p className="text-muted-foreground mt-1">
            {useCustomRange && startDate && endDate
              ? `${format(new Date(startDate), 'MMM d, yyyy')} - ${format(new Date(endDate), 'MMM d, yyyy')}`
              : `Operational Day: ${format(getOperationalDayStart(selectedDate), 'MMM d, yyyy')} 06:00 - ${format(getOperationalDayEnd(selectedDate), 'MMM d, yyyy')} 06:00`
            }
          </p>
        </div>
        <Button onClick={exportToPDF} disabled={isExporting || stats.totalVehicles === 0} size="lg" className="bg-blue-600 hover:bg-blue-700">
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <FileDown className="h-4 w-4 mr-2" />
              Download Report
            </>
          )}
        </Button>
      </div>

      {/* Date Selection */}
      <Card className="border-primary/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-5 w-5" />
            Date Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Single Day Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Single Operational Day</Label>
                <Badge variant={!useCustomRange ? "default" : "outline"} className="text-xs">
                  6am - 6am
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setUseCustomRange(false);
                    setSelectedDate(subDays(selectedDate, 1));
                  }}
                  disabled={useCustomRange}
                  className="h-10 w-10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    setUseCustomRange(false);
                    setSelectedDate(new Date(e.target.value));
                  }}
                  disabled={useCustomRange}
                  className="flex-1 h-10"
                />
                
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setUseCustomRange(false);
                    setSelectedDate(addDays(selectedDate, 1));
                  }}
                  disabled={useCustomRange}
                  className="h-10 w-10"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={!useCustomRange ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    setUseCustomRange(false);
                    setSelectedDate(getPreviousOperationalDay());
                  }}
                  disabled={useCustomRange}
                  className="flex-1"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Previous Day
                </Button>
                <Button
                  variant={!useCustomRange ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    setUseCustomRange(false);
                    setSelectedDate(new Date());
                  }}
                  disabled={useCustomRange}
                  className="flex-1"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Today
                </Button>
              </div>
              
              {!useCustomRange && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-xs font-medium text-blue-600">
                    📅 {format(getOperationalDayStart(selectedDate), 'EEEE, MMM d, yyyy')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(getOperationalDayStart(selectedDate), 'HH:mm')} - {format(getOperationalDayEnd(selectedDate), 'HH:mm (MMM d)')}
                  </p>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Custom Range Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Custom Date Range</Label>
                <Badge variant={useCustomRange ? "default" : "outline"} className="text-xs">
                  Multi-day
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (e.target.value && endDate) {
                        setUseCustomRange(true);
                      }
                    }}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">End Date</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      if (startDate && e.target.value) {
                        setUseCustomRange(true);
                      }
                    }}
                    className="h-10"
                  />
                </div>
              </div>
              
              {useCustomRange && startDate && endDate && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-green-600">
                        📊 Custom Range Active
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(startDate), 'MMM d, yyyy')} 06:00 - {format(addDays(new Date(endDate), 1), 'MMM d, yyyy')} 06:00
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1} operational days
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUseCustomRange(false);
                        setStartDate('');
                        setEndDate('');
                      }}
                      className="h-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              
              {!useCustomRange && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Select both start and end dates to view multi-day summary
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Session Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Officer</p>
              <p className="font-semibold">{user?.first_name} {user?.last_name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Session Duration</p>
              <p className="font-semibold">{stats.duration}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Period</p>
              <p className="font-semibold">
                {stats.firstCheckTime && stats.lastCheckTime
                  ? `${new Date(stats.firstCheckTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })} - ${new Date(stats.lastCheckTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}`
                  : 'No records yet'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Primary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Car className="h-4 w-4" />
              Total Vehicles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalVehicles}</div>
          </CardContent>
        </Card>

        <Card className="border-green-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Compliant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">{stats.compliantVehicles}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.complianceRate.toFixed(1)}% compliance rate
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Violations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{stats.nonCompliantVehicles}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Non-compliant vehicles
            </p>
          </CardContent>
        </Card>

        <Card className="border-orange-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Flag className="h-4 w-4 text-orange-500" />
              Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">{stats.followupsRequested}</div>
            {stats.urgentFollowups > 0 && (
              <p className="text-xs text-red-500 font-semibold mt-1">
                {stats.urgentFollowups} urgent
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.zonesCovered.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Areas patrolled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Self-Contained
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.selfContainedChecks}</div>
            <p className="text-xs text-muted-foreground mt-1">SC vehicles</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Home className="h-4 w-4" />
              Homeless
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.homelessEncounters}</div>
            <p className="text-xs text-muted-foreground mt-1">Claims received</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Evidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.evidencePhotos}</div>
            <p className="text-xs text-muted-foreground mt-1">Photos captured</p>
          </CardContent>
        </Card>
      </div>

      {/* Zone Coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Zone Coverage
          </CardTitle>
          <CardDescription>Areas patrolled during this session</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.zonesCovered.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stats.zonesCovered.map((zoneId) => {
                const zone = zones.find(z => z.id === zoneId);
                const zoneRecords = records.filter(r => r.zone_id === zoneId);
                return (
                  <Badge key={zoneId} variant="outline" className="text-sm py-2 px-3">
                    <MapPin className="h-3 w-3 mr-1" />
                    {zone?.name || 'Unknown'} ({zoneRecords.length})
                  </Badge>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No zones covered yet</p>
          )}
        </CardContent>
      </Card>

      {/* Behavioral Issues */}
      {stats.behavioralIssues > 0 && (
        <Card className="border-red-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              Behavioral Issues Reported
            </CardTitle>
            <CardDescription>Incidents requiring attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {records
                .filter(r => r.behavioral_flags && r.behavioral_flags.length > 0)
                .map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <p className="font-semibold">{record.plate_number}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {record.behavioral_flags.map((flag) => (
                          <Badge key={flag} variant="destructive" className="text-xs">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(record.recorded_at).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance Indicator */}
      <Card className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Session Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Compliance Rate</span>
                <span className="font-semibold">{stats.complianceRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${stats.complianceRate}%` }}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-500">{stats.totalVehicles}</p>
                <p className="text-xs text-muted-foreground">Checked</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-500">{stats.evidencePhotos}</p>
                <p className="text-xs text-muted-foreground">Evidence</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-500">{stats.duration}</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Empty State */}
      {stats.totalVehicles === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Car className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No Vehicles Recorded</h3>
            <p className="text-muted-foreground text-center text-sm">
              {useCustomRange && startDate && endDate
                ? `No patrol data found for ${format(new Date(startDate), 'MMM d')} - ${format(new Date(endDate), 'MMM d')}`
                : `No patrol data found for ${format(getOperationalDayStart(selectedDate), 'MMM d, yyyy')}`
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { supabase } from './supabase';
import { toast } from 'sonner';

interface CSVExportParams {
  dateFrom: string;
  dateTo: string;
  viewLevel: 'overview' | 'zone';
  selectedOrgId?: string;
  selectedZone?: any;
  isMaster: boolean;
  userId: string;
  stats: any;
  zones: any[];
  vehicles: any[];
}

export async function exportComprehensiveCSV(params: CSVExportParams) {
  const {
    dateFrom,
    dateTo,
    viewLevel,
    selectedOrgId,
    selectedZone,
    isMaster,
    userId,
    stats,
    zones,
    vehicles
  } = params;

  const timestamp = new Date().toISOString().split('T')[0];
  const rows: string[][] = [];

  try {
    // ═══════════════════════════════════════════════════════
    // HEADER SECTION
    // ═══════════════════════════════════════════════════════
    rows.push(['═══════════════════════════════════════════════════════']);
    rows.push(['FREEDOMCAMP MANAGER - DASHBOARD EXPORT']);
    rows.push(['═══════════════════════════════════════════════════════']);
    rows.push([]);
    rows.push(['Report Generated:', new Date().toLocaleString('en-NZ')]);
    rows.push(['Date Range:', `${new Date(dateFrom).toLocaleDateString('en-NZ')} to ${new Date(dateTo).toLocaleDateString('en-NZ')}`]);
    if (viewLevel === 'zone' && selectedZone) {
      rows.push(['Zone Filter:', selectedZone.zone_name]);
    }
    rows.push([]);

    // ═══════════════════════════════════════════════════════
    // SUMMARY STATISTICS
    // ═══════════════════════════════════════════════════════
    if (stats) {
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push(['📊 SUMMARY STATISTICS']);
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push([]);
      rows.push(['Metric', 'Value', 'Details']);
      rows.push(['Total Observations', stats.total_observations.toString(), `Across ${stats.total_zones} zones`]);
      rows.push(['Total Vehicles', stats.total_vehicles.toString(), 'Unique plates']);
      rows.push(['Compliance Rate', `${stats.compliance_rate}%`, `${stats.compliant} compliant vehicles`]);
      rows.push(['Overstayers (Breach)', stats.overstayers.toString(), '⚠️ Requires enforcement action']);
      rows.push(['At Risk Vehicles', stats.at_risk.toString(), '⏰ 1 night from breach']);
      rows.push(['Flagged Vehicles', stats.flagged.toString(), '🚩 High priority monitoring']);
      rows.push(['Homeless Vehicles', stats.homeless.toString(), '🏠 Confirmed status']);
      rows.push([]);
    }

    // ═══════════════════════════════════════════════════════
    // ZONE PERFORMANCE BREAKDOWN
    // ═══════════════════════════════════════════════════════
    if (viewLevel === 'overview' && zones.length > 0) {
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push(['📍 ZONE PERFORMANCE BREAKDOWN']);
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push([]);
      rows.push([
        'Zone Name',
        'Observations',
        'Vehicles',
        'Compliance %',
        'Compliant',
        'Overstayers',
        'At Risk',
        'Flagged',
        'Homeless'
      ]);
      
      zones.forEach(z => {
        rows.push([
          z.zone_name,
          z.observations.toString(),
          z.vehicles.toString(),
          `${z.compliance_rate}%`,
          z.compliant.toString(),
          z.overstayers.toString(),
          z.at_risk.toString(),
          z.flagged.toString(),
          z.homeless.toString(),
        ]);
      });
      rows.push([]);
      rows.push(['TOTALS', 
        zones.reduce((sum, z) => sum + z.observations, 0).toString(),
        zones.reduce((sum, z) => sum + z.vehicles, 0).toString(),
        '',
        zones.reduce((sum, z) => sum + z.compliant, 0).toString(),
        zones.reduce((sum, z) => sum + z.overstayers, 0).toString(),
        zones.reduce((sum, z) => sum + z.at_risk, 0).toString(),
        zones.reduce((sum, z) => sum + z.flagged, 0).toString(),
        zones.reduce((sum, z) => sum + z.homeless, 0).toString(),
      ]);
      rows.push([]);
    }

    // ═══════════════════════════════════════════════════════
    // BREACH VEHICLES SECTION
    // ═══════════════════════════════════════════════════════
    if (stats && stats.overstayers > 0) {
      const breachVehicles = await loadBreachVehicles(params);
      
      if (breachVehicles.length > 0) {
        rows.push(['═══════════════════════════════════════════════════════']);
        rows.push(['⚠️ VEHICLES IN BREACH (OVERSTAYERS)']);
        rows.push(['═══════════════════════════════════════════════════════']);
        rows.push([]);
        rows.push([
          'Plate Number',
          'Make',
          'Model',
          'Year',
          'Color',
          'Total Observations',
          'Flagged',
          'Homeless',
          'Breach Type',
          'Breach Details'
        ]);
        
        breachVehicles.forEach(vehicle => {
          rows.push([
            vehicle.plate_number,
            vehicle.make || 'Unknown',
            vehicle.model || '',
            vehicle.year?.toString() || '',
            vehicle.color || '',
            vehicle.total_observations?.toString() || '0',
            vehicle.is_flagged ? 'YES ⚠️' : 'No',
            vehicle.homeless_status === 'confirmed' ? 'YES 🏠' : 'No',
            vehicle.breach_type,
            vehicle.breach_details
          ]);
        });
        rows.push([]);
        rows.push(['BREACH SUMMARY:', breachVehicles.length.toString(), 'vehicles require immediate enforcement action']);
        rows.push([]);
      }
    }

    // ═══════════════════════════════════════════════════════
    // AT RISK VEHICLES SECTION
    // ═══════════════════════════════════════════════════════
    if (stats && stats.at_risk > 0) {
      const atRiskVehicles = await loadAtRiskVehicles(params);
      
      if (atRiskVehicles.length > 0) {
        rows.push(['═══════════════════════════════════════════════════════']);
        rows.push(['⏰ VEHICLES AT RISK (1 NIGHT FROM BREACH)']);
        rows.push(['═══════════════════════════════════════════════════════']);
        rows.push([]);
        rows.push([
          'Plate Number',
          'Make',
          'Model',
          'Year',
          'Color',
          'Total Observations',
          'Flagged',
          'Homeless',
          'Risk Type',
          'Warning Details'
        ]);
        
        atRiskVehicles.forEach(vehicle => {
          rows.push([
            vehicle.plate_number,
            vehicle.make || 'Unknown',
            vehicle.model || '',
            vehicle.year?.toString() || '',
            vehicle.color || '',
            vehicle.total_observations?.toString() || '0',
            vehicle.is_flagged ? 'YES ⚠️' : 'No',
            vehicle.homeless_status === 'confirmed' ? 'YES 🏠' : 'No',
            vehicle.warning_type,
            vehicle.warning_details
          ]);
        });
        rows.push([]);
        rows.push(['AT RISK SUMMARY:', atRiskVehicles.length.toString(), 'vehicles approaching limits']);
        rows.push([]);
      }
    }

    // ═══════════════════════════════════════════════════════
    // ALL VEHICLES IN ZONE (if zone view)
    // ═══════════════════════════════════════════════════════
    if (viewLevel === 'zone' && vehicles.length > 0) {
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push([`🚗 ALL VEHICLES IN ${selectedZone?.zone_name || 'ZONE'}`]);
      rows.push(['═══════════════════════════════════════════════════════']);
      rows.push([]);
      rows.push([
        'Plate Number',
        'Make',
        'Model',
        'Year',
        'Color',
        'Observations',
        'Status',
        'Flagged',
        'Homeless',
        'First Seen',
        'Last Seen'
      ]);
      
      vehicles.forEach(v => {
        rows.push([
          v.plate_number,
          v.make || 'Unknown',
          v.model || '',
          v.year?.toString() || '',
          v.color || '',
          v.observations.toString(),
          v.status.toUpperCase(),
          v.is_flagged ? 'YES ⚠️' : 'No',
          v.homeless_status === 'confirmed' ? 'YES 🏠' : 'No',
          new Date(v.first_seen).toLocaleDateString('en-NZ'),
          new Date(v.last_seen).toLocaleDateString('en-NZ'),
        ]);
      });
      rows.push([]);
      
      // Status summary for zone
      const statusCounts = {
        overstayer: vehicles.filter(v => v.status === 'overstayer').length,
        at_risk: vehicles.filter(v => v.status === 'at_risk').length,
        compliant: vehicles.filter(v => v.status === 'compliant').length,
        flagged: vehicles.filter(v => v.status === 'flagged').length,
        homeless: vehicles.filter(v => v.status === 'homeless').length,
      };
      
      rows.push(['STATUS BREAKDOWN:']);
      rows.push(['Overstayers:', statusCounts.overstayer.toString()]);
      rows.push(['At Risk:', statusCounts.at_risk.toString()]);
      rows.push(['Compliant:', statusCounts.compliant.toString()]);
      rows.push(['Flagged:', statusCounts.flagged.toString()]);
      rows.push(['Homeless:', statusCounts.homeless.toString()]);
      rows.push([]);
    }

    // ═══════════════════════════════════════════════════════
    // FOOTER
    // ═══════════════════════════════════════════════════════
    rows.push(['═══════════════════════════════════════════════════════']);
    rows.push(['END OF REPORT']);
    rows.push(['═══════════════════════════════════════════════════════']);
    rows.push([]);
    rows.push(['Generated by FreedomCamp Manager']);
    rows.push([new Date().toLocaleString('en-NZ')]);
    rows.push([]);
    rows.push(['LEGEND:']);
    rows.push(['⚠️ = Flagged Vehicle | 🏠 = Homeless | ⏰ = At Risk | 🚩 = High Priority']);

    if (rows.length === 0) {
      toast.error('No data to export');
      return;
    }

    // Convert to CSV with proper escaping
    const csv = rows.map(row => 
      row.map(cell => {
        const cellStr = String(cell);
        // Escape cells with commas, quotes, or newlines
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    // Add UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freedomcamp-dashboard-${viewLevel}-${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('✅ Comprehensive CSV export complete!');
    return true;

  } catch (error: any) {
    console.error('CSV export failed:', error);
    toast.error('CSV export failed: ' + error.message);
    return false;
  }
}

// Helper function to load breach vehicles with full details
async function loadBreachVehicles(params: CSVExportParams) {
  const { dateFrom, dateTo, viewLevel, selectedZone, selectedOrgId, isMaster, userId } = params;

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();

    let orgFilter: string | null = null;
    if (isMaster && selectedOrgId !== 'all') {
      orgFilter = selectedOrgId;
    } else if (!isMaster) {
      orgFilter = profile?.organization_id || null;
    }

    let obsQuery = supabase
      .from('vehicle_observations_v2')
      .select('plate_number, zone_id')
      .gte('recorded_at', `${dateFrom}T00:00:00`)
      .lte('recorded_at', `${dateTo}T23:59:59`);

    if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter);
    if (viewLevel === 'zone' && selectedZone) {
      obsQuery = obsQuery.eq('zone_id', selectedZone.zone_id);
    }

    const { data: observations } = await obsQuery;
    const obs = observations || [];
    const uniquePlates = [...new Set(obs.map(o => o.plate_number))];

    if (uniquePlates.length === 0) return [];

    const { data: vehicleData } = await supabase
      .from('canonical_vehicles')
      .select('*')
      .in('plate_number', uniquePlates);

    const fromMonth = dateFrom.slice(0, 7) + '-01';
    const toMonth = dateTo.slice(0, 7) + '-01';

    const { data: staysData } = await supabase
      .from('vehicle_monthly_stays')
      .select('plate_number, zone_id, consecutive_nights, nights_stayed, zones(name)')
      .in('plate_number', uniquePlates)
      .gte('calendar_month', fromMonth)
      .lte('calendar_month', toMonth);

    const { data: matrixData } = await supabase
      .from('zone_compliance_matrix')
      .select('zone_id, max_consecutive_nights, nights_per_month')
      .is('effective_to', null);

    const matrixMap = new Map(matrixData?.map(m => [m.zone_id, m]) || []);
    const vehicleMap = new Map(vehicleData?.map(v => [v.plate_number, v]) || []);

    const breachVehicles: any[] = [];

    (staysData || []).forEach(stay => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules) return;

      if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
        const vehicle = vehicleMap.get(stay.plate_number);
        if (!vehicle) return;

        const zoneName = (stay.zones as any)?.name || 'Unknown';
        let breachType = '';
        let breachDetails = '';

        if (stay.consecutive_nights > rules.max_consecutive_nights) {
          breachType = 'Consecutive Nights Exceeded';
          breachDetails = `${stay.consecutive_nights}/${rules.max_consecutive_nights} nights in ${zoneName}`;
        } else if (stay.nights_stayed > rules.nights_per_month) {
          breachType = 'Monthly Limit Exceeded';
          breachDetails = `${stay.nights_stayed}/${rules.nights_per_month} nights/month in ${zoneName}`;
        }

        // Check if already added
        const existing = breachVehicles.find(v => v.plate_number === stay.plate_number);
        if (existing) {
          existing.breach_details += ` | ${breachDetails}`;
        } else {
          breachVehicles.push({
            plate_number: vehicle.plate_number,
            make: vehicle.vehicle_make,
            model: vehicle.vehicle_model,
            year: vehicle.vehicle_year,
            color: vehicle.vehicle_color,
            total_observations: vehicle.total_observations,
            is_flagged: vehicle.is_flagged,
            homeless_status: vehicle.homeless_status,
            breach_type: breachType,
            breach_details: breachDetails,
          });
        }
      }
    });

    return breachVehicles.sort((a, b) => (b.total_observations || 0) - (a.total_observations || 0));
  } catch (error) {
    console.error('Failed to load breach vehicles:', error);
    return [];
  }
}

// Helper function to load at-risk vehicles
async function loadAtRiskVehicles(params: CSVExportParams) {
  const { dateFrom, dateTo, viewLevel, selectedZone, selectedOrgId, isMaster, userId } = params;

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();

    let orgFilter: string | null = null;
    if (isMaster && selectedOrgId !== 'all') {
      orgFilter = selectedOrgId;
    } else if (!isMaster) {
      orgFilter = profile?.organization_id || null;
    }

    let obsQuery = supabase
      .from('vehicle_observations_v2')
      .select('plate_number, zone_id')
      .gte('recorded_at', `${dateFrom}T00:00:00`)
      .lte('recorded_at', `${dateTo}T23:59:59`);

    if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter);
    if (viewLevel === 'zone' && selectedZone) {
      obsQuery = obsQuery.eq('zone_id', selectedZone.zone_id);
    }

    const { data: observations } = await obsQuery;
    const obs = observations || [];
    const uniquePlates = [...new Set(obs.map(o => o.plate_number))];

    if (uniquePlates.length === 0) return [];

    const { data: vehicleData } = await supabase
      .from('canonical_vehicles')
      .select('*')
      .in('plate_number', uniquePlates);

    const fromMonth = dateFrom.slice(0, 7) + '-01';
    const toMonth = dateTo.slice(0, 7) + '-01';

    const { data: staysData } = await supabase
      .from('vehicle_monthly_stays')
      .select('plate_number, zone_id, consecutive_nights, nights_stayed, zones(name)')
      .in('plate_number', uniquePlates)
      .gte('calendar_month', fromMonth)
      .lte('calendar_month', toMonth);

    const { data: matrixData } = await supabase
      .from('zone_compliance_matrix')
      .select('zone_id, max_consecutive_nights, nights_per_month')
      .is('effective_to', null);

    const matrixMap = new Map(matrixData?.map(m => [m.zone_id, m]) || []);
    const vehicleMap = new Map(vehicleData?.map(v => [v.plate_number, v]) || []);

    // First identify breach vehicles to exclude
    const breachPlates = new Set<string>();
    (staysData || []).forEach(stay => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules) return;
      if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
        breachPlates.add(stay.plate_number);
      }
    });

    const atRiskVehicles: any[] = [];

    (staysData || []).forEach(stay => {
      if (breachPlates.has(stay.plate_number)) return; // Skip if already in breach

      const rules = matrixMap.get(stay.zone_id);
      if (!rules) return;

      if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
        const vehicle = vehicleMap.get(stay.plate_number);
        if (!vehicle) return;

        const zoneName = (stay.zones as any)?.name || 'Unknown';
        let warningType = '';
        let warningDetails = '';

        if (stay.consecutive_nights === rules.max_consecutive_nights) {
          warningType = 'Consecutive Nights At Limit';
          warningDetails = `${stay.consecutive_nights}/${rules.max_consecutive_nights} nights in ${zoneName} (1 more = breach)`;
        } else if (stay.nights_stayed === rules.nights_per_month) {
          warningType = 'Monthly Limit At Limit';
          warningDetails = `${stay.nights_stayed}/${rules.nights_per_month} nights/month in ${zoneName} (1 more = breach)`;
        }

        const existing = atRiskVehicles.find(v => v.plate_number === stay.plate_number);
        if (existing) {
          existing.warning_details += ` | ${warningDetails}`;
        } else {
          atRiskVehicles.push({
            plate_number: vehicle.plate_number,
            make: vehicle.vehicle_make,
            model: vehicle.vehicle_model,
            year: vehicle.vehicle_year,
            color: vehicle.vehicle_color,
            total_observations: vehicle.total_observations,
            is_flagged: vehicle.is_flagged,
            homeless_status: vehicle.homeless_status,
            warning_type: warningType,
            warning_details: warningDetails,
          });
        }
      }
    });

    return atRiskVehicles.sort((a, b) => (b.total_observations || 0) - (a.total_observations || 0));
  } catch (error) {
    console.error('Failed to load at-risk vehicles:', error);
    return [];
  }
}

export type BreachType = 'overstay' | 'no_self_contained' | 'no_wof' | 'consecutive_days' | 'unauthorized_zone' | 'nights_exceeded';

export type BreachStatus = 'pending' | 'notified' | 'resolved' | 'escalated';

export type PatrolStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Zone {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  self_contained_required: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  geometry: any;
  created_at: string;
}

export interface BreachAlert {
  id: string;
  organization_id: string;
  patrol_id: string | null;
  vehicle_record_id: string | null;
  zone_id: string;
  breach_type: BreachType;
  breach_details: any;
  due_date: string | null;
  notification_sent: boolean;
  notification_method: string | null;
  notified_at: string | null;
  notified_by: string | null;
  status: BreachStatus;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  zone?: Zone;
}

export interface Patrol {
  id: string;
  organization_id: string;
  zone_id: string;
  patrol_date: string;
  shift: 'night' | 'morning';
  assigned_to: string | null;
  checked_in_at: string | null;
  check_in_location_lat: number | null;
  check_in_location_lng: number | null;
  completed_at: string | null;
  status: PatrolStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  zone?: Zone;
  officer?: UserProfile;
}

export interface VehicleRecord {
  id: string;
  organization_id: string;
  zone_id: string;
  plate_number: string;
  is_self_contained: boolean;
  is_compliant: boolean;
  recorded_at: string;
  location_lat: number | null;
  location_lng: number | null;
  zone?: Zone;
}

export interface HealthSafetyReport {
  id: string;
  organization_id: string;
  incident_id: string | null;
  zone_id: string;
  reported_by: string;
  patrol_id: string | null;
  details: string;
  severity: Severity;
  status: 'pending' | 'under_review' | 'resolved';
  location_lat: number | null;
  location_lng: number | null;
  attachments: any;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  zone?: Zone;
}

export interface UserProfile {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  permissions?: string[];
}

export interface ComplianceStats {
  total_breaches: number;
  pending_notifications: number;
  active_patrols: number;
  zone_violations: { [key: string]: number };
}

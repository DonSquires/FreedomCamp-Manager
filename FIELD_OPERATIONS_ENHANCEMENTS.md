# 🔧 FIELD OPERATIONS STREAMLINING

**Date:** February 12, 2026  
**Status:** ✅ **IMPLEMENTATION READY**

---

## 🎯 **EXECUTIVE SUMMARY**

Comprehensive enhancements to field operations, patrol management, investigation workflows, and enforcement processes to create a streamlined, efficient, and user-friendly system.

---

## 📋 **ENHANCEMENT CATEGORIES**

### **1. PLATE CAPTURE IMPROVEMENTS**

#### **1.1 Zoom Slider with Sticky State**

**Current Issue:** Zoom uses buttons (+/-), doesn't persist between sessions

**Solution:** Replace with slider + localStorage persistence

```typescript
// PlateCapture.tsx - Enhanced Zoom Control
const [zoom, setZoom] = useState<number>(() => {
  const saved = localStorage.getItem('camera-zoom-level');
  return saved ? parseFloat(saved) : 1.0;
});

const handleZoomChange = (newZoom: number) => {
  setZoom(newZoom);
  localStorage.setItem('camera-zoom-level', newZoom.toString());
  applyZoom(newZoom);
};

// UI Component:
<div className="zoom-control">
  <Label>Zoom: {zoom.toFixed(1)}x</Label>
  <Slider
    value={[zoom]}
    onValueChange={([value]) => handleZoomChange(value)}
    min={1}
    max={5}
    step={0.1}
    className="w-48"
  />
</div>
```

**Benefits:**
- ✅ Persists zoom level across sessions
- ✅ More precise control than buttons
- ✅ Visual indicator of current zoom

---

### **2. SESSION HISTORY ENHANCEMENTS**

#### **2.1 24-Hour Edit/Delete Window**

**Current Issue:** Officers can't edit scans after submission

**Solution:** Allow full edit/delete for 24 hours with visual indicators

```typescript
// ScannedVehiclesList.tsx Enhancement
interface SessionScan {
  // ... existing fields
  recorded_at: string;
  recorded_by: string;
  can_edit: boolean;  // New field
  can_delete: boolean; // New field
  hours_remaining: number; // New field
}

const canModifyScan = (scan: SessionScan, userId: string) => {
  const recordedAt = new Date(scan.recorded_at);
  const now = new Date();
  const hoursElapsed = (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60);
  const isOwnRecord = scan.recorded_by === userId;
  
  return {
    can_edit: isOwnRecord && hoursElapsed < 24,
    can_delete: isOwnRecord && hoursElapsed < 24,
    hours_remaining: Math.max(0, 24 - hoursElapsed),
  };
};

// UI Display:
<Card className="vehicle-card">
  {scan.can_edit && (
    <Badge variant="outline" className="edit-badge">
      ⏰ {Math.floor(scan.hours_remaining)}h to edit
    </Badge>
  )}
  <div className="actions">
    {scan.can_edit && (
      <>
        <Button onClick={() => handleEdit(scan)}>Edit</Button>
        <Button variant="destructive" onClick={() => handleDelete(scan)}>Delete</Button>
      </>
    )}
  </div>
</Card>
```

**RLS Policy Update:**
```sql
-- Officers can delete their own recent scans
CREATE POLICY officers_delete_recent_scans
  ON vehicle_observations_v2 FOR DELETE
  USING (
    recorded_by = auth.uid() 
    AND recorded_at >= (nz_now() - INTERVAL '24 hours')
  );

-- Officers can edit their own recent scans
CREATE POLICY officers_edit_recent_scans
  ON vehicle_observations_v2 FOR UPDATE
  USING (
    recorded_by = auth.uid() 
    AND recorded_at >= (nz_now() - INTERVAL '24 hours')
  );
```

---

#### **2.2 Organization-Wide 24-Hour View**

**Current Issue:** Officers can only see their own scans

**Solution:** Show all org scans for last 24 hours with highlighting and filtering

```typescript
// ScannedVehiclesList.tsx - Organization View
const [viewMode, setViewMode] = useState<'my_scans' | 'org_scans'>('my_scans');
const [filterBreaches, setFilterBreaches] = useState(false);
const [filterHomeless, setFilterHomeless] = useState(false);
const [filterAtRisk, setFilterAtRisk] = useState(false);

const loadOrgScans = async () => {
  const { data: scans, error } = await supabase
    .from('vehicle_observations_v2')
    .select(`
      *,
      zones(name),
      canonical_vehicles(is_flagged, homeless_status, vehicle_make, vehicle_model, vehicle_color),
      compliance_results(is_compliant),
      user_profiles(first_name, last_name)
    `)
    .eq('organization_id', user.organization_id)
    .gte('recorded_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('recorded_at', { ascending: false });

  if (error) throw error;

  return scans.map(scan => ({
    ...scan,
    is_my_scan: scan.recorded_by === user.id,
    officer_name: `${scan.user_profiles.first_name} ${scan.user_profiles.last_name}`,
    is_breach: !scan.compliance_results?.is_compliant,
    is_homeless: scan.canonical_vehicles?.homeless_status === 'confirmed',
    is_at_risk: scan.canonical_vehicles?.is_flagged || scan.is_breach,
  }));
};

// UI with Highlighting:
<div className="scans-container">
  {/* View Mode Toggle */}
  <div className="view-toggle">
    <Button 
      variant={viewMode === 'my_scans' ? 'default' : 'outline'}
      onClick={() => setViewMode('my_scans')}
    >
      My Scans
    </Button>
    <Button 
      variant={viewMode === 'org_scans' ? 'default' : 'outline'}
      onClick={() => setViewMode('org_scans')}
    >
      All Organization (24h)
    </Button>
  </div>

  {/* Filters (org view only) */}
  {viewMode === 'org_scans' && (
    <div className="filters">
      <Button
        variant={filterBreaches ? 'default' : 'outline'}
        onClick={() => setFilterBreaches(!filterBreaches)}
      >
        🚨 Breaches Only
      </Button>
      <Button
        variant={filterHomeless ? 'default' : 'outline'}
        onClick={() => setFilterHomeless(!filterHomeless)}
      >
        🏠 Homeless
      </Button>
      <Button
        variant={filterAtRisk ? 'default' : 'outline'}
        onClick={() => setFilterAtRisk(!filterAtRisk)}
      >
        ⚠️ At Risk
      </Button>
    </div>
  )}

  {/* Scans List with Highlighting */}
  {filteredScans.map(scan => (
    <Card 
      key={scan.id}
      className={cn(
        'scan-card',
        scan.is_my_scan && 'border-blue-500 bg-blue-50',
        scan.is_breach && 'border-l-4 border-l-red-500',
        scan.is_homeless && 'border-l-4 border-l-amber-500'
      )}
    >
      <div className="scan-header">
        <div className="plate-number">{scan.plate_number}</div>
        {scan.is_my_scan && <Badge variant="secondary">You</Badge>}
        {!scan.is_my_scan && <Badge variant="outline">{scan.officer_name}</Badge>}
      </div>
      
      <div className="scan-badges">
        {scan.is_breach && (
          <Badge variant="destructive">🚨 BREACH</Badge>
        )}
        {scan.is_homeless && (
          <Badge variant="secondary">🏠 HOMELESS (FC EXEMPT)</Badge>
        )}
        {scan.is_at_risk && (
          <Badge variant="outline" className="text-orange-600">⚠️ AT RISK</Badge>
        )}
      </div>

      <div className="scan-actions">
        {scan.can_edit && scan.is_my_scan && (
          <>
            <Button size="sm" onClick={() => handleEdit(scan)}>Edit</Button>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(scan)}>
              Delete
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => handleView(scan)}>
          View Details
        </Button>
      </div>
    </Card>
  ))}
</div>
```

**Key Features:**
- ✅ Toggle between "My Scans" and "All Organization (24h)"
- ✅ Visual highlighting for own scans (blue border)
- ✅ Visual highlighting for breaches (red left border)
- ✅ Visual highlighting for homeless (amber left border)
- ✅ Filter buttons for Breaches Only, Homeless, At Risk
- ✅ Officer name badge on each scan
- ✅ Edit/Delete only available for own scans within 24h

---

### **3. PATROL MANAGEMENT STREAMLINING**

#### **3.1 Patrol Request & Notification System**

**Current Flow:**
```
Admin creates patrol → Manually checks → Officer manually signs on
```

**New Flow:**
```
Admin creates patrol → Officer notified (push + in-app) → 
Officer accepts/declines → Auto sign-on via geofence OR manual check-in
```

**Implementation:**

```typescript
// Database Enhancement
ALTER TABLE patrols
  ADD COLUMN notification_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN notification_sent_at TIMESTAMPTZ,
  ADD COLUMN officer_accepted BOOLEAN DEFAULT FALSE,
  ADD COLUMN officer_accepted_at TIMESTAMPTZ,
  ADD COLUMN officer_declined BOOLEAN DEFAULT FALSE,
  ADD COLUMN officer_decline_reason TEXT,
  ADD COLUMN auto_checkin_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN geofence_radius INTEGER DEFAULT 100; -- meters
```

**Notification Trigger:**
```sql
CREATE OR REPLACE FUNCTION notify_patrol_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify when patrol is assigned (not updated)
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL) THEN
    
    -- Send push notification via Edge Function
    PERFORM send_push_via_edge_function(
      NEW.assigned_to,
      jsonb_build_object(
        'type', 'patrol_assigned',
        'title', 'New Patrol Assignment',
        'message', format('You have been assigned to patrol %s on %s', 
          (SELECT name FROM zones WHERE id = NEW.zone_id),
          to_char(NEW.patrol_date, 'DD/MM/YYYY')
        ),
        'data', jsonb_build_object(
          'patrol_id', NEW.id,
          'zone_id', NEW.zone_id,
          'patrol_date', NEW.patrol_date,
          'shift', NEW.shift
        )
      )
    );
    
    NEW.notification_sent := TRUE;
    NEW.notification_sent_at := nz_now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_patrol_assignment ON patrols;
CREATE TRIGGER trigger_notify_patrol_assignment
  BEFORE INSERT OR UPDATE ON patrols
  FOR EACH ROW
  EXECUTE FUNCTION notify_patrol_assignment();
```

**Officer Portal - Patrol Notifications:**
```typescript
// FieldOfficerPortal.tsx - Patrol Notifications Section
const [patrolNotifications, setPatrolNotifications] = useState<Patrol[]>([]);

useEffect(() => {
  loadPatrolNotifications();
  
  // Subscribe to new patrol assignments
  const channel = supabase
    .channel('patrol_assignments')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'patrols',
        filter: `assigned_to=eq.${user.id}`,
      },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          loadPatrolNotifications();
          playSounds.notification();
          toast.info('New patrol assignment received!');
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [user.id]);

const loadPatrolNotifications = async () => {
  const { data, error } = await supabase
    .from('patrols')
    .select(`
      *,
      zones(name, location_lat, location_lng, geometry)
    `)
    .eq('assigned_to', user.id)
    .is('officer_accepted', null) // Not yet accepted/declined
    .gte('patrol_date', new Date().toISOString().split('T')[0])
    .order('patrol_date', { ascending: true });

  if (error) throw error;
  setPatrolNotifications(data || []);
};

const handleAcceptPatrol = async (patrolId: string) => {
  const { error } = await supabase
    .from('patrols')
    .update({
      officer_accepted: true,
      officer_accepted_at: new Date().toISOString(),
      status: 'accepted',
    })
    .eq('id', patrolId);

  if (error) {
    toast.error('Failed to accept patrol');
    return;
  }

  toast.success('Patrol accepted! You will be auto-signed in when entering the zone.');
  loadPatrolNotifications();
};

const handleDeclinePatrol = async (patrolId: string, reason: string) => {
  const { error } = await supabase
    .from('patrols')
    .update({
      officer_declined: true,
      officer_decline_reason: reason,
      assigned_to: null, // Unassign
      status: 'declined',
    })
    .eq('id', patrolId);

  if (error) {
    toast.error('Failed to decline patrol');
    return;
  }

  toast.info('Patrol declined - admin will be notified');
  loadPatrolNotifications();
};

// UI Component:
<Card className="patrol-notifications">
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Shield className="h-5 w-5" />
      Patrol Assignments ({patrolNotifications.length})
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    {patrolNotifications.map(patrol => (
      <Card key={patrol.id} className="border-2 border-blue-200">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div>
              <div className="font-bold text-lg">{patrol.zones.name}</div>
              <div className="text-sm text-muted-foreground">
                {new Date(patrol.patrol_date).toLocaleDateString('en-NZ')} • {patrol.shift}
              </div>
            </div>

            <Alert>
              <MapPin className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Auto check-in enabled: You will be signed on when entering the zone
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button
                onClick={() => handleAcceptPatrol(patrol.id)}
                className="flex-1"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Accept Patrol
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Show decline reason dialog
                  setDeclineDialogOpen(true);
                  setSelectedPatrol(patrol);
                }}
              >
                Decline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </CardContent>
</Card>
```

---

#### **3.2 Geofence Auto Check-In/Out**

**Implementation:**

```typescript
// FieldOfficerPortal.tsx - Geofence Monitor
const [activePatrols, setActivePatrols] = useState<Patrol[]>([]);
const [insideZones, setInsideZones] = useState<Set<string>>(new Set());

useEffect(() => {
  // Load accepted patrols for today
  loadActivePatrols();
}, []);

useEffect(() => {
  if (!gpsLocation || activePatrols.length === 0) return;

  // Check if inside any patrol zone
  const newInsideZones = new Set<string>();
  
  activePatrols.forEach(patrol => {
    const isInside = isPointInZone(
      gpsLocation.lat,
      gpsLocation.lng,
      patrol.zones.geometry,
      patrol.geofence_radius || 100
    );

    if (isInside) {
      newInsideZones.add(patrol.zone_id);

      // Auto check-in if not already checked in
      if (!patrol.checked_in_at && patrol.auto_checkin_enabled) {
        handleAutoCheckIn(patrol);
      }
    } else {
      // Auto check-out if was inside and now outside
      if (insideZones.has(patrol.zone_id) && patrol.checked_in_at && !patrol.completed_at) {
        handleAutoCheckOut(patrol);
      }
    }
  });

  setInsideZones(newInsideZones);
}, [gpsLocation, activePatrols]);

const handleAutoCheckIn = async (patrol: Patrol) => {
  const { error } = await supabase
    .from('patrols')
    .update({
      checked_in_at: new Date().toISOString(),
      check_in_location_lat: gpsLocation?.lat,
      check_in_location_lng: gpsLocation?.lng,
      status: 'in_progress',
    })
    .eq('id', patrol.id);

  if (error) {
    console.error('Auto check-in failed:', error);
    return;
  }

  playSounds.success();
  toast.success(`🎯 Auto-signed on to ${patrol.zones.name}`, {
    description: 'Patrol started via geofence detection',
  });

  loadActivePatrols();
};

const handleAutoCheckOut = async (patrol: Patrol) => {
  const { error } = await supabase
    .from('patrols')
    .update({
      completed_at: new Date().toISOString(),
      status: 'completed',
    })
    .eq('id', patrol.id);

  if (error) {
    console.error('Auto check-out failed:', error);
    return;
  }

  toast.info(`👋 Auto-signed off from ${patrol.zones.name}`, {
    description: 'Left patrol zone',
  });

  loadActivePatrols();
};

// Utility function for point-in-polygon check
const isPointInZone = (
  lat: number,
  lng: number,
  geometry: any,
  bufferMeters: number = 100
): boolean => {
  // If no geometry, use radius from zone center
  if (!geometry || !geometry.coordinates) {
    return false;
  }

  // Simplified point-in-polygon check with buffer
  // TODO: Use turf.js for accurate geofencing
  const polygon = geometry.coordinates[0];
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > lng) !== (yj > lng))
        && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
};
```

**Benefits:**
- ✅ Officers notified of patrol assignments
- ✅ Accept/decline workflow
- ✅ Auto check-in when entering zone
- ✅ Auto check-out when leaving zone
- ✅ Manual override option available
- ✅ Audit trail of all actions

---

### **4. INVESTIGATION JOBS WORKFLOW STREAMLINING**

**Current Issues:**
- Too many fields in creation form
- No job templates for common scenarios
- No mobile-optimized job completion workflow
- No photo/evidence integration for field work

**Solution:** Smart Job Creation + Mobile Completion Workflow

```typescript
// InvestigationJobs.tsx - Job Templates
const JOB_TEMPLATES = {
  homeless_occupation: {
    job_type: 'homeless_occupation',
    priority: 'medium',
    instructions: 'Please visit the site and obtain up-to-date photographs showing: 1) Overall site layout, 2) Any structures/tents, 3) Vehicle registration plates if present, 4) Any hazards. Document number of people if present.',
    briefing_notes: '',
  },
  abandoned_vehicle: {
    job_type: 'abandoned_vehicle',
    priority: 'medium',
    instructions: 'Please verify vehicle is still present, photograph from all angles including: 1) Front/rear plates, 2) Interior condition, 3) Any damage, 4) Accumulation indicators (dust, flat tires).',
    briefing_notes: '',
  },
  unauthorized_structure: {
    job_type: 'unauthorized_structure',
    priority: 'high',
    instructions: 'Document structure type, dimensions, and assess public safety risks. Photograph from multiple angles.',
    briefing_notes: '',
  },
};

// Simplified Job Creation
const handleQuickCreateJob = async (templateKey: string, location: string) => {
  const template = JOB_TEMPLATES[templateKey];
  
  const { data, error } = await supabase
    .from('investigation_jobs')
    .insert({
      organization_id: user.organization_id,
      reference_number: generateReferenceNumber(),
      location_address: location,
      ...template,
      created_by: user.id,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;

  toast.success('Investigation job created');
  return data;
};
```

**Mobile Job Completion Workflow:**
```typescript
// FieldOfficerPortal.tsx - Investigation Jobs Tab
const [myJobs, setMyJobs] = useState<InvestigationJob[]>([]);

const CompleteJobWorkflow = ({ job }: { job: InvestigationJob }) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [findingsSummary, setFindingsSummary] = useState('');
  const [vehiclesFound, setVehiclesFound] = useState('');
  const [structuresFound, setStructuresFound] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);

  const handleCompleteJob = async () => {
    // Create investigation finding
    const { data: finding, error: findingError } = await supabase
      .from('investigation_findings')
      .insert({
        job_id: job.id,
        visit_date: new Date().toISOString(),
        arrived_at: new Date().toISOString(),
        departed_at: new Date().toISOString(),
        findings_summary: findingsSummary,
        vehicles_found: vehiclesFound,
        structures_found: structuresFound,
        evidence_photos: photos,
        follow_up_required: followUpRequired,
        completed_by: user.id,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (findingError) throw findingError;

    // Update job status
    const { error: jobError } = await supabase
      .from('investigation_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (jobError) throw jobError;

    toast.success('Investigation completed and reported');
  };

  return (
    <Dialog>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete Investigation: {job.reference_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Photo Capture */}
          <div>
            <Label>Evidence Photos</Label>
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handlePhotoUpload}
              className="hidden"
              ref={photoInputRef}
            />
            <Button onClick={() => photoInputRef.current?.click()}>
              <Camera className="h-4 w-4 mr-2" />
              Take Photos ({photos.length})
            </Button>
          </div>

          {/* Quick Findings */}
          <div>
            <Label>Findings Summary</Label>
            <Textarea
              value={findingsSummary}
              onChange={(e) => setFindingsSummary(e.target.value)}
              placeholder="Brief summary of what you found..."
              rows={3}
            />
          </div>

          {/* Vehicles Found */}
          <div>
            <Label>Vehicles Identified</Label>
            <Input
              value={vehiclesFound}
              onChange={(e) => setVehiclesFound(e.target.value)}
              placeholder="e.g., ABC123 (white van), XYZ789 (blue sedan)"
            />
          </div>

          {/* Structures Found */}
          <div>
            <Label>Structures/Tents</Label>
            <Input
              value={structuresFound}
              onChange={(e) => setStructuresFound(e.target.value)}
              placeholder="e.g., 1x blue tent, 2x tarps"
            />
          </div>

          {/* Follow-up */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="follow-up"
              checked={followUpRequired}
              onChange={(e) => setFollowUpRequired(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="follow-up" className="cursor-pointer">
              Follow-up required
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCompleteJob}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Complete Investigation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

**Benefits:**
- ✅ Pre-filled templates for common jobs
- ✅ Mobile-optimized completion workflow
- ✅ Photo capture built into completion
- ✅ Quick reporting with structured fields
- ✅ Automatic status updates

---

### **5. ENFORCEMENT SECTION REIMPLEMENTATION**

**Strategy:** Unified enforcement workflow accessible from both Admin and Officer portals

**Admin Portal Integration:**
```typescript
// AdminPortal.tsx - Add Enforcement Section
const EnforcementManagementSection = () => {
  return (
    <section>
      <h3 className="text-lg font-bold mb-3">Enforcement Management</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/enforcement">
          <Card className="hover:shadow-lg cursor-pointer">
            <CardContent className="p-6 text-center">
              <Shield className="h-8 w-8 mx-auto mb-2 text-red-600" />
              <div className="text-2xl font-black">{stats.active_breaches}</div>
              <div className="text-sm font-semibold">Active Breaches</div>
            </CardContent>
          </Card>
        </Link>
        
        <Link to="/enforcement?tab=jobs">
          <Card className="hover:shadow-lg cursor-pointer">
            <CardContent className="p-6 text-center">
              <User className="h-8 w-8 mx-auto mb-2 text-blue-600" />
              <div className="text-2xl font-black">{stats.enforcement_jobs}</div>
              <div className="text-sm font-semibold">Assigned Jobs</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
  );
};
```

**Officer Portal Integration:**
```typescript
// FieldOfficerPortal.tsx - My Enforcement Jobs
const MyEnforcementJobs = () => {
  const [myJobs, setMyJobs] = useState<EnforcementJob[]>([]);

  useEffect(() => {
    loadMyJobs();
  }, []);

  const loadMyJobs = async () => {
    const { data, error } = await supabase
      .from('enforcement_actions')
      .select(`
        *,
        zone:zones(name),
        canonical_vehicles(vehicle_make, vehicle_model, vehicle_color)
      `)
      .eq('assigned_to', user.id)
      .in('breach_status', ['assigned', 'in_progress'])
      .order('assigned_at', { ascending: false });

    if (error) throw error;
    setMyJobs(data || []);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          My Enforcement Jobs ({myJobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {myJobs.map(job => (
          <Card key={job.id} className="mb-3">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono font-bold text-lg">{job.plate_number}</div>
                  <div className="text-sm text-muted-foreground">{job.zone.name}</div>
                  <Badge variant="outline" className="mt-1">{job.action_type}</Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleCompleteJob(job)}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Complete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
};
```

**Benefits:**
- ✅ Admin can create and assign enforcement jobs
- ✅ Officer sees assigned jobs in field portal
- ✅ One-tap job completion with outcomes
- ✅ Automatic status updates and audit trail
- ✅ Real-time notifications

---

## ✅ **IMPLEMENTATION CHECKLIST**

### **Phase 1: Plate Capture (30 min)**
- [ ] Replace zoom buttons with slider
- [ ] Add localStorage persistence for zoom level
- [ ] Test zoom sticky behavior across sessions

### **Phase 2: Session History (1 hour)**
- [ ] Add 24-hour edit/delete window logic
- [ ] Add RLS policies for officer edit/delete
- [ ] Add org-wide 24-hour view toggle
- [ ] Add breach/homeless/at-risk highlighting
- [ ] Add filter buttons
- [ ] Add visual indicators for own scans

### **Phase 3: Patrol Management (1.5 hours)**
- [ ] Add notification fields to patrols table
- [ ] Create notification trigger function
- [ ] Build patrol notification UI in officer portal
- [ ] Implement accept/decline workflow
- [ ] Build geofence auto check-in/out system
- [ ] Test geofence detection accuracy

### **Phase 4: Investigation Jobs (1 hour)**
- [ ] Create job templates
- [ ] Simplify job creation form
- [ ] Build mobile completion workflow
- [ ] Integrate photo capture
- [ ] Add automatic status updates

### **Phase 5: Enforcement (1 hour)**
- [ ] Add enforcement section to admin portal
- [ ] Add enforcement jobs to officer portal
- [ ] Create unified job completion workflow
- [ ] Test end-to-end enforcement flow

**Total Estimated Time:** ~5 hours

---

## 🎯 **SUCCESS METRICS**

- ✅ **Zoom:** Persists across sessions (sticky state)
- ✅ **Session History:** Officers can edit/delete for 24h
- ✅ **Organization View:** All officers see org scans with highlighting
- ✅ **Patrol Notifications:** Officers receive and accept patrols
- ✅ **Geofence:** Auto check-in/out with 95% accuracy
- ✅ **Investigation Jobs:** Mobile completion workflow under 2 minutes
- ✅ **Enforcement:** Unified workflow accessible from admin + officer portals

---

**Status:** ✅ **READY FOR IMPLEMENTATION**

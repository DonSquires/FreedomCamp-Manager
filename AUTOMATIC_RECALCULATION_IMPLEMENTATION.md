# Automatic Compliance Recalculation Implementation

## Feature Overview

**Requirement:** When zone compliance matrix rules change, automatically recalculate compliance for affected observations.

**Current State:** Manual recalculation via AdminRecalculation page.

**Proposed State:** Automatic recalculation triggered by matrix changes, with optional admin approval.

---

## Implementation Strategy

### Option 1: Database Trigger (Immediate, Automatic)

**Trigger:** When `zone_compliance_matrix` table INSERT/UPDATE occurs
**Action:** Automatically queue recalculation job

**Pros:**
- ✅ Instant response to matrix changes
- ✅ No user action required
- ✅ Consistent behavior

**Cons:**
- ❌ No admin control/approval
- ❌ Can cause unexpected load
- ❌ May recalculate unnecessarily

**Implementation:**

```sql
-- Step 1: Create recalculation queue table
CREATE TABLE IF NOT EXISTS public.compliance_recalc_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  matrix_id_from UUID REFERENCES zone_compliance_matrix(id),
  matrix_id_to UUID NOT NULL REFERENCES zone_compliance_matrix(id),
  trigger_reason TEXT NOT NULL,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES user_profiles(id)
);

-- Create index for processing queue
CREATE INDEX idx_recalc_queue_status ON compliance_recalc_queue(status, queued_at);


-- Step 2: Create trigger function
CREATE OR REPLACE FUNCTION queue_automatic_recalculation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if this is a new active matrix or rules changed
  IF (TG_OP = 'INSERT' AND NEW.effective_to IS NULL) OR
     (TG_OP = 'UPDATE' AND 
      OLD.effective_to IS NULL AND 
      NEW.effective_to IS NULL AND
      (OLD.self_contained_required IS DISTINCT FROM NEW.self_contained_required OR
       OLD.nights_per_month IS DISTINCT FROM NEW.nights_per_month OR
       OLD.max_consecutive_nights IS DISTINCT FROM NEW.max_consecutive_nights OR
       OLD.day_visit_only IS DISTINCT FROM NEW.day_visit_only OR
       OLD.allowed_days IS DISTINCT FROM NEW.allowed_days OR
       OLD.homeless_exemption IS DISTINCT FROM NEW.homeless_exemption)) THEN
    
    -- Queue recalculation
    INSERT INTO compliance_recalc_queue (
      zone_id,
      matrix_id_from,
      matrix_id_to,
      trigger_reason,
      status,
      created_by
    ) VALUES (
      NEW.zone_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
      NEW.id,
      CASE 
        WHEN TG_OP = 'INSERT' THEN 'New compliance matrix created'
        WHEN TG_OP = 'UPDATE' THEN 'Compliance matrix rules changed: ' || NEW.change_reason
        ELSE 'Matrix updated'
      END,
      'queued',
      NEW.created_by
    );
    
    -- Create drift event notification
    INSERT INTO drift_events (
      zone_id,
      organization_id,
      matrix_version_from,
      matrix_version_to,
      matrix_id_from,
      matrix_id_to,
      criteria_changed,
      detected_at,
      detected_by,
      status
    ) VALUES (
      NEW.zone_id,
      NEW.organization_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.version ELSE NULL END,
      NEW.version,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
      NEW.id,
      jsonb_build_object(
        'self_contained_required', ARRAY[OLD.self_contained_required, NEW.self_contained_required],
        'nights_per_month', ARRAY[OLD.nights_per_month, NEW.nights_per_month],
        'max_consecutive_nights', ARRAY[OLD.max_consecutive_nights, NEW.max_consecutive_nights],
        'change_reason', NEW.change_reason
      ),
      NOW(),
      NEW.created_by,
      'pending'
    ) ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Queued automatic recalculation for zone % (matrix version %)', NEW.zone_id, NEW.version;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to zone_compliance_matrix table
DROP TRIGGER IF EXISTS trigger_auto_recalculation ON zone_compliance_matrix;
CREATE TRIGGER trigger_auto_recalculation
  AFTER INSERT OR UPDATE ON zone_compliance_matrix
  FOR EACH ROW
  EXECUTE FUNCTION queue_automatic_recalculation();
```

**Step 3: Create background worker Edge Function**

```typescript
// supabase/functions/process-recalc-queue/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * AUTOMATIC COMPLIANCE RECALCULATION QUEUE PROCESSOR
 * 
 * Runs on cron schedule (every 5 minutes) to process queued recalculations
 * Can also be invoked manually
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Checking recalculation queue...');

    // Get oldest queued item
    const { data: queueItems, error: queueError } = await supabaseAdmin
      .from('compliance_recalc_queue')
      .select('*')
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(1);

    if (queueError) throw queueError;

    if (!queueItems || queueItems.length === 0) {
      console.log('✅ Queue empty - no recalculations needed');
      return new Response(
        JSON.stringify({ message: 'Queue empty', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const queueItem = queueItems[0];
    console.log(`📦 Processing queue item ${queueItem.id} for zone ${queueItem.zone_id}`);

    // Mark as processing
    await supabaseAdmin
      .from('compliance_recalc_queue')
      .update({ status: 'processing' })
      .eq('id', queueItem.id);

    try {
      // Call recalculate-all-compliance Edge Function
      const { data: recalcResult, error: recalcError } = await supabaseAdmin.functions.invoke(
        'recalculate-all-compliance',
        {
          body: {
            scope: 'ZONE',
            zoneIds: [queueItem.zone_id],
            dateRangeStart: null, // All time
            dateRangeEnd: null,
            performedBy: queueItem.created_by || null,
          },
        }
      );

      if (recalcError) throw recalcError;

      console.log('✅ Recalculation completed:', recalcResult);

      // Mark as completed
      await supabaseAdmin
        .from('compliance_recalc_queue')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', queueItem.id);

      // Update drift event
      if (recalcResult.summary) {
        await supabaseAdmin
          .from('drift_events')
          .update({
            observations_affected: recalcResult.summary.processed || 0,
            compliance_changed: recalcResult.summary.complianceChanged || 0,
            status: 'completed',
          })
          .eq('zone_id', queueItem.zone_id)
          .eq('matrix_id_to', queueItem.matrix_id_to)
          .eq('status', 'pending');
      }

      return new Response(
        JSON.stringify({
          message: 'Recalculation completed',
          queueItemId: queueItem.id,
          summary: recalcResult.summary,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (processingError: any) {
      console.error('❌ Recalculation failed:', processingError);

      // Mark as failed
      await supabaseAdmin
        .from('compliance_recalc_queue')
        .update({
          status: 'failed',
          error_message: processingError.message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', queueItem.id);

      // Update drift event
      await supabaseAdmin
        .from('drift_events')
        .update({
          status: 'failed',
          remediation_notes: processingError.message,
        })
        .eq('zone_id', queueItem.zone_id)
        .eq('matrix_id_to', queueItem.matrix_id_to)
        .eq('status', 'pending');

      throw processingError;
    }
  } catch (error: any) {
    console.error('❌ Queue processor error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
```

**Step 4: Setup Cron Job**

In Supabase Dashboard → Database → Cron Jobs:

```sql
-- Run queue processor every 5 minutes
SELECT cron.schedule(
  'process-compliance-recalc-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/process-recalc-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

---

### Option 2: UI-Triggered with Approval (Recommended)

**Trigger:** Admin sees notification when matrix changes
**Action:** Admin clicks "Approve Recalculation" button

**Pros:**
- ✅ Admin control and visibility
- ✅ Can review changes before applying
- ✅ Prevents accidental recalculations

**Cons:**
- ❌ Requires admin action
- ❌ Delay between matrix change and recalculation

**Implementation:**

```typescript
// src/components/features/RecalcApprovalBanner.tsx

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RefreshCw, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface PendingRecalculation {
  id: string;
  zone_id: string;
  zone_name: string;
  trigger_reason: string;
  queued_at: string;
  matrix_changes: string[];
}

export function RecalcApprovalBanner() {
  const [pending, setPending] = useState<PendingRecalculation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadPending();

    // Real-time subscription for new queue items
    const channel = supabase
      .channel('recalc_queue_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'compliance_recalc_queue',
          filter: 'status=eq.queued',
        },
        () => {
          loadPending();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadPending = async () => {
    const { data, error } = await supabase
      .from('compliance_recalc_queue')
      .select(`
        id,
        zone_id,
        trigger_reason,
        queued_at,
        zones(name)
      `)
      .eq('status', 'queued')
      .order('queued_at', { ascending: true });

    if (error) {
      console.error('Failed to load pending recalculations:', error);
      return;
    }

    setPending(data.map(item => ({
      id: item.id,
      zone_id: item.zone_id,
      zone_name: (item.zones as any)?.name || 'Unknown Zone',
      trigger_reason: item.trigger_reason,
      queued_at: item.queued_at,
      matrix_changes: [], // Parse from trigger_reason
    })));
  };

  const handleApprove = async (queueId: string) => {
    setIsProcessing(true);
    try {
      // Manually invoke queue processor for this specific item
      const { error } = await supabase.functions.invoke('process-recalc-queue', {
        body: { queueId },
      });

      if (error) throw error;

      toast.success('Recalculation started');
      loadPending();
    } catch (error: any) {
      toast.error('Failed to start recalculation: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismiss = async (queueId: string) => {
    try {
      const { error } = await supabase
        .from('compliance_recalc_queue')
        .update({ status: 'dismissed' })
        .eq('id', queueId);

      if (error) throw error;

      toast.success('Recalculation dismissed');
      loadPending();
    } catch (error: any) {
      toast.error('Failed to dismiss: ' + error.message);
    }
  };

  if (pending.length === 0) return null;

  return (
    <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="flex items-center justify-between">
        <span>Pending Compliance Recalculations</span>
        <Badge variant="default" className="bg-amber-600">
          {pending.length} pending
        </Badge>
      </AlertTitle>
      <AlertDescription className="mt-3 space-y-3">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Compliance matrix rules have changed. Review and approve recalculation for affected zones.
        </p>
        
        {pending.map((item) => (
          <Card key={item.id} className="bg-white dark:bg-gray-900">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{item.zone_name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.trigger_reason}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Queued: {new Date(item.queued_at).toLocaleString('en-NZ')}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDismiss(item.id)}
                    className="h-8 text-xs"
                    disabled={isProcessing}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleApprove(item.id)}
                    className="h-8 text-xs"
                    disabled={isProcessing}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Approve & Run
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </AlertDescription>
    </Alert>
  );
}
```

**Add to AdminPortal:**
```typescript
// In src/pages/AdminPortal.tsx, add at top of dashboard:

import { RecalcApprovalBanner } from '@/components/features/RecalcApprovalBanner';

// In render:
<div className="space-y-6">
  <RecalcApprovalBanner />
  {/* Rest of dashboard */}
</div>
```

---

### Option 3: Hybrid Approach (Best of Both)

**Trigger:** Automatic queue + Manual approval for critical changes

**Rules:**
- **Auto-run immediately:** Minor changes (allowed_days adjustment)
- **Require approval:** Major changes (self_contained_required, max_consecutive_nights)

**Implementation:**

Modify trigger function:
```sql
CREATE OR REPLACE FUNCTION queue_automatic_recalculation()
RETURNS TRIGGER AS $$
DECLARE
  requires_approval BOOLEAN := FALSE;
  auto_process BOOLEAN := FALSE;
BEGIN
  -- Detect major vs minor changes
  IF (TG_OP = 'UPDATE' AND OLD.effective_to IS NULL AND NEW.effective_to IS NULL) THEN
    -- Major changes require approval
    IF (OLD.self_contained_required IS DISTINCT FROM NEW.self_contained_required OR
        OLD.max_consecutive_nights IS DISTINCT FROM NEW.max_consecutive_nights OR
        OLD.nights_per_month IS DISTINCT FROM NEW.nights_per_month) THEN
      requires_approval := TRUE;
    -- Minor changes auto-process
    ELSIF (OLD.allowed_days IS DISTINCT FROM NEW.allowed_days OR
           OLD.day_visit_only IS DISTINCT FROM NEW.day_visit_only) THEN
      auto_process := TRUE;
    END IF;
  END IF;

  IF requires_approval OR auto_process THEN
    INSERT INTO compliance_recalc_queue (
      zone_id,
      matrix_id_from,
      matrix_id_to,
      trigger_reason,
      status,
      requires_approval,
      created_by
    ) VALUES (
      NEW.zone_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
      NEW.id,
      NEW.change_reason,
      CASE WHEN auto_process THEN 'auto-process' ELSE 'queued' END,
      requires_approval,
      NEW.created_by
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Recommendation

**Use Option 2: UI-Triggered with Approval** for initial implementation.

**Why:**
1. ✅ Gives admins visibility and control
2. ✅ Prevents unexpected performance impact
3. ✅ Allows review before applying changes
4. ✅ Simpler to implement and test
5. ✅ Can upgrade to Option 3 later if needed

**Upgrade Path:**
1. Deploy Option 2 first (queue + approval banner)
2. Gather feedback on usage patterns
3. Identify which changes are always approved
4. Upgrade to Option 3 (hybrid) with auto-run rules

---

## Deployment Steps

1. **Run database migrations:**
   ```sql
   -- Create compliance_recalc_queue table
   -- Create queue_automatic_recalculation() function
   -- Create trigger on zone_compliance_matrix
   ```

2. **Deploy Edge Function:**
   ```bash
   supabase functions deploy process-recalc-queue
   ```

3. **Add UI component:**
   - Create RecalcApprovalBanner component
   - Add to AdminPortal
   - Test with matrix change

4. **Test flow:**
   - Change matrix rules for a zone
   - Verify queue item created
   - Check banner appears
   - Click "Approve & Run"
   - Verify recalculation completes

5. **Monitor:**
   - Check queue processing logs
   - Review drift events created
   - Verify compliance results updated

---

## Future Enhancements

- **Batch Approval:** Approve multiple zones at once
- **Scheduled Processing:** Run recalculations during off-peak hours
- **Impact Preview:** Show estimated affected observations before approval
- **Auto-approval Rules:** Configure which changes auto-run
- **Notification System:** Email/SMS alerts when approval needed

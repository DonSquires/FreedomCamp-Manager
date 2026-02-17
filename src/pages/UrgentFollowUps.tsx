import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, FileText, Home, Loader2, CheckCircle2, Camera, Bug, ArrowRight, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface FollowUpCounts {
  breaches: number;
  incidents: number;
  homeless: number;
  bugs: number;
}

interface UrgentFollowUpsProps {
  onTabChange?: (tab: string) => void;
}

export function UrgentFollowUps({ onTabChange }: UrgentFollowUpsProps = {}) {
  const [isLoading, setIsLoading] = useState(true);
  const [counts, setCounts] = useState<FollowUpCounts>({
    breaches: 0,
    incidents: 0,
    homeless: 0,
    bugs: 0,
  });

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    setIsLoading(true);
    try {
      // Get user profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) throw new Error('Organization not found');
      
      const isMaster = profile.role === 'master';

      // Count ACTIVE breaches that need action (status='active' AND not resolved)
      const { count: breachCount } = await supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('status', 'active')
        .is('resolved_at', null); // ✅ Only breaches NOT yet resolved

      // Count PENDING incidents awaiting admin approval (court_ready=false AND status='pending')
      const { count: incidentCount } = await supabase
        .from('incidents')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('court_ready', false)
        .in('status', ['pending', 'submitted']) // ✅ Only incidents awaiting review
        .is('approved_at', null); // ✅ Not yet approved

      // Count UNCONFIRMED homeless claims (claimed but not confirmed)
      const { count: homelessCount } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('homeless_status', 'claimed') // ✅ Only claimed, not confirmed
        .is('homeless_confirmed_at', null); // ✅ Not yet confirmed by admin

      // Count NEW bug reports (masters only - submitted but not acknowledged)
      let bugCount = 0;
      if (isMaster) {
        const { count } = await supabase
          .from('bug_reports')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'submitted') // ✅ Only newly submitted
          .eq('requires_human_review', true); // ✅ Needs human attention
        bugCount = count || 0;
      }

      setCounts({
        breaches: breachCount || 0,
        incidents: incidentCount || 0,
        homeless: homelessCount || 0,
        bugs: bugCount,
      });
    } catch (error: any) {
      console.error('❌ Failed to load counts:', error);
      toast.error('Failed to load follow-up counts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = (tabName: string, filterKey?: string) => {
    // Set filter in localStorage so target page can read it
    if (filterKey) {
      localStorage.setItem('urgent_followup_filter', filterKey);
    }
    
    if (onTabChange) {
      onTabChange(tabName);
      setSidebarOpen(false); // Close mobile sidebar if open
    } else {
      console.error('Navigation not available - onTabChange prop missing');
      toast.error('Navigation error - please use the menu');
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const totalItems = counts.breaches + counts.incidents + counts.homeless + counts.bugs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          Urgent Follow-Ups
        </h2>
        <p className="text-muted-foreground">
          {totalItems === 0 ? 'No items requiring attention' : `${totalItems} item${totalItems !== 1 ? 's' : ''} requiring immediate attention`}
        </p>
      </div>

      {/* Quick Access Guidance */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-300 dark:border-blue-700 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <Shield className="h-6 w-6 text-blue-600 shrink-0 mt-1" />
          <div>
            <h3 className="font-bold text-lg text-blue-900 dark:text-blue-100 mb-2">Quick Access Guide</h3>
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
              Click any card below to navigate directly to the appropriate management page where you can take action.
            </p>
            <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <li>• <strong>Unresolved Breaches</strong> → Enforcement Hub page (view, assign, resolve breaches)</li>
              <li>• <strong>Incidents Awaiting Approval</strong> → Incident Reports page (review, approve for court)</li>
              <li>• <strong>Homeless Claims (Unconfirmed)</strong> → Special Vehicles page (confirm or dismiss claims)</li>
              <li>• <strong>New Bug Reports</strong> → Bug Reports Management page (analyze, update status)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Follow-Up Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Breaches */}
        <Card 
          className="cursor-pointer hover:shadow-lg hover:border-red-400 transition-all group"
          onClick={() => handleNavigate('enforcement-hub', 'unresolved_breaches')}
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">Unresolved Breaches</p>
                <p className="text-4xl font-bold text-red-600 mb-2">{counts.breaches}</p>
                <p className="text-xs text-red-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Go to Enforcement Hub
                  <ArrowRight className="h-3 w-3" />
                </p>
              </div>
              <FileText className="h-12 w-12 text-red-500 opacity-20 group-hover:opacity-40 transition-opacity" />
            </div>
            {counts.breaches > 0 && (
              <Badge variant="destructive" className="w-full justify-center">
                Requires Action
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Pending Incidents */}
        <Card 
          className="cursor-pointer hover:shadow-lg hover:border-orange-400 transition-all group"
          onClick={() => handleNavigate('incident-reports', 'pending_approval')}
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">Incidents Awaiting Approval</p>
                <p className="text-4xl font-bold text-orange-600 mb-2">{counts.incidents}</p>
                <p className="text-xs text-orange-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Go to Incident Reports
                  <ArrowRight className="h-3 w-3" />
                </p>
              </div>
              <Camera className="h-12 w-12 text-orange-500 opacity-20 group-hover:opacity-40 transition-opacity" />
            </div>
            {counts.incidents > 0 && (
              <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 w-full justify-center border-orange-300">
                Review Required
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Homeless Claims */}
        <Card 
          className="cursor-pointer hover:shadow-lg hover:border-cyan-400 transition-all group"
          onClick={() => handleNavigate('special-vehicles', 'homeless_pending')}
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">Homeless Claims (Unconfirmed)</p>
                <p className="text-4xl font-bold text-cyan-600 mb-2">{counts.homeless}</p>
                <p className="text-xs text-cyan-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Go to Special Vehicles
                  <ArrowRight className="h-3 w-3" />
                </p>
              </div>
              <Home className="h-12 w-12 text-cyan-500 opacity-20 group-hover:opacity-40 transition-opacity" />
            </div>
            {counts.homeless > 0 && (
              <Badge className="bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300 w-full justify-center border-cyan-300">
                Awaiting Confirmation
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Bug Reports */}
        <Card 
          className="cursor-pointer bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 hover:shadow-lg hover:border-red-400 transition-all group"
          onClick={() => handleNavigate('bug-reports')}
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <p className="text-sm text-red-700 dark:text-red-300 mb-1 font-semibold">New Bug Reports</p>
                <p className="text-4xl font-bold text-red-600 mb-2">{counts.bugs}</p>
                <p className="text-xs text-red-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Go to Bug Reports
                  <ArrowRight className="h-3 w-3" />
                </p>
              </div>
              <Bug className="h-12 w-12 text-red-500 opacity-30 group-hover:opacity-50 transition-opacity" />
            </div>
            {counts.bugs > 0 && (
              <Badge variant="destructive" className="w-full justify-center">
                Needs Analysis
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {/* All Clear Message */}
      {totalItems === 0 && (
        <Card className="border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-600" />
            <h3 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
              All Caught Up!
            </h3>
            <p className="text-green-700 dark:text-green-300">
              No urgent follow-ups requiring attention at this time.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

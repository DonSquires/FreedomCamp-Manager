/**
 * SessionList Component - Admin session management
 * Allows admins to view and terminate user sessions
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Monitor,
  Loader2,
  RefreshCw,
  XCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface UserSession {
  id: string;
  user_id: string;
  session_token: string;
  device_info: {
    userAgent?: string;
    platform?: string;
    screenResolution?: string;
    timestamp?: string;
  };
  ip_address: string | null;
  login_at: string;
  last_activity_at: string;
  expires_at: string;
  is_active: boolean;
  terminated_by: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  user_profiles: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
  } | null;
}

export function SessionList() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTerminating, setIsTerminating] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();

    // Realtime subscription for session changes
    const channel = supabase
      .channel('session-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_sessions',
        },
        () => {
          loadSessions();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const loadSessions = async () => {
    try {
      let query = supabase
        .from('user_sessions')
        .select(`
          *,
          user_profiles (
            first_name,
            last_name,
            email,
            role
          )
        `)
        .order('login_at', { ascending: false });

      // Non-master users only see their org's sessions
      if (user?.role !== 'master') {
        const { data: orgUsers } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('organization_id', user?.organization_id);

        if (orgUsers) {
          const userIds = orgUsers.map(u => u.id);
          query = query.in('user_id', userIds);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setSessions(data || []);
    } catch (error: any) {
      console.error('Failed to load sessions:', error);
      toast.error('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to terminate this session? The user will be logged out immediately.')) {
      return;
    }

    setIsTerminating(sessionId);

    try {
      const { error } = await supabase.rpc('terminate_user_session', {
        p_session_id: sessionId,
        p_reason: 'Admin terminated session',
      });

      if (error) throw error;

      toast.success('Session terminated successfully');
      loadSessions();
    } catch (error: any) {
      console.error('Failed to terminate session:', error);
      toast.error('Failed to terminate session: ' + error.message);
    } finally {
      setIsTerminating(null);
    }
  };

  const getDeviceName = (deviceInfo: any) => {
    if (!deviceInfo || typeof deviceInfo !== 'object') return 'Unknown Device';
    
    const ua = deviceInfo.userAgent || '';
    if (ua.includes('Mobile') || ua.includes('Android') || ua.includes('iPhone')) {
      return '📱 Mobile Device';
    } else if (ua.includes('iPad') || ua.includes('Tablet')) {
      return '📱 Tablet';
    } else {
      return '💻 Desktop';
    }
  };

  const getTimeSinceActivity = (timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = Math.floor((now - then) / 1000 / 60); // minutes

    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const activeSessions = sessions.filter(s => s.is_active && !isExpired(s.expires_at));
  const inactiveSessions = sessions.filter(s => !s.is_active || isExpired(s.expires_at));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Monitor className="h-6 w-6" />
            Active User Sessions
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage active login sessions across devices
          </p>
        </div>
        <Button variant="outline" onClick={loadSessions} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Sessions</p>
                <p className="text-3xl font-bold text-green-600">{activeSessions.length}</p>
              </div>
              <CheckCircle2 className="h-10 w-10 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Terminated</p>
                <p className="text-3xl font-bold text-red-600">{inactiveSessions.length}</p>
              </div>
              <XCircle className="h-10 w-10 text-red-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Unique Users</p>
                <p className="text-3xl font-bold text-blue-600">
                  {new Set(activeSessions.map(s => s.user_id)).size}
                </p>
              </div>
              <Monitor className="h-10 w-10 text-blue-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Active Sessions ({activeSessions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold truncate">
                          {session.user_profiles?.first_name} {session.user_profiles?.last_name}
                        </h4>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                          Active
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {session.user_profiles?.role}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate mb-2">
                        {session.user_profiles?.email}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" />
                          {getDeviceName(session.device_info)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last active: {getTimeSinceActivity(session.last_activity_at)}
                        </div>
                        <div className="truncate" title={session.device_info?.userAgent}>
                          {session.device_info?.platform || 'Unknown OS'}
                        </div>
                        <div>
                          Logged in: {getTimeSinceActivity(session.login_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleTerminateSession(session.id)}
                      disabled={isTerminating === session.id}
                    >
                      {isTerminating === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 mr-1" />
                          Terminate
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Terminated Sessions */}
      {inactiveSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              Recent Terminated Sessions ({inactiveSessions.slice(0, 10).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactiveSessions.slice(0, 10).map((session) => (
                <div
                  key={session.id}
                  className="p-3 border rounded-lg bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm truncate">
                          {session.user_profiles?.first_name} {session.user_profiles?.last_name}
                        </p>
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-xs">
                          Terminated
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-1">
                        {session.user_profiles?.email}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{getDeviceName(session.device_info)}</span>
                        {session.termination_reason && (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {session.termination_reason}
                          </span>
                        )}
                        {session.terminated_at && (
                          <span>Ended: {getTimeSinceActivity(session.terminated_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Sessions */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No sessions found</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

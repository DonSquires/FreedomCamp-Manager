import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore';
import { useHybridWorkspaceHandshake } from '@/hooks/useHybridWorkspaceHandshake';

type GeoPoint = {
  latitude: number;
  longitude: number;
};

export function JurisdictionBanner() {
  const user = useAuthStore((state) => state.user);
  const preferredClientOrgId = useGlobalFiltersStore((state) => state.organizationId);

  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [gpsAvailable, setGpsAvailable] = useState(true);
  const pollInFlightRef = useRef(false);

  const providerOrgId = useMemo(
    () => user?.employer_organization_id || user?.organization_id || null,
    [user?.employer_organization_id, user?.organization_id],
  );

  useEffect(() => {
    if (!user || !navigator?.geolocation) {
      setGpsAvailable(false);
      return;
    }

    let cancelled = false;

    const refreshLocation = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 20_000,
          });
        });

        if (!cancelled) {
          setGpsAvailable(true);
          setCoords({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        }
      } catch {
        if (!cancelled) {
          setGpsAvailable(false);
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void refreshLocation();
    const interval = setInterval(() => void refreshLocation(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  const { data: handshake } = useHybridWorkspaceHandshake({
    providerOrgId,
    longitude: coords?.longitude,
    latitude: coords?.latitude,
    preferredClientOrgId,
    userId: user?.id,
    enabled: !!user,
  });

  if (!user) return null;

  const matched = handshake?.matched === true;
  const conflict = handshake?.conflict === true;
  const handshakeActive = handshake?.handshake_active === true;
  const translationActive = handshake?.translation_active === true;

  const title = !gpsAvailable
    ? 'GPS Unavailable - Context Locked'
    : conflict
      ? 'Multiple Jurisdictions Detected'
      : handshakeActive
        ? 'Client Jurisdiction Active'
        : matched
          ? 'Standard Patrol Mode'
          : 'Outside Contracted Zone';

  const subtitle = !gpsAvailable
    ? 'Enable location to auto-switch workspace rules and translation mode.'
    : conflict
      ? 'Select a client context to complete workspace handshake.'
      : handshakeActive
        ? `${handshake?.workspace_name || 'Client Workspace'} - ${translationActive ? 'Translation Available' : 'Translation Off'}`
        : matched
          ? 'Provider workspace rules in effect.'
          : handshake?.reason || 'No active zone + contract handshake at this location.';

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border px-4 py-3 backdrop-blur-sm',
        conflict
          ? 'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
          : handshakeActive
            ? 'border-cyan-200 bg-cyan-50/80 text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100'
            : 'border-slate-200 bg-white/85 text-slate-800 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {handshakeActive && (
          <Badge className="bg-cyan-600 text-white hover:bg-cyan-700">Hybrid Workspace</Badge>
        )}
        {translationActive && (
          <Badge variant="outline">Hindi Translation</Badge>
        )}
        {handshake?.ptt_channel ? (
          <Badge variant="outline">PTT: {handshake.ptt_channel}</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-xs opacity-85">{subtitle}</p>
    </div>
  );
}

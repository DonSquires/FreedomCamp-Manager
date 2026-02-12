
/**
 * NotificationCenter Component - Split-Screen Layout for PlateCapture
 * Displays scan alerts in top half of screen with larger cards for violations/H&S
 * Allows click-through to vehicle details without leaving camera screen
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  X,
  Flag,
  AlertTriangle,
  Activity,
  MapPin,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useNotifications, type Notification } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface NotificationCenterProps {
  onNotificationClick?: (notification: Notification) => void;
  className?: string;
}

export function NotificationCenter({ onNotificationClick, className }: NotificationCenterProps) {
  const {
    notifications,
    markAsRead,
    clearNotification,
  } = useNotifications();

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'flagged_vehicle':
        return <Flag className="h-6 w-6 text-red-500" />;
      case 'breach_alert':
        return <AlertTriangle className="h-6 w-6 text-amber-500" />;
      case 'almost_breach':
        return <AlertTriangle className="h-6 w-6 text-orange-600" />;
      case 'hs_report':
        return <Activity className="h-6 w-6 text-orange-500" />;
      case 'homeless_confirmed':
        return <MapPin className="h-6 w-6 text-blue-500" />;
      default:
        return <AlertTriangle className="h-6 w-6 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: Notification['severity']) => {
    switch (severity) {
      case 'urgent':
        return 'border-red-600 bg-red-100 dark:bg-red-950/40';
      case 'warning':
        return 'border-amber-600 bg-amber-100 dark:bg-amber-950/40';
      case 'info':
        return 'border-blue-600 bg-blue-100 dark:bg-blue-950/40';
      default:
        return 'border-gray-300 dark:border-gray-700';
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    onNotificationClick?.(notification);
  };

  // Separate notifications by priority
  const criticalBreachNotifications = notifications.filter(
    n => n.type === 'almost_breach' && n.metadata?.willBreachTonight
  );
  const urgentNotifications = notifications.filter(
    n => (n.severity === 'urgent' || n.severity === 'warning') && !(n.type === 'almost_breach' && n.metadata?.willBreachTonight)
  );
  const infoNotifications = notifications.filter(
    n => n.severity === 'info'
  );

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className={cn('w-full', className)}>
      <ScrollArea className="h-full">
        <div className="p-3 space-y-3">
          {/* CRITICAL BREACH ALERTS - Largest, Most Prominent */}
          {criticalBreachNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={cn(
                'border-4 shadow-2xl cursor-pointer transition-all hover:shadow-3xl active:scale-[0.98] touch-manipulation',
                'border-red-600 bg-gradient-to-br from-red-100 via-orange-100 to-red-100 dark:from-red-950/60 dark:via-orange-950/60 dark:to-red-950/60',
                !notification.read && 'ring-8 ring-red-300 dark:ring-red-700 animate-pulse'
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <CardContent className="p-5 space-y-4">
                {/* Header with Prominent Badge */}
                <div className="flex items-start gap-4">
                  <div className="shrink-0 mt-1 bg-red-600 rounded-full p-3 shadow-xl">
                    <AlertTriangle className="h-8 w-8 text-white" strokeWidth={3} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1">
                        <Badge
                          variant="destructive"
                          className="mb-3 text-sm font-black px-4 py-1.5 bg-red-700 text-white shadow-lg"
                        >
                          🚨 CRITICAL - WILL BREACH TONIGHT
                        </Badge>
                        <h3 className="font-black text-2xl leading-tight text-red-900 dark:text-red-100">
                          {notification.title}
                        </h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearNotification(notification.id);
                        }}
                        className="h-10 w-10 shrink-0 hover:bg-black/10 dark:hover:bg-white/10 touch-manipulation"
                      >
                        <X className="h-5 w-5" />
                      </Button>
                    </div>
                    <p className="text-base text-foreground font-bold whitespace-pre-line">
                      {notification.message}
                    </p>
                  </div>
                </div>

                {/* Vehicle Photo - Extra Large for Critical Alerts */}
                {(notification.metadata?.profilePhotoUrl || notification.metadata?.photoUrl) && (
                  <div className="relative rounded-xl overflow-hidden border-4 border-red-500 shadow-2xl ring-4 ring-red-300">
                    <img
                      src={notification.metadata.profilePhotoUrl || notification.metadata.photoUrl}
                      alt="Vehicle identification photo"
                      className="w-full h-64 object-cover"
                    />
                    {/* Badge showing photo source */}
                    {notification.metadata.profilePhotoUrl && (
                      <div className="absolute top-3 right-3 bg-green-600/95 text-white px-3 py-1.5 rounded-lg text-sm font-bold backdrop-blur-sm shadow-xl border-2 border-white/50">
                        ✓ Profile Photo
                      </div>
                    )}
                    {notification.metadata.plateNumber && (
                      <div className="absolute bottom-4 left-4 bg-black/95 text-white px-5 py-3 rounded-xl font-mono font-black text-2xl backdrop-blur-sm shadow-2xl border-4 border-white/40">
                        {notification.metadata.plateNumber}
                      </div>
                    )}
                  </div>
                )}

                {/* Breach Prediction Details - Prominent */}
                <div className="grid grid-cols-2 gap-3 text-sm bg-red-50 dark:bg-red-950/40 rounded-xl p-4 border-2 border-red-400">
                  <div className="col-span-2">
                    <div className="bg-red-600 text-white rounded-lg p-3 shadow-lg">
                      <p className="font-black text-lg flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        ⚠️ ACTION REQUIRED: Advise vehicle owner to leave BEFORE nightfall
                      </p>
                    </div>
                  </div>
                  {notification.metadata?.consecutiveNights !== undefined && (
                    <div className="bg-white dark:bg-red-900/30 rounded-lg p-3 border-2 border-red-300">
                      <span className="text-muted-foreground font-semibold block mb-1">Consecutive Nights:</span>
                      <span className="font-black text-2xl text-red-700 dark:text-red-300">
                        {notification.metadata.consecutiveNights + 1}/{notification.metadata.consecutiveAllowed}
                      </span>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-bold">If stays tonight</p>
                    </div>
                  )}
                  {notification.metadata?.nightsStayed !== undefined && (
                    <div className="bg-white dark:bg-red-900/30 rounded-lg p-3 border-2 border-red-300">
                      <span className="text-muted-foreground font-semibold block mb-1">Monthly Total:</span>
                      <span className="font-black text-2xl text-red-700 dark:text-red-300">
                        {notification.metadata.nightsStayed + 1}/{notification.metadata.nightsAllowed}
                      </span>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-bold">If stays tonight</p>
                    </div>
                  )}
                  {notification.metadata?.vehicleMake && (
                    <div className="col-span-2 bg-white dark:bg-red-900/30 rounded-lg p-3 border-2 border-red-300">
                      <span className="text-muted-foreground font-semibold block mb-1">Vehicle:</span>
                      <span className="font-bold text-lg">
                        {notification.metadata.vehicleMake} {notification.metadata.vehicleModel} • {notification.metadata.vehicleColor}
                      </span>
                    </div>
                  )}
                  {notification.metadata?.zoneName && (
                    <div className="col-span-2 bg-white dark:bg-red-900/30 rounded-lg p-3 border-2 border-red-300">
                      <span className="text-muted-foreground font-semibold block mb-1">Location:</span>
                      <span className="font-bold text-lg">📍 {notification.metadata.zoneName}</span>
                    </div>
                  )}
                </div>

                {/* GPS Location */}
                {notification.metadata?.gpsLocation && (
                  <a
                    href={`https://maps.google.com/?q=${notification.metadata.gpsLocation.lat},${notification.metadata.gpsLocation.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-3 p-4 bg-blue-600 hover:bg-blue-700 rounded-xl border-3 border-blue-400 transition-colors shadow-lg"
                  >
                    <MapPin className="h-6 w-6 text-white shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">
                        🗺️ Open in Google Maps
                      </p>
                      <p className="text-xs text-blue-100 font-mono">
                        {notification.metadata.gpsLocation.lat.toFixed(6)}, {notification.metadata.gpsLocation.lng.toFixed(6)}
                      </p>
                    </div>
                    <ExternalLink className="h-5 w-5 text-white shrink-0" />
                  </a>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t-2 border-red-300">
                  <p className="text-sm text-muted-foreground font-bold">
                    {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 text-sm font-black gap-2 bg-red-600 text-white hover:bg-red-700 touch-manipulation"
                  >
                    Take Action Now
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* URGENT/WARNING Notifications - Larger, Pinned to Top */}
          {urgentNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={cn(
                'border-3 shadow-lg cursor-pointer transition-all hover:shadow-xl active:scale-[0.98] touch-manipulation',
                getSeverityColor(notification.severity),
                !notification.read && 'ring-4 ring-primary/30 animate-pulse'
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <Badge
                          variant="destructive"
                          className={cn(
                            'mb-2 text-xs font-bold',
                            notification.severity === 'urgent' && 'bg-red-600',
                            notification.severity === 'warning' && 'bg-amber-600'
                          )}
                        >
                          {notification.severity === 'urgent' ? '🚨 URGENT' : '⚠️ WARNING'}
                        </Badge>
                        <h3 className="font-bold text-lg leading-tight">
                          {notification.title}
                        </h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearNotification(notification.id);
                        }}
                        className="h-8 w-8 shrink-0 hover:bg-black/10 dark:hover:bg-white/10 touch-manipulation"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-line font-medium">
                      {notification.message}
                    </p>
                  </div>
                </div>

                {/* Vehicle Photo - Prioritize profile photo for consistent identification */}
                {(notification.metadata?.profilePhotoUrl || notification.metadata?.photoUrl) && (
                  <div className="relative rounded-xl overflow-hidden border-4 border-white/70 shadow-2xl">
                    <img
                      src={notification.metadata.profilePhotoUrl || notification.metadata.photoUrl}
                      alt="Vehicle identification photo"
                      className="w-full h-56 object-cover"
                    />
                    {/* Badge showing photo source */}
                    {notification.metadata.profilePhotoUrl && (
                      <div className="absolute top-2 right-2 bg-green-600/90 text-white px-2 py-1 rounded-md text-xs font-bold backdrop-blur-sm shadow-lg">
                        ✓ Profile Photo
                      </div>
                    )}
                    {notification.metadata.plateNumber && (
                      <div className="absolute bottom-3 left-3 bg-black/90 text-white px-4 py-2 rounded-lg font-mono font-bold text-xl backdrop-blur-sm shadow-xl border-2 border-white/30">
                        {notification.metadata.plateNumber}
                      </div>
                    )}
                  </div>
                )}

                {/* Vehicle Details */}
                {notification.metadata && (
                  <div className="grid grid-cols-2 gap-2 text-xs bg-white/50 dark:bg-black/20 rounded-lg p-3 border border-black/10">
                    {notification.metadata.plateNumber && (
                      <div>
                        <span className="text-muted-foreground">Plate:</span>
                        <span className="font-mono font-bold ml-1">
                          {notification.metadata.plateNumber}
                        </span>
                      </div>
                    )}
                    {notification.metadata.vehicleMake && (
                      <div>
                        <span className="text-muted-foreground">Vehicle:</span>
                        <span className="font-semibold ml-1">
                          {notification.metadata.vehicleMake} {notification.metadata.vehicleModel}
                        </span>
                      </div>
                    )}
                    {notification.metadata.zoneName && (
                      <div>
                        <span className="text-muted-foreground">Zone:</span>
                        <span className="font-semibold ml-1">
                          {notification.metadata.zoneName}
                        </span>
                      </div>
                    )}
                    {notification.metadata.priorVisits !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Prior Visits:</span>
                        <span className="font-semibold ml-1">
                          {notification.metadata.priorVisits}
                        </span>
                      </div>
                    )}
                    {/* Homeless Status Badge */}
                    {notification.metadata?.homelessStatus && (
                      <div className="col-span-2">
                        <div className="bg-cyan-100 dark:bg-cyan-950/40 border-2 border-cyan-500 rounded-md p-2">
                          <p className="text-cyan-900 dark:text-cyan-100 font-bold text-xs flex items-center gap-1">
                            🏕️ HOMELESS STATUS: {notification.metadata.homelessStatus === 'confirmed' ? 'CONFIRMED (EXEMPT)' : 'CLAIMED'}
                          </p>
                          {notification.metadata.homelessStatus === 'confirmed' && (
                            <p className="text-cyan-700 dark:text-cyan-300 text-[10px] mt-1 italic">
                              Protected under Freedom Camping Act (NZ) - No enforcement action
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Almost Breach Details */}
                    {notification.type === 'almost_breach' && notification.metadata.willBreachTonight && (
                      <>
                        <div className="col-span-2">
                          <div className="bg-red-100 dark:bg-red-950/40 border-2 border-red-500 rounded-md p-2">
                            <p className="text-red-900 dark:text-red-100 font-bold text-sm flex items-center gap-1">
                              <AlertTriangle className="h-4 w-4" />
                              🚨 WILL BREACH IF STAYS TONIGHT
                            </p>
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Consecutive:</span>
                          <span className={`font-bold ml-1 ${notification.metadata.consecutiveNights + 1 > notification.metadata.consecutiveAllowed ? 'text-red-600' : ''}`}>
                            {notification.metadata.consecutiveNights + 1}/{notification.metadata.consecutiveAllowed}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Monthly:</span>
                          <span className={`font-bold ml-1 ${notification.metadata.nightsStayed + 1 > notification.metadata.nightsAllowed ? 'text-red-600' : ''}`}>
                            {notification.metadata.nightsStayed + 1}/{notification.metadata.nightsAllowed}
                          </span>
                        </div>
                      </>
                    )}
                    {notification.type === 'almost_breach' && !notification.metadata.willBreachTonight && (
                      <>
                        <div>
                          <span className="text-muted-foreground">Consecutive:</span>
                          <span className="font-semibold ml-1">
                            {notification.metadata.consecutiveNights}/{notification.metadata.consecutiveAllowed}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Monthly:</span>
                          <span className="font-semibold ml-1">
                            {notification.metadata.nightsStayed}/{notification.metadata.nightsAllowed}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
                
                {/* GPS Location with Google Maps Link */}
                {notification.metadata?.gpsLocation && (
                  <a
                    href={`https://maps.google.com/?q=${notification.metadata.gpsLocation.lat},${notification.metadata.gpsLocation.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border-2 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                  >
                    <MapPin className="h-5 w-5 text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-blue-900 dark:text-blue-100">
                        View on Google Maps
                      </p>
                      <p className="text-[10px] text-blue-700 dark:text-blue-300 font-mono">
                        {notification.metadata.gpsLocation.lat.toFixed(6)}, {notification.metadata.gpsLocation.lng.toFixed(6)}
                      </p>
                      {notification.metadata.gpsLocation.accuracy && (
                        <p className="text-[10px] text-blue-600 dark:text-blue-400">
                          Accuracy: ±{Math.round(notification.metadata.gpsLocation.accuracy)}m
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 text-blue-600 shrink-0" />
                  </a>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-black/10">
                  <p className="text-xs text-muted-foreground font-medium">
                    {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-bold gap-1 touch-manipulation hover:bg-black/10"
                  >
                    View Details
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* INFO Notifications - Standard Size, Scrollable */}
          {infoNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={cn(
                'border-2 cursor-pointer transition-all hover:shadow-md active:scale-[0.98] touch-manipulation',
                getSeverityColor(notification.severity),
                !notification.read && 'ring-2 ring-primary/20'
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm leading-tight">
                        {notification.title}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearNotification(notification.id);
                        }}
                        className="h-6 w-6 shrink-0 hover:bg-black/10 dark:hover:bg-white/10 touch-manipulation"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-2">
                      {notification.message}
                    </p>
                    
                    {/* Small vehicle photo for info notifications */}
                    {notification.metadata?.photoUrl && (
                      <div className="relative rounded-md overflow-hidden border mt-2">
                        <img
                          src={notification.metadata.photoUrl}
                          alt="Vehicle"
                          className="w-full h-24 object-cover"
                        />
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                      </p>
                      {!notification.read && (
                        <Badge
                          variant="default"
                          className="h-5 text-xs bg-primary/20 text-primary"
                        >
                          New
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

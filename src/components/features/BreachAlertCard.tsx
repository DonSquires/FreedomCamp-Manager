import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BreachAlert } from '@/types';
import { Calendar, MapPin, AlertCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface BreachAlertCardProps {
  breach: BreachAlert;
  onNotify: (id: string) => void;
  onResolve: (id: string) => void;
}

const breachTypeLabels: Record<string, string> = {
  overstay: 'Overstay',
  no_self_contained: 'No Self-Contained Cert',
  no_wof: 'No WoF',
  consecutive_days: 'Consecutive Days Exceeded',
  unauthorized_zone: 'Unauthorized Zone',
  nights_exceeded: 'Monthly Nights Exceeded',
};

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  notified: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  resolved: 'bg-green-500/10 text-green-500 border-green-500/20',
  escalated: 'bg-destructive/10 text-destructive border-destructive/20',
};

export function BreachAlertCard({ breach, onNotify, onResolve }: BreachAlertCardProps) {
  return (
    <Card className="border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base">
                  {breachTypeLabels[breach.breach_type] || breach.breach_type}
                </h3>
                <Badge variant="outline" className={cn('border', statusColors[breach.status])}>
                  {breach.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {breach.zone?.name}
              </p>
            </div>
            {breach.due_date && (
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Due
                </p>
                <p className="text-sm font-medium">
                  {format(new Date(breach.due_date), 'MMM dd')}
                </p>
              </div>
            )}
          </div>

          <div className="bg-muted/30 rounded-md p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Breach Details</p>
            {breach.breach_type === 'nights_exceeded' && (
              <p className="text-sm">
                Stayed {breach.breach_details.nights_stayed} nights (limit: {breach.breach_details.limit})
              </p>
            )}
            {breach.breach_type === 'consecutive_days' && (
              <p className="text-sm">
                {breach.breach_details.consecutive_nights} consecutive nights (limit: {breach.breach_details.limit})
              </p>
            )}
            {breach.breach_type === 'no_self_contained' && (
              <p className="text-sm">
                Plate: {breach.breach_details.plate_number} - No self-contained certificate
              </p>
            )}
            {breach.breach_type === 'no_wof' && (
              <p className="text-sm">
                Plate: {breach.breach_details.plate_number} - WoF expired {breach.breach_details.wof_expired}
              </p>
            )}
          </div>

          {breach.notification_sent && breach.notified_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Notified via {breach.notification_method} on {format(new Date(breach.notified_at), 'MMM dd, HH:mm')}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {breach.status === 'pending' && (
              <Button
                size="sm"
                onClick={() => onNotify(breach.id)}
                className="flex-1"
              >
                <AlertCircle className="h-4 w-4 mr-1.5" />
                Send Notification
              </Button>
            )}
            {(breach.status === 'pending' || breach.status === 'notified') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onResolve(breach.id)}
                className="flex-1"
              >
                Mark Resolved
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

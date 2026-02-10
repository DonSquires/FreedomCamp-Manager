import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Patrol } from '@/types';
import { Calendar, Clock, MapPin, User } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface PatrolCardProps {
  patrol: Patrol;
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  in_progress: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  completed: 'bg-green-500/10 text-green-500 border-green-500/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

export function PatrolCard({ patrol }: PatrolCardProps) {
  return (
    <Card className="border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 flex-1">
              <h3 className="font-semibold">{patrol.zone?.name}</h3>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {patrol.shift === 'night' ? 'Night Patrol' : 'Morning Patrol'}
              </p>
            </div>
            <Badge variant="outline" className={cn('border', statusColors[patrol.status])}>
              {patrol.status.replace('_', ' ')}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{format(new Date(patrol.patrol_date), 'MMM dd, yyyy')}</span>
            </div>
            {patrol.officer && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{patrol.officer.first_name} {patrol.officer.last_name}</span>
              </div>
            )}
          </div>

          {patrol.checked_in_at && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <Clock className="h-4 w-4" />
              <span>Checked in at {format(new Date(patrol.checked_in_at), 'HH:mm')}</span>
            </div>
          )}

          {patrol.notes && (
            <div className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{patrol.notes}</p>
            </div>
          )}

          {!patrol.assigned_to && patrol.status === 'scheduled' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5 text-sm text-amber-500">
              Unassigned - Needs officer assignment
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

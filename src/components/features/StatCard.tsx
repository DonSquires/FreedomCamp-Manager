import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    positive: boolean;
  };
  variant?: 'default' | 'warning' | 'danger' | 'success';
}

export function StatCard({ title, value, icon: Icon, trend, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'bg-card border-border',
    warning: 'bg-amber-500/10 border-amber-500/20',
    danger: 'bg-destructive/10 border-destructive/20',
    success: 'bg-green-500/10 border-green-500/20',
  };

  const iconStyles = {
    default: 'text-muted-foreground',
    warning: 'text-amber-500',
    danger: 'text-destructive',
    success: 'text-green-500',
  };

  return (
    <Card className={cn('border', variantStyles[variant])}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold">{value}</p>
            {trend && (
              <p className={cn(
                'text-sm font-medium',
                trend.positive ? 'text-green-500' : 'text-destructive'
              )}>
                {trend.value}
              </p>
            )}
          </div>
          <div className={cn('p-3 rounded-lg bg-background/50', iconStyles[variant])}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

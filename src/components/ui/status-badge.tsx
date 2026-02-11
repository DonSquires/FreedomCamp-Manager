/**
 * StatusBadge - Standardized badge component for status indicators
 * Consistent styling across all portals (Field Officer + Admin)
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getStatusBadgeClasses } from '@/lib/theme';
import {
  CheckCircle2,
  AlertTriangle,
  Flag,
  Home,
  XCircle,
} from 'lucide-react';

export interface StatusBadgeProps {
  status: 'compliant' | 'breach' | 'flagged' | 'homeless' | 'warning';
  variant?: 'solid' | 'outline';
  size?: 'sm' | 'default' | 'lg';
  showIcon?: boolean;
  label?: string;
  className?: string;
}

const statusConfig = {
  compliant: {
    icon: CheckCircle2,
    defaultLabel: 'Compliant',
    emoji: '✓',
  },
  breach: {
    icon: AlertTriangle,
    defaultLabel: 'Breach',
    emoji: '⚠️',
  },
  flagged: {
    icon: Flag,
    defaultLabel: 'Flagged',
    emoji: '🚩',
  },
  homeless: {
    icon: Home,
    defaultLabel: 'Homeless',
    emoji: '🏕️',
  },
  warning: {
    icon: XCircle,
    defaultLabel: 'Warning',
    emoji: '⚠️',
  },
};

export function StatusBadge({
  status,
  variant = 'solid',
  size = 'default',
  showIcon = true,
  label,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    default: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-2',
  };

  return (
    <Badge
      className={cn(
        getStatusBadgeClasses(status, variant),
        sizeClasses[size],
        'inline-flex items-center gap-1.5',
        className
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" />}
      <span>{label || config.defaultLabel}</span>
    </Badge>
  );
}

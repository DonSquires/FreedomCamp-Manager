/**
 * ThemedCard - Standardized card component with consistent styling
 * Uses unified theme system for all card variants
 */

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getCardClasses } from '@/lib/theme';

export interface ThemedCardProps {
  variant?: 'default' | 'compliant' | 'breach' | 'flagged' | 'homeless';
  className?: string;
  children: React.ReactNode;
  header?: {
    title?: string;
    description?: string;
    icon?: React.ReactNode;
    action?: React.ReactNode;
  };
}

export function ThemedCard({
  variant = 'default',
  className,
  children,
  header,
}: ThemedCardProps) {
  return (
    <Card className={cn(getCardClasses(variant), className)}>
      {header && (
        <CardHeader className="card-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {header.icon}
              <div>
                {header.title && (
                  <CardTitle className="text-card-title">{header.title}</CardTitle>
                )}
                {header.description && (
                  <CardDescription className="text-secondary mt-1">
                    {header.description}
                  </CardDescription>
                )}
              </div>
            </div>
            {header.action}
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(header ? 'p-6' : 'p-6')}>
        {children}
      </CardContent>
    </Card>
  );
}

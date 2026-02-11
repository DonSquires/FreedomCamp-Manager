/**
 * ResponsiveContainer - Adaptive layout container
 * Automatically adjusts for mobile, tablet, and desktop viewports
 */

import { ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getViewportSize } from '@/lib/design-system';

interface ResponsiveContainerProps {
  children: ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  mobileFullHeight?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-full',
};

const paddingClasses = {
  none: '',
  sm: 'px-3 py-2',
  md: 'px-4 py-4 md:px-6 md:py-6',
  lg: 'px-6 py-6 md:px-8 md:py-8',
};

export function ResponsiveContainer({
  children,
  className,
  maxWidth = 'full',
  padding = 'md',
  mobileFullHeight = false,
}: ResponsiveContainerProps) {
  const [viewportSize, setViewportSize] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');

  useEffect(() => {
    const handleResize = () => {
      setViewportSize(getViewportSize());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      className={cn(
        'mx-auto w-full',
        maxWidthClasses[maxWidth],
        paddingClasses[padding],
        mobileFullHeight && viewportSize === 'mobile' && 'min-h-screen',
        className
      )}
    >
      {children}
    </div>
  );
}

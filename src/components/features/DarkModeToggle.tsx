/**
 * DarkModeToggle - Manual dark mode control for night shift workers
 * Provides light/dark/system mode options with visual feedback
 */

import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useDarkMode } from '@/hooks/useDarkMode';
import { cn } from '@/lib/utils';

export interface DarkModeToggleProps {
  variant?: 'icon' | 'full';
  className?: string;
}

export function DarkModeToggle({ variant = 'icon', className }: DarkModeToggleProps) {
  const { preference, isDark, setPreference } = useDarkMode();

  if (variant === 'icon') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-10 w-10 touch-manipulation', className)}
            aria-label="Toggle dark mode"
          >
            {isDark ? (
              <Moon className="h-5 w-5 text-cyan-400" />
            ) : (
              <Sun className="h-5 w-5 text-amber-500" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => setPreference('light')}
            className={cn(
              'cursor-pointer',
              preference === 'light' && 'bg-cyan-50 dark:bg-cyan-950/30'
            )}
          >
            <Sun className="h-4 w-4 mr-2 text-amber-500" />
            <span>Light Mode</span>
            {preference === 'light' && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
          
          <DropdownMenuItem
            onClick={() => setPreference('dark')}
            className={cn(
              'cursor-pointer',
              preference === 'dark' && 'bg-cyan-50 dark:bg-cyan-950/30'
            )}
          >
            <Moon className="h-4 w-4 mr-2 text-cyan-400" />
            <span>Dark Mode</span>
            {preference === 'dark' && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem
            onClick={() => setPreference('system')}
            className={cn(
              'cursor-pointer',
              preference === 'system' && 'bg-cyan-50 dark:bg-cyan-950/30'
            )}
          >
            <Monitor className="h-4 w-4 mr-2" />
            <span>System Default</span>
            {preference === 'system' && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Full variant with buttons (for settings page)
  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="font-semibold text-base text-foreground">Display Mode</h3>
      <p className="text-sm text-muted-foreground">
        🌙 Optimize display for night shift work or follow system settings
      </p>
      
      <div className="grid grid-cols-3 gap-3">
        <Button
          variant={preference === 'light' ? 'default' : 'outline'}
          onClick={() => setPreference('light')}
          className={cn(
            'h-20 flex flex-col items-center justify-center gap-2 touch-manipulation',
            preference === 'light' && 'bg-cyan-500 hover:bg-cyan-600'
          )}
        >
          <Sun className="h-6 w-6 text-amber-500" />
          <span className="text-sm font-semibold">Light</span>
        </Button>
        
        <Button
          variant={preference === 'dark' ? 'default' : 'outline'}
          onClick={() => setPreference('dark')}
          className={cn(
            'h-20 flex flex-col items-center justify-center gap-2 touch-manipulation',
            preference === 'dark' && 'bg-cyan-500 hover:bg-cyan-600'
          )}
        >
          <Moon className="h-6 w-6 text-cyan-400" />
          <span className="text-sm font-semibold">Dark</span>
        </Button>
        
        <Button
          variant={preference === 'system' ? 'default' : 'outline'}
          onClick={() => setPreference('system')}
          className={cn(
            'h-20 flex flex-col items-center justify-center gap-2 touch-manipulation',
            preference === 'system' && 'bg-cyan-500 hover:bg-cyan-600'
          )}
        >
          <Monitor className="h-6 w-6" />
          <span className="text-sm font-semibold">System</span>
        </Button>
      </div>
      
      <div className="p-4 bg-cyan-50 dark:bg-cyan-950/20 rounded-lg border border-cyan-200 dark:border-cyan-800">
        <p className="text-sm text-cyan-900 dark:text-cyan-100">
          <strong>Current:</strong> {preference === 'system' ? `System (${isDark ? 'Dark' : 'Light'})` : preference === 'dark' ? 'Dark Mode' : 'Light Mode'}
        </p>
        <p className="text-xs text-cyan-700 dark:text-cyan-200 mt-1">
          {preference === 'dark' && '🌙 Night shift mode active - easier on the eyes'}
          {preference === 'light' && '☀️ Day mode active - maximum brightness'}
          {preference === 'system' && '💻 Following your device settings'}
        </p>
      </div>
    </div>
  );
}

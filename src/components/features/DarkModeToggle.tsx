import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDarkMode } from '@/hooks/useDarkMode'

interface DarkModeToggleProps {
  className?: string
  showLabel?: boolean
}

export function DarkModeToggle({ className, showLabel }: DarkModeToggleProps) {
  const { isDark, toggle } = useDarkMode()

  return (
    <Button variant="ghost" onClick={toggle} className={className}>
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      {showLabel && <span className="ml-2">{isDark ? 'Dark Mode' : 'Light Mode'}</span>}
    </Button>
  )
}

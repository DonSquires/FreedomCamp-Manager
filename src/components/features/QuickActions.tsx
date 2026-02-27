/**
 * QuickActions Component
 * Floating action button menu
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Plus,
  Camera,
  FileText,
  Users,
  MapPin,
  AlertTriangle,
  X,
} from 'lucide-react'

interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  onClick: () => void
  badge?: string | number
  variant?: 'default' | 'destructive' | 'outline' | 'secondary'
}

interface QuickActionsProps {
  actions: QuickAction[]
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

export function QuickActions({
  actions,
  position = 'bottom-right',
}: QuickActionsProps) {
  const [isOpen, setIsOpen] = useState(false)

  const getPositionClasses = () => {
    switch (position) {
      case 'bottom-right':
        return 'bottom-6 right-6'
      case 'bottom-left':
        return 'bottom-6 left-6'
      case 'top-right':
        return 'top-6 right-6'
      case 'top-left':
        return 'top-6 left-6'
      default:
        return 'bottom-6 right-6'
    }
  }

  const getMenuPositionClasses = () => {
    switch (position) {
      case 'bottom-right':
      case 'top-right':
        return 'right-0'
      case 'bottom-left':
      case 'top-left':
        return 'left-0'
      default:
        return 'right-0'
    }
  }

  const getMenuDirectionClasses = () => {
    switch (position) {
      case 'bottom-right':
      case 'bottom-left':
        return 'bottom-16'
      case 'top-right':
      case 'top-left':
        return 'top-16'
      default:
        return 'bottom-16'
    }
  }

  const handleActionClick = (action: QuickAction) => {
    action.onClick()
    setIsOpen(false)
  }

  return (
    <div className={`fixed ${getPositionClasses()} z-50`}>
      {/* Action menu */}
      {isOpen && (
        <div
          className={`absolute ${getMenuPositionClasses()} ${getMenuDirectionClasses()} mb-2 space-y-2 min-w-[200px]`}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              className="w-full flex items-center gap-3 p-3 bg-background border rounded-lg hover:bg-muted transition-colors shadow-lg"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                {action.icon}
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium text-sm">{action.label}</div>
              </div>
              {action.badge && (
                <Badge variant="secondary" className="text-xs">
                  {action.badge}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Main FAB */}
      <Button
        size="icon"
        className={`h-14 w-14 rounded-full shadow-lg ${
          isOpen ? 'rotate-45' : ''
        } transition-transform`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Plus className="h-6 w-6" />
        )}
      </Button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 -z-10"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}

// Common preset actions
export const OFFICER_QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'scan',
    label: 'Scan Vehicle',
    icon: <Camera className="h-5 w-5" />,
    onClick: () => console.log('Scan vehicle'),
  },
  {
    id: 'report',
    label: 'Create Report',
    icon: <FileText className="h-5 w-5" />,
    onClick: () => console.log('Create report'),
  },
  {
    id: 'incident',
    label: 'Log Incident',
    icon: <AlertTriangle className="h-5 w-5" />,
    onClick: () => console.log('Log incident'),
  },
]

export const ADMIN_QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'user',
    label: 'Add User',
    icon: <Users className="h-5 w-5" />,
    onClick: () => console.log('Add user'),
  },
  {
    id: 'zone',
    label: 'Create Zone',
    icon: <MapPin className="h-5 w-5" />,
    onClick: () => console.log('Create zone'),
  },
  {
    id: 'report',
    label: 'Generate Report',
    icon: <FileText className="h-5 w-5" />,
    onClick: () => console.log('Generate report'),
  },
]

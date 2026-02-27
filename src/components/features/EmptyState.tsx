/**
 * EmptyState Component
 * Empty state illustrations
 */

import { Button } from '@/components/ui/button'
import { 
  Inbox,
  SearchX,
  FolderX,
  Users,
  Car,
  MapPin,
  AlertCircle,
  FileText,
} from 'lucide-react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  variant?: 'default' | 'search' | 'error' | 'success'
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
}: EmptyStateProps) {
  const defaultIcons = {
    default: <Inbox className="h-16 w-16" />,
    search: <SearchX className="h-16 w-16" />,
    error: <AlertCircle className="h-16 w-16" />,
    success: <FolderX className="h-16 w-16" />,
  }

  const iconColors = {
    default: 'text-muted-foreground',
    search: 'text-blue-500',
    error: 'text-red-500',
    success: 'text-green-500',
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className={`mb-4 ${iconColors[variant]} opacity-20`}>
        {icon || defaultIcons[variant]}
      </div>
      
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          {description}
        </p>
      )}

      {action && (
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

// Common preset empty states
export const EMPTY_STATES = {
  noVehicles: {
    icon: <Car className="h-16 w-16" />,
    title: 'No Vehicles Found',
    description: 'Start scanning vehicles to build your database',
  },
  noObservations: {
    icon: <Inbox className="h-16 w-16" />,
    title: 'No Observations Yet',
    description: 'Record your first observation to get started',
  },
  noZones: {
    icon: <MapPin className="h-16 w-16" />,
    title: 'No Zones Created',
    description: 'Create your first zone to start monitoring',
  },
  noUsers: {
    icon: <Users className="h-16 w-16" />,
    title: 'No Users Found',
    description: 'Invite team members to collaborate',
  },
  noBreaches: {
    icon: <AlertCircle className="h-16 w-16" />,
    title: 'No Breach Alerts',
    description: 'All vehicles are currently compliant',
    variant: 'success' as const,
  },
  searchEmpty: {
    icon: <SearchX className="h-16 w-16" />,
    title: 'No Results Found',
    description: 'Try adjusting your search filters',
    variant: 'search' as const,
  },
  noReports: {
    icon: <FileText className="h-16 w-16" />,
    title: 'No Reports Available',
    description: 'Generate your first report to see it here',
  },
}

/**
 * OrganizationSelector Component
 * Multi-organization dropdown with hierarchy
 */

import { useOrganizations } from '@/hooks/useOrganizations'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Building2,
  ChevronDown,
  Check,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useState } from 'react'

interface OrganizationSelectorProps {
  value?: string
  onChange: (organizationId: string) => void
  allowAll?: boolean
  disabled?: boolean
}

export function OrganizationSelector({
  value,
  onChange,
  allowAll = false,
  disabled = false,
}: OrganizationSelectorProps) {
  const { user } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)

  const orgQuery = useOrganizations()
  const organizations = orgQuery.data
  const isLoading = orgQuery.isLoading

  const selectedOrg = organizations?.find((org: any) => org.id === value)
  const isMaster = user?.role === 'master'

  // Filter organizations based on user permissions
  const accessibleOrgs = organizations?.filter((org: any) => {
    if (isMaster) return true // Masters see all
    
    // Check if user has access to this org
    return (
      org.id === user?.organization_id ||
      (user as any)?.authorized_work_locations?.includes(org.id)
    )
  })

  const handleSelect = (orgId: string) => {
    onChange(orgId)
    setIsOpen(false)
  }

  const getOrgTypeIcon = (type: string) => {
    switch (type) {
      case 'service_provider':
        return '🏢'
      case 'client':
        return '🏛️'
      default:
        return '📍'
    }
  }

  const getOrgLevel = (level: number) => {
    switch (level) {
      case 1:
        return 'Level 1'
      case 2:
        return 'Level 2'
      case 3:
        return 'Level 3'
      default:
        return `Level ${level}`
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="w-full sm:w-auto justify-between"
          disabled={disabled || isLoading}
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {selectedOrg ? (
              <span>{selectedOrg.name}</span>
            ) : allowAll && !value ? (
              <span>All Organisations</span>
            ) : (
              <span className="text-muted-foreground">Select organisation</span>
            )}
          </div>
          <ChevronDown className="h-4 w-4 ml-2" />
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Organisation
          </SheetTitle>
          <SheetDescription>
            {isMaster 
              ? 'Choose an organisation to filter data' 
              : 'Select from your accessible organisations'
            }
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          {/* All organizations option */}
          {allowAll && isMaster && (
            <Button
              variant={!value ? 'default' : 'ghost'}
              className="w-full justify-between"
              onClick={() => handleSelect('')}
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>All Organisations</span>
              </div>
              {!value && <Check className="h-4 w-4" />}
            </Button>
          )}

          {/* Organization list */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading organisations...
            </div>
          ) : accessibleOrgs && accessibleOrgs.length > 0 ? (
            <div className="space-y-2">
              {accessibleOrgs.map((org: any) => (
                <Button
                  key={org.id}
                  variant={value === org.id ? 'default' : 'ghost'}
                  className="w-full justify-between"
                  onClick={() => handleSelect(org.id)}
                >
                  <div className="flex items-center gap-2">
                    <span>{getOrgTypeIcon(org.organization_type)}</span>
                    <div className="text-left">
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {getOrgLevel(org.organization_level)} • {org.organization_type}
                      </div>
                    </div>
                  </div>
                  {value === org.id && <Check className="h-4 w-4" />}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No organisations accessible</p>
            </div>
          )}
        </div>

        {/* Info for non-masters */}
        {!isMaster && (
          <div className="mt-6 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
            You have access to {accessibleOrgs?.length || 0} organisation
            {accessibleOrgs?.length !== 1 ? 's' : ''}. Contact your administrator 
            to request access to additional organisations.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

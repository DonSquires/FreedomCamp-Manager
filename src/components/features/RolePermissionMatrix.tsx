/**
 * RolePermissionMatrix Component
 * Visual permission grid for role configuration
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { 
  Shield,
  Save,
  RotateCcw,
  Check,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface Permission {
  id: string
  name: string
  description: string
  category: string
}

interface RolePermissions {
  [role: string]: string[]
}

const PERMISSIONS: Permission[] = [
  // Observation permissions
  { id: 'view_observations', name: 'View Observations', description: 'Can view vehicle observations', category: 'Observations' },
  { id: 'create_observations', name: 'Create Observations', description: 'Can record new observations', category: 'Observations' },
  { id: 'edit_observations', name: 'Edit Observations', description: 'Can modify existing observations', category: 'Observations' },
  { id: 'delete_observations', name: 'Delete Observations', description: 'Can delete observations', category: 'Observations' },
  
  // Vehicle permissions
  { id: 'view_vehicles', name: 'View Vehicles', description: 'Can view vehicle records', category: 'Vehicles' },
  { id: 'edit_vehicles', name: 'Edit Vehicles', description: 'Can modify vehicle details', category: 'Vehicles' },
  { id: 'flag_vehicles', name: 'Flag Vehicles', description: 'Can flag problem vehicles', category: 'Vehicles' },
  
  // Enforcement permissions
  { id: 'view_breaches', name: 'View Breaches', description: 'Can view breach alerts', category: 'Enforcement' },
  { id: 'create_enforcement', name: 'Create Enforcement', description: 'Can create enforcement actions', category: 'Enforcement' },
  { id: 'approve_enforcement', name: 'Approve Enforcement', description: 'Can approve enforcement actions', category: 'Enforcement' },
  { id: 'delete_enforcement', name: 'Delete Enforcement', description: 'Can delete enforcement actions', category: 'Enforcement' },
  
  // Zone permissions
  { id: 'view_zones', name: 'View Zones', description: 'Can view zone definitions', category: 'Zones' },
  { id: 'edit_zones', name: 'Edit Zones', description: 'Can modify zone rules', category: 'Zones' },
  { id: 'create_zones', name: 'Create Zones', description: 'Can create new zones', category: 'Zones' },
  
  // User permissions
  { id: 'view_users', name: 'View Users', description: 'Can view user list', category: 'Users' },
  { id: 'create_users', name: 'Create Users', description: 'Can create new users', category: 'Users' },
  { id: 'edit_users', name: 'Edit Users', description: 'Can modify user details', category: 'Users' },
  { id: 'delete_users', name: 'Delete Users', description: 'Can delete users', category: 'Users' },
  
  // Reports permissions
  { id: 'view_reports', name: 'View Reports', description: 'Can view reports', category: 'Reports' },
  { id: 'export_data', name: 'Export Data', description: 'Can export system data', category: 'Reports' },
  { id: 'view_audit_log', name: 'View Audit Log', description: 'Can view audit trail', category: 'Reports' },
]

const ROLES = ['master', 'admin', 'admin_officer', 'officer']

const DEFAULT_PERMISSIONS: RolePermissions = {
  master: PERMISSIONS.map(p => p.id), // All permissions
  admin: PERMISSIONS.filter(p => !['delete_users', 'delete_enforcement'].includes(p.id)).map(p => p.id),
  admin_officer: PERMISSIONS.filter(p => 
    p.category !== 'Users' && 
    !['delete_enforcement', 'delete_observations'].includes(p.id)
  ).map(p => p.id),
  officer: PERMISSIONS.filter(p => 
    ['view_observations', 'create_observations', 'view_vehicles', 'view_breaches', 'view_zones'].includes(p.id)
  ).map(p => p.id),
}

interface RolePermissionMatrixProps {
  onSave?: (permissions: RolePermissions) => void
}

export function RolePermissionMatrix({
  onSave,
}: RolePermissionMatrixProps) {
  const [permissions, setPermissions] = useState<RolePermissions>(DEFAULT_PERMISSIONS)
  const [hasChanges, setHasChanges] = useState(false)

  const togglePermission = (role: string, permissionId: string) => {
    if (role === 'master') {
      toast.warning('Master role has all permissions by default')
      return
    }

    setPermissions(prev => {
      const rolePerms = prev[role] || []
      const newPerms = rolePerms.includes(permissionId)
        ? rolePerms.filter(p => p !== permissionId)
        : [...rolePerms, permissionId]

      return {
        ...prev,
        [role]: newPerms,
      }
    })
    setHasChanges(true)
  }

  const handleSave = () => {
    if (onSave) {
      onSave(permissions)
    }
    toast.success('Permissions updated')
    setHasChanges(false)
  }

  const handleReset = () => {
    setPermissions(DEFAULT_PERMISSIONS)
    setHasChanges(false)
    toast.info('Changes discarded')
  }

  const categories = [...new Set(PERMISSIONS.map(p => p.category))]

  const hasPermission = (role: string, permissionId: string) => {
    return permissions[role]?.includes(permissionId) || false
  }

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      master: 'bg-purple-600',
      admin: 'bg-blue-600',
      admin_officer: 'bg-indigo-600',
      officer: 'bg-green-600',
    }

    return (
      <Badge className={colors[role]}>
        {role.replace('_', ' ').toUpperCase()}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Role Permission Matrix
            </CardTitle>
            <CardDescription className="mt-1">
              Configure permissions for each role
            </CardDescription>
          </div>
          {hasChanges && (
            <Badge variant="secondary">Unsaved Changes</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Permission matrix */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium sticky left-0 bg-muted">
                    Permission
                  </th>
                  {ROLES.map(role => (
                    <th key={role} className="px-4 py-3 text-center text-sm font-medium">
                      {getRoleBadge(role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map(category => (
                  <>
                    {/* Category header */}
                    <tr key={`category-${category}`} className="border-t bg-muted/50">
                      <td colSpan={ROLES.length + 1} className="px-4 py-2 font-medium text-sm">
                        {category}
                      </td>
                    </tr>
                    
                    {/* Permissions in category */}
                    {PERMISSIONS.filter(p => p.category === category).map(permission => (
                      <tr key={permission.id} className="border-t hover:bg-muted/50">
                        <td className="px-4 py-3 sticky left-0 bg-background">
                          <div>
                            <div className="font-medium text-sm">{permission.name}</div>
                            <div className="text-xs text-muted-foreground">{permission.description}</div>
                          </div>
                        </td>
                        {ROLES.map(role => (
                          <td key={`${role}-${permission.id}`} className="px-4 py-3 text-center">
                            {role === 'master' ? (
                              <Check className="h-5 w-5 text-green-600 mx-auto" />
                            ) : (
                              <Switch
                                checked={hasPermission(role, permission.id)}
                                onCheckedChange={() => togglePermission(role, permission.id)}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        {hasChanges && (
          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Discard
            </Button>
          </div>
        )}

        {/* Legend */}
        <div className="text-sm text-muted-foreground pt-4 border-t">
          <div className="font-medium mb-2">Legend:</div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>Permission granted (Master role has all permissions)</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={true} className="scale-75" />
              <span>Toggle to enable/disable permission for role</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

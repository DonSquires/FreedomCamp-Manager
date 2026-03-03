/**
 * UserManagementTable Component
 * User list with management actions
 */

import { useState } from 'react'
import { useUsers } from '@/hooks/useUsers'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  Users,
  Search,
  Filter,
  UserPlus,
  Edit,
  Trash2,
  Shield,
  CheckCircle2,
  XCircle,
  MoreVertical,
} from 'lucide-react'

interface UserManagementTableProps {
  organizationId?: string
  onCreateUser?: () => void
  onEditUser?: (userId: string) => void
  onDeleteUser?: (userId: string) => void
}

export function UserManagementTable({
  organizationId,
  onCreateUser,
  onEditUser,
  onDeleteUser,
}: UserManagementTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const usersQuery = useUsers({})
  const users = usersQuery.data
  const isLoading = usersQuery.isLoading

  const getRoleBadge = (role: string) => {
    const roleColors: Record<string, string> = {
      master: 'bg-purple-600 text-white',
      admin: 'bg-blue-600 text-white',
      admin_officer: 'bg-indigo-600 text-white',
      officer: 'bg-green-600 text-white',
    }

    return (
      <Badge className={roleColors[role] || 'bg-gray-600'}>
        {role.replace('_', ' ').toUpperCase()}
      </Badge>
    )
  }

  // Filter users
  const filteredUsers = users?.filter((user: any) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase()
    const matchesSearch = 
      user.first_name?.toLowerCase().includes(searchLower) ||
      user.last_name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)
    
    if (searchTerm && !matchesSearch) return false

    // Role filter
    if (filterRole !== 'all' && user.role !== filterRole) return false

    // Status filter
    if (filterStatus === 'active' && !user.is_active) return false
    if (filterStatus === 'inactive' && user.is_active) return false

    return true
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </CardTitle>
            <CardDescription className="mt-1">
              Manage users and their permissions
            </CardDescription>
          </div>
          {onCreateUser && (
            <Button onClick={onCreateUser}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-10"
              />
            </div>
          </div>

          {/* Role filter */}
          <div className="flex gap-2">
            <Button
              variant={filterRole === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterRole('all')}
            >
              All Roles
            </Button>
            <Button
              variant={filterRole === 'admin' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterRole('admin')}
            >
              Admin
            </Button>
            <Button
              variant={filterRole === 'officer' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterRole('officer')}
            >
              Officer
            </Button>
          </div>

          {/* Status filter */}
          <div className="flex gap-2">
            <Button
              variant={filterStatus === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('all')}
            >
              All
            </Button>
            <Button
              variant={filterStatus === 'active' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('active')}
            >
              Active
            </Button>
            <Button
              variant={filterStatus === 'inactive' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('inactive')}
            >
              Inactive
            </Button>
          </div>
        </div>

        {/* User table */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading users...
          </div>
        ) : filteredUsers && filteredUsers.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Phone</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user: any) => (
                    <tr key={user.id} className="border-t hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {user.first_name} {user.last_name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        {getRoleBadge(user.role)}
                      </td>
                      <td className="px-4 py-3">
                        {user.is_active ? (
                          <Badge className="bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="h-3 w-3 mr-1" />
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {user.phone || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {onEditUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditUser(user.id)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {onDeleteUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onDeleteUser(user.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No users found</p>
            {searchTerm && (
              <p className="text-sm mt-1">Try adjusting your search filters</p>
            )}
          </div>
        )}

        {/* Count */}
        {filteredUsers && filteredUsers.length > 0 && (
          <div className="text-sm text-center text-muted-foreground border-t pt-4">
            Showing {filteredUsers.length} user{filteredUsers.length > 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * SitePermissionsAdmin
 *
 * Admin UI for managing role-based and per-user field-group access to client_sites.
 *
 * Tab 1 – Role Matrix: grid of roles × field_groups with view/edit toggles.
 *          Admins can add custom roles, adjust defaults, or remove custom rows.
 * Tab 2 – User Overrides: search users and set individual field-group overrides
 *          that take precedence over role defaults.
 *
 * Route: /site-permissions  (admin / master / grand_master only)
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { ShieldCheck, Plus, Trash2, Save, UserCog, Eye, Pencil, Info, Building2, Users, FileText, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { SITE_FIELD_GROUPS, SITE_FIELD_GROUP_LABELS, type SiteFieldGroup } from '@/hooks/useSitePermissions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RolePermRow {
  id: string
  role: string
  field_group: string
  can_view: boolean
  can_edit: boolean
}

interface UserPermRow {
  id: string
  user_id: string
  field_group: string
  can_view: boolean | null
  can_edit: boolean | null
}

interface UserProfile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  role: string
  organization_id: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BUILT_IN_ROLES = ['grand_master', 'master', 'admin', 'admin_officer', 'officer', 'nzscv_monitor', 'client_admin', 'client_officer', 'client_viewer']

const ROLE_LABELS: Record<string, string> = {
  grand_master:  'Grand Master',
  master:        'Master',
  admin:         'Admin',
  admin_officer: 'Ops Manager',
  officer:       'Field Officer',
  nzscv_monitor: 'NZSCV Monitor',
  client_admin:  'Client Admin',
  client_officer:'Client Officer',
  client_viewer: 'Client Viewer',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SitePermissionsAdmin() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [newRoleName, setNewRoleName] = useState('')
  const [userSearch, setUserSearch]   = useState('')
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)
  const [userDialogOpen, setUserDialogOpen] = useState(false)

  // ── Role permissions ───────────────────────────────────────────────────────

  const { data: rolePerms = [], isLoading: loadingRole } = useQuery<RolePermRow[]>({
    queryKey: ['admin-site-role-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_role_permissions' as any)
        .select('id, role, field_group, can_view, can_edit')
        .order('role')
      if (error) throw error
      return (data ?? []) as unknown as RolePermRow[]
    },
  })

  // Group by role
  const roles = [...new Set(rolePerms.map(r => r.role))].sort((a, b) => {
    const ai = BUILT_IN_ROLES.indexOf(a)
    const bi = BUILT_IN_ROLES.indexOf(b)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b)
  })

  function getCell(role: string, group: SiteFieldGroup): RolePermRow | undefined {
    return rolePerms.find(r => r.role === role && r.field_group === group)
  }

  const updateRolePerm = useMutation({
    mutationFn: async ({ role, group, canView, canEdit }: {
      role: string; group: SiteFieldGroup; canView: boolean; canEdit: boolean
    }) => {
      const existing = getCell(role, group)
      if (existing) {
        const { error } = await (supabase as any)
          .from('site_role_permissions')
          .update({ can_view: canView, can_edit: canEdit, updated_by: user?.id })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('site_role_permissions')
          .insert({ role, field_group: group, can_view: canView, can_edit: canEdit, updated_by: user?.id })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-site-role-permissions'] }),
    onError: (err: any) => toast.error(err.message ?? 'Update failed'),
  })

  const addNewRole = useMutation({
    mutationFn: async (roleName: string) => {
      const rows = SITE_FIELD_GROUPS.map(g => ({
        role: roleName, field_group: g,
        can_view: false, can_edit: false, updated_by: user?.id,
      }))
      const { error } = await (supabase as any)
        .from('site_role_permissions')
        .insert(rows)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Role "${newRoleName}" added`)
      setNewRoleName('')
      qc.invalidateQueries({ queryKey: ['admin-site-role-permissions'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to add role'),
  })

  const deleteRole = useMutation({
    mutationFn: async (role: string) => {
      const { error } = await (supabase as any)
        .from('site_role_permissions')
        .delete()
        .eq('role', role)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-site-role-permissions'] }),
    onError: (err: any) => toast.error(err.message ?? 'Delete failed'),
  })

  // ── User permissions ───────────────────────────────────────────────────────

  const { data: users = [], isLoading: loadingUsers } = useQuery<UserProfile[]>({
    queryKey: ['admin-user-profiles-search', userSearch],
    queryFn: async () => {
      let q = supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, organization_id')
        .order('first_name')
        .limit(50)
      if (userSearch.trim()) {
        q = q.or(`first_name.ilike.%${userSearch}%,last_name.ilike.%${userSearch}%,email.ilike.%${userSearch}%`)
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as UserProfile[]
    },
    enabled: true,
  })

  const { data: userPerms = [], isLoading: loadingUserPerms } = useQuery<UserPermRow[]>({
    queryKey: ['admin-site-user-permissions', selectedUser?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('site_user_permissions')
        .select('id, user_id, field_group, can_view, can_edit')
        .eq('user_id', selectedUser!.id)
      if (error) throw error
      return (data ?? []) as UserPermRow[]
    },
    enabled: !!selectedUser,
  })

  function getUserOverride(group: SiteFieldGroup): UserPermRow | undefined {
    return userPerms.find(u => u.field_group === group)
  }

  const upsertUserPerm = useMutation({
    mutationFn: async ({ group, canView, canEdit }: {
      group: SiteFieldGroup; canView: boolean | null; canEdit: boolean | null
    }) => {
      const existing = getUserOverride(group)
      if (existing) {
        const { error } = await (supabase as any)
          .from('site_user_permissions')
          .update({ can_view: canView, can_edit: canEdit, updated_by: user?.id })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('site_user_permissions')
          .insert({ user_id: selectedUser!.id, field_group: group, can_view: canView, can_edit: canEdit, updated_by: user?.id })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-site-user-permissions', selectedUser?.id] }),
    onError: (err: any) => toast.error(err.message ?? 'Update failed'),
  })

  const clearUserPerm = useMutation({
    mutationFn: async (group: SiteFieldGroup) => {
      const existing = getUserOverride(group)
      if (!existing) return
      const { error } = await (supabase as any)
        .from('site_user_permissions')
        .delete()
        .eq('id', existing.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-site-user-permissions', selectedUser?.id] }),
    onError: (err: any) => toast.error(err.message ?? 'Clear failed'),
  })

  const clearAllUserPerms = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('site_user_permissions')
        .delete()
        .eq('user_id', selectedUser!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('All overrides cleared — user reverts to role defaults')
      qc.invalidateQueries({ queryKey: ['admin-site-user-permissions', selectedUser?.id] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Clear failed'),
  })

  // ── Render helpers ─────────────────────────────────────────────────────────

  function PermCell({ role, group }: { role: string; group: SiteFieldGroup }) {
    const cell = getCell(role, group)
    const canView = cell?.can_view ?? false
    const canEdit = cell?.can_edit ?? false

    return (
      <div className="flex flex-col gap-1 items-center">
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <Switch
            checked={canView}
            onCheckedChange={v => updateRolePerm.mutate({ role, group, canView: v, canEdit: v ? canEdit : false })}
            className="scale-75"
          />
          <Eye className="h-3 w-3 text-muted-foreground" />
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <Switch
            checked={canEdit}
            disabled={!canView}
            onCheckedChange={v => updateRolePerm.mutate({ role, group, canView: canView || v, canEdit: v })}
            className="scale-75"
          />
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </label>
      </div>
    )
  }

  function UserPermCell({ group }: { group: SiteFieldGroup }) {
    const override = getUserOverride(group)
    const hasOverride = !!override
    const canView = override?.can_view ?? null
    const canEdit = override?.can_edit ?? null

    return (
      <div className="flex flex-col gap-1 items-center relative">
        {hasOverride && (
          <Badge variant="secondary" className="absolute -top-2 -right-2 text-[9px] px-1 py-0 h-3.5">
            override
          </Badge>
        )}
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <Switch
            checked={canView === true}
            onCheckedChange={v => upsertUserPerm.mutate({ group, canView: v, canEdit: v ? (canEdit ?? false) : false })}
            className="scale-75"
          />
          <Eye className="h-3 w-3 text-muted-foreground" />
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <Switch
            checked={canEdit === true}
            disabled={canView !== true}
            onCheckedChange={v => upsertUserPerm.mutate({ group, canView: canView ?? true, canEdit: v })}
            className="scale-75"
          />
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </label>
        {hasOverride && (
          <button
            className="text-[10px] text-destructive hover:underline"
            onClick={() => clearUserPerm.mutate(group)}
          >
            reset
          </button>
        )}
      </div>
    )
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 dark:border-blue-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              Governance Quick Actions
            </CardTitle>
            <CardDescription>
              Jump between governance policy, user scope, organisation management, and audit traceability.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: 'Organisations', path: '/organizations', Icon: Building2 },
                { label: 'Users', path: '/users', Icon: Users },
                { label: 'Access Control', path: '/access-control', Icon: ShieldCheck },
                { label: 'Audit Log', path: '/audit-log', Icon: FileText },
                { label: 'Command Centre', path: '/admin', Icon: Settings },
              ].map(({ label, path, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => navigate(path)}
                  className="text-left rounded-lg border bg-white dark:bg-gray-900 px-3 py-3 transition-colors hover:bg-blue-100/60 dark:hover:bg-blue-900/20"
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                    <Icon className="h-4 w-4 text-blue-600" />
                    {label}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Site Field Permissions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which roles and users can view or edit each group of client site fields.
            Changes take effect immediately.
          </p>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-300">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>How it works:</strong> Each role has default visibility and editability settings per field group.
            Individual user overrides take precedence over role defaults.
            <span className="mx-1">·</span>
            <strong>View</strong> <Eye className="inline h-3 w-3" /> = can see the field.
            <span className="mx-1">·</span>
            <strong>Edit</strong> <Pencil className="inline h-3 w-3" /> = can modify the field (requires View).
          </div>
        </div>

        <Tabs defaultValue="roles">
          <TabsList>
            <TabsTrigger value="roles">Role Defaults</TabsTrigger>
            <TabsTrigger value="users">User Overrides</TabsTrigger>
          </TabsList>

          {/* ── Role Matrix tab ──────────────────────────────────────────── */}
          <TabsContent value="roles" className="mt-4 space-y-4">
            {loadingRole ? (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Role × Field Group Matrix</CardTitle>
                  <CardDescription>
                    Each cell has two toggles: <Eye className="inline h-3 w-3" /> View and <Pencil className="inline h-3 w-3" /> Edit.
                    Enabling Edit automatically enables View.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 w-36">Field Group</TableHead>
                        {roles.map(r => (
                          <TableHead key={r} className="text-center min-w-[80px]">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs font-semibold">{ROLE_LABELS[r] ?? r}</span>
                              {!BUILT_IN_ROLES.includes(r) && (
                                <button
                                  className="text-destructive hover:underline text-[10px]"
                                  onClick={() => {
                                    if (confirm(`Delete role "${r}" and all its permissions?`)) {
                                      deleteRole.mutate(r)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SITE_FIELD_GROUPS.map(group => (
                        <TableRow key={group}>
                          <TableCell className="sticky left-0 bg-background z-10 font-medium text-sm py-3">
                            {SITE_FIELD_GROUP_LABELS[group]}
                          </TableCell>
                          {roles.map(r => (
                            <TableCell key={r} className="text-center py-3">
                              <PermCell role={r} group={group} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Add custom role */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Add Custom Role</CardTitle>
                <CardDescription className="text-xs">
                  New roles start with all permissions denied. Adjust the matrix above after adding.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 max-w-xs">
                  <Input
                    placeholder="e.g. supervisor"
                    value={newRoleName}
                    onChange={e => setNewRoleName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    disabled={!newRoleName.trim() || roles.includes(newRoleName.trim()) || addNewRole.isPending}
                    onClick={() => addNewRole.mutate(newRoleName.trim())}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── User Overrides tab ───────────────────────────────────────── */}
          <TabsContent value="users" className="mt-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">

              {/* User search */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCog className="h-4 w-4" /> Select User
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Input
                    placeholder="Search by name or email…"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    className="h-9"
                  />
                  <div className="divide-y max-h-64 overflow-y-auto rounded border">
                    {loadingUsers && (
                      <p className="p-3 text-sm text-muted-foreground">Loading…</p>
                    )}
                    {!loadingUsers && users.length === 0 && (
                      <p className="p-3 text-sm text-muted-foreground">No users found</p>
                    )}
                    {users.map(u => (
                      <button
                        key={u.id}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedUser?.id === u.id ? 'bg-primary/10 font-medium' : ''}`}
                        onClick={() => setSelectedUser(u)}
                      >
                        <div>{u.first_name} {u.last_name}</div>
                        <div className="text-xs text-muted-foreground">{u.email} · <Badge variant="outline" className="text-[10px] px-1 py-0">{u.role}</Badge></div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Override matrix for selected user */}
              {selectedUser ? (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm">{selectedUser.first_name} {selectedUser.last_name}</CardTitle>
                        <CardDescription className="text-xs">
                          {selectedUser.email} · Role: <span className="font-medium">{ROLE_LABELS[selectedUser.role] ?? selectedUser.role}</span>
                        </CardDescription>
                        <div className="flex gap-2 pt-2">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate('/users')}>
                            <Users className="h-3.5 w-3.5 mr-1" />
                            User Management
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate('/audit-log')}>
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Audit Log
                          </Button>
                        </div>
                      </div>
                      {userPerms.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10 h-7 text-xs"
                          onClick={() => clearAllUserPerms.mutate()}
                        >
                          Clear All Overrides
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    {loadingUserPerms ? (
                      <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field Group</TableHead>
                            <TableHead className="text-center">Override</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {SITE_FIELD_GROUPS.map(group => (
                            <TableRow key={group}>
                              <TableCell className="font-medium text-sm py-3">
                                {SITE_FIELD_GROUP_LABELS[group]}
                              </TableCell>
                              <TableCell className="py-3 relative">
                                <UserPermCell group={group} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="flex items-center justify-center min-h-[200px]">
                  <div className="text-center text-sm text-muted-foreground p-6">
                    <UserCog className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>Select a user to manage their individual overrides</p>
                  </div>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </AppLayout>
  )
}

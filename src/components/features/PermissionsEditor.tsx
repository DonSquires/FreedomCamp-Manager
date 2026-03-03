import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-react'

interface Permission {
  resource: string
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
  roles: {
    officer: boolean
    admin: boolean
    admin_officer: boolean
    master: boolean
  }
}

interface PermissionsEditorProps {
  permissions: Permission[]
  onSave?: (permissions: Permission[]) => void
  readOnly?: boolean
}

const ROLES: Array<keyof Permission['roles']> = ['officer', 'admin', 'admin_officer', 'master']

const ROLE_LABELS: Record<keyof Permission['roles'], string> = {
  officer: 'Officer',
  admin: 'Admin',
  admin_officer: 'Admin Officer',
  master: 'Master',
}

export function PermissionsEditor({ permissions, onSave, readOnly = false }: PermissionsEditorProps) {
  const [localPerms, setLocalPerms] = useState<Permission[]>(permissions)

  const grouped = localPerms.reduce<Record<string, Permission[]>>((acc, perm) => {
    if (!acc[perm.resource]) acc[perm.resource] = []
    acc[perm.resource].push(perm)
    return acc
  }, {})

  const handleToggle = (resource: string, action: string, role: keyof Permission['roles']) => {
    setLocalPerms(prev =>
      prev.map(p =>
        p.resource === resource && p.action === action
          ? { ...p, roles: { ...p.roles, [role]: !p.roles[role] } }
          : p
      )
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Resource</TableHead>
              <TableHead className="w-24">Action</TableHead>
              {ROLES.map(role => (
                <TableHead key={role} className="text-center w-28">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(grouped).map(([resource, perms]) =>
              perms.map((perm, idx) => (
                <TableRow key={`${resource}-${perm.action}`}>
                  {idx === 0 ? (
                    <TableCell className="font-medium capitalize" rowSpan={perms.length}>
                      {resource}
                    </TableCell>
                  ) : null}
                  <TableCell className="capitalize text-sm text-gray-600">{perm.action}</TableCell>
                  {ROLES.map(role => (
                    <TableCell key={role} className="text-center">
                      <Checkbox
                        checked={perm.roles[role]}
                        disabled={readOnly}
                        onCheckedChange={() => handleToggle(resource, perm.action, role)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {onSave && !readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => onSave(localPerms)}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      )}
    </div>
  )
}

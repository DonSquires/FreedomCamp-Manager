import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PERMISSION_GROUPS, ROLE_PERMISSIONS, Permission } from '@/hooks/usePermissions';
import { Shield, CheckSquare, Square, RotateCcw } from 'lucide-react';

interface PermissionsEditorProps {
  selectedPermissions: string[];
  onPermissionsChange: (permissions: string[]) => void;
  userRole: 'master' | 'admin' | 'officer';
}

export function PermissionsEditor({
  selectedPermissions,
  onPermissionsChange,
  userRole,
}: PermissionsEditorProps) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>(
    PERMISSION_GROUPS.map((g) => g.name)
  );

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupName)
        ? prev.filter((n) => n !== groupName)
        : [...prev, groupName]
    );
  };

  const togglePermission = (permission: Permission) => {
    if (selectedPermissions.includes(permission)) {
      onPermissionsChange(selectedPermissions.filter((p) => p !== permission));
    } else {
      onPermissionsChange([...selectedPermissions, permission]);
    }
  };

  const selectAllInGroup = (groupPermissions: Permission[]) => {
    const newPermissions = new Set(selectedPermissions);
    groupPermissions.forEach((p) => newPermissions.add(p.key));
    onPermissionsChange(Array.from(newPermissions));
  };

  const deselectAllInGroup = (groupPermissions: Permission[]) => {
    const permissionKeys = groupPermissions.map((p) => p.key);
    onPermissionsChange(selectedPermissions.filter((p) => !permissionKeys.includes(p)));
  };

  const resetToRoleDefaults = () => {
    const defaultPerms = ROLE_PERMISSIONS[userRole] || [];
    onPermissionsChange(defaultPerms);
  };

  const isGroupFullySelected = (groupPermissions: { key: Permission }[]) => {
    return groupPermissions.every((p) => selectedPermissions.includes(p.key));
  };

  const isGroupPartiallySelected = (groupPermissions: { key: Permission }[]) => {
    const hasAny = groupPermissions.some((p) => selectedPermissions.includes(p.key));
    const hasAll = groupPermissions.every((p) => selectedPermissions.includes(p.key));
    return hasAny && !hasAll;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Granular Permissions</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetToRoleDefaults}
          className="gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to {userRole} defaults
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        Customize permissions for fine-grained access control. Selected: {selectedPermissions.length}
      </div>

      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
        {PERMISSION_GROUPS.map((group) => {
          const isExpanded = expandedGroups.includes(group.name);
          const isFullySelected = isGroupFullySelected(group.permissions);
          const isPartiallySelected = isGroupPartiallySelected(group.permissions);

          return (
            <Card key={group.name} className="border-border">
              <CardHeader
                className="cursor-pointer p-4 hover:bg-muted/50 transition-colors"
                onClick={() => toggleGroup(group.name)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center">
                      {isFullySelected ? (
                        <CheckSquare className="h-5 w-5 text-primary" />
                      ) : isPartiallySelected ? (
                        <div className="h-5 w-5 border-2 border-primary bg-primary/20 rounded" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {group.description}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {group.permissions.filter((p) => selectedPermissions.includes(p.key)).length}/
                    {group.permissions.length}
                  </Badge>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="p-4 pt-0 space-y-2">
                  <div className="flex gap-2 mb-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllInGroup(group.permissions);
                      }}
                      className="text-xs h-7"
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        deselectAllInGroup(group.permissions);
                      }}
                      className="text-xs h-7"
                    >
                      Deselect All
                    </Button>
                  </div>

                  {group.permissions.map((permission) => {
                    const isChecked = selectedPermissions.includes(permission.key);

                    return (
                      <div
                        key={permission.key}
                        className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          id={permission.key}
                          checked={isChecked}
                          onCheckedChange={() => togglePermission(permission.key)}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor={permission.key}
                            className="cursor-pointer font-medium text-sm"
                          >
                            {permission.label}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {permission.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

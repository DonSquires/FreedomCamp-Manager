import { useAuthStore } from '@/stores/authStore';

export type Permission =
  | 'zones.view'
  | 'zones.create'
  | 'zones.edit'
  | 'zones.delete'
  | 'breaches.view'
  | 'breaches.create'
  | 'breaches.edit'
  | 'breaches.resolve'
  | 'breaches.delete'
  | 'patrols.view'
  | 'patrols.create'
  | 'patrols.edit'
  | 'patrols.delete'
  | 'vehicles.view'
  | 'vehicles.create'
  | 'vehicles.edit'
  | 'vehicles.delete'
  | 'reports.view'
  | 'reports.export'
  | 'health_safety.view'
  | 'health_safety.create'
  | 'health_safety.resolve'
  | 'import.data'
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.delete'
  | 'organizations.view'
  | 'organizations.create'
  | 'organizations.edit'
  | 'organizations.delete'
  | 'analytics.view';

export interface PermissionGroup {
  name: string;
  description: string;
  permissions: {
    key: Permission;
    label: string;
    description: string;
  }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    name: 'Zone Management',
    description: 'Manage freedom camping zones and their rules',
    permissions: [
      { key: 'zones.view', label: 'View Zones', description: 'View all zones and their details' },
      { key: 'zones.create', label: 'Create Zones', description: 'Create new freedom camping zones' },
      { key: 'zones.edit', label: 'Edit Zones', description: 'Modify existing zone configurations' },
      { key: 'zones.delete', label: 'Delete Zones', description: 'Remove zones from the system' },
    ],
  },
  {
    name: 'Breach Management',
    description: 'Handle compliance breaches and violations',
    permissions: [
      { key: 'breaches.view', label: 'View Breaches', description: 'View all breach alerts' },
      { key: 'breaches.create', label: 'Create Breaches', description: 'Manually create breach alerts' },
      { key: 'breaches.edit', label: 'Edit Breaches', description: 'Modify breach alert details' },
      { key: 'breaches.resolve', label: 'Resolve Breaches', description: 'Mark breaches as resolved' },
      { key: 'breaches.delete', label: 'Delete Breaches', description: 'Remove breach alerts' },
    ],
  },
  {
    name: 'Patrol Operations',
    description: 'Manage patrol schedules and activities',
    permissions: [
      { key: 'patrols.view', label: 'View Patrols', description: 'View patrol schedules and history' },
      { key: 'patrols.create', label: 'Create Patrols', description: 'Schedule new patrols' },
      { key: 'patrols.edit', label: 'Edit Patrols', description: 'Modify patrol assignments and details' },
      { key: 'patrols.delete', label: 'Delete Patrols', description: 'Cancel or remove patrols' },
    ],
  },
  {
    name: 'Vehicle Records',
    description: 'Manage vehicle registration and tracking',
    permissions: [
      { key: 'vehicles.view', label: 'View Vehicles', description: 'View vehicle records and history' },
      { key: 'vehicles.create', label: 'Create Records', description: 'Add new vehicle sightings' },
      { key: 'vehicles.edit', label: 'Edit Records', description: 'Update vehicle information' },
      { key: 'vehicles.delete', label: 'Delete Records', description: 'Remove vehicle records' },
    ],
  },
  {
    name: 'Reports & Analytics',
    description: 'Access reports and compliance analytics',
    permissions: [
      { key: 'reports.view', label: 'View Reports', description: 'Access all reports and dashboards' },
      { key: 'reports.export', label: 'Export Reports', description: 'Export reports to PDF/Excel' },
      { key: 'analytics.view', label: 'View Analytics', description: 'Access compliance analytics dashboard' },
    ],
  },
  {
    name: 'Health & Safety',
    description: 'Manage health and safety incident reports',
    permissions: [
      { key: 'health_safety.view', label: 'View Reports', description: 'View health & safety incidents' },
      { key: 'health_safety.create', label: 'Create Reports', description: 'Submit new incident reports' },
      { key: 'health_safety.resolve', label: 'Resolve Reports', description: 'Mark incidents as resolved' },
    ],
  },
  {
    name: 'Data Management',
    description: 'Import and manage system data',
    permissions: [
      { key: 'import.data', label: 'Import Data', description: 'Upload and import vehicle records from files' },
    ],
  },
  {
    name: 'User Management',
    description: 'Manage system users and access control',
    permissions: [
      { key: 'users.view', label: 'View Users', description: 'View all system users' },
      { key: 'users.create', label: 'Create Users', description: 'Add new users to the system' },
      { key: 'users.edit', label: 'Edit Users', description: 'Modify user details and permissions' },
      { key: 'users.delete', label: 'Delete Users', description: 'Deactivate or remove users' },
    ],
  },
  {
    name: 'Organization Management',
    description: 'Manage organizations and their settings',
    permissions: [
      { key: 'organizations.view', label: 'View Organizations', description: 'View all organizations' },
      { key: 'organizations.create', label: 'Create Organizations', description: 'Add new organizations' },
      { key: 'organizations.edit', label: 'Edit Organizations', description: 'Modify organization details' },
      { key: 'organizations.delete', label: 'Delete Organizations', description: 'Remove organizations' },
    ],
  },
];

// Role-based default permission sets
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  master: [
    'zones.view', 'zones.create', 'zones.edit', 'zones.delete',
    'breaches.view', 'breaches.create', 'breaches.edit', 'breaches.resolve', 'breaches.delete',
    'patrols.view', 'patrols.create', 'patrols.edit', 'patrols.delete',
    'vehicles.view', 'vehicles.create', 'vehicles.edit', 'vehicles.delete',
    'reports.view', 'reports.export',
    'health_safety.view', 'health_safety.create', 'health_safety.resolve',
    'import.data',
    'users.view', 'users.create', 'users.edit', 'users.delete',
    'organizations.view', 'organizations.create', 'organizations.edit', 'organizations.delete',
    'analytics.view',
  ],
  admin: [
    'zones.view', 'zones.create', 'zones.edit', 'zones.delete',
    'breaches.view', 'breaches.create', 'breaches.edit', 'breaches.resolve',
    'patrols.view', 'patrols.create', 'patrols.edit', 'patrols.delete',
    'vehicles.view', 'vehicles.create', 'vehicles.edit',
    'reports.view', 'reports.export',
    'health_safety.view', 'health_safety.create', 'health_safety.resolve',
    'import.data',
    'users.view', 'users.create', 'users.edit',
    'analytics.view',
  ],
  officer: [
    'zones.view',
    'breaches.view', 'breaches.create',
    'patrols.view', 'patrols.create', 'patrols.edit',
    'vehicles.view', 'vehicles.create',
    'reports.view',
    'health_safety.view', 'health_safety.create',
    'analytics.view',
  ],
};

export const usePermissions = () => {
  const { user } = useAuthStore();

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;
    
    // Master role always has all permissions
    if (user.role === 'master') return true;
    
    // Check user's specific permissions
    const permissions = user.permissions || [];
    return permissions.includes(permission);
  };

  const hasAnyPermission = (permissions: Permission[]): boolean => {
    return permissions.some(p => hasPermission(p));
  };

  const hasAllPermissions = (permissions: Permission[]): boolean => {
    return permissions.every(p => hasPermission(p));
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    permissions: user?.permissions || [],
  };
};

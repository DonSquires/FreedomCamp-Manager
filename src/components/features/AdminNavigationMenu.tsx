/**
 * Admin Navigation Menu
 * Comprehensive hamburger menu with all admin routes
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Menu,
  TrendingUp,
  Eye,
  AlertCircle,
  Shield,
  Activity,
  MapPin,
  Car,
  Users,
  FileText,
  Database,
  Settings,
  LogOut,
  Camera,
  HelpCircle,
  Flame,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { cn } from '@/lib/utils';

interface NavigationItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string | number;
  description?: string;
  roles?: string[]; // If specified, only show for these roles
}

const navigationSections: { title: string; items: NavigationItem[] }[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: '/admin/dashboard',
        icon: TrendingUp,
        description: 'Main statistics and KPIs',
      },
      {
        label: 'Hotspots',
        path: '/admin/hotspots',
        icon: Flame,
        description: 'Heat map and density analysis',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'Compliance',
        path: '/admin/compliance',
        icon: Shield,
        description: 'Compliance dashboard with breach detail, zone stats and homeless/exempt tracking',
      },
      {
        label: 'Observations',
        path: '/admin/observations',
        icon: Eye,
        description: 'All vehicle observations',
      },
      {
        label: 'Breaches',
        path: '/admin/breaches',
        icon: AlertCircle,
        description: 'Active and pending breaches',
      },
      {
        label: 'Enforcement',
        path: '/admin/enforcement',
        icon: Shield,
        description: 'Actions and workflows',
      },
      {
        label: 'Officer Welfare',
        path: '/admin/officer-welfare',
        icon: Activity,
        description: 'Staff safety monitoring',
      },
    ],
  },
  {
    title: 'Management',
    items: [
      {
        label: 'Vehicles',
        path: '/admin/vehicles',
        icon: Car,
        description: 'Canonical registry',
      },
      {
        label: 'Zones',
        path: '/admin/zones',
        icon: MapPin,
        description: 'Zone configuration',
      },
      {
        label: 'Users',
        path: '/admin/users',
        icon: Users,
        description: 'User management',
      },
    ],
  },
  {
    title: 'Reporting',
    items: [
      {
        label: 'Reports',
        path: '/admin/reports',
        icon: FileText,
        description: 'Prebuilt reports & exports',
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        label: 'Database Tools',
        path: '/admin/db-tools',
        icon: Database,
        description: 'Imports, cleaners, integrity',
      },
      {
        label: 'Settings',
        path: '/admin/settings',
        icon: Settings,
        description: 'System configuration',
      },
    ],
  },
];

const quickActions: NavigationItem[] = [
  {
    label: 'Switch to Officer',
    path: '/officer/scan',
    icon: Camera,
    description: 'Field operations portal',
    roles: ['admin_officer'],
  },
  {
    label: 'Help & Docs',
    path: '/admin/help',
    icon: HelpCircle,
    description: 'Documentation',
  },
];

export function AdminNavigationMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);

  const handleNavigate = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    setOpen(false);
  };

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const shouldShowItem = (item: NavigationItem) => {
    if (!item.roles) return true;
    return user?.role && item.roles.includes(user.role);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0">
        <SheetHeader className="p-6 border-b">
          <div className="flex items-center gap-3">
            <JDSLogo size="sm" />
            <div>
              <SheetTitle>Admin Portal</SheetTitle>
              <SheetDescription className="text-xs truncate">
                {user?.first_name} {user?.last_name}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)]">
          <div className="p-4 space-y-6">
            {navigationSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.filter(shouldShowItem).map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);

                    return (
                      <Button
                        key={item.path}
                        variant={active ? 'secondary' : 'ghost'}
                        className={cn(
                          "w-full justify-start h-auto py-3 px-3",
                          active && "bg-primary/10 text-primary hover:bg-primary/20"
                        )}
                        onClick={() => handleNavigate(item.path)}
                      >
                        <Icon className="h-5 w-5 mr-3 shrink-0" />
                        <div className="flex-1 text-left">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{item.label}</span>
                            {item.badge && (
                              <Badge variant="secondary" className="ml-2">
                                {item.badge}
                              </Badge>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Quick Actions */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Quick Actions
              </h3>
              <div className="space-y-1">
                {quickActions.filter(shouldShowItem).map((item) => {
                  const Icon = item.icon;

                  return (
                    <Button
                      key={item.path}
                      variant="ghost"
                      className="w-full justify-start h-auto py-3 px-3"
                      onClick={() => handleNavigate(item.path)}
                    >
                      <Icon className="h-5 w-5 mr-3 shrink-0" />
                      <div className="flex-1 text-left">
                        <span className="font-medium">{item.label}</span>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background">
          <Button
            variant="ghost"
            className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

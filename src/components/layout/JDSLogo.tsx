/**
 * CompanyLogo - Official Iron Eagle Security (IES) branding component
 * Used consistently across all portals and pages
 * 
 * Iron Eagle Security provides professional security services and technology solutions
 * for compliance management and field operations in New Zealand.
 */

export interface CompanyLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showShadow?: boolean;
}

export function CompanyLogo({ 
  size = 'md',
  className = '',
  showShadow = false,
}: CompanyLogoProps) {
  const sizeClasses = {
    xs: 'h-6',   // 24px - Small icons
    sm: 'h-8',   // 32px - Sidebar, headers
    md: 'h-12',  // 48px - Default size
    lg: 'h-16',  // 64px - Login page
    xl: 'h-20',  // 80px - Hero sections
  };

  return (
    <img 
      src="/iron-eagle-security-logo.jpg" 
      alt="Iron Eagle Security (IES)" 
      className={`w-auto ${sizeClasses[size]} ${showShadow ? 'drop-shadow-lg' : ''} ${className}`}
      style={showShadow ? { filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' } : undefined}
    />
  );
}

// Legacy export for backward compatibility
export const JDSLogo = CompanyLogo;
export type JDSLogoProps = CompanyLogoProps;

/**
 * FreedomCamp Manager - Unified Theme System
 * Based on Iron Eagle Security logo colors: Cyan Blue, Navy Blue, Yellow/Gold, Black & Orange
 * Consistent color palette across all portals (Field Officer + Admin)
 */

export const colors = {
  // Brand Colors (from Iron Eagle Security logo)
  brand: {
    // Primary colors from logo
    cyan: '#00D4FF',            // Logo primary cyan blue (vibrant, energetic)
    cyanLight: '#33E0FF',       // Lighter cyan for hover states
    cyanDark: '#00A8CC',        // Darker cyan for active states
    cyanMuted: '#E5F9FF',       // Very light cyan for backgrounds
    
    navy: '#1B3A6B',            // Logo navy blue (professional, trustworthy)
    navyLight: '#2A5091',       // Lighter navy for hover states
    navyDark: '#0F2347',        // Darker navy for active states
    navyMuted: '#E8EDF5',       // Very light navy for backgrounds
    
    yellow: '#FFD700',          // Logo yellow/gold (eagle beak, accents)
    yellowLight: '#FFE44D',     // Lighter yellow for hover states
    yellowDark: '#CCB000',      // Darker yellow for active states
    yellowMuted: '#FFF9E5',     // Very light yellow for backgrounds
    
    // Core brand colors
    black: '#000000',           // Logo black
    orange: '#FF6B00',          // Brand orange
    orangeLight: '#FF8533',     // Lighter orange for hover states
    orangeDark: '#CC5500',      // Darker orange for active states
    orangeMuted: '#FFE5D6',     // Very light orange for backgrounds
    
    // Neutral grays
    grayDark: '#1A1A1A',        // Near-black for dark mode
    grayMedium: '#666666',      // Medium gray for secondary text
    grayLight: '#E5E5E5',       // Light gray for borders
    white: '#FFFFFF',           // Pure white
  },

  // Primary Actions (unified across all portals) - Using Cyan Blue from logo
  primary: {
    default: 'bg-cyan-500 hover:bg-cyan-600 text-white',
    outline: 'border-2 border-cyan-500 text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950/30',
    ghost: 'text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950/30',
  },

  // Secondary Actions - Using Navy Blue from logo
  secondary: {
    default: 'bg-blue-900 hover:bg-blue-950 text-white',
    outline: 'border-2 border-blue-900 text-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/30',
    ghost: 'text-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/30',
  },

  // Accent Actions - Using Orange
  accent: {
    default: 'bg-orange-600 hover:bg-orange-700 text-white',
    outline: 'border-2 border-orange-600 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30',
    ghost: 'text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30',
  },

  // Semantic Status Colors (consistent across all contexts)
  status: {
    compliant: {
      bg: 'bg-green-50 dark:bg-green-950/30',
      border: 'border-green-500',
      text: 'text-green-700 dark:text-green-300',
      gradient: 'bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/40',
      badge: 'bg-green-500 text-white',
      badgeOutline: 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-500',
    },
    breach: {
      bg: 'bg-yellow-50 dark:bg-yellow-950/30',
      border: 'border-yellow-500',
      text: 'text-yellow-700 dark:text-yellow-300',
      gradient: 'bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-950/40 dark:to-yellow-900/40',
      badge: 'bg-yellow-500 text-black',
      badgeOutline: 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-300 border-yellow-500',
    },
    flagged: {
      bg: 'bg-orange-50 dark:bg-orange-950/30',
      border: 'border-orange-500',
      text: 'text-orange-700 dark:text-orange-300',
      gradient: 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/40',
      badge: 'bg-orange-600 text-white',
      badgeOutline: 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border-orange-500',
    },
    homeless: {
      bg: 'bg-cyan-50 dark:bg-cyan-950/30',
      border: 'border-cyan-500',
      text: 'text-cyan-700 dark:text-cyan-300',
      gradient: 'bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/40 dark:to-cyan-900/40',
      badge: 'bg-cyan-500 text-white',
      badgeOutline: 'bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 border-cyan-500',
    },
    warning: {
      bg: 'bg-red-50 dark:bg-red-950/30',
      border: 'border-red-500',
      text: 'text-red-700 dark:text-red-300',
      gradient: 'bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/40',
      badge: 'bg-red-500 text-white',
      badgeOutline: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-500',
    },
    info: {
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      border: 'border-blue-900',
      text: 'text-blue-900 dark:text-blue-200',
      gradient: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40',
      badge: 'bg-blue-900 text-white',
      badgeOutline: 'bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 border-blue-900',
    },
  },

  // Neutral Palette (consistent cards, backgrounds, borders)
  neutral: {
    // Card backgrounds
    card: {
      default: 'bg-white dark:bg-gray-900',
      muted: 'bg-gray-50 dark:bg-gray-800',
      header: 'bg-gray-100 dark:bg-gray-800',
    },
    
    // Borders
    border: {
      default: 'border-2 border-gray-200 dark:border-gray-700',
      strong: 'border-2 border-gray-300 dark:border-gray-600',
      subtle: 'border border-gray-200 dark:border-gray-700',
    },

    // Text
    text: {
      primary: 'text-gray-900 dark:text-white',
      secondary: 'text-gray-700 dark:text-gray-200',
      muted: 'text-gray-600 dark:text-gray-300',
      subtle: 'text-gray-500 dark:text-gray-400',
    },
  },

  // Interactive States (hover, focus, active) - Using Cyan Blue
  interactive: {
    hover: 'hover:border-cyan-500 dark:hover:border-cyan-400 transition-colors',
    focus: 'focus:ring-4 focus:ring-cyan-300 dark:focus:ring-cyan-700',
    active: 'active:scale-[0.98] transition-transform',
    hoverNavy: 'hover:border-blue-900 dark:hover:border-blue-700 transition-colors',
    focusNavy: 'focus:ring-4 focus:ring-blue-900/30 dark:focus:ring-blue-700/50',
  },
};

/**
 * Get combined class string for a card variant
 */
export function getCardClasses(variant: 'default' | 'compliant' | 'breach' | 'flagged' | 'homeless' = 'default'): string {
  const base = colors.neutral.card.default + ' ' + colors.neutral.border.default;
  
  if (variant === 'default') return base;
  
  const statusColors = colors.status[variant as keyof typeof colors.status];
  return `${colors.neutral.card.default} border-2 ${statusColors.border}`;
}

/**
 * Get status badge classes
 */
export function getStatusBadgeClasses(
  status: 'compliant' | 'breach' | 'flagged' | 'homeless' | 'warning' | 'info',
  variant: 'solid' | 'outline' = 'solid'
): string {
  const statusColors = colors.status[status];
  return variant === 'solid' ? statusColors.badge : `border-2 ${statusColors.badgeOutline}`;
}

/**
 * Get button classes based on variant
 */
export function getButtonClasses(variant: 'primary' | 'outline' | 'ghost' = 'primary'): string {
  return colors.primary[variant];
}

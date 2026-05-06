/**
 * OfficerLanguageSelector — B-19
 *
 * Compact language-switcher pill for the officer portal header.
 * Uses useOfficerLocale() so the selection persists to localStorage
 * and the user's profile.
 */

import { Globe } from 'lucide-react'
import { useOfficerLocale } from '@/hooks/useOfficerLocale'
import type { OfficerLocale } from '@/lib/officerLocale'

const LOCALES: OfficerLocale[] = ['en', 'mi', 'zh', 'hi']
const LABELS: Record<OfficerLocale, string> = { en: 'EN', mi: 'MĀ', zh: '中', hi: 'हि' }
const ARIA: Record<OfficerLocale, string> = {
  en: 'English',
  mi: 'Te Reo Māori',
  zh: '普通话',
  hi: 'हिन्दी',
}

interface Props {
  /** If true, renders pills in a compact (icon-only) layout. Default false. */
  compact?: boolean
}

export function OfficerLanguageSelector({ compact = false }: Props) {
  const { locale, setLocale } = useOfficerLocale()

  return (
    <div className="flex items-center gap-1">
      {!compact && <Globe className="h-3.5 w-3.5 text-muted-foreground mr-0.5 shrink-0" />}
      {LOCALES.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-label={ARIA[l]}
          title={ARIA[l]}
          className={[
            'px-2 py-0.5 rounded text-xs font-medium transition-colors',
            locale === l
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          ].join(' ')}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}

/**
 * TranslateButton — B-28 Real-time Translation
 *
 * A reusable translate-button affordance that can be dropped next to any
 * text block (incident notes, breach descriptions, observation notes, etc.).
 *
 * Shows a "Translate" button with a language selector popover.
 * When a language is selected the edge function is called and the result
 * is shown inline in a highlighted card.
 *
 * Props:
 *   text        — source text to translate
 *   className?  — additional Tailwind classes on the wrapper
 */

import { useState } from 'react'
import { Globe, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { useTranslation, type SupportedLang, TRANSLATION_LANG_LABELS } from '@/hooks/useTranslation'

const TARGET_LANGS: SupportedLang[] = ['mi', 'zh-Hans', 'hi', 'ko', 'en']

interface TranslateButtonProps {
  text: string
  className?: string
}

export function TranslateButton({ text, className = '' }: TranslateButtonProps) {
  const { translate, result, isLoading, error, clearResult } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeLang, setActiveLang] = useState<SupportedLang | null>(null)

  const handleSelectLang = async (lang: SupportedLang) => {
    setActiveLang(lang)
    setOpen(false)
    await translate(text, lang)
  }

  const handleClear = () => {
    clearResult()
    setActiveLang(null)
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={!text.trim() || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Globe className="h-3 w-3" />
              )}
              {isLoading ? 'Translating…' : 'Translate'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Translate to:</p>
            <div className="grid gap-1">
              {TARGET_LANGS.map((lang) => (
                <button
                  key={lang}
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => handleSelectLang(lang)}
                >
                  {TRANSLATION_LANG_LABELS[lang]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {result && activeLang && (
          <Badge variant="secondary" className="text-xs gap-1">
            {TRANSLATION_LANG_LABELS[activeLang]}
            <button
              onClick={handleClear}
              className="ml-1 rounded-full hover:bg-accent"
              aria-label="Clear translation"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {result && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <p className="text-xs text-muted-foreground mb-1 font-medium">
            {activeLang ? TRANSLATION_LANG_LABELS[activeLang] : 'Translation'}
            {result.provider === 'mock' && (
              <span className="ml-1 text-amber-600">(preview)</span>
            )}
          </p>
          <p className="whitespace-pre-wrap">{result.translated_text}</p>
        </div>
      )}
    </div>
  )
}

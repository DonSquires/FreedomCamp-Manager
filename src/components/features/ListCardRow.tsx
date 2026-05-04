import type { ReactNode } from 'react'

interface ListCardRowProps {
  left: ReactNode
  right?: ReactNode
  className?: string
}

/**
 * Shared compact list-row shell used across dense operator cards.
 */
export function ListCardRow({ left, right, className }: ListCardRowProps) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded p-2 text-sm ${className ?? ''}`}>
      <div className="min-w-0 flex items-center gap-2">{left}</div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}
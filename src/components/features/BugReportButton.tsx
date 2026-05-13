import { Bug } from 'lucide-react'

interface BugReportButtonProps {
  onOpen: () => void
  position?: 'bottom-right' | 'bottom-left'
}

export function BugReportButton({ onOpen, position = 'bottom-right' }: BugReportButtonProps) {
  const positionClass = position === 'bottom-left'
    ? 'bottom-4 left-4'
    : 'bottom-4 right-4'

  return (
    <button
      onClick={onOpen}
      title="Report a Bug"
      className={`fixed ${positionClass} z-50 size-10 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333333] flex items-center justify-center shadow-md transition-colors`}
    >
      <Bug className="h-5 w-5 text-gray-600 dark:text-gray-300" />
    </button>
  )
}

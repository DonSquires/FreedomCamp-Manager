/**
 * LoadingSpinner Component
 * Loading states with various styles
 */

import { Loader2, RefreshCw } from 'lucide-react'
import { PaperworkSearchAnimation } from './PaperworkSearchAnimation'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'spinner' | 'pulse' | 'bounce' | 'dots' | 'paperwork'
  text?: string
  fullScreen?: boolean
}

export function LoadingSpinner({
  size = 'md',
  variant = 'spinner',
  text,
  fullScreen = false,
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16',
  }

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
  }

  const renderSpinner = () => {
    switch (variant) {
      case 'spinner':
        return (
          <Loader2 className={`${sizeClasses[size]} animate-spin text-primary`} />
        )

      case 'pulse':
        return (
          <div className={`${sizeClasses[size]} rounded-full bg-primary animate-pulse`} />
        )

      case 'bounce':
        return (
          <div className="flex items-center gap-2">
            <div
              className={`${
                size === 'sm' ? 'h-2 w-2' : size === 'md' ? 'h-3 w-3' : 'h-4 w-4'
              } rounded-full bg-primary animate-bounce [animation-delay:-0.3s]`}
            />
            <div
              className={`${
                size === 'sm' ? 'h-2 w-2' : size === 'md' ? 'h-3 w-3' : 'h-4 w-4'
              } rounded-full bg-primary animate-bounce [animation-delay:-0.15s]`}
            />
            <div
              className={`${
                size === 'sm' ? 'h-2 w-2' : size === 'md' ? 'h-3 w-3' : 'h-4 w-4'
              } rounded-full bg-primary animate-bounce`}
            />
          </div>
        )

      case 'dots':
        return (
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`${
                  size === 'sm' ? 'h-1.5 w-1.5' : size === 'md' ? 'h-2 w-2' : 'h-3 w-3'
                } rounded-full bg-primary animate-pulse`}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )

      case 'paperwork': {
        const animSize = size === 'sm' ? 'sm' : size === 'xl' ? 'lg' : 'md'
        return <PaperworkSearchAnimation size={animSize} text={text} />
      }

      default:
        return (
          <Loader2 className={`${sizeClasses[size]} animate-spin text-primary`} />
        )
    }
  }

  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      {renderSpinner()}
      {text && variant !== 'paperwork' && (
        <p className={`${textSizeClasses[size]} text-muted-foreground`}>
          {text}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
        {content}
      </div>
    )
  }

  return <div className="flex items-center justify-center p-8">{content}</div>
}

// Inline loading (for buttons, cards, etc.)
export function InlineLoading({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  }

  return <Loader2 className={`${sizeClasses[size]} animate-spin`} />
}

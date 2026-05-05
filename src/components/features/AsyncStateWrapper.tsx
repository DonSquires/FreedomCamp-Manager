/**
 * AsyncStateWrapper
 *
 * A composable wrapper that unifies loading / error / empty / retry / offline
 * async-state handling across operator routes.
 *
 * Usage:
 *   <AsyncStateWrapper isLoading={isLoading} isError={isError} isEmpty={data.length === 0}>
 *     {/* content rendered only when not loading, not errored, and not empty *\/}
 *   </AsyncStateWrapper>
 */

import { ReactNode } from 'react'
import { AlertTriangle, WifiOff, RefreshCw, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PaperworkSearchAnimation } from './PaperworkSearchAnimation'

export interface AsyncStateWrapperProps {
  /** True while the primary data query is in-flight */
  isLoading?: boolean
  /** True when the query has failed and no cached data is available */
  isError?: boolean
  /** Supply when you want a custom empty-state check */
  isEmpty?: boolean
  /** Raw error object or message string for the error panel */
  error?: Error | string | null | unknown
  /** Called when the user clicks the retry / refresh button */
  onRetry?: () => void
  /** True when the browser/app is offline (navigator.onLine) */
  isOffline?: boolean
  /** Override the loading indicator text */
  loadingText?: string
  /** Override the loading indicator size */
  loadingSize?: 'sm' | 'md' | 'lg'
  /** Override the error heading text */
  errorTitle?: string
  /** Override the empty-state heading text */
  emptyTitle?: string
  /** Override the empty-state description */
  emptyDescription?: string
  /** Custom icon for the empty state */
  emptyIcon?: ReactNode
  /** Custom action button label for empty state (shown alongside onRetry or an add callback) */
  emptyActionLabel?: string
  /** Custom action for empty state CTA */
  onEmptyAction?: () => void
  /** Content to render when data is ready and non-empty */
  children: ReactNode
  /** Optional wrapper className applied around the state panels */
  className?: string
}

function errorMessage(error: AsyncStateWrapperProps['error']): string {
  if (!error) return 'An unexpected error occurred. Please try again.'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

export function AsyncStateWrapper({
  isLoading = false,
  isError = false,
  isEmpty = false,
  error,
  onRetry,
  isOffline = false,
  loadingText = 'Loading…',
  loadingSize = 'md',
  errorTitle = 'Failed to load data',
  emptyTitle = 'No data found',
  emptyDescription,
  emptyIcon,
  emptyActionLabel,
  onEmptyAction,
  children,
  className,
}: AsyncStateWrapperProps) {
  // ── Offline ────────────────────────────────────────────────────────────────
  if (isOffline) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <WifiOff className="h-12 w-12 text-muted-foreground opacity-40" />
          <div>
            <p className="font-medium text-base">You appear to be offline</p>
            <p className="text-sm text-muted-foreground mt-1">
              Check your connection and try again.
            </p>
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={className}>
        <PaperworkSearchAnimation text={loadingText} size={loadingSize} />
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <AlertTriangle className="h-12 w-12 text-red-400 opacity-70" />
          <div>
            <p className="font-medium text-base text-foreground">{errorTitle}</p>
            {error && (
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {errorMessage(error)}
              </p>
            )}
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Try Again
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
          {emptyIcon ?? <Inbox className="h-12 w-12 text-muted-foreground opacity-30" />}
          <div>
            <p className="font-medium text-base text-foreground">{emptyTitle}</p>
            {emptyDescription && (
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {emptyDescription}
              </p>
            )}
          </div>
          {(emptyActionLabel && onEmptyAction) && (
            <Button variant="outline" size="sm" onClick={onEmptyAction}>
              {emptyActionLabel}
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Resolved ───────────────────────────────────────────────────────────────
  return <>{children}</>
}

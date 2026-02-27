/**
 * ProgressTracker Component
 * Multi-step progress indicator
 */

import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface Step {
  id: string
  label: string
  description?: string
}

interface ProgressTrackerProps {
  steps: Step[]
  currentStep: number
  onStepClick?: (stepIndex: number) => void
  variant?: 'horizontal' | 'vertical'
}

export function ProgressTracker({
  steps,
  currentStep,
  onStepClick,
  variant = 'horizontal',
}: ProgressTrackerProps) {
  if (variant === 'vertical') {
    return (
      <div className="space-y-4">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const isFuture = index > currentStep

          return (
            <button
              key={step.id}
              onClick={() => onStepClick && onStepClick(index)}
              disabled={isFuture || !onStepClick}
              className={`w-full text-left ${
                !onStepClick || isFuture ? 'cursor-default' : 'cursor-pointer'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Step indicator */}
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                    isCompleted
                      ? 'bg-primary border-primary text-primary-foreground'
                      : isCurrent
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${
                        isCurrent ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {step.label}
                    </span>
                    {isCurrent && (
                      <Badge variant="secondary" className="text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  {step.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="ml-4 pl-4 mt-2 mb-2">
                  <div
                    className={`w-0.5 h-8 ${
                      index < currentStep ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                </div>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // Horizontal variant
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const isFuture = index > currentStep

          return (
            <div key={step.id} className="flex items-center flex-1">
              <button
                onClick={() => onStepClick && onStepClick(index)}
                disabled={isFuture || !onStepClick}
                className={`flex flex-col items-center gap-2 ${
                  !onStepClick || isFuture ? 'cursor-default' : 'cursor-pointer'
                }`}
              >
                {/* Step indicator */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                    isCompleted
                      ? 'bg-primary border-primary text-primary-foreground'
                      : isCurrent
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>

                {/* Step label */}
                <div className="text-center">
                  <div
                    className={`text-sm font-medium ${
                      isCurrent ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {step.label}
                  </div>
                  {step.description && (
                    <div className="text-xs text-muted-foreground mt-1 hidden sm:block">
                      {step.description}
                    </div>
                  )}
                </div>
              </button>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

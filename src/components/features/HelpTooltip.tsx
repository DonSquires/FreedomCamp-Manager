/**
 * HelpTooltip Component
 * Contextual help system
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { HelpCircle, X, ExternalLink } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface HelpTooltipProps {
  title: string
  content: string | React.ReactNode
  learnMoreUrl?: string
  variant?: 'icon' | 'text' | 'inline'
  size?: 'sm' | 'md' | 'lg'
}

export function HelpTooltip({
  title,
  content,
  learnMoreUrl,
  variant = 'icon',
  size = 'md',
}: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false)

  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }

  if (variant === 'inline') {
    return (
      <div className="inline-flex items-center gap-2">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <HelpCircle className={sizeClasses[size]} />
            </button>
          </SheetTrigger>

          <SheetContent>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                {title}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              <div className="text-sm text-muted-foreground leading-relaxed">
                {content}
              </div>

              {learnMoreUrl && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(learnMoreUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Learn More
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  if (variant === 'text') {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="link" className="h-auto p-0 text-sm">
            <HelpCircle className="h-4 w-4 mr-1" />
            Help
          </Button>
        </SheetTrigger>

        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              {title}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="text-sm text-muted-foreground leading-relaxed">
              {content}
            </div>

            {learnMoreUrl && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(learnMoreUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Learn More
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // Default: icon variant
  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <HelpCircle className={sizeClasses[size]} />
        </button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="text-sm text-muted-foreground leading-relaxed">
            {content}
          </div>

          {learnMoreUrl && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(learnMoreUrl, '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Learn More
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Common help topics
export const HELP_TOPICS = {
  plateScanner: {
    title: 'Plate Scanner',
    content: (
      <div className="space-y-3">
        <p>
          The Plate Scanner uses Bob-powered Automatic Licence Plate Recognition (ALPR) 
          to quickly identify vehicles.
        </p>
        <div className="space-y-2">
          <p className="font-medium">Best Practices:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Ensure good lighting conditions</li>
            <li>Keep the plate centered in frame</li>
            <li>Avoid glare and reflections</li>
            <li>Use manual entry as fallback</li>
          </ul>
        </div>
      </div>
    ),
  },
  complianceRules: {
    title: 'Compliance Rules',
    content: (
      <div className="space-y-3">
        <p>
          Compliance rules determine whether a vehicle is permitted to park in a zone.
        </p>
        <div className="space-y-2">
          <p className="font-medium">Key Criteria:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Self-contained certification requirement</li>
            <li>Maximum nights per month (typically 28)</li>
            <li>Maximum consecutive nights (typically 3)</li>
            <li>Homeless exemption status</li>
          </ul>
        </div>
      </div>
    ),
  },
  breachAlerts: {
    title: 'Breach Alerts',
    content: (
      <div className="space-y-3">
        <p>
          Breach alerts are automatically generated when a vehicle violates zone 
          compliance rules.
        </p>
        <div className="space-y-2">
          <p className="font-medium">Response Actions:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Review breach details and evidence</li>
            <li>Issue warning notice if first offence</li>
            <li>Generate notice to vacate if repeat offence</li>
            <li>Request tow if non-compliant after notice</li>
          </ul>
        </div>
      </div>
    ),
  },
}

/**
 * KeyboardShortcuts Component
 * Keyboard shortcut overlay
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Keyboard, X, Command } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Shortcut {
  keys: string[]
  description: string
  category: string
}

interface KeyboardShortcutsProps {
  shortcuts?: Shortcut[]
  onShortcut?: (shortcutId: string) => void
}

export function KeyboardShortcuts({
  shortcuts = DEFAULT_SHORTCUTS,
  onShortcut,
}: KeyboardShortcutsProps) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show shortcuts overlay with ?
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setIsOpen(true)
        return
      }

      // Close overlay with Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        return
      }

      // Handle other shortcuts
      if (onShortcut) {
        shortcuts.forEach((shortcut) => {
          const matchesKeys = shortcut.keys.every((key) => {
            if (key === 'Ctrl' || key === 'Cmd') {
              return e.ctrlKey || e.metaKey
            }
            if (key === 'Shift') {
              return e.shiftKey
            }
            if (key === 'Alt') {
              return e.altKey
            }
            return e.key.toLowerCase() === key.toLowerCase()
          })

          if (matchesKeys) {
            e.preventDefault()
            const shortcutId = shortcut.keys.join('+').toLowerCase()
            onShortcut(shortcutId)
          }
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, shortcuts, onShortcut])

  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = []
    }
    acc[shortcut.category].push(shortcut)
    return acc
  }, {} as Record<string, Shortcut[]>)

  const renderKey = (key: string) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    
    if (key === 'Ctrl' && isMac) {
      return <Command className="h-3 w-3" />
    }
    
    if (key === 'Cmd') {
      return <Command className="h-3 w-3" />
    }

    return key
  }

  return (
    <>
      {/* Trigger button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40"
      >
        <Keyboard className="h-4 w-4 mr-2" />
        Shortcuts
      </Button>

      {/* Shortcuts overlay */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription>
              Use these shortcuts to navigate faster
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 space-y-6">
            {Object.entries(groupedShortcuts).map(([category, shortcuts]) => (
              <div key={category}>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  {category}
                </h3>
                <div className="space-y-2">
                  {shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-muted"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <div key={keyIndex} className="flex items-center gap-1">
                            <Badge
                              variant="outline"
                              className="font-mono px-2 py-0.5"
                            >
                              {renderKey(key)}
                            </Badge>
                            {keyIndex < shortcut.keys.length - 1 && (
                              <span className="text-xs text-muted-foreground">+</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
            Press <Badge variant="outline" className="mx-1">?</Badge> to show this dialog anytime
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Default shortcuts
const DEFAULT_SHORTCUTS: Shortcut[] = [
  // Navigation
  {
    keys: ['Ctrl', 'K'],
    description: 'Open search',
    category: 'Navigation',
  },
  {
    keys: ['G', 'H'],
    description: 'Go to home',
    category: 'Navigation',
  },
  {
    keys: ['G', 'V'],
    description: 'Go to vehicles',
    category: 'Navigation',
  },
  {
    keys: ['G', 'Z'],
    description: 'Go to zones',
    category: 'Navigation',
  },
  {
    keys: ['G', 'B'],
    description: 'Go to breaches',
    category: 'Navigation',
  },

  // Actions
  {
    keys: ['N'],
    description: 'New observation',
    category: 'Actions',
  },
  {
    keys: ['S'],
    description: 'Scan vehicle',
    category: 'Actions',
  },
  {
    keys: ['R'],
    description: 'Refresh data',
    category: 'Actions',
  },
  {
    keys: ['Ctrl', 'P'],
    description: 'Print/Export',
    category: 'Actions',
  },

  // Help
  {
    keys: ['?'],
    description: 'Show keyboard shortcuts',
    category: 'Help',
  },
  {
    keys: ['Escape'],
    description: 'Close dialog/menu',
    category: 'Help',
  },
]

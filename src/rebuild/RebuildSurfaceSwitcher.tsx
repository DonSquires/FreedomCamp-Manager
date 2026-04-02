/**
 * RebuildSurfaceSwitcher
 *
 * A floating dev badge visible only when `?dev-tools=1` is in the URL or when
 * the tester previously enabled it.  Lets QA staff flip between the legacy app
 * surface and the clean rebuild surface without needing ENV vars or a new build.
 *
 * Toggle mechanism:
 *   Enable  → localStorage.setItem('clean_rebuild_surface', 'true') + reload
 *   Disable → localStorage.removeItem('clean_rebuild_surface') + reload
 *
 * Can also be activated/deactivated via URL:
 *   ?clean_rebuild=1  → enable and persist
 *   ?clean_rebuild=0  → disable and clear
 */

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'clean_rebuild_surface'

function isDevToolsVisible(): boolean {
  return new URLSearchParams(window.location.search).get('dev-tools') === '1'
    || localStorage.getItem('dev_tools_visible') === 'true'
}

export function RebuildSurfaceSwitcher() {
  const [visible, setVisible] = useState(false)
  const [isClean, setIsClean] = useState(false)

  useEffect(() => {
    setVisible(isDevToolsVisible())
    setIsClean(localStorage.getItem(STORAGE_KEY) === 'true')

    // Persist dev-tools visibility so it survives navigation.
    if (new URLSearchParams(window.location.search).get('dev-tools') === '1') {
      localStorage.setItem('dev_tools_visible', 'true')
    }
  }, [])

  if (!visible) return null

  function toggle() {
    if (isClean) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    window.location.reload()
  }

  function hide() {
    localStorage.removeItem('dev_tools_visible')
    setVisible(false)
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '0.25rem',
        fontFamily: 'monospace',
        fontSize: '0.75rem',
      }}
    >
      <div
        style={{
          background: isClean ? '#16a34a' : '#dc2626',
          color: '#fff',
          borderRadius: '0.375rem',
          padding: '0.5rem 0.875rem',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
        onClick={toggle}
        title={isClean ? 'Switch to legacy surface' : 'Switch to clean rebuild surface'}
      >
        <span style={{ opacity: 0.75 }}>⚡ DEV</span>
        <span>{isClean ? 'CLEAN BUILD' : 'LEGACY'}</span>
        <span style={{ opacity: 0.6 }}>→ flip</span>
      </div>
      <span
        style={{ color: '#6b7280', cursor: 'pointer', paddingRight: '0.25rem' }}
        onClick={hide}
        title="Hide dev tools badge"
      >
        hide
      </span>
    </div>
  )
}

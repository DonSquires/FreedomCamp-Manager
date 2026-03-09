import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { useOrganizationBoundary } from '@/hooks/useOrganizationBoundary'
import { getGeoJsonBounds } from '@/lib/geoBounds'

interface JurisdictionMapViewportProps {
  organizationId?: string | null
  fallbackCenter?: [number, number]
  fallbackZoom?: number
  focusKey?: string | number
}

export function JurisdictionMapViewport({
  organizationId,
  fallbackCenter,
  fallbackZoom = 11,
  focusKey,
}: JurisdictionMapViewportProps) {
  const map = useMap()
  const { data: boundary } = useOrganizationBoundary(organizationId || undefined)
  const lastAppliedRef = useRef<string>('')

  useEffect(() => {
    const bounds = getGeoJsonBounds(boundary?.geom)
    const key = bounds
      ? `${organizationId || 'none'}-${boundary?.updated_at || 'na'}-bounds-${String(focusKey ?? '')}`
      : `${organizationId || 'none'}-fallback-${fallbackCenter?.join(',') || 'none'}-${fallbackZoom}-${String(focusKey ?? '')}`

    if (lastAppliedRef.current === key) {
      return
    }

    if (bounds) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 })
      lastAppliedRef.current = key
      return
    }

    if (fallbackCenter) {
      map.setView(fallbackCenter, fallbackZoom)
      lastAppliedRef.current = key
    }
  }, [map, organizationId, boundary?.geom, boundary?.updated_at, fallbackCenter, fallbackZoom, focusKey])

  return null
}

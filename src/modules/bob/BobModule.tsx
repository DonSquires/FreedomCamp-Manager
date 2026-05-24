import { Navigate } from 'react-router-dom'

/**
 * Bob module entry should always resolve to the operational assistant surface.
 */
export default function BobModule() {
  return <Navigate to="/bob-assistant" replace />
}

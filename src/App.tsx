import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import Login from '@/pages/Login'
import FieldOfficerPortal from '@/pages/FieldOfficerPortal'
import AdminPortal from '@/pages/AdminPortal'

function App() {
  const { checkSession, isAuthenticated, user } = useAuthStore()

  useEffect(() => {
    checkSession()
  }, [])

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      
      {/* Field Officer Portal */}
      {(user?.role === 'officer' || user?.role === 'admin_officer') && (
        <Route path="/field-officer" element={<FieldOfficerPortal />} />
      )}

      {/* Admin Portal */}
      {(user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master') && (
        <Route path="/admin" element={<AdminPortal />} />
      )}

      {/* Default redirect based on role */}
      <Route 
        path="/" 
        element={
          user?.role === 'officer' 
            ? <Navigate to="/field-officer" replace />
            : <Navigate to="/admin" replace />
        } 
      />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App

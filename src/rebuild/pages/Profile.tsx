import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface UserProfile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string
  badge_number: string | null
  phone: string | null
  profile_photo_url: string | null
  organization_id: string | null
}

export default function CleanProfile() {
  const { user } = useAuthStore()
  const userId = user?.id
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<Partial<UserProfile>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)

  useEffect(() => {
    if (!userId) return
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (data) {
        const row = data as any
        const profileData: UserProfile = {
          id: row.id,
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          email: row.email ?? null,
          role: row.role ?? 'officer',
          badge_number: row.badge_number ?? null,
          phone: row.phone ?? null,
          profile_photo_url: row.profile_photo_url ?? null,
          organization_id: row.organization_id ?? null,
        }
        setProfile(profileData)
        setForm(profileData)
      }
      setLoading(false)
    }
    load()
  }, [userId])

  async function saveProfile() {
    if (!profile) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: err } = await supabase
      .from('user_profiles')
      .update({
        first_name: (form.first_name ?? '').trim() || null,
        last_name: (form.last_name ?? '').trim() || null,
        phone: form.phone || null,
        badge_number: form.badge_number || null,
      })
      .eq('id', profile.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function changePassword() {
    setPasswordError(null)
    setPasswordSaved(false)
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    setChangingPassword(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (err) { setPasswordError(err.message); return }
    setNewPassword('')
    setCurrentPassword('')
    setConfirmPassword('')
    setPasswordSaved(true)
    setTimeout(() => setPasswordSaved(false), 3000)
  }

  if (loading) return <div className="p-6 text-center text-gray-400">Loading…</div>

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>

      {/* Avatar + role */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl text-blue-600 font-bold">
          {(`${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || profile?.email || '?').charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{(`${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || profile?.email || '—')}</p>
          <p className="text-sm text-gray-500 capitalize">{profile?.role ?? '—'}</p>
        </div>
      </div>

      {/* Profile form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Personal details</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
          <input
            type="text"
            value={form.first_name ?? ''}
            onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
          <input
            type="text"
            value={form.last_name ?? ''}
            onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={form.email ?? ''}
            disabled
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-gray-50 text-gray-500"
          />
          <p className="text-xs text-gray-400 mt-1">Email cannot be changed here. Contact your administrator.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input
            type="text"
            value={form.phone ?? ''}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Badge number</label>
          <input
            type="text"
            value={form.badge_number ?? ''}
            onChange={e => setForm(f => ({ ...f, badge_number: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-600">✓ Profile saved</p>}
        <button
          onClick={saveProfile}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {/* Password change */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Change password</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
        {passwordSaved && <p className="text-sm text-green-600">✓ Password updated</p>}
        <button
          onClick={changePassword}
          disabled={changingPassword || !newPassword}
          className="px-5 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
        >
          {changingPassword ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </div>
  )
}

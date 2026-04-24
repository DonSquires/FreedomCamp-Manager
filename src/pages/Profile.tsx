import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  User,
  Mail,
  Phone,
  Building2,
  Save,
  Check,
  Shield,
  Calendar,
  Activity,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface UserProfile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  role: string | null
  organization_id: string | null
  is_active: boolean | null
  created_at: string | null
  bio: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  profile_photo_url: string | null
  organization: { name: string } | null
}

interface ActiveSession {
  id: string
  device_name: string | null
  device_platform: string | null
  created_at: string
  last_seen_at: string | null
  ip_address: string | null
}

export default function Profile() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    bio: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  })

  const [formReady, setFormReady] = useState(false)

  // Fetch full profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select(`
          id, first_name, last_name, email, phone, role, organization_id, is_active, created_at,
          bio, emergency_contact_name, emergency_contact_phone, profile_photo_url,
          organization:organizations!organization_id(name)
        `)
        .eq('id', user!.id)
        .single()
      if (error) throw error
      const p = data as unknown as UserProfile
      if (!formReady) {
        setForm({
          first_name: p.first_name || '',
          last_name: p.last_name || '',
          phone: p.phone || '',
          bio: p.bio || '',
          emergency_contact_name: p.emergency_contact_name || '',
          emergency_contact_phone: p.emergency_contact_phone || '',
        })
        setFormReady(true)
      }
      return p
    },
    enabled: !!user,
  })

  // Fetch active sessions
  const { data: sessions = [] } = useQuery({
    queryKey: ['user-sessions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_sessions')
        .select('id, device_name, device_platform, created_at, last_seen_at, ip_address')
        .eq('user_id', user!.id)
        .order('last_seen_at', { ascending: false })
        .limit(10)
      if (error) return []
      return (data || []) as ActiveSession[]
    },
    enabled: !!user,
  })

  const saveProfile = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('user_profiles') as any)
        .update({
          first_name: form.first_name || null,
          last_name: form.last_name || null,
          phone: form.phone || null,
          bio: form.bio || null,
          emergency_contact_name: form.emergency_contact_name || null,
          emergency_contact_phone: form.emergency_contact_phone || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      setSaved(true)
      toast.success('Profile updated')
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: any) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <AppLayout title="Profile">
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="My Profile" description="Manage your account details and emergency contact">
      <div className="max-w-2xl space-y-5">

        {/* ── Profile hero ─────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4 sm:p-5 shadow-sm">
          <div className="absolute -top-12 -right-10 h-36 w-36 rounded-full bg-blue-200/40 blur-2xl dark:bg-blue-500/10 pointer-events-none" />
          <div className="relative flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/40 border-2 border-blue-200 dark:border-blue-700 flex items-center justify-center overflow-hidden shadow-sm shrink-0">
              {profile?.profile_photo_url ? (
                <img src={profile.profile_photo_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-blue-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                {profile?.first_name || profile?.last_name
                  ? `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
                  : user?.email}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge variant="outline" className="capitalize text-xs">{profile?.role}</Badge>
                {profile?.is_active && <Badge variant="secondary" className="text-xs">Active</Badge>}
                {profile?.organization && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {profile.organization.name}
                  </span>
                )}
              </div>
              {profile?.created_at && (
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Member since {formatDateTime(profile.created_at)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Edit form */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-600" />
          <CardHeader className="pt-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Personal Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First Name</Label>
                <Input
                  value={form.first_name}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name</Label>
                <Input
                  value={form.last_name}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">Email cannot be changed here. Contact your administrator.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+64 21 xxx xxxx"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Bio</Label>
              <Textarea
                value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                placeholder="Brief description of your role…"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Emergency contact */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-600" />
          <CardHeader className="pt-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-red-500" />
              Emergency Contact
            </CardTitle>
            <CardDescription>
              Used in Man Down welfare alerts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Emergency Contact Name</Label>
              <Input
                value={form.emergency_contact_name}
                onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
                placeholder="Contact name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Contact Phone</Label>
              <Input
                value={form.emergency_contact_phone}
                onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
                placeholder="+64 21 xxx xxxx"
              />
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          onClick={() => saveProfile.mutate()}
          disabled={saveProfile.isPending}
        >
          {saved ? (
            <span className="flex items-center gap-2"><Check className="h-4 w-4" />Saved</span>
          ) : (
            <span className="flex items-center gap-2"><Save className="h-4 w-4" />Save Profile</span>
          )}
        </Button>

        {/* Sessions */}
        {sessions.length > 0 && (
          <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-slate-400 to-slate-600" />
            <CardHeader className="pt-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Active Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-800/50 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="font-medium">{s.device_name || s.device_platform || 'Unknown device'}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.last_seen_at ? `Last seen ${formatDateTime(s.last_seen_at)}` : `Created ${formatDateTime(s.created_at)}`}
                        {s.ip_address && ` · ${s.ip_address}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

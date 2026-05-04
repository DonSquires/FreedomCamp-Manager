import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { 
  UserPlus, 
  Search, 
  Edit, 
  Mail, 
  Shield, 
  CheckCircle, 
  XCircle, 
  Upload,
  FileText,
  Calendar,
  AlertCircle,
  Award,
  Clock,
  Building2,
  ShieldCheck,
  Globe,
  Lock,
  Radio,
  Settings,
  Plus,
  X,
} from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { PTTChannelAccessControl } from '@/components/features/PTTChannelAccessControl'
import { uploadFile } from '@/lib/fileUpload'
import { PORTAL_AREA_LABELS, type PortalAreaCode } from '@/hooks/usePermissions'

interface Organization {
  id: string
  name: string
  parent_organization_id: string | null
}

interface UserProfile {
  id: string
  first_name: string
  last_name: string
  callsign: string | null
  email: string
  role: string
  organization_id: string | null
  employer_organization_id: string | null
  is_active: boolean
  created_at: string
  phone: string | null
  job_title: string | null
  requires_driver_license: boolean
  // Compliance credentials
  coa_number: string | null
  coa_expiry: string | null
  coa_document_url: string | null
  warrant_number: string | null
  warrant_expiry: string | null
  warrant_document_url: string | null
  credentials_verified: boolean
  credentials_verified_at: string | null
  credentials_verified_by: string | null
  // Access control
  portal_access: string[]
  authorized_work_locations: string[]
  extra_organization_ids: string[]
  ptt_channel_access: string[] | null
  // Joined data
  organization?: Organization | null
}

interface DirectUserPreview {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

export default function UserManagement() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false)
  const [showRoleDialog, setShowRoleDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterCredentials, setFilterCredentials] = useState<string>('all')
  const [filterOrg, setFilterOrg] = useState<string>('all')
  
  // Form state
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('officer')
  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [requiresDriverLicense, setRequiresDriverLicense] = useState(false)
  const [organizationId, setOrganizationId] = useState<string>('')
  const [extraOrganizationIds, setExtraOrganizationIds] = useState<string[]>([])
  const [employerOrgId, setEmployerOrgId] = useState<string>('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showSetPasswordDialog, setShowSetPasswordDialog] = useState(false)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const normalizedEmail = email.trim()
  const hasEmailInput = normalizedEmail.length > 0
  const isEmailValid = !hasEmailInput || emailRegex.test(normalizedEmail)
  const [showBulkCallsignDialog, setShowBulkCallsignDialog] = useState(false)
  const [setPasswordUserId, setSetPasswordUserId] = useState<string | null>(null)
  const [setPasswordUserName, setSetPasswordUserName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [bulkCallsignOrgId, setBulkCallsignOrgId] = useState<string>('')
  const [bulkCallsignMode, setBulkCallsignMode] = useState<'missing' | 'all'>('missing')
  const [editablePttScopes, setEditablePttScopes] = useState<string[]>([])
  const [crossOrgToAdd, setCrossOrgToAdd] = useState<string>('')
  const [directUserToAdd, setDirectUserToAdd] = useState<string>('')
  const [portalAccess, setPortalAccess] = useState<PortalAreaCode[]>([])
  const [createPttScopes, setCreatePttScopes] = useState<string[]>([])
  const [createPttScopeInput, setCreatePttScopeInput] = useState<string>('')

  // Credentials form state
  const [coaNumber, setCoaNumber] = useState('')
  const [coaExpiry, setCoaExpiry] = useState('')
  const [warrantNumber, setWarrantNumber] = useState('')
  const [warrantExpiry, setWarrantExpiry] = useState('')
  const [uploadingCOA, setUploadingCOA] = useState(false)
  const [uploadingWarrant, setUploadingWarrant] = useState(false)

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
    ])
  }

  // Check user role
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master' || user?.role === 'grand_master'
  const isMaster = user?.role === 'master' || user?.role === 'grand_master'

  // Fetch all active organizations for dropdowns
  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, parent_organization_id')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return data as Organization[]
    },
  })

  // For non-master users, fetch accessible org IDs (own org + descendants)
  const { data: accessibleOrgIds } = useQuery({
    queryKey: ['user-org-ids'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_user_organization_ids')
      if (error) throw error
      return data as string[]
    },
    enabled: !isMaster,
  })

  // Organizations available for assignment, scoped by role
  const availableOrgs = isMaster
    ? (organizations || [])
    : (organizations || []).filter((o) => accessibleOrgIds?.includes(o.id))

  const derivedAuthorizedWorkLocations = Array.from(
    new Set([organizationId, ...extraOrganizationIds].filter((id): id is string => Boolean(id)))
  )

  const normalizedDirectUserToAdd = directUserToAdd.trim()
  const directUserIdValid = normalizedDirectUserToAdd.length > 0 && uuidRegex.test(normalizedDirectUserToAdd)

  const { data: directUserPreview, isFetching: isDirectUserPreviewLoading } = useQuery({
    queryKey: ['direct-user-preview', normalizedDirectUserToAdd],
    queryFn: async () => {
      if (!directUserIdValid || !normalizedDirectUserToAdd) return null

      const { data, error } = await (supabase
        .from('user_profiles') as any)
        .select('id, first_name, last_name, email')
        .eq('id', normalizedDirectUserToAdd)
        .limit(1)

      if (error) throw error

      const row = Array.isArray(data) ? data[0] : null
      return (row || null) as DirectUserPreview | null
    },
    enabled: showEditDialog && isMaster && directUserIdValid,
    staleTime: 30000,
  })

  const directScopeAlreadyGranted = directUserPreview
    ? editablePttScopes.includes(`direct:${directUserPreview.id}`)
    : false

  const canGrantDirectScope = Boolean(
    selectedUser &&
    directUserPreview?.id &&
    directUserPreview.id !== selectedUser.id &&
    !directScopeAlreadyGranted
  )

  // Fetch users
  const { data: users, isLoading, error: usersError } = useQuery({
    queryKey: ['users', searchTerm, filterRole, filterCredentials, filterOrg],
    queryFn: async () => {
      let query = (supabase
        .from('user_profiles') as any)
        .select(`
          *,
          organization:organizations!organization_id(id, name)
        `)
        .order('created_at', { ascending: false })

      if (searchTerm) {
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      }

      if (filterRole !== 'all') {
        query = query.eq('role', filterRole)
      }

      if (filterOrg !== 'all') {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidPattern.test(filterOrg)) {
          query = query.or(`organization_id.eq.${filterOrg},extra_organization_ids.cs.{${filterOrg}}`)
        }
      }

      const { data, error } = await query
      if (error) throw error
      
      let filteredUsers = data as UserProfile[]

      // Filter by credentials status
      if (filterCredentials === 'verified') {
        filteredUsers = filteredUsers.filter(u => u.credentials_verified)
      } else if (filterCredentials === 'expired') {
        const today = new Date().toISOString().split('T')[0]
        filteredUsers = filteredUsers.filter(u => 
          (u.coa_expiry && u.coa_expiry < today) || 
          (u.warrant_expiry && u.warrant_expiry < today)
        )
      } else if (filterCredentials === 'missing') {
        filteredUsers = filteredUsers.filter(u => !u.coa_number && !u.warrant_number)
      }

      return filteredUsers
    },
  })

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async () => {
      if (!emailRegex.test(email.trim())) {
        throw new Error('Enter a valid email address (for example user@example.com)')
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match')
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters')
      }
      const payload = {
        email: email.trim(),
        password,
        role,
        first_name: firstName,
        last_name: lastName,
        phone,
        job_title: jobTitle || null,
        requires_driver_license: requiresDriverLicense,
        organization_id: organizationId || null,
        extra_organization_ids: extraOrganizationIds,
        employer_organization_id: employerOrgId || null,
        portal_access: portalAccess,
        authorized_work_locations: derivedAuthorizedWorkLocations,
        ptt_channel_access: createPttScopes,
      }

      const { data, error } = await withTimeout(
        edgeFunctions.createUser(payload),
        60000,
        'Request timed out after 60 seconds.',
      )
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreateDialog(false)
      resetForm()
      toast.success('User created successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create user')
    },
  })

  // Set user password mutation
  const setPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPwd }: { userId: string; newPwd: string }) => {
      const { data, error } = await withTimeout(
        edgeFunctions.setUserPassword({ user_id: userId, new_password: newPwd }),
        30000,
        'Request timed out after 30 seconds.',
      )
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      setShowSetPasswordDialog(false)
      setSetPasswordUserId(null)
      setSetPasswordUserName('')
      setNewPassword('')
      setConfirmNewPassword('')
      toast.success('Password updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update password')
    },
  })

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update(updates)
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('User updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowEditDialog(false)
      setSelectedUser(null)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user')
    },
  })

  // Toggle user active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const nextIsActive = !isActive

      const invocation = isActive
        ? edgeFunctions.deactivateUser({ user_id: userId })
        : edgeFunctions.setUserActiveStatus({ user_id: userId, is_active: true })

      const { data, error } = await withTimeout(
        invocation,
        30000,
        'Request timed out after 30 seconds.',
      )

      if (error) throw new Error(error)

      return {
        nextIsActive,
        pttRevoke: (data as any)?.pttRevoke,
      }
    },
    onSuccess: (result) => {
      const revocationWarning = result?.nextIsActive === false && result?.pttRevoke?.attempted && result?.pttRevoke?.ok === false
      if (revocationWarning) {
        toast.warning('User deactivated, but PTT revoke did not fully confirm. Check voice server logs.')
      } else {
        toast.success('User status updated')
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user')
    },
  })

  const disconnectPttMutation = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const { data, error } = await withTimeout(
        edgeFunctions.disconnectUserPtt({ user_id: userId }),
        30000,
        'Request timed out after 30 seconds.',
      )

      if (error) throw new Error(error)

      return {
        pttRevoke: (data as any)?.pttRevoke,
      }
    },
    onSuccess: (result) => {
      if (result?.pttRevoke?.attempted && result?.pttRevoke?.ok === false) {
        toast.warning('PTT disconnect requested, but revoke did not fully confirm. Check voice server logs.')
      } else {
        toast.success('PTT disconnect request sent')
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to disconnect PTT session')
    },
  })

  const setPttChannelAccessMutation = useMutation({
    mutationFn: async ({ userId, mode, scopes }: { userId: string; mode: 'replace' | 'grant' | 'revoke'; scopes: string[] }) => {
      const { data, error } = await withTimeout(
        edgeFunctions.setUserPttChannelAccess({
          user_id: userId,
          mode,
          scopes,
        }),
        30000,
        'Request timed out after 30 seconds.',
      )

      if (error) throw new Error(error)
      return (data as any)?.data?.ptt_channel_access ?? (data as any)?.ptt_channel_access ?? null
    },
    onSuccess: (updatedScopesRaw) => {
      const updatedScopes = Array.isArray(updatedScopesRaw) ? updatedScopesRaw : []
      setEditablePttScopes(updatedScopes)
      if (selectedUser) {
        setSelectedUser({
          ...selectedUser,
          ptt_channel_access: updatedScopes,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('PTT channel access updated')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update PTT channel access')
    },
  })

  const resetForm = () => {
    setEmail('')
    setFirstName('')
    setLastName('')
    setRole('officer')
    setPhone('')
    setJobTitle('')
    setRequiresDriverLicense(false)
    setPassword('')
    setConfirmPassword('')
    setCoaNumber('')
    setCoaExpiry('')
    setWarrantNumber('')
    setWarrantExpiry('')
    setOrganizationId('')
    setExtraOrganizationIds([])
    setEmployerOrgId('')
    setPortalAccess([])
    setCreatePttScopes([])
    setCreatePttScopeInput('')
  }
  const togglePortalAccess = (area: PortalAreaCode) => {
    setPortalAccess((prev) =>
      prev.includes(area)
        ? prev.filter((item) => item !== area)
        : [...prev, area]
    )
  }
  const addCreatePttScope = () => {
    const trimmed = createPttScopeInput.trim()
    if (!trimmed) return
    setCreatePttScopes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setCreatePttScopeInput('')
  }
  const removeCreatePttScope = (scope: string) => {
    setCreatePttScopes((prev) => prev.filter((item) => item !== scope))
  }

  const toggleExtraOrganization = (orgId: string) => {
    setExtraOrganizationIds((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId]
    )
  }

  const openEditDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setFirstName(userProfile.first_name)
    setLastName(userProfile.last_name)
    setEmail(userProfile.email)
    setRole(userProfile.role)
    setPhone(userProfile.phone || '')
    setJobTitle(userProfile.job_title || '')
    setRequiresDriverLicense(userProfile.requires_driver_license || false)
    setOrganizationId(userProfile.organization_id || '')
    setExtraOrganizationIds((userProfile.extra_organization_ids || []).filter((id) => id !== (userProfile.organization_id || '')))
    setEmployerOrgId(userProfile.employer_organization_id || '')
    setEditablePttScopes(userProfile.ptt_channel_access || [])
    setCrossOrgToAdd('')
    setDirectUserToAdd('')
    setShowEditDialog(true)
  }

  const grantScope = async (scope: string) => {
    if (!selectedUser || !scope.trim()) return
    await setPttChannelAccessMutation.mutateAsync({
      userId: selectedUser.id,
      mode: 'grant',
      scopes: [scope.trim()],
    })
  }

  const revokeScope = async (scope: string) => {
    if (!selectedUser || !scope.trim()) return
    await setPttChannelAccessMutation.mutateAsync({
      userId: selectedUser.id,
      mode: 'revoke',
      scopes: [scope.trim()],
    })
  }

  const openCredentialsDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setCoaNumber(userProfile.coa_number || '')
    setCoaExpiry(userProfile.coa_expiry || '')
    setWarrantNumber(userProfile.warrant_number || '')
    setWarrantExpiry(userProfile.warrant_expiry || '')
    setShowCredentialsDialog(true)
  }

  const openRoleDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setRole(userProfile.role)
    setShowRoleDialog(true)
  }

  // Upload COA document
  const handleCOAUpload = async (file: File) => {
    if (!selectedUser) return
    
    try {
      setUploadingCOA(true)
      const path = `credentials/${selectedUser.id}/coa_${Date.now()}.pdf`
      const result = await uploadFile({
        bucket: 'evidence',
        path,
        file
      })

      if (result.error) throw new Error(result.error)

      const { error } = await (supabase.from('user_profiles') as any)
        .update({ coa_document_url: result.url })
        .eq('id', selectedUser.id)

      if (error) throw error

      toast.success('COA document uploaded')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload COA')
    } finally {
      setUploadingCOA(false)
    }
  }

  // Upload Warrant document
  const handleWarrantUpload = async (file: File) => {
    if (!selectedUser) return
    
    try {
      setUploadingWarrant(true)
      const path = `credentials/${selectedUser.id}/warrant_${Date.now()}.pdf`
      const result = await uploadFile({
        bucket: 'evidence',
        path,
        file
      })

      if (result.error) throw new Error(result.error)

      const { error } = await (supabase.from('user_profiles') as any)
        .update({ warrant_document_url: result.url })
        .eq('id', selectedUser.id)

      if (error) throw error

      toast.success('Warrant document uploaded')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload warrant')
    } finally {
      setUploadingWarrant(false)
    }
  }

  // Update credentials mutation
  const updateCredentialsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update({
          coa_number: coaNumber || null,
          coa_expiry: coaExpiry || null,
          warrant_number: warrantNumber || null,
          warrant_expiry: warrantExpiry || null,
        })
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Credentials updated')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCredentialsDialog(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update credentials')
    },
  })

  // Verify credentials mutation
  const verifyCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase.from('user_profiles') as any)
        .update({
          credentials_verified: true,
          credentials_verified_at: new Date().toISOString(),
          credentials_verified_by: user?.id,
        })
        .eq('id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Credentials verified')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to verify credentials')
    },
  })

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update({ role })
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Role updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowRoleDialog(false)
      setSelectedUser(null)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update role')
    },
  })

  const bulkAssignCallsignsMutation = useMutation({
    mutationFn: async () => {
      if (!bulkCallsignOrgId) throw new Error('Select an organisation first')
      const { data, error } = await (supabase as any).rpc('admin_bulk_assign_callsigns', {
        p_organization_id: bulkCallsignOrgId,
        p_force: bulkCallsignMode === 'all',
      })
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    onSuccess: (result: any) => {
      const updated = result?.updated_count ?? 0
      toast.success(`Callsigns updated: ${updated}`)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowBulkCallsignDialog(false)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to bulk assign callsigns')
    },
  })

  // Check if credentials are expired
  const isCredentialExpired = (expiryDate: string | null) => {
    if (!expiryDate) return false
    const today = new Date().toISOString().split('T')[0]
    return expiryDate < today
  }

  // Check if credentials expire soon (within 30 days)
  const isCredentialExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false
    const today = new Date()
    const expiry = new Date(expiryDate)
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0
  }

  // Get credentials status badge
  const getCredentialsBadge = (userProfile: UserProfile) => {
    const hasCredentials = userProfile.coa_number || userProfile.warrant_number
    const coaExpired = isCredentialExpired(userProfile.coa_expiry)
    const warrantExpired = isCredentialExpired(userProfile.warrant_expiry)
    const coaExpiring = isCredentialExpiringSoon(userProfile.coa_expiry)
    const warrantExpiring = isCredentialExpiringSoon(userProfile.warrant_expiry)

    if (!hasCredentials) {
      return <Badge variant="outline" className="text-gray-500"><XCircle className="h-3 w-3 mr-1" />No Credentials</Badge>
    }
    if (coaExpired || warrantExpired) {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300"><AlertCircle className="h-3 w-3 mr-1" />Expired</Badge>
    }
    if (coaExpiring || warrantExpiring) {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300"><Clock className="h-3 w-3 mr-1" />Expiring Soon</Badge>
    }
    if (userProfile.credentials_verified) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300"><Award className="h-3 w-3 mr-1" />Verified</Badge>
    }
    return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300"><FileText className="h-3 w-3 mr-1" />Pending Review</Badge>
  }

  // Calculate stats
  const stats = users ? {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    verified: users.filter(u => u.credentials_verified).length,
    expired: users.filter(u => 
      isCredentialExpired(u.coa_expiry) || isCredentialExpired(u.warrant_expiry)
    ).length,
    expiringSoon: users.filter(u => 
      isCredentialExpiringSoon(u.coa_expiry) || isCredentialExpiringSoon(u.warrant_expiry)
    ).length,
  } : null

  if (!isAdmin) {
    return (
      <AppLayout title="User Management" description="Manage user accounts and permissions" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Admin access required.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="User Management" description="Manage user accounts and permissions" showBackButton>
      <GlobalFilterRibbon showDateFilter={false} />

      <Card className="mb-6 border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 dark:border-blue-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Governance Quick Actions
          </CardTitle>
          <CardDescription>
            Jump between user governance, organisation scope, access rules, and audit traceability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: 'Organisations', path: '/organizations', Icon: Building2 },
              { label: 'Access Control', path: '/access-control', Icon: ShieldCheck },
              { label: 'Site Permissions', path: '/site-permissions', Icon: Settings },
              { label: 'Audit Log', path: '/audit-log', Icon: FileText },
              { label: 'Command Centre', path: '/admin', Icon: ShieldCheck },
            ].map(({ label, path, Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(path)}
                className="text-left rounded-lg border bg-white dark:bg-gray-900 px-3 py-3 transition-colors hover:bg-blue-100/60 dark:hover:bg-blue-900/20"
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  <Icon className="h-4 w-4 text-blue-600" />
                  {label}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-600">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <Award className="h-4 w-4" />
                Verified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.verified}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Expired
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{stats.expired}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Expiring Soon
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{stats.expiringSoon}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end gap-2 mb-6">
        <Button variant="outline" onClick={() => {
          setBulkCallsignOrgId(filterOrg !== 'all' ? filterOrg : '')
          setBulkCallsignMode('missing')
          setShowBulkCallsignDialog(true)
        }}>
          <Radio className="h-4 w-4 mr-2" />
          Bulk Assign Callsigns
        </Button>
        <Button onClick={() => setShowCreateDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Select value={filterRole || 'all'} onValueChange={setFilterRole}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="officer">Officers</SelectItem>
                  <SelectItem value="client_officer">Client Officers</SelectItem>
                  <SelectItem value="client_admin">Client Admins</SelectItem>
                  <SelectItem value="nzscv_monitor">NZSCV Monitors</SelectItem>
                  <SelectItem value="admin_officer">Admin Officers</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
                  <SelectItem value="master">Masters</SelectItem>
                  <SelectItem value="grand_master">Grand Masters</SelectItem>
                  <SelectItem value="client_viewer">Client Viewers</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterCredentials || 'all'} onValueChange={setFilterCredentials}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter credentials" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Credentials</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="missing">Missing</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterOrg || 'all'} onValueChange={setFilterOrg}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Filter by organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Organisations</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {isLoading ? 'Loading…' : `${users?.length || 0} total users`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersError ? (
            <div className="text-center py-8 text-red-600">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p className="font-medium">Failed to load users</p>
              <p className="text-sm mt-1">{(usersError as Error).message}</p>
            </div>
          ) : isLoading ? (
            <PaperworkSearchAnimation size="sm" text="Loading users…" />
          ) : users && users.length > 0 ? (
            <div className="space-y-3">
              {users.map((userProfile) => (
                <div
                  key={userProfile.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="font-medium text-foreground">
                        {userProfile.first_name} {userProfile.last_name}
                      </div>
                      <Badge variant={userProfile.is_active ? 'default' : 'secondary'}>
                        {userProfile.is_active ? (
                          <><CheckCircle className="h-3 w-3 mr-1" />Active</>
                        ) : (
                          <><XCircle className="h-3 w-3 mr-1" />Inactive</>
                        )}
                      </Badge>
                      <Badge variant="outline">
                        <Shield className="h-3 w-3 mr-1" />
                        {userProfile.role}
                      </Badge>
                      {getCredentialsBadge(userProfile)}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      <Mail className="h-3 w-3 inline mr-1" />
                      {userProfile.email}
                    </div>
                    {userProfile.callsign && (
                      <div className="text-sm text-gray-600 mt-1">
                        <Radio className="h-3 w-3 inline mr-1" />
                        Callsign: <span className="font-mono font-semibold">{userProfile.callsign}</span>
                      </div>
                    )}
                    {userProfile.organization && (
                      <div className="text-sm text-gray-500 mt-1">
                        <Building2 className="h-3 w-3 inline mr-1" />
                        {userProfile.organization.name}
                      </div>
                    )}
                    {(userProfile.extra_organization_ids?.length > 0) && (
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                        <Globe className="h-3 w-3" />
                        <span>Also authorised in:</span>
                        {(() => {
                          const hiddenIds = userProfile.extra_organization_ids.filter(
                            (id) => !availableOrgs.find((o) => o.id === id)
                          )
                          return (
                            <>
                              {userProfile.extra_organization_ids.map((orgId) => {
                                const extraOrg = availableOrgs.find((o) => o.id === orgId)
                                return extraOrg ? (
                                  <Badge key={orgId} variant="outline" className="text-xs px-1.5 py-0 h-auto">
                                    {extraOrg.name}
                                  </Badge>
                                ) : null
                              })}
                              {hiddenIds.length > 0 && (
                                <span className="text-gray-400">+{hiddenIds.length} more</span>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                    {userProfile.job_title && (
                      <div className="text-sm text-gray-500 mt-1">
                        <Award className="h-3 w-3 inline mr-1" />
                        {userProfile.job_title}
                        {userProfile.requires_driver_license && (
                          <span className="ml-1 text-xs text-amber-600">🚗 Licence required</span>
                        )}
                      </div>
                    )}
                    
                    {/* Credentials Info */}
                    {(userProfile.coa_number || userProfile.warrant_number) && (
                      <div className="mt-2 space-y-1">
                        {userProfile.coa_number && (
                          <div className="text-xs flex items-center gap-2 text-foreground">
                            <FileText className="h-3 w-3 text-blue-600" />
                            <span className="font-medium">COA:</span>
                            <span className="font-mono">{userProfile.coa_number}</span>
                            {userProfile.coa_expiry && (
                              <span className={`flex items-center gap-1 ${
                                isCredentialExpired(userProfile.coa_expiry) ? 'text-red-600' :
                                isCredentialExpiringSoon(userProfile.coa_expiry) ? 'text-yellow-600' :
                                'text-gray-500'
                              }`}>
                                <Calendar className="h-3 w-3" />
                                Expires {formatDate(userProfile.coa_expiry)}
                              </span>
                            )}
                          </div>
                        )}
                        {userProfile.warrant_number && (
                          <div className="text-xs flex items-center gap-2 text-foreground">
                            <Award className="h-3 w-3 text-purple-600" />
                            <span className="font-medium">Warrant:</span>
                            <span className="font-mono">{userProfile.warrant_number}</span>
                            {userProfile.warrant_expiry && (
                              <span className={`flex items-center gap-1 ${
                                isCredentialExpired(userProfile.warrant_expiry) ? 'text-red-600' :
                                isCredentialExpiringSoon(userProfile.warrant_expiry) ? 'text-yellow-600' :
                                'text-gray-500'
                              }`}>
                                <Calendar className="h-3 w-3" />
                                Expires {formatDate(userProfile.warrant_expiry)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-xs text-gray-500 mt-2">
                      Created {formatDateTime(userProfile.created_at)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openRoleDialog(userProfile)}
                      >
                        <Shield className="h-4 w-4 mr-1" />
                        Role
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openEditDialog(userProfile)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCredentialsDialog(userProfile)}
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Credentials
                      </Button>
                      {(userProfile.coa_number || userProfile.warrant_number) && !userProfile.credentials_verified && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => verifyCredentialsMutation.mutate(userProfile.id)}
                          disabled={verifyCredentialsMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Verify
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSetPasswordUserId(userProfile.id)
                          setSetPasswordUserName(`${userProfile.first_name} ${userProfile.last_name}`)
                          setNewPassword('')
                          setConfirmNewPassword('')
                          setShowSetPasswordDialog(true)
                        }}
                      >
                        Set Password
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disconnectPttMutation.mutate({ userId: userProfile.id })}
                      disabled={
                        userProfile.id === user?.id ||
                        !userProfile.is_active ||
                        disconnectPttMutation.isPending
                      }
                      className="text-xs"
                    >
                      Disconnect PTT
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate({
                        userId: userProfile.id,
                        isActive: userProfile.is_active
                      })}
                      disabled={userProfile.id === user?.id}
                      className="text-xs"
                    >
                      {userProfile.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600">
              No users found
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Create a user account with a password. The user can sign in immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
              {hasEmailInput && !isEmailValid && (
                <p className="text-xs text-red-500 mt-1">Enter a valid email address (for example user@example.com)</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="role">Role *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="nzscv_monitor">NZSCV Monitor</SelectItem>
                  <SelectItem value="admin_officer">Admin Officer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="client_officer">Client Officer</SelectItem>
                  <SelectItem value="client_admin">Client Admin</SelectItem>
                  <SelectItem value="client_viewer">Client Viewer</SelectItem>
                  {(user?.role === 'master' || user?.role === 'grand_master') && (
                    <SelectItem value="master">Master</SelectItem>
                  )}
                  {user?.role === 'grand_master' && (
                    <SelectItem value="grand_master">Grand Master</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="jobTitle">Job Title</Label>
              <Select value={jobTitle || 'none'} onValueChange={(v) => {
                const title = v === 'none' ? '' : v
                setJobTitle(title)
                setRequiresDriverLicense(
                  title === 'Field Services Officer' || title === 'Patrol Officer'
                )
              }}>
                <SelectTrigger id="jobTitle">
                  <SelectValue placeholder="Select job title (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  <SelectItem value="Rostering Team Admin">Rostering Team Admin</SelectItem>
                  <SelectItem value="Branch Manager">Branch Manager</SelectItem>
                  <SelectItem value="Operations Manager">Operations Manager</SelectItem>
                  <SelectItem value="Sales Team">Sales Team</SelectItem>
                  <SelectItem value="Dispatch Team">Dispatch Team</SelectItem>
                  <SelectItem value="Welfare Team">Welfare Team</SelectItem>
                  <SelectItem value="Supervisor">Supervisor</SelectItem>
                  <SelectItem value="Field Services Officer">Field Services Officer 🚗</SelectItem>
                  <SelectItem value="Patrol Officer">Patrol Officer 🚗</SelectItem>
                  <SelectItem value="Static Guard - Permanent">Static Guard – Permanent</SelectItem>
                  <SelectItem value="Static Guard - Part-Time">Static Guard – Part-Time</SelectItem>
                  <SelectItem value="Static Guard - Casual">Static Guard – Casual</SelectItem>
                  <SelectItem value="Contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
              {requiresDriverLicense && (
                <p className="text-xs text-amber-600 mt-1">⚠️ This position requires a valid full NZ driver licence.</p>
              )}
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+64 21 123 4567"
              />
            </div>
            <div>
              <Label htmlFor="createOrg">Organisation</Label>
              <Select
                value={organizationId || 'none'}
                onValueChange={(v) => {
                  const nextOrgId = v === 'none' ? '' : v
                  setOrganizationId(nextOrgId)
                  if (nextOrgId) {
                    setExtraOrganizationIds((prev) => prev.filter((id) => id !== nextOrgId))
                  }
                }}
              >
                <SelectTrigger id="createOrg">
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Authorised Additional Organisations</Label>
              <p className="text-xs text-gray-500 mt-1">
                Select any extra organisations this user can work across.
              </p>
              <div className="mt-2 max-h-36 overflow-y-auto rounded-md border divide-y">
                {availableOrgs.filter((org) => org.id !== organizationId).map((org) => (
                  <label key={org.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={extraOrganizationIds.includes(org.id)}
                      onCheckedChange={() => toggleExtraOrganization(org.id)}
                    />
                    <span className="text-sm text-gray-800">{org.name}</span>
                  </label>
                ))}
                {availableOrgs.filter((org) => org.id !== organizationId).length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500">No additional organisations available.</div>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="createEmployerOrg">Employer Organisation</Label>
              <Select value={employerOrgId || 'none'} onValueChange={(v) => setEmployerOrgId(v === 'none' ? '' : v)}>
                <SelectTrigger id="createEmployerOrg">
                  <SelectValue placeholder="Select employer organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Employer Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Portal Area Access (Pre-authorize)</Label>
              <p className="text-xs text-gray-500 mt-1">
                Leave empty to use role defaults. Select areas to pre-authorize specific portal routes.
              </p>
              <div className="mt-2 max-h-44 overflow-y-auto rounded-md border divide-y">
                {(Object.keys(PORTAL_AREA_LABELS) as PortalAreaCode[]).map((area) => (
                  <label key={area} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={portalAccess.includes(area)}
                      onCheckedChange={() => togglePortalAccess(area)}
                    />
                    <span className="text-sm text-gray-800">{PORTAL_AREA_LABELS[area]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Authorized Work Locations</Label>
              <p className="text-xs text-gray-500 mt-1">
                Saved from Organisation + Additional Organisations selections.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 rounded-md border p-2 min-h-[2.5rem]">
                {derivedAuthorizedWorkLocations.length === 0 ? (
                  <span className="text-xs text-gray-500">No locations selected yet.</span>
                ) : (
                  derivedAuthorizedWorkLocations.map((orgId) => {
                    const orgName = availableOrgs.find((org) => org.id === orgId)?.name || orgId
                    return (
                      <Badge key={orgId} variant="outline" className="text-xs">
                        {orgName}
                      </Badge>
                    )
                  })
                )}
              </div>
            </div>
            <div>
              <Label>Explicit PTT Scopes (Optional)</Label>
              <p className="text-xs text-gray-500 mt-1">
                Add explicit cross-org/direct scopes now (for example org:&lt;uuid&gt; or direct:&lt;uuid&gt;).
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  placeholder="org:&lt;uuid&gt; or direct:&lt;uuid&gt;"
                  value={createPttScopeInput}
                  onChange={(e) => setCreatePttScopeInput(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={addCreatePttScope}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {createPttScopes.length === 0 ? (
                  <span className="text-xs text-gray-500">No explicit PTT scopes set.</span>
                ) : (
                  createPttScopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="flex items-center gap-1">
                      {scope}
                      <button
                        type="button"
                        onClick={() => removeCreatePttScope(scope)}
                        className="inline-flex items-center"
                        aria-label={`Remove ${scope}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="createPassword">Password *</Label>
                <Input
                  id="createPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
              </div>
              <div>
                <Label htmlFor="createConfirmPassword">Confirm Password *</Label>
                <Input
                  id="createConfirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>
            </div>
            {password && confirmPassword && password !== confirmPassword && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createUserMutation.mutate()}
              disabled={!normalizedEmail || !isEmailValid || !firstName || !lastName || !password || !confirmPassword || createUserMutation.isPending}
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Callsign Assignment Dialog */}
      <Dialog open={showBulkCallsignDialog} onOpenChange={setShowBulkCallsignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Assign Callsigns</DialogTitle>
            <DialogDescription>
              Assign radio callsigns by organisation initials (for example FSN23, NCC10).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="bulkCallsignOrg">Organisation</Label>
              <Select value={bulkCallsignOrgId || 'none'} onValueChange={(v) => setBulkCallsignOrgId(v === 'none' ? '' : v)}>
                <SelectTrigger id="bulkCallsignOrg">
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="bulkCallsignMode">Mode</Label>
              <Select value={bulkCallsignMode} onValueChange={(v: 'missing' | 'all') => setBulkCallsignMode(v)}>
                <SelectTrigger id="bulkCallsignMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="missing">Only users missing callsign</SelectItem>
                  <SelectItem value="all">Regenerate all callsigns in org</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCallsignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkAssignCallsignsMutation.mutate()}
              disabled={!bulkCallsignOrgId || bulkAssignCallsignsMutation.isPending}
            >
              {bulkAssignCallsignsMutation.isPending ? 'Assigning…' : 'Run Bulk Assignment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Assignment Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
            <DialogDescription>
              Change user role and permissions for {selectedUser?.first_name} {selectedUser?.last_name}
            </DialogDescription>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/access-control')}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                Access Control
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/audit-log')}>
                <FileText className="h-3.5 w-3.5 mr-1" />
                Audit Log
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="assignRole">Select Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Officer</span>
                      <span className="text-xs text-gray-500">Field operations only</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="nzscv_monitor">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">NZSCV Monitor</span>
                      <span className="text-xs text-gray-500">Read-only vehicle registry monitoring</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin_officer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Admin Officer</span>
                      <span className="text-xs text-gray-500">Dual role - field + admin access</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Admin</span>
                      <span className="text-xs text-gray-500">Full organisational management</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="client_officer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Client Officer</span>
                      <span className="text-xs text-gray-500">Client portal operations</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="client_admin">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Client Admin</span>
                      <span className="text-xs text-gray-500">Client portal administration</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="client_viewer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-gray-900 dark:text-gray-100">Client Viewer</span>
                      <span className="text-xs text-gray-500">Read-only client organisation portal</span>
                    </div>
                  </SelectItem>
                  {(user?.role === 'master' || user?.role === 'grand_master') && (
                    <SelectItem value="master">
                      <div className="flex flex-col items-start">
                        <span className="font-medium text-gray-900 dark:text-gray-100">Master</span>
                        <span className="text-xs text-gray-500">Cross-organisation access</span>
                      </div>
                    </SelectItem>
                  )}
                  {user?.role === 'grand_master' && (
                    <SelectItem value="grand_master">
                      <div className="flex flex-col items-start">
                        <span className="font-medium text-gray-900 dark:text-gray-100">Grand Master</span>
                        <span className="text-xs text-gray-500">Platform owner – full access across all organisations</span>
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> Role changes take effect immediately. User may need to log out and log back in to see updated permissions.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRoleDialog(false)
                setSelectedUser(null)
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateRoleMutation.mutate()}
              disabled={updateRoleMutation.isPending || !selectedUser}
            >
              {updateRoleMutation.isPending ? 'Updating...' : 'Update Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compliance Credentials</DialogTitle>
            <DialogDescription>
              Manage COA and Warrant verification for {selectedUser?.first_name} {selectedUser?.last_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* COA Section */}
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Certificate of Approval (COA)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="coaNumber">COA Number</Label>
                  <Input
                    id="coaNumber"
                    value={coaNumber}
                    onChange={(e) => setCoaNumber(e.target.value)}
                    placeholder="e.g., COA-2024-001"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="coaExpiry">Expiry Date</Label>
                  <Input
                    id="coaExpiry"
                    type="date"
                    value={coaExpiry}
                    onChange={(e) => setCoaExpiry(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="coaUpload">Upload COA Document (PDF)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="coaUpload"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleCOAUpload(file)
                    }}
                    disabled={uploadingCOA}
                  />
                  {uploadingCOA && <div className="text-sm text-gray-500">Uploading...</div>}
                </div>
                {selectedUser?.coa_document_url && (
                  <a 
                    href={selectedUser.coa_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    View current document
                  </a>
                )}
              </div>
            </div>

            {/* Warrant Section */}
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Award className="h-5 w-5 text-purple-600" />
                Warrant of Fitness
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="warrantNumber">Warrant Number</Label>
                  <Input
                    id="warrantNumber"
                    value={warrantNumber}
                    onChange={(e) => setWarrantNumber(e.target.value)}
                    placeholder="e.g., W-2024-001"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="warrantExpiry">Expiry Date</Label>
                  <Input
                    id="warrantExpiry"
                    type="date"
                    value={warrantExpiry}
                    onChange={(e) => setWarrantExpiry(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="warrantUpload">Upload Warrant Document (PDF)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="warrantUpload"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleWarrantUpload(file)
                    }}
                    disabled={uploadingWarrant}
                  />
                  {uploadingWarrant && <div className="text-sm text-gray-500">Uploading...</div>}
                </div>
                {selectedUser?.warrant_document_url && (
                  <a 
                    href={selectedUser.warrant_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    View current document
                  </a>
                )}
              </div>
            </div>

            {/* Verification Status */}
            {selectedUser?.credentials_verified && (
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Credentials Verified</span>
                </div>
                {selectedUser.credentials_verified_at && (
                  <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                    Verified on {formatDateTime(selectedUser.credentials_verified_at)}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCredentialsDialog(false)
                setSelectedUser(null)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateCredentialsMutation.mutate()}
              disabled={updateCredentialsMutation.isPending}
            >
              {updateCredentialsMutation.isPending ? 'Saving...' : 'Save Credentials'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editFirstName">First Name</Label>
                <Input
                  id="editFirstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editLastName">Last Name</Label>
                <Input
                  id="editLastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="editRole">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="admin_officer">Admin Officer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="client_officer">Client Officer</SelectItem>
                  <SelectItem value="client_admin">Client Admin</SelectItem>
                  <SelectItem value="client_viewer">Client Viewer</SelectItem>
                  {(user?.role === 'master' || user?.role === 'grand_master') && (
                    <SelectItem value="master">Master</SelectItem>
                  )}
                  {user?.role === 'grand_master' && (
                    <SelectItem value="grand_master">Grand Master</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="editJobTitle">Job Title</Label>
              <Select value={jobTitle || 'none'} onValueChange={(v) => {
                const title = v === 'none' ? '' : v
                setJobTitle(title)
                setRequiresDriverLicense(
                  title === 'Field Services Officer' || title === 'Patrol Officer'
                )
              }}>
                <SelectTrigger id="editJobTitle">
                  <SelectValue placeholder="Select job title (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  <SelectItem value="Rostering Team Admin">Rostering Team Admin</SelectItem>
                  <SelectItem value="Branch Manager">Branch Manager</SelectItem>
                  <SelectItem value="Operations Manager">Operations Manager</SelectItem>
                  <SelectItem value="Sales Team">Sales Team</SelectItem>
                  <SelectItem value="Dispatch Team">Dispatch Team</SelectItem>
                  <SelectItem value="Welfare Team">Welfare Team</SelectItem>
                  <SelectItem value="Supervisor">Supervisor</SelectItem>
                  <SelectItem value="Field Services Officer">Field Services Officer 🚗</SelectItem>
                  <SelectItem value="Patrol Officer">Patrol Officer 🚗</SelectItem>
                  <SelectItem value="Static Guard - Permanent">Static Guard – Permanent</SelectItem>
                  <SelectItem value="Static Guard - Part-Time">Static Guard – Part-Time</SelectItem>
                  <SelectItem value="Static Guard - Casual">Static Guard – Casual</SelectItem>
                  <SelectItem value="Contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
              {requiresDriverLicense && (
                <p className="text-xs text-amber-600 mt-1">⚠️ This position requires a valid full NZ driver licence.</p>
              )}
            </div>
            <div>
              <Label htmlFor="editPhone">Phone</Label>
              <Input
                id="editPhone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="editOrg">Organisation</Label>
              <Select
                value={organizationId || 'none'}
                onValueChange={(v) => {
                  const nextOrgId = v === 'none' ? '' : v
                  setOrganizationId(nextOrgId)
                  if (nextOrgId) {
                    setExtraOrganizationIds((prev) => prev.filter((id) => id !== nextOrgId))
                  }
                }}
              >
                <SelectTrigger id="editOrg">
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Authorised Additional Organisations</Label>
              <p className="text-xs text-gray-500 mt-1">
                Select any extra organisations this user can access.
              </p>
              <div className="mt-2 max-h-36 overflow-y-auto rounded-md border divide-y">
                {availableOrgs.filter((org) => org.id !== organizationId).map((org) => (
                  <label key={org.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={extraOrganizationIds.includes(org.id)}
                      onCheckedChange={() => toggleExtraOrganization(org.id)}
                    />
                    <span className="text-sm text-gray-800">{org.name}</span>
                  </label>
                ))}
                {availableOrgs.filter((org) => org.id !== organizationId).length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500">No additional organisations available.</div>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="editEmployerOrg">Employer Organisation</Label>
              <Select value={employerOrgId || 'none'} onValueChange={(v) => setEmployerOrgId(v === 'none' ? '' : v)}>
                <SelectTrigger id="editEmployerOrg">
                  <SelectValue placeholder="Select employer organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Employer Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedUser && (role === 'officer' || role === 'admin_officer' || role === 'admin') && (
              <PTTChannelAccessControl
                userId={selectedUser.id}
                organizationId={organizationId || selectedUser.organization_id || ''}
                currentChannelAccess={editablePttScopes}
                onSave={async (channelAccess) => {
                  await setPttChannelAccessMutation.mutateAsync({
                    userId: selectedUser.id,
                    mode: 'replace',
                    scopes: channelAccess,
                  })
                }}
                disabled={setPttChannelAccessMutation.isPending}
              />
            )}

            {selectedUser && isMaster && (
              <Card className="border-amber-300 bg-amber-50/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Lock className="h-4 w-4 text-amber-700" />
                    Master Cross-Org PTT Scopes
                  </CardTitle>
                  <CardDescription>
                    Grant explicit cross-organization or direct user radio scopes. Same-organization channels stay available by default.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>Grant Org Channel Scope</Label>
                      <div className="flex gap-2">
                        <Select value={crossOrgToAdd || 'none'} onValueChange={(v) => setCrossOrgToAdd(v === 'none' ? '' : v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select organization" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Select organisation</SelectItem>
                            {availableOrgs
                              .filter((org) => org.id !== (organizationId || selectedUser.organization_id || ''))
                              .map((org) => (
                                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (!crossOrgToAdd) return
                            void grantScope(`org:${crossOrgToAdd}`)
                            setCrossOrgToAdd('')
                          }}
                          disabled={!crossOrgToAdd || setPttChannelAccessMutation.isPending}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Grant Direct Scope (User ID)</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="UUID of target user"
                          value={directUserToAdd}
                          onChange={(e) => setDirectUserToAdd(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (!canGrantDirectScope || !directUserPreview?.id) return
                            void grantScope(`direct:${directUserPreview.id}`)
                            setDirectUserToAdd('')
                          }}
                          disabled={!canGrantDirectScope || setPttChannelAccessMutation.isPending}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      {normalizedDirectUserToAdd.length > 0 && !directUserIdValid && (
                        <p className="text-xs text-red-600">Enter a valid user UUID.</p>
                      )}
                      {directUserIdValid && isDirectUserPreviewLoading && (
                        <p className="text-xs text-gray-500">Looking up user…</p>
                      )}
                      {directUserIdValid && !isDirectUserPreviewLoading && !directUserPreview && (
                        <p className="text-xs text-red-600">No user found for this ID.</p>
                      )}
                      {directUserPreview && selectedUser && directUserPreview.id === selectedUser.id && (
                        <p className="text-xs text-red-600">Cannot grant direct scope to the same user.</p>
                      )}
                      {directUserPreview && directScopeAlreadyGranted && (
                        <p className="text-xs text-amber-600">Direct scope already exists for this user.</p>
                      )}
                      {directUserPreview && selectedUser && directUserPreview.id !== selectedUser.id && !directScopeAlreadyGranted && (
                        <p className="text-xs text-green-700">
                          Target: {(directUserPreview.first_name || '').trim()} {(directUserPreview.last_name || '').trim()} ({directUserPreview.email || directUserPreview.id})
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border bg-white p-3">
                    <div className="text-xs font-medium text-gray-600 mb-2">Explicit scope grants</div>
                    <div className="flex flex-wrap gap-2">
                      {editablePttScopes.length === 0 ? (
                        <span className="text-xs text-gray-500">No explicit scopes. Default same-org behavior applies.</span>
                      ) : (
                        editablePttScopes.map((scope) => (
                          <Badge key={scope} variant="outline" className="flex items-center gap-1">
                            {scope}
                            <button
                              type="button"
                              onClick={() => void revokeScope(scope)}
                              className="inline-flex items-center"
                              disabled={setPttChannelAccessMutation.isPending}
                              aria-label={`Remove ${scope}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateUserMutation.mutate({
                first_name: firstName,
                last_name: lastName,
                role,
                phone: phone || null,
                job_title: jobTitle || null,
                requires_driver_license: requiresDriverLicense,
                organization_id: organizationId || null,
                extra_organization_ids: extraOrganizationIds,
                employer_organization_id: employerOrgId || null,
              })}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Password Dialog */}
      <Dialog open={showSetPasswordDialog} onOpenChange={(open) => {
        if (!open) { setShowSetPasswordDialog(false); setSetPasswordUserId(null); setNewPassword(''); setConfirmNewPassword('') }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
            <DialogDescription>
              Set a new password for {setPasswordUserName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="newPwd">New Password *</Label>
              <Input
                id="newPwd"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <Label htmlFor="confirmNewPwd">Confirm Password *</Label>
              <Input
                id="confirmNewPwd"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Re-enter password"
              />
            </div>
            {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowSetPasswordDialog(false); setNewPassword(''); setConfirmNewPassword('') }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newPassword !== confirmNewPassword) { toast.error('Passwords do not match'); return }
                if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
                setPasswordMutation.mutate({ userId: setPasswordUserId!, newPwd: newPassword })
              }}
              disabled={!newPassword || !confirmNewPassword || setPasswordMutation.isPending}
            >
              {setPasswordMutation.isPending ? 'Saving...' : 'Save Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

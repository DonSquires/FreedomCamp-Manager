import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

type ProviderGrant = {
  id: string
  provider_org_id: string
  client_org_id: string
  service_type: string
  allow_without_roster: boolean
  is_active: boolean
}

type OrganizationName = {
  id: string
  name: string
}

export default function ServiceProviderAccessSettings() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isAuthorized = !!user && ['admin', 'master'].includes(user.role)

  const { data, isLoading } = useQuery({
    queryKey: ['service-provider-access-grants', user?.organization_id],
    enabled: !!user?.organization_id && isAuthorized,
    queryFn: async () => {
      const { data: grants, error: grantsError } = await (supabase as any)
        .from('provider_client_access_grants')
        .select('id, provider_org_id, client_org_id, service_type, allow_without_roster, is_active')
        .eq('client_org_id', user!.organization_id!)
        .eq('is_active', true)
        .order('service_type', { ascending: true })

      if (grantsError) throw grantsError

      const providerOrgIds = Array.from(new Set((grants ?? []).map((g: ProviderGrant) => g.provider_org_id)))
      let organizationsById: Record<string, string> = {}

      if (providerOrgIds.length > 0) {
        const { data: orgs, error: orgsError } = await (supabase as any)
          .from('organizations')
          .select('id, name')
          .in('id', providerOrgIds)

        if (orgsError) throw orgsError

        organizationsById = (orgs ?? []).reduce((acc: Record<string, string>, org: OrganizationName) => {
          acc[org.id] = org.name
          return acc
        }, {})
      }

      return (grants ?? []).map((grant: ProviderGrant) => ({
        ...grant,
        provider_org_name: organizationsById[grant.provider_org_id] ?? 'Unknown provider',
      }))
    },
  })

  const updateGrant = useMutation({
    mutationFn: async ({ id, allowWithoutRoster }: { id: string; allowWithoutRoster: boolean }) => {
      const { error } = await (supabase as any)
        .from('provider_client_access_grants')
        .update({ allow_without_roster: allowWithoutRoster, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-provider-access-grants'] })
      toast.success('Provider access updated')
    },
    onError: () => {
      toast.error('Failed to update provider access')
    },
  })

  const rows = useMemo(() => data ?? [], [data])

  if (!isAuthorized) {
    return (
      <AppLayout title="Service Provider Access" description="Client-controlled cross-organisation access" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Only admin and master roles can manage provider access.</CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Service Provider Access"
      description="Control which provider officers can work your services without being rostered"
      showBackButton
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Provider Grants
          </CardTitle>
          <CardDescription>
            Toggle <strong>Allow without roster</strong> for each provider + service pairing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading provider grants…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No provider grants found for your organisation.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Allow without roster</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row: ProviderGrant & { provider_org_name: string }) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.provider_org_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase tracking-wide">
                        {row.service_type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.is_active ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Revoked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={!!row.allow_without_roster}
                        onCheckedChange={(checked) => {
                          updateGrant.mutate({ id: row.id, allowWithoutRoster: checked })
                        }}
                        disabled={updateGrant.isPending}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}

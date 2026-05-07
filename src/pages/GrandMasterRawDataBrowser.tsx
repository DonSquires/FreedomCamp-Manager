import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { Database, RefreshCw, Save, Trash2 } from 'lucide-react'

type RawRecord = Record<string, any>

const TABLE_SUGGESTIONS = [
  'zones',
  'client_sites',
  'observations',
  'breach_alerts',
  'dispatch_jobs',
  'user_profiles',
  'organizations',
  'canonical_vehicles',
  'import_batches',
  'notifications',
]

const DEFAULT_PAGE_SIZE = 100
const TABLE_NAME_REGEX = /^[a-z][a-z0-9_]*$/

function inferKeyColumn(row?: RawRecord | null): string {
  if (!row) return 'id'
  const candidates = ['id', 'observation_id', 'vehicle_id', 'organization_id', 'user_id']
  return candidates.find((c) => Object.prototype.hasOwnProperty.call(row, c)) ?? 'id'
}

export default function GrandMasterRawDataBrowser() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [tableName, setTableName] = useState('zones')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowKeyColumn, setRowKeyColumn] = useState('id')
  const [selectedRow, setSelectedRow] = useState<RawRecord | null>(null)
  const [draftJson, setDraftJson] = useState('')

  const normalizedTable = tableName.trim().toLowerCase()
  const isValidTableName = TABLE_NAME_REGEX.test(normalizedTable)

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['grand-master-raw-browser', normalizedTable, page],
    queryFn: async () => {
      if (!isValidTableName) return { rows: [] as RawRecord[], total: 0 }
      const from = page * DEFAULT_PAGE_SIZE
      const to = from + DEFAULT_PAGE_SIZE - 1
      const { data, error, count } = await (supabase.from(normalizedTable as any) as any)
        .select('*', { count: 'exact' })
        .range(from, to)
      if (error) throw error
      return { rows: (data ?? []) as RawRecord[], total: count ?? 0 }
    },
    enabled: user?.role === 'grand_master',
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q))
  }, [rows, search])

  const columns = useMemo(() => {
    const keySet = new Set<string>()
    rows.slice(0, 25).forEach((row) => Object.keys(row).forEach((k) => keySet.add(k)))
    return Array.from(keySet)
  }, [rows])

  useEffect(() => {
    if (!selectedRow) {
      setRowKeyColumn(inferKeyColumn(rows[0]))
      return
    }
    setRowKeyColumn(inferKeyColumn(selectedRow))
  }, [rows, selectedRow])

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow) throw new Error('No row selected')
      if (!rowKeyColumn) throw new Error('Row key column is required')
      const keyValue = selectedRow[rowKeyColumn]
      if (keyValue === undefined || keyValue === null) {
        throw new Error(`Selected row has no "${rowKeyColumn}" value`)
      }
      let payload: RawRecord
      try {
        payload = JSON.parse(draftJson)
      } catch {
        throw new Error('Invalid JSON payload')
      }
      const { error } = await (supabase.from(normalizedTable as any) as any)
        .update(payload)
        .eq(rowKeyColumn, keyValue)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Record updated')
      queryClient.invalidateQueries({ queryKey: ['grand-master-raw-browser', normalizedTable] })
      setSelectedRow(null)
      setDraftJson('')
    },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (row: RawRecord) => {
      if (!rowKeyColumn) throw new Error('Row key column is required')
      const keyValue = row[rowKeyColumn]
      if (keyValue === undefined || keyValue === null) throw new Error(`Row has no "${rowKeyColumn}" value`)
      const { error } = await (supabase.from(normalizedTable as any) as any)
        .delete()
        .eq(rowKeyColumn, keyValue)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Record deleted')
      queryClient.invalidateQueries({ queryKey: ['grand-master-raw-browser', normalizedTable] })
      setSelectedRow(null)
      setDraftJson('')
    },
    onError: (err: any) => toast.error(err?.message ?? 'Delete failed'),
  })

  if (user?.role !== 'grand_master') {
    return (
      <AppLayout>
        <Card>
          <CardHeader>
            <CardTitle>Raw Data Browser</CardTitle>
            <CardDescription>Grand Master access only.</CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Raw Data Browser</h1>
          <p className="text-muted-foreground mt-1">
            Microsoft Access-style direct record browser for Grand Master review and maintenance.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Table Selection
            </CardTitle>
            <CardDescription>Enter any public table name, then search and edit raw records.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="table-name">Table name</Label>
                <Input
                  id="table-name"
                  value={tableName}
                  onChange={(e) => {
                    setTableName(e.target.value)
                    setPage(0)
                  }}
                  placeholder="e.g. zones"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="search-rows">Search records</Label>
                <Input
                  id="search-rows"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search current page JSON…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="row-key">Row key column</Label>
                <Input
                  id="row-key"
                  value={rowKeyColumn}
                  onChange={(e) => setRowKeyColumn(e.target.value)}
                  placeholder="id"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {TABLE_SUGGESTIONS.map((table) => (
                <Button
                  key={table}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTableName(table)
                    setPage(0)
                  }}
                >
                  {table}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {!isValidTableName && <Badge variant="destructive">Invalid table name</Badge>}
              {error && <Badge variant="destructive">{(error as Error).message}</Badge>}
              <Badge variant="secondary">Rows loaded: {rows.length}</Badge>
              <Badge variant="secondary">Total: {total}</Badge>
              <Badge variant="secondary">Page: {page + 1}/{pageCount}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Records</CardTitle>
            <CardDescription>{isLoading ? 'Loading…' : `${filteredRows.length} row(s) in current page`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row, idx) => (
                    <TableRow key={`${idx}-${row[rowKeyColumn] ?? 'row'}`}>
                      {columns.map((column) => {
                        const value = row[column]
                        const text = value === null || value === undefined
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value)
                        return (
                          <TableCell key={column} className="max-w-[260px] truncate" title={text}>
                            {text}
                          </TableCell>
                        )
                      })}
                      <TableCell className="space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedRow(row)
                            setDraftJson(JSON.stringify(row, null, 2))
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            const keyValue = row[rowKeyColumn]
                            if (!globalThis.confirm(`Delete row where ${rowKeyColumn} = ${String(keyValue)}?`)) return
                            deleteMutation.mutate(row)
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) >= pageCount}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedRow && (
          <Card>
            <CardHeader>
              <CardTitle>Edit Selected Record</CardTitle>
              <CardDescription>Update raw JSON and save directly back to the selected table.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={draftJson}
                onChange={(e) => setDraftJson(e.target.value)}
                className="min-h-[260px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedRow(null)
                    setDraftJson('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

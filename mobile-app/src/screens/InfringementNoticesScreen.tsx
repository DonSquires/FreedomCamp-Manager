/**
 * InfringementNoticesScreen — Mobile officer screen for viewing and issuing
 * FCA infringement notices (fines).
 *
 * Mirrors the web InfringementNotices.tsx workflow:
 *   issued → paid | reminder_sent → court_referred | withdrawn | cancelled
 *
 * Officers can:
 *   - View all notices for their org (pulled from infringement_notices table)
 *   - Issue a new notice by calling the generate-infringement edge function
 *   - Mark notices as paid, void, etc.
 */

import React, { useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  Modal, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView,
  Platform, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { toast } from 'sonner-native'
import { useRoute } from '@react-navigation/native'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InfringementNotice {
  id: string
  notice_number: string
  plate_number: string
  offence_description: string
  amount_cents: number
  due_date: string | null
  status: string
  service_method: string
  created_at: string
  zone: { name: string } | null
}

interface Zone {
  id: string
  name: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',         color: '#6b7280', bg: '#f3f4f6' },
  issued:         { label: 'Issued',        color: '#1d4ed8', bg: '#eff6ff' },
  paid:           { label: 'Paid',          color: '#15803d', bg: '#f0fdf4' },
  reminder_sent:  { label: 'Reminder Sent', color: '#b45309', bg: '#fffbeb' },
  court_referred: { label: 'Court',         color: '#dc2626', bg: '#fef2f2' },
  withdrawn:      { label: 'Withdrawn',     color: '#6b7280', bg: '#f3f4f6' },
  cancelled:      { label: 'Cancelled',     color: '#6b7280', bg: '#f3f4f6' },
}

const FINE_OPTIONS = [
  { label: '$200 — Standard FCA fine',    value: 20000 },
  { label: '$400 — Repeat offender',      value: 40000 },
  { label: '$100 — Warning notice',       value: 10000 },
  { label: '$600 — Commercial vehicle',   value: 60000 },
]

const SERVICE_OPTIONS: Array<{ label: string; value: 'hand' | 'post' | 'email' }> = [
  { label: 'Hand delivered (on-site)', value: 'hand' },
  { label: 'Posted',                   value: 'post' },
  { label: 'Email',                    value: 'email' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function InfringementNoticesScreen() {
  const { user } = useAuthStore()
  const route = useRoute<any>()
  const queryClient = useQueryClient()
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [showPrintPrompt, setShowPrintPrompt] = useState(false)
  const [showFineSheet, setShowFineSheet] = useState(false)
  const [showServiceSheet, setShowServiceSheet] = useState(false)
  const [showZoneSheet, setShowZoneSheet] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')
  const [printableHtml, setPrintableHtml] = useState<string | null>(null)
  const [printableNoticeNumber, setPrintableNoticeNumber] = useState<string>('')
  const [openingPrint, setOpeningPrint] = useState(false)
  const [reprintingNoticeId, setReprintingNoticeId] = useState<string | null>(null)

  // Issue form state
  const [form, setForm] = useState({
    plate_number: '',
    zone_id: '',
    zone_name: '',
    offence_description: '',
    legal_basis: 'Freedom Camping Act 2011 s20(1)(a)',
    offence_location: '',
    amount_cents: 20000,
    service_method: 'hand' as 'hand' | 'post' | 'email',
    recipient_name: '',
    breach_alert_id: null as string | null,
    observation_id: null as string | null,
  })
  const [issuing, setIssuing] = useState(false)

  React.useEffect(() => {
    const prefill = route.params?.prefill
    if (!prefill) return

    setForm((f) => ({
      ...f,
      plate_number: prefill.plate_number || f.plate_number,
      zone_id: prefill.zone_id || f.zone_id,
      zone_name: prefill.offence_location || f.zone_name,
      offence_description: prefill.offence_description || f.offence_description,
      offence_location: prefill.offence_location || f.offence_location,
      breach_alert_id: prefill.breach_alert_id || null,
      observation_id: prefill.observation_id || null,
    }))
    setShowIssueModal(true)
  }, [route.params?.prefill])

  // ── Fetch notices ────────────────────────────────────────────────────────
  const { data: notices = [], isLoading, refetch } = useQuery({
    queryKey: ['notices-mobile', user?.organization_id, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('infringement_notices')
        .select('id, notice_number, plate_number, offence_description, amount_cents, due_date, status, service_method, created_at, zone:zones!zone_id(name)')
        .eq('organization_id', user!.organization_id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (statusFilter === 'active') {
        q = q.in('status', ['issued', 'reminder_sent'])
      }

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as InfringementNotice[]
    },
    enabled: !!user?.organization_id,
    refetchInterval: 30000,
  })

  // ── Fetch zones ──────────────────────────────────────────────────────────
  const { data: zones = [] } = useQuery({
    queryKey: ['zones-mobile', user?.organization_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', user!.organization_id)
        .eq('is_active', true)
        .order('name')
      return (data || []) as Zone[]
    },
    enabled: !!user?.organization_id,
  })

  // ── Status update mutation ────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('infringement_notices')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Notice updated')
      queryClient.invalidateQueries({ queryKey: ['notices-mobile'] })
    },
    onError: (err: any) => toast.error(err.message || 'Update failed'),
  })

  // ── Issue new notice ─────────────────────────────────────────────────────
  const openPrintableNotice = async () => {
    if (!printableHtml) {
      toast.error('No printable notice available')
      return
    }

    setOpeningPrint(true)
    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`
      await Linking.openURL(dataUrl)
      toast.success('Opened printable notice in browser')
      setShowPrintPrompt(false)
    } catch {
      toast.error('Could not open printable notice on this device')
    } finally {
      setOpeningPrint(false)
    }
  }

  const handleIssue = async () => {
    if (!form.plate_number.trim() || !form.zone_id || !form.offence_description.trim()) {
      toast.error('Plate, zone and offence description are required')
      return
    }
    setIssuing(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-infringement', {
        body: {
          plate_number: form.plate_number.toUpperCase().trim(),
          zone_id: form.zone_id,
          offence_description: form.offence_description,
          legal_basis: form.legal_basis,
          offence_location: form.offence_location || form.zone_name,
          amount_cents: form.amount_cents,
          service_method: form.service_method,
          recipient_name: form.recipient_name || undefined,
          offence_date: new Date().toISOString(),
          breach_alert_id: form.breach_alert_id || undefined,
          observation_id: form.observation_id || undefined,
        },
      })
      if (error) throw new Error(error.message)
      if (!data?.success) throw new Error(data?.error || 'Failed')

      toast.success(`✅ Notice ${data.notice_number} issued`)
      if (data?.html) {
        setPrintableHtml(data.html)
        setPrintableNoticeNumber(data.notice_number || '')
        setShowPrintPrompt(true)
      }
      setShowIssueModal(false)
      setForm({
        plate_number: '', zone_id: '', zone_name: '', offence_description: '',
        legal_basis: 'Freedom Camping Act 2011 s20(1)(a)', offence_location: '',
        amount_cents: 20000, service_method: 'hand', recipient_name: '',
        breach_alert_id: null, observation_id: null,
      })
      queryClient.invalidateQueries({ queryKey: ['notices-mobile'] })
    } catch (err: any) {
      toast.error(err.message || 'Failed to issue notice')
    } finally {
      setIssuing(false)
    }
  }

  const handleReprint = async (noticeId: string) => {
    setReprintingNoticeId(noticeId)
    try {
      const { data, error } = await supabase.functions.invoke('render-infringement-notice', {
        body: { notice_id: noticeId },
      })
      if (error) throw new Error(error.message)
      if (!data?.success || !data?.html) throw new Error(data?.error || 'Printable notice unavailable')

      setPrintableHtml(data.html)
      setPrintableNoticeNumber(data.notice_number || '')
      setShowPrintPrompt(true)
    } catch (err: any) {
      toast.error(err.message || 'Failed to load printable notice')
    } finally {
      setReprintingNoticeId(null)
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const issuedToday = notices.filter(n => n.created_at?.startsWith(today)).length
  const outstanding = notices.filter(n => ['issued', 'reminder_sent'].includes(n.status)).length

  // ── Render ───────────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: InfringementNotice }) => {
    const meta = STATUS_META[item.status] || STATUS_META.issued
    const overdue = ['issued', 'reminder_sent'].includes(item.status) &&
      item.due_date && new Date(item.due_date) < new Date()
    const amount = `$${((item.amount_cents || 0) / 100).toFixed(2)}`

    return (
      <View style={[styles.card, overdue && styles.cardOverdue]}>
        <View style={styles.cardTop}>
          <Text style={styles.plate}>{item.plate_number}</Text>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>
              {meta.label}{overdue ? ' • OVERDUE' : ''}
            </Text>
          </View>
        </View>

        <Text style={styles.offence} numberOfLines={2}>{item.offence_description}</Text>

        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>{item.zone?.name || '—'}</Text>
          <Text style={[styles.amount, overdue && { color: '#dc2626' }]}>{amount}</Text>
          {item.due_date && (
            <Text style={styles.metaText}>
              Due: {new Date(item.due_date).toLocaleDateString('en-NZ')}
            </Text>
          )}
        </View>

        <Text style={styles.noticeNum}>{item.notice_number}</Text>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.reprintBtn}
            onPress={() => handleReprint(item.id)}
            disabled={reprintingNoticeId === item.id}
          >
            <Ionicons name="print-outline" size={14} color="#1d4ed8" />
            <Text style={styles.reprintText}>
              {reprintingNoticeId === item.id ? 'Loading...' : 'Reprint'}
            </Text>
          </TouchableOpacity>
        </View>

        {item.status === 'issued' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#86efac' }]}
              onPress={() => updateStatus.mutate({ id: item.id, status: 'paid' })}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color="#15803d" />
              <Text style={[styles.actionText, { color: '#15803d' }]}>Paid</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#fde68a' }]}
              onPress={() => updateStatus.mutate({ id: item.id, status: 'reminder_sent' })}
            >
              <Ionicons name="mail-outline" size={14} color="#b45309" />
              <Text style={[styles.actionText, { color: '#b45309' }]}>Reminder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#fecaca' }]}
              onPress={() => updateStatus.mutate({ id: item.id, status: 'court_referred' })}
            >
              <Ionicons name="scale-outline" size={14} color="#dc2626" />
              <Text style={[styles.actionText, { color: '#dc2626' }]}>Court</Text>
            </TouchableOpacity>
          </View>
        )}
        {item.status === 'reminder_sent' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#86efac' }]}
              onPress={() => updateStatus.mutate({ id: item.id, status: 'paid' })}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color="#15803d" />
              <Text style={[styles.actionText, { color: '#15803d' }]}>Paid</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#fecaca' }]}
              onPress={() => updateStatus.mutate({ id: item.id, status: 'court_referred' })}
            >
              <Ionicons name="scale-outline" size={14} color="#dc2626" />
              <Text style={[styles.actionText, { color: '#dc2626' }]}>Court</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Infringement Notices</Text>
          <Text style={styles.subtitle}>FCA fines — ADR/TicketOr2 workflow</Text>
        </View>
        <TouchableOpacity style={styles.issueBtn} onPress={() => setShowIssueModal(true)}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.issueBtnText}>Issue</Text>
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{issuedToday}</Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={[styles.statCard, { borderColor: outstanding > 0 ? '#fca5a5' : '#e2e8f0' }]}>
          <Text style={[styles.statNum, { color: outstanding > 0 ? '#dc2626' : '#1e293b' }]}>
            {outstanding}
          </Text>
          <Text style={styles.statLabel}>Outstanding</Text>
        </View>
      </View>

      {/* Filter toggle */}
      <View style={styles.filterRow}>
        {(['active', 'all'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, statusFilter === f && styles.filterBtnActive]}
            onPress={() => setStatusFilter(f)}
          >
            <Text style={[styles.filterText, statusFilter === f && styles.filterTextActive]}>
              {f === 'active' ? 'Outstanding' : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={notices}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#1d4ed8" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No notices found</Text>
          </View>
        }
      />

      {/* ── Issue Notice Modal ─────────────────────────────────────────── */}
      <Modal
        visible={showIssueModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowIssueModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Issue Infringement Notice</Text>
              <TouchableOpacity onPress={() => setShowIssueModal(false)}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Plate */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Plate Number *</Text>
                <TextInput
                  style={[styles.input, styles.plateInput]}
                  value={form.plate_number}
                  onChangeText={v => setForm(f => ({ ...f, plate_number: v.toUpperCase() }))}
                  placeholder="ABC123"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="characters"
                  maxLength={8}
                />
              </View>

              {/* Zone */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Zone *</Text>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  onPress={() => setShowZoneSheet(true)}
                >
                  <Text style={form.zone_id ? styles.pickerValueText : styles.pickerPlaceholder}>
                    {form.zone_name || 'Select zone...'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>

              {/* Offence description */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Offence Description *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={form.offence_description}
                  onChangeText={v => setForm(f => ({ ...f, offence_description: v }))}
                  placeholder="e.g. Camping for 4 consecutive nights exceeding the 3-night limit"
                  placeholderTextColor="#9ca3af"
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Legal basis */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Legal Basis</Text>
                <TextInput
                  style={styles.input}
                  value={form.legal_basis}
                  onChangeText={v => setForm(f => ({ ...f, legal_basis: v }))}
                  placeholder="FCA 2011 s20(1)(a)..."
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Location */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Location (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={form.offence_location}
                  onChangeText={v => setForm(f => ({ ...f, offence_location: v }))}
                  placeholder="e.g. North Beach Reserve"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Fine amount */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Fine Amount</Text>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  onPress={() => setShowFineSheet(true)}
                >
                  <Text style={styles.pickerValueText}>
                    ${(form.amount_cents / 100).toFixed(2)}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>

              {/* Service method */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Service Method</Text>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  onPress={() => setShowServiceSheet(true)}
                >
                  <Text style={styles.pickerValueText} style={{ textTransform: 'capitalize' }}>
                    {SERVICE_OPTIONS.find(o => o.value === form.service_method)?.label}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>

              {/* Recipient name */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Recipient Name (if known)</Text>
                <TextInput
                  style={styles.input}
                  value={form.recipient_name}
                  onChangeText={v => setForm(f => ({ ...f, recipient_name: v }))}
                  placeholder="Optional"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Issue button */}
              <TouchableOpacity
                style={[styles.issueSubmitBtn, issuing && styles.issueSubmitBtnDisabled]}
                onPress={handleIssue}
                disabled={issuing}
              >
                {issuing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="document-text" size={18} color="#fff" />
                    <Text style={styles.issueSubmitText}>Issue Notice</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>

        {/* ── Fine bottom sheet ─────────────────────────────────────── */}
        <Modal
          visible={showFineSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowFineSheet(false)}
        >
          <TouchableOpacity style={styles.sheetOverlay} onPress={() => setShowFineSheet(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select Fine Amount</Text>
            {FINE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.sheetItem, form.amount_cents === opt.value && styles.sheetItemActive]}
                onPress={() => { setForm(f => ({ ...f, amount_cents: opt.value })); setShowFineSheet(false) }}
              >
                <Text style={[styles.sheetItemText, form.amount_cents === opt.value && { color: '#1d4ed8', fontWeight: '700' }]}>
                  {opt.label}
                </Text>
                {form.amount_cents === opt.value && <Ionicons name="checkmark" size={18} color="#1d4ed8" />}
              </TouchableOpacity>
            ))}
          </View>
        </Modal>

        {/* ── Service method bottom sheet ──────────────────────────── */}
        <Modal
          visible={showServiceSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowServiceSheet(false)}
        >
          <TouchableOpacity style={styles.sheetOverlay} onPress={() => setShowServiceSheet(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Service Method</Text>
            {SERVICE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.sheetItem, form.service_method === opt.value && styles.sheetItemActive]}
                onPress={() => { setForm(f => ({ ...f, service_method: opt.value })); setShowServiceSheet(false) }}
              >
                <Text style={[styles.sheetItemText, form.service_method === opt.value && { color: '#1d4ed8', fontWeight: '700' }]}>
                  {opt.label}
                </Text>
                {form.service_method === opt.value && <Ionicons name="checkmark" size={18} color="#1d4ed8" />}
              </TouchableOpacity>
            ))}
          </View>
        </Modal>

        {/* ── Zone bottom sheet ────────────────────────────────────── */}
        <Modal
          visible={showZoneSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowZoneSheet(false)}
        >
          <TouchableOpacity style={styles.sheetOverlay} onPress={() => setShowZoneSheet(false)} />
          <View style={[styles.sheet, { maxHeight: '60%' }]}>
            <Text style={styles.sheetTitle}>Select Zone</Text>
            <ScrollView>
              {zones.map(z => (
                <TouchableOpacity
                  key={z.id}
                  style={[styles.sheetItem, form.zone_id === z.id && styles.sheetItemActive]}
                  onPress={() => {
                    setForm(f => ({ ...f, zone_id: z.id, zone_name: z.name }))
                    setShowZoneSheet(false)
                  }}
                >
                  <Text style={[styles.sheetItemText, form.zone_id === z.id && { color: '#1d4ed8', fontWeight: '700' }]}>
                    {z.name}
                  </Text>
                  {form.zone_id === z.id && <Ionicons name="checkmark" size={18} color="#1d4ed8" />}
                </TouchableOpacity>
              ))}
              {zones.length === 0 && (
                <Text style={styles.sheetItemText}>No zones found</Text>
              )}
            </ScrollView>
          </View>
        </Modal>
      </Modal>

      {/* ── Print Prompt Modal ─────────────────────────────────────── */}
      <Modal
        visible={showPrintPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPrintPrompt(false)}
      >
        <View style={styles.promptBackdrop}>
          <View style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <Ionicons name="print-outline" size={20} color="#1d4ed8" />
              <Text style={styles.promptTitle}>Ticket Ready to Print</Text>
            </View>
            <Text style={styles.promptText}>
              Notice {printableNoticeNumber || 'issued'} is ready. Open the printable page and use your browser print/share action.
            </Text>

            <View style={styles.promptActions}>
              <TouchableOpacity
                style={styles.promptSecondaryBtn}
                onPress={() => setShowPrintPrompt(false)}
              >
                <Text style={styles.promptSecondaryText}>Later</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.promptPrimaryBtn, openingPrint && styles.promptPrimaryBtnDisabled]}
                onPress={openPrintableNotice}
                disabled={openingPrint}
              >
                {openingPrint ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="open-outline" size={16} color="#fff" />
                    <Text style={styles.promptPrimaryText}>Open Printable Ticket</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: 20, paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  issueBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1d4ed8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  issueBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12,
    alignItems: 'center', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  statNum: { fontSize: 28, fontWeight: '800', color: '#1e293b' },
  statLabel: { fontSize: 11, color: '#64748b' },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  filterBtnActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  filterText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 6,
  },
  cardOverdue: { borderColor: '#fca5a5', backgroundColor: '#fff5f5' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plate: { fontFamily: 'Courier New', fontSize: 20, fontWeight: '800', color: '#0f172a' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  offence: { fontSize: 13, color: '#374151', lineHeight: 18 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaText: { fontSize: 11, color: '#94a3b8' },
  amount: { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },
  noticeNum: { fontSize: 10, color: '#cbd5e1', fontFamily: 'Courier New' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: '#fff',
  },
  actionText: { fontSize: 12, fontWeight: '600' },
  reprintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: '#eff6ff', borderColor: '#bfdbfe',
  },
  reprintText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#94a3b8' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  modalBody: { flex: 1, padding: 20 },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#fff',
  },
  plateInput: { fontFamily: 'Courier New', fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  pickerBtn: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    padding: 12, backgroundColor: '#fff',
  },
  pickerValueText: { fontSize: 15, color: '#111827' },
  pickerPlaceholder: { fontSize: 15, color: '#9ca3af' },
  issueSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1d4ed8', borderRadius: 12, padding: 15, marginTop: 8,
  },
  issueSubmitBtnDisabled: { backgroundColor: '#93c5fd' },
  issueSubmitText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Bottom sheets
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingBottom: 32, maxHeight: '50%',
  },
  sheetTitle: {
    fontSize: 16, fontWeight: '700', color: '#0f172a',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  sheetItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  sheetItemActive: { backgroundColor: '#eff6ff' },
  sheetItemText: { fontSize: 14, color: '#374151' },

  // Print prompt
  promptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  promptCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  promptHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  promptText: { fontSize: 13, color: '#475569', lineHeight: 20 },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  promptSecondaryBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  promptSecondaryText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  promptPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1d4ed8',
  },
  promptPrimaryBtnDisabled: { backgroundColor: '#93c5fd' },
  promptPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
})

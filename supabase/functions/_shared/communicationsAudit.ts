const safeAuditError = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);

interface CommunicationAuditParams {
  organizationId?: string | null;
  channel: 'email' | 'push_notification';
  provider: string;
  status: 'sent' | 'delivered' | 'failed' | 'queued';
  subject?: string | null;
  bodyText?: string | null;
  toEmails?: string[];
  sentBy?: string | null;
  externalMessageId?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
  mergeData?: Record<string, unknown>;
}

export async function recordCommunicationAudit(
  supabase: any,
  params: CommunicationAuditParams,
) {
  if (!params.organizationId) {
    console.warn('communications audit skipped: missing organization context', {
      provider: params.provider,
      status: params.status,
    });
    return;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('crm_communications')
    .insert({
      organization_id: params.organizationId,
      channel: params.channel,
      direction: 'outbound',
      to_emails: params.toEmails?.length ? params.toEmails : null,
      subject: params.subject ?? null,
      body_text: params.bodyText ?? null,
      status: params.status,
      sent_at: ['sent', 'delivered'].includes(params.status) ? now : null,
      delivered_at: params.status === 'delivered' ? now : null,
      external_message_id: params.externalMessageId ?? null,
      external_provider: params.provider,
      error_message: params.errorMessage ? safeAuditError(params.errorMessage) : null,
      retry_count: params.retryCount ?? 0,
      sent_by: params.sentBy ?? null,
      merge_data: params.mergeData ?? null,
    });

  if (error) {
    console.warn('communications audit insert failed', {
      provider: params.provider,
      status: params.status,
      error: safeAuditError(error.message || error),
    });
  }
}

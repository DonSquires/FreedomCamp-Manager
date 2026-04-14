import { useState, useCallback } from 'react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { edgeFunctions } from '@/lib/edgeFunctions'
import {
  BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, Clock, Code2,
  FileCode2, Loader2, RefreshCw, Send, ShieldCheck, Sparkles, Trash2,
  XCircle, Activity, BookOpen, HelpCircle, AlertTriangle, SkipForward,
  Terminal, Layers, Wrench,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeTask {
  id: string
  short_id: string
  task: string
  context: string | null
  target_files: string[]
  priority: 'high' | 'normal'
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'expired'
  requested_by: string | null
  bob_plan: string | null
  pr_url: string | null
  pr_number: number | null
  files_changed: number | null
  build_passed: boolean | null
  error_message: string | null
  created_at: string
  updated_at: string
}

interface KnowledgeRequest {
  id: string
  question: string
  category: string | null
  status: 'pending' | 'answered' | 'skipped'
  priority: string
  answer: string | null
  created_at: string
  updated_at: string
}

interface BobHealth {
  status: string
  config: Record<string, unknown>
  capabilities: Record<string, unknown>
  code_tasks: { counts?: Record<string, number> }
  knowledge_requests: { counts?: Record<string, number> }
  uptime: number
}

interface CodePattern {
  name: string
  description: string
  template: string
  usage: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case 'pending':     return <Badge variant="outline" className="text-yellow-600 border-yellow-400">Pending</Badge>
    case 'in_progress': return <Badge variant="outline" className="text-blue-600 border-blue-400">In Progress</Badge>
    case 'completed':   return <Badge variant="outline" className="text-green-600 border-green-400">Completed</Badge>
    case 'failed':      return <Badge variant="outline" className="text-red-600 border-red-400">Failed</Badge>
    case 'skipped':     return <Badge variant="outline" className="text-gray-500 border-gray-400">Skipped</Badge>
    case 'expired':     return <Badge variant="outline" className="text-orange-500 border-orange-400">Expired</Badge>
    default:            return <Badge variant="outline">{status}</Badge>
  }
}

function priorityBadge(priority: string) {
  return priority === 'high'
    ? <Badge className="bg-red-100 text-red-700 border-red-300">High</Badge>
    : <Badge variant="secondary">Normal</Badge>
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function uptimeHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TaskRow({ task, onSkip, onDelete, onRefresh }: {
  task: CodeTask
  onSkip: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border bg-card">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <code className="text-xs text-muted-foreground font-mono">{task.short_id}</code>
            {statusBadge(task.status)}
            {priorityBadge(task.priority)}
            {task.build_passed === true && (
              <Badge className="bg-green-100 text-green-700 border-green-300 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Build passed
              </Badge>
            )}
            {task.build_passed === false && (
              <Badge className="bg-red-100 text-red-700 border-red-300 gap-1">
                <XCircle className="h-3 w-3" /> Build failed
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium leading-snug line-clamp-2">{task.task}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{relativeTime(task.created_at)}</p>
        </div>
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-blue-600 underline"
            onClick={(e) => e.stopPropagation()}
          >
            PR #{task.pr_number}
          </a>
        )}
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 text-sm">
          {task.target_files.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target files</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {task.target_files.map((f) => (
                  <code key={f} className="text-xs bg-muted px-1.5 py-0.5 rounded">{f}</code>
                ))}
              </div>
            </div>
          )}
          {task.bob_plan && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bob's plan</span>
              <pre className="mt-1 whitespace-pre-wrap text-xs bg-muted rounded p-2 max-h-48 overflow-y-auto">{task.bob_plan}</pre>
            </div>
          )}
          {task.error_message && (
            <div>
              <span className="text-xs font-medium text-red-600 uppercase tracking-wide">Error</span>
              <pre className="mt-1 whitespace-pre-wrap text-xs bg-red-50 border border-red-200 rounded p-2">{task.error_message}</pre>
            </div>
          )}
          {task.requested_by && (
            <p className="text-xs text-muted-foreground">Requested by: {task.requested_by}</p>
          )}
          <div className="flex gap-2 pt-1">
            {task.status === 'pending' && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onSkip(task.id)}>
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => onDelete(task.id)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GrandmasterCodingStudio() {
  // ── Submit Task ──────────────────────────────────────────────────────────
  const [taskText, setTaskText] = useState('')
  const [taskContext, setTaskContext] = useState('')
  const [taskFiles, setTaskFiles] = useState('')
  const [taskPriority, setTaskPriority] = useState<'normal' | 'high'>('normal')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)

  // ── Task Queue ───────────────────────────────────────────────────────────
  const [queueStatus, setQueueStatus] = useState<string>('all')
  const [queueLoading, setQueueLoading] = useState(false)
  const [tasks, setTasks] = useState<CodeTask[]>([])
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({})

  // ── Code Patterns ────────────────────────────────────────────────────────
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [patterns, setPatterns] = useState<Record<string, CodePattern> | null>(null)
  const [conventions, setConventions] = useState<Record<string, unknown> | null>(null)
  const [techStack, setTechStack] = useState<Record<string, unknown> | null>(null)
  const [activePattern, setActivePattern] = useState<string | null>(null)

  // ── Code Assist ──────────────────────────────────────────────────────────
  const [assistQuestion, setAssistQuestion] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)
  const [assistAnswer, setAssistAnswer] = useState<string | null>(null)

  // ── Ask Bob ──────────────────────────────────────────────────────────────
  const [askQuestion, setAskQuestion] = useState('')
  const [askCategory, setAskCategory] = useState('general')
  const [askLoading, setAskLoading] = useState(false)
  const [knowledgeRequests, setKnowledgeRequests] = useState<KnowledgeRequest[]>([])
  const [knowledgeCounts, setKnowledgeCounts] = useState<Record<string, number>>({})
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)

  // ── Secrets Health ───────────────────────────────────────────────────────
  const [healthLoading, setHealthLoading] = useState(false)
  const [health, setHealth] = useState<BobHealth | null>(null)

  // ── Actions ──────────────────────────────────────────────────────────────

  const submitTask = useCallback(async () => {
    if (!taskText.trim()) { toast.error('Task description is required'); return }
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'code_task_submit',
        task: taskText.trim(),
        context: taskContext.trim() || undefined,
        target_files: taskFiles.split('\n').map((l) => l.trim()).filter(Boolean),
        priority: taskPriority,
      })
      if (error) throw new Error(String(error))
      setSubmitResult(JSON.stringify(data, null, 2))
      toast.success(`Code task queued [${(data as any)?.task?.short_id ?? ''}]`)
      setTaskText('')
      setTaskContext('')
      setTaskFiles('')
      setTaskPriority('normal')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit task')
    } finally {
      setSubmitting(false)
    }
  }, [taskText, taskContext, taskFiles, taskPriority])

  const loadTasks = useCallback(async () => {
    setQueueLoading(true)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'code_tasks_list',
        status: queueStatus === 'all' ? undefined : queueStatus,
      })
      if (error) throw new Error(String(error))
      const d = data as any
      setTasks(d?.tasks ?? [])
      setTaskCounts(d?.counts ?? {})
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load tasks')
    } finally {
      setQueueLoading(false)
    }
  }, [queueStatus])

  const skipTask = useCallback(async (id: string) => {
    try {
      const { error } = await edgeFunctions.grandmasterStudio({ action: 'code_task_skip', task_id: id })
      if (error) throw new Error(String(error))
      toast.success('Task skipped')
      loadTasks()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to skip task')
    }
  }, [loadTasks])

  const deleteTask = useCallback(async (id: string) => {
    try {
      const { error } = await edgeFunctions.grandmasterStudio({ action: 'code_task_delete', task_id: id })
      if (error) throw new Error(String(error))
      toast.success('Task deleted')
      loadTasks()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete task')
    }
  }, [loadTasks])

  const loadPatterns = useCallback(async () => {
    setPatternsLoading(true)
    try {
      const [pRes, cRes, tRes] = await Promise.all([
        edgeFunctions.grandmasterStudio({ action: 'code_patterns' }),
        edgeFunctions.grandmasterStudio({ action: 'code_conventions' }),
        edgeFunctions.grandmasterStudio({ action: 'code_tech_stack' }),
      ])
      if (pRes.error) throw new Error(String(pRes.error))
      setPatterns((pRes.data as any)?.patterns ?? null)
      setConventions((cRes.data as any)?.conventions ?? null)
      setTechStack((tRes.data as any)?.tech_stack ?? null)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load patterns')
    } finally {
      setPatternsLoading(false)
    }
  }, [])

  const runAssist = useCallback(async () => {
    if (!assistQuestion.trim()) { toast.error('Question is required'); return }
    setAssistLoading(true)
    setAssistAnswer(null)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'code_assist',
        question: assistQuestion.trim(),
      })
      if (error) throw new Error(String(error))
      const d = data as any
      setAssistAnswer(d?.answer ?? d?.message ?? JSON.stringify(d, null, 2))
    } catch (err: any) {
      toast.error(err?.message || 'Failed to get code assist answer')
    } finally {
      setAssistLoading(false)
    }
  }, [assistQuestion])

  const submitAsk = useCallback(async () => {
    if (!askQuestion.trim()) { toast.error('Question is required'); return }
    setAskLoading(true)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'ask_copilot_submit',
        question: askQuestion.trim(),
        category: askCategory !== 'general' ? askCategory : undefined,
      })
      if (error) throw new Error(String(error))
      toast.success('Question queued — Copilot will research and answer hourly')
      setAskQuestion('')
      loadKnowledge()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit question')
    } finally {
      setAskLoading(false)
    }
  }, [askQuestion, askCategory])

  const loadKnowledge = useCallback(async () => {
    setKnowledgeLoading(true)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'ask_copilot_list' })
      if (error) throw new Error(String(error))
      const d = data as any
      setKnowledgeRequests(d?.requests ?? [])
      setKnowledgeCounts(d?.counts ?? {})
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load knowledge requests')
    } finally {
      setKnowledgeLoading(false)
    }
  }, [])

  const loadHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'health_check' })
      if (error) throw new Error(String(error))
      setHealth(data as BobHealth)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load health status')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Grandmaster Coding Studio"
      description="Submit code tasks to Bob, monitor the queue, browse patterns, and check service health — all in one place."
    >
      <GlobalFilterRibbon />

      <Tabs defaultValue="submit" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="submit" className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Submit Task
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-1.5" onClick={() => { if (!tasks.length) loadTasks() }}>
            <Clock className="h-3.5 w-3.5" /> Task Queue
          </TabsTrigger>
          <TabsTrigger value="patterns" className="gap-1.5" onClick={() => { if (!patterns) loadPatterns() }}>
            <Layers className="h-3.5 w-3.5" /> Patterns &amp; Conventions
          </TabsTrigger>
          <TabsTrigger value="assist" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Code Assist
          </TabsTrigger>
          <TabsTrigger value="ask" className="gap-1.5" onClick={() => { if (!knowledgeRequests.length) loadKnowledge() }}>
            <HelpCircle className="h-3.5 w-3.5" /> Ask Bob
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5" onClick={() => { if (!health) loadHealth() }}>
            <Activity className="h-3.5 w-3.5" /> Service Health
          </TabsTrigger>
        </TabsList>

        {/* ── Submit Task ─────────────────────────────────────────────────── */}
        <TabsContent value="submit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-4 w-4" /> Submit Code Task to Bob
              </CardTitle>
              <CardDescription>
                Describe what to build or fix. Bob will draft a plan, then the ops-bob-code-task workflow
                generates code, runs bun build + lint, and opens a pull request — all automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="task-text">Task description *</Label>
                <Textarea
                  id="task-text"
                  placeholder="e.g. Add a CSV export button to the VehicleManagement page that exports all filtered results"
                  value={taskText}
                  onChange={(e) => setTaskText(e.target.value)}
                  rows={4}
                  maxLength={4000}
                />
                <p className="text-xs text-muted-foreground text-right">{taskText.length}/4000</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-context">Additional context (optional)</Label>
                <Textarea
                  id="task-context"
                  placeholder="Any extra context Bob should know — related bugs, design constraints, existing code references"
                  value={taskContext}
                  onChange={(e) => setTaskContext(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-files">Target files (optional, one per line)</Label>
                <Textarea
                  id="task-files"
                  placeholder={"src/pages/VehicleManagement.tsx\nsrc/hooks/useVehicles.ts"}
                  value={taskFiles}
                  onChange={(e) => setTaskFiles(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={taskPriority} onValueChange={(v) => setTaskPriority(v as 'normal' | 'high')}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-5">
                  <Button onClick={submitTask} disabled={submitting || !taskText.trim()} className="gap-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {submitting ? 'Queuing…' : 'Queue task'}
                  </Button>
                </div>
              </div>

              {submitResult && (
                <div className="space-y-1.5">
                  <Label className="text-green-700">Task queued</Label>
                  <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-48">{submitResult}</pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Terminal className="h-4 w-4 text-muted-foreground" /> How it works
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>1. You submit a task description here — Bob drafts an implementation plan using Ollama.</p>
              <p>2. The <code className="bg-muted px-1 rounded">ops-bob-code-task</code> GitHub Actions workflow runs hourly, picks up pending tasks, and calls GitHub Models API (gpt-4o) to generate the code.</p>
              <p>3. Files are written to a new branch <code className="bg-muted px-1 rounded">bob/task-&lt;id&gt;</code>, bun build + lint run, and a pull request is opened labelled <code className="bg-muted px-1 rounded">bob-generated</code>.</p>
              <p>4. You review and merge the PR. The task status updates to <strong>completed</strong> with the PR link.</p>
              <p className="text-xs">This gives you the same code generation pipeline as GitHub Copilot, running entirely inside your own infrastructure — no dependency on GitHub as the sole code management channel.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Task Queue ──────────────────────────────────────────────────── */}
        <TabsContent value="queue" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Select value={queueStatus} onValueChange={(v) => setQueueStatus(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tasks</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={loadTasks} disabled={queueLoading} className="gap-1.5">
                {queueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
            {Object.keys(taskCounts).length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {Object.entries(taskCounts).map(([s, n]) => (
                  <span key={s}>{s}: <strong>{n}</strong></span>
                ))}
              </div>
            )}
          </div>

          {queueLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <FileCode2 className="h-8 w-8" />
                <p className="text-sm">No tasks found. Submit one on the Submit Task tab.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} onSkip={skipTask} onDelete={deleteTask} onRefresh={loadTasks} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Patterns & Conventions ──────────────────────────────────────── */}
        <TabsContent value="patterns" className="space-y-4">
          {patternsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !patterns ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <BookOpen className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Load the codebase patterns and conventions from Bob.</p>
                <Button onClick={loadPatterns} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Load patterns
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-2">Patterns</p>
                {Object.keys(patterns).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActivePattern(key)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activePattern === key
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {patterns[key].name ?? key}
                  </button>
                ))}
                <Separator className="my-3" />
                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={loadPatterns} disabled={patternsLoading}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reload
                </Button>
              </div>

              <div className="space-y-4">
                {activePattern && patterns[activePattern] ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileCode2 className="h-4 w-4" />
                        {patterns[activePattern].name ?? activePattern}
                      </CardTitle>
                      {patterns[activePattern].description && (
                        <CardDescription>{patterns[activePattern].description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {patterns[activePattern].usage && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Usage</p>
                          <p className="text-sm">{patterns[activePattern].usage}</p>
                        </div>
                      )}
                      {patterns[activePattern].template && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Template</p>
                          <ScrollArea className="max-h-[500px]">
                            <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap">{patterns[activePattern].template}</pre>
                          </ScrollArea>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {conventions && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <Wrench className="h-4 w-4" /> Naming Conventions
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <dl className="space-y-2 text-sm">
                            {Object.entries(conventions).map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[160px_1fr] gap-2">
                                <dt className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</dt>
                                <dd className="font-mono text-xs">{String(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </CardContent>
                      </Card>
                    )}
                    {techStack && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <Layers className="h-4 w-4" /> Tech Stack
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-72">{JSON.stringify(techStack, null, 2)}</pre>
                        </CardContent>
                      </Card>
                    )}
                    {!conventions && !techStack && (
                      <p className="text-sm text-muted-foreground py-4">Select a pattern from the left sidebar to view its template.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Code Assist ─────────────────────────────────────────────────── */}
        <TabsContent value="assist" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Code Assist
              </CardTitle>
              <CardDescription>
                Ask Bob a natural language coding question and get a structured answer with the relevant pattern
                template for this codebase.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="assist-q">Question</Label>
                <Textarea
                  id="assist-q"
                  placeholder="e.g. How do I create a new page with a data table and row selection?"
                  value={assistQuestion}
                  onChange={(e) => setAssistQuestion(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <Button onClick={runAssist} disabled={assistLoading || !assistQuestion.trim()} className="gap-2">
                {assistLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                {assistLoading ? 'Thinking…' : 'Ask Bob'}
              </Button>
              {assistAnswer && (
                <div className="space-y-1.5">
                  <Label className="text-primary">Answer</Label>
                  <ScrollArea className="max-h-[400px]">
                    <pre className="whitespace-pre-wrap text-sm bg-muted rounded p-3">{assistAnswer}</pre>
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ask Bob ─────────────────────────────────────────────────────── */}
        <TabsContent value="ask" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" /> Queue a Research Question
              </CardTitle>
              <CardDescription>
                Questions Bob can't answer immediately are queued for the ops-bob-ask-copilot workflow, which
                researches answers via GitHub Models API hourly and injects the knowledge into Bob's intel feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ask-q">Question</Label>
                <Textarea
                  id="ask-q"
                  placeholder="e.g. What is the correct way to configure a custom domain in Supabase for this project?"
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={askCategory} onValueChange={setAskCategory}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['general', 'supabase', 'railway', 'github', 'vercel', 'expo', 'domain', 'email', 'ptt', 'coding'].map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-5">
                  <Button onClick={submitAsk} disabled={askLoading || !askQuestion.trim()} className="gap-2">
                    {askLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Queue question
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Knowledge queue</h3>
            <div className="flex items-center gap-2">
              {Object.keys(knowledgeCounts).length > 0 && (
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {Object.entries(knowledgeCounts).map(([s, n]) => (
                    <span key={s}>{s}: <strong>{n}</strong></span>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={loadKnowledge} disabled={knowledgeLoading} className="gap-1.5">
                {knowledgeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
          </div>

          {knowledgeRequests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <HelpCircle className="h-7 w-7" />
                <p className="text-sm">No knowledge requests yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {knowledgeRequests.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        {r.status === 'answered'
                          ? <Badge className="bg-green-100 text-green-700 border-green-300 gap-1"><CheckCircle2 className="h-3 w-3" /> Answered</Badge>
                          : r.status === 'skipped'
                          ? <Badge variant="outline" className="text-gray-500">Skipped</Badge>
                          : <Badge variant="outline" className="text-yellow-600 border-yellow-400">Pending</Badge>
                        }
                        {r.category && <Badge variant="secondary" className="capitalize">{r.category}</Badge>}
                        <span className="text-xs text-muted-foreground">{relativeTime(r.created_at)}</span>
                      </div>
                      <p className="text-sm font-medium">{r.question}</p>
                      {r.answer && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground font-semibold mb-0.5">Answer</p>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{r.answer}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Service Health ──────────────────────────────────────────────── */}
        <TabsContent value="health" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Bob Service Health &amp; Secrets Status</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows which services and credentials are configured. <strong>No secret values are ever displayed.</strong>
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadHealth} disabled={healthLoading} className="gap-1.5">
              {healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>

          {healthLoading && !health && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {health && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bob status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4" /> Bob (inference-service)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge className={health.status === 'healthy' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'}>
                      {health.status === 'healthy' ? '● Online' : '● Offline'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Uptime {uptimeHuman(health.uptime ?? 0)}</span>
                  </div>
                  {health.code_tasks?.counts && (
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Code task queue</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(health.code_tasks.counts).map(([s, n]) => (
                          <span key={s} className="text-xs">{s}: <strong>{n}</strong></span>
                        ))}
                      </div>
                    </div>
                  )}
                  {health.knowledge_requests?.counts && (
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Knowledge requests</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(health.knowledge_requests.counts).map(([s, n]) => (
                          <span key={s} className="text-xs">{s}: <strong>{n}</strong></span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Credentials / secrets config */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="h-4 w-4" /> Secrets Configuration
                  </CardTitle>
                  <CardDescription className="text-xs">
                    ✓ = configured, ✗ = missing — values are never exposed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2">
                    {health.config && Object.entries(health.config).map(([key, value]) => {
                      const isSet = value === true || (typeof value === 'string' && value.length > 0 && value !== 'false')
                      const isBool = typeof value === 'boolean'
                      if (!isBool) return null
                      return (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <dt className="text-xs font-mono text-muted-foreground truncate">{key}</dt>
                          <dd className="shrink-0">
                            {isSet
                              ? <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">✓ set</Badge>
                              : <Badge variant="outline" className="text-red-600 border-red-300 text-xs">✗ missing</Badge>
                            }
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </CardContent>
              </Card>

              {/* Capabilities */}
              {health.capabilities && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <BrainCircuit className="h-4 w-4" /> Bob Capabilities
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(health.capabilities).map(([key, value]) => {
                        if (typeof value !== 'boolean') return null
                        return (
                          <div key={key} className="flex items-center gap-1.5 text-xs">
                            {value
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              : <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                            }
                            <span className={value ? '' : 'text-muted-foreground'}>{key.replace(/_/g, ' ')}</span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!health && !healthLoading && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <Activity className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click Refresh to load Bob's health status.</p>
                <Button onClick={loadHealth} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Load health
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}

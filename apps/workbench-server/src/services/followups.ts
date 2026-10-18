import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { WorkbenchDb } from '../db/index.js'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface FollowupScope { serverId: string; workspaceId: string; sourceConversationId: string }
export type FollowupStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'expired' | 'needs_attention'
export interface FollowupInput {
  name: string
  prompt: string
  completionCondition: string
  intervalMinutes: number
  deadlineAt: string | null
  notificationPolicy: 'every' | 'change' | 'terminal'
  backgroundConversationId?: string | null
  creationTurnId?: string | null
  accountId?: string | null
  recipientOpenId?: string | null
  notificationTarget?: JsonValue
}
export interface FollowupResult {
  status: 'pending' | 'completed' | 'failed' | 'needs_attention'
  summary: string
  facts?: JsonValue
}
export interface FollowupRun {
  error?: string | null
  id: string
  taskId: string
  phase: 'executing' | 'notifying' | 'finished' | 'interrupted' | 'deferred'
  startedAt: string
  finishedAt: string | null
  result: FollowupResult | null
  outboxId: string | null
}
export interface FollowupTask extends FollowupScope, FollowupInput {
  id: string
  revision: number
  status: FollowupStatus
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
  lastRun: FollowupRun | null
  lastResult: FollowupResult | null
  failureCount: number
  deferralCount: number
}
export class FollowupDeferredError extends Error {}
export class FollowupConflictError extends Error {}
export class FollowupNotFoundError extends Error {}
interface StoredTask extends FollowupTask {
  comparisonFacts?: string
  notificationRetry?: boolean
  notificationRetryStatus?: FollowupStatus
}
interface Row { data: string; lease_token: string | null; lease_until: number | null }
export interface FollowupRepositoryOptions {
  now?: () => number
  validateIdentity?: (scope: FollowupScope, input: FollowupInput) => void
}

/** Sorted object keys, ordered arrays; reject lossy/non-JSON facts rather than hiding changes. */
export function canonicalFollowupFacts(value: JsonValue): string {
  const seen = new Set<object>()
  function visit(item: JsonValue): JsonValue {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (typeof item !== 'object' || seen.has(item)) throw new Error('Facts must be finite, acyclic JSON')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Facts must be plain JSON')
    seen.add(item)
    const result = Array.isArray(item) ? Array.from(item, visit) : Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key]!)]))
    seen.delete(item)
    return result
  }
  return JSON.stringify(visit(value))
}

/** Stores scheduling/result metadata only. Native conversation history remains owned by Core. */
export class FollowupRepository {
  readonly db: DatabaseSync
  readonly now: () => number
  private readonly validateIdentity?: FollowupRepositoryOptions['validateIdentity']
  constructor(db: WorkbenchDb | DatabaseSync, options: FollowupRepositoryOptions = {}) {
    this.db = db instanceof DatabaseSync ? db : db.db
    this.now = options.now ?? Date.now
    this.validateIdentity = options.validateIdentity
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS followup_tasks (
        id TEXT PRIMARY KEY, server_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        source_conversation_id TEXT NOT NULL, status TEXT NOT NULL, next_run_at TEXT,
        lease_token TEXT, lease_until INTEGER, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS followup_due ON followup_tasks(server_id, status, next_run_at);
      CREATE INDEX IF NOT EXISTS followup_scope ON followup_tasks(server_id, workspace_id, source_conversation_id);
      CREATE TABLE IF NOT EXISTS followup_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES followup_tasks(id), data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS followup_run_task ON followup_runs(task_id);
    `)
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private scope(scope: FollowupScope): void {
    for (const value of [scope.serverId, scope.workspaceId, scope.sourceConversationId]) if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid followup scope')
  }
  private validate(scope: FollowupScope, input: FollowupInput): FollowupInput {
    this.scope(scope)
    if (!this.db.prepare('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?').get(scope.sourceConversationId, scope.workspaceId)) throw new FollowupNotFoundError('Source conversation not found in workspace')
    for (const key of ['name', 'prompt', 'completionCondition'] as const) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > (key === 'name' ? 200 : 20_000)) throw new Error(`Invalid ${key}`)
    }
    if (!Number.isSafeInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 525_600) throw new Error('Invalid intervalMinutes')
    if (!['every', 'change', 'terminal'].includes(input.notificationPolicy)) throw new Error('Invalid notificationPolicy')
    if (input.deadlineAt !== null && (typeof input.deadlineAt !== 'string' || !Number.isFinite(Date.parse(input.deadlineAt)) || Date.parse(input.deadlineAt) <= this.now())) throw new Error('deadlineAt must be in the future')
    for (const key of ['backgroundConversationId', 'creationTurnId', 'accountId', 'recipientOpenId'] as const) if (input[key] != null && (typeof input[key] !== 'string' || !input[key]!.trim())) throw new Error(`Invalid ${key}`)
    if (input.backgroundConversationId && !this.db.prepare('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?').get(input.backgroundConversationId, scope.workspaceId)) throw new FollowupNotFoundError('Background conversation not found in workspace')
    if (input.notificationTarget !== undefined) canonicalFollowupFacts(input.notificationTarget)
    this.validateIdentity?.(scope, input)
    // Explicit allowlist prevents request bodies from overriding server-owned scope/state.
    return {
      name: input.name.trim(), prompt: input.prompt.trim(), completionCondition: input.completionCondition.trim(),
      intervalMinutes: input.intervalMinutes, deadlineAt: input.deadlineAt === null ? null : new Date(input.deadlineAt).toISOString(),
      notificationPolicy: input.notificationPolicy, backgroundConversationId: input.backgroundConversationId ?? null,
      creationTurnId: input.creationTurnId ?? null, accountId: input.accountId ?? null, recipientOpenId: input.recipientOpenId ?? null,
      ...(input.notificationTarget === undefined ? {} : { notificationTarget: input.notificationTarget }),
    }
  }
  private row(scope: FollowupScope, id: string): Row {
    this.scope(scope)
    const row = this.db.prepare('SELECT data, lease_token, lease_until FROM followup_tasks WHERE id = ? AND server_id = ? AND workspace_id = ? AND source_conversation_id = ?').get(id, scope.serverId, scope.workspaceId, scope.sourceConversationId) as unknown as Row | undefined
    if (!row) throw new FollowupNotFoundError('Followup not found')
    return row
  }
  private save(task: StoredTask): void {
    this.db.prepare('UPDATE followup_tasks SET status = ?, next_run_at = ?, data = ? WHERE id = ?').run(task.status, task.nextRunAt, JSON.stringify(task), task.id)
    if (task.lastRun) this.db.prepare('INSERT INTO followup_runs(id, task_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(task.lastRun.id, task.id, JSON.stringify(task.lastRun))
  }
  private view(task: StoredTask): FollowupTask {
    const { comparisonFacts: _, notificationRetry: _retry, notificationRetryStatus: _status, ...view } = task
    return view
  }
  get(scope: FollowupScope, id: string): FollowupTask { return this.view(JSON.parse(this.row(scope, id).data)) }
  list(scope: FollowupScope): FollowupTask[] {
    this.scope(scope)
    return (this.db.prepare('SELECT data FROM followup_tasks WHERE server_id = ? AND workspace_id = ? AND source_conversation_id = ? ORDER BY id').all(scope.serverId, scope.workspaceId, scope.sourceConversationId) as unknown as Row[]).map(row => this.view(JSON.parse(row.data)))
  }
  listRuns(scope: FollowupScope, id: string): FollowupRun[] {
    this.row(scope, id)
    return (this.db.prepare('SELECT data FROM followup_runs WHERE task_id = ? ORDER BY rowid').all(id) as { data: string }[]).map(row => JSON.parse(row.data))
  }
  create(scope: FollowupScope, input: FollowupInput): FollowupTask {
    const normalized = this.validate(scope, input)
    const now = new Date(this.now()).toISOString()
    const task: FollowupTask = { ...normalized, serverId: scope.serverId, workspaceId: scope.workspaceId, sourceConversationId: scope.sourceConversationId, id: randomUUID(), revision: 1, status: 'active', nextRunAt: new Date(this.now() + normalized.intervalMinutes * 60_000).toISOString(), createdAt: now, updatedAt: now, lastRun: null, lastResult: null, failureCount: 0, deferralCount: 0 }
    this.db.prepare('INSERT INTO followup_tasks(id, server_id, workspace_id, source_conversation_id, status, next_run_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(task.id, scope.serverId, scope.workspaceId, scope.sourceConversationId, task.status, task.nextRunAt, JSON.stringify(task))
    return task
  }
  private mutate(scope: FollowupScope, id: string, revision: number, fn: (task: StoredTask, row: Row) => void): FollowupTask {
    return this.transaction(() => {
      const row = this.row(scope, id)
      const task: StoredTask = JSON.parse(row.data)
      if (!Number.isSafeInteger(revision) || task.revision !== revision) throw new FollowupConflictError('Followup revision conflict')
      fn(task, row)
      task.revision++
      task.updatedAt = new Date(this.now()).toISOString()
      this.save(task)
      return this.view(task)
    })
  }
  update(scope: FollowupScope, id: string, revision: number, patch: Partial<FollowupInput>): FollowupTask {
    return this.mutate(scope, id, revision, (task, row) => {
      if (row.lease_token || !['active', 'paused', 'needs_attention'].includes(task.status)) throw new FollowupConflictError('Followup cannot be edited in current state')
      Object.assign(task, this.validate(scope, { ...task, ...patch }))
      if (task.status === 'active') task.nextRunAt = new Date(this.now() + task.intervalMinutes * 60_000).toISOString()
    })
  }
  pause(scope: FollowupScope, id: string, revision: number): FollowupTask {
    return this.mutate(scope, id, revision, task => {
      if (task.status !== 'active') throw new FollowupConflictError('Only active followups can pause')
      task.status = 'paused'; task.nextRunAt = null
    })
  }
  resume(scope: FollowupScope, id: string, revision: number): FollowupTask {
    return this.mutate(scope, id, revision, (task, row) => {
      if (!['paused', 'needs_attention'].includes(task.status) || row.lease_token || task.notificationRetryStatus) throw new FollowupConflictError('Followup cannot resume; interrupted notifications require retryNotification')
      if (task.deadlineAt && Date.parse(task.deadlineAt) <= this.now()) throw new FollowupConflictError('Followup deadline passed')
      task.status = 'active'; task.nextRunAt = new Date(this.now() + task.intervalMinutes * 60_000).toISOString(); task.failureCount = 0; task.deferralCount = 0
    })
  }
  cancel(scope: FollowupScope, id: string, revision: number): FollowupTask {
    return this.mutate(scope, id, revision, task => {
      if (['completed', 'cancelled', 'expired'].includes(task.status)) throw new FollowupConflictError('Followup already terminal')
      task.status = 'cancelled'; task.nextRunAt = null
    })
  }
  runNow(scope: FollowupScope, id: string, revision: number): FollowupTask {
    return this.mutate(scope, id, revision, (task, row) => {
      if (task.status !== 'active' || row.lease_token) throw new FollowupConflictError('Followup cannot run now')
      if (task.deadlineAt && Date.parse(task.deadlineAt) <= this.now()) throw new FollowupConflictError('Followup deadline passed')
      task.nextRunAt = new Date(this.now()).toISOString()
    })
  }
  /** Explicit operator retry only. The notifier MUST dedupe Outbox admission by run.id. */
  retryNotification(scope: FollowupScope, id: string, revision: number): FollowupTask {
    return this.mutate(scope, id, revision, (task, row) => {
      if (task.status !== 'needs_attention' || row.lease_token || task.notificationRetry || !task.notificationRetryStatus || !task.lastRun?.result || task.lastRun.phase !== 'interrupted') throw new FollowupConflictError('No interrupted notification to retry')
      task.notificationRetry = true
      task.nextRunAt = new Date(this.now()).toISOString()
    })
  }
  setBackgroundConversationId(scope: FollowupScope, id: string, backgroundConversationId: string): FollowupTask {
    return this.transaction(() => {
      const task: StoredTask = JSON.parse(this.row(scope, id).data)
      if (task.backgroundConversationId && task.backgroundConversationId !== backgroundConversationId) throw new FollowupConflictError('Background conversation already assigned')
      if (!this.db.prepare('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?').get(backgroundConversationId, scope.workspaceId)) throw new FollowupNotFoundError('Background conversation not found in workspace')
      task.backgroundConversationId = backgroundConversationId; task.revision++; task.updatedAt = new Date(this.now()).toISOString(); this.save(task)
      return this.view(task)
    })
  }
  /** Scheduler-only: all recovery and claims are fenced in one SQLite write transaction. */
  claim(serverId: string, leaseMs: number): { task: FollowupTask; run: FollowupRun; token: string } | null {
    return this.transaction(() => {
      const now = this.now(); const iso = new Date(now).toISOString()
      const rows = this.db.prepare('SELECT data, lease_token, lease_until FROM followup_tasks WHERE server_id = ? ORDER BY next_run_at, id').all(serverId) as unknown as Row[]
      for (const row of rows) {
        const task: StoredTask = JSON.parse(row.data)
        if (row.lease_token) {
          if (row.lease_until! > now) continue
          const stoppedNotification = ['paused', 'cancelled'].includes(task.status) && task.lastRun?.phase === 'notifying'
          if (task.lastRun) {
            if (stoppedNotification) delete task.notificationRetryStatus
            else if (task.lastRun.phase === 'notifying') task.notificationRetryStatus = task.status
            task.lastRun.phase = stoppedNotification ? 'finished' : 'interrupted'; task.lastRun.finishedAt = iso
            if (!stoppedNotification) task.lastRun.error = '执行租约已过期，状态不确定；不会自动重发，请人工确认'
          }
          if (!stoppedNotification && task.status !== 'cancelled') task.status = 'needs_attention'
          task.nextRunAt = null; task.revision++; task.updatedAt = iso
          this.save(task)
          this.db.prepare('UPDATE followup_tasks SET lease_token = NULL, lease_until = NULL WHERE id = ?').run(task.id)
          continue
        }
        if (task.notificationRetry && task.status === 'needs_attention' && task.nextRunAt && Date.parse(task.nextRunAt) <= now) {
          const token = randomUUID()
          task.notificationRetry = false
          task.status = task.notificationRetryStatus!
          task.nextRunAt = task.status === 'active' ? new Date(now + this.delay(task)).toISOString() : null
          task.lastRun!.phase = 'notifying'; task.lastRun!.finishedAt = null
          task.revision++; task.updatedAt = iso; this.save(task)
          this.db.prepare('UPDATE followup_tasks SET lease_token = ?, lease_until = ? WHERE id = ?').run(token, now + leaseMs, task.id)
          return { task: this.view(task), run: task.lastRun!, token }
        }
        if (['active', 'paused'].includes(task.status) && task.deadlineAt && Date.parse(task.deadlineAt) <= now) {
          task.status = 'expired'; task.nextRunAt = null; task.revision++; task.updatedAt = iso
          const token = randomUUID()
          const run: FollowupRun = { id: randomUUID(), taskId: task.id, phase: 'notifying', startedAt: iso, finishedAt: null, result: { status: 'failed', summary: 'Followup deadline reached', facts: { reason: 'deadline' } }, outboxId: null }
          task.lastRun = run; task.lastResult = run.result; this.save(task)
          this.db.prepare('UPDATE followup_tasks SET lease_token = ?, lease_until = ? WHERE id = ?').run(token, now + leaseMs, task.id)
          return { task: this.view(task), run, token }
        }
        if (task.status !== 'active' || !task.nextRunAt || Date.parse(task.nextRunAt) > now) continue
        const token = randomUUID()
        const run: FollowupRun = { id: randomUUID(), taskId: task.id, phase: 'executing', startedAt: iso, finishedAt: null, result: null, outboxId: null }
        task.lastRun = run; task.revision++; task.updatedAt = iso
        this.save(task)
        this.db.prepare('UPDATE followup_tasks SET lease_token = ?, lease_until = ? WHERE id = ?').run(token, now + leaseMs, task.id)
        return { task: this.view(task), run, token }
      }
      return null
    })
  }
  heartbeat(id: string, token: string, leaseMs: number): boolean {
    return this.db.prepare('UPDATE followup_tasks SET lease_until = ? WHERE id = ? AND lease_token = ? AND lease_until > ?').run(this.now() + leaseMs, id, token, this.now()).changes === 1
  }
  /** Persist result before Outbox admission; never repeat a partially admitted notification. */
  recordResult(scope: FollowupScope, id: string, token: string, result: FollowupResult): { task: FollowupTask; run: FollowupRun; notify: boolean } | null {
    if (!result || !['pending', 'completed', 'failed', 'needs_attention'].includes(result.status) || typeof result.summary !== 'string' || result.summary.length > 20_000) throw new Error('Invalid followup result')
    const facts = result.facts === undefined ? undefined : canonicalFollowupFacts(result.facts)
    result = { status: result.status, summary: result.summary, ...(facts === undefined ? {} : { facts: JSON.parse(facts) as JsonValue }) }
    return this.transaction(() => {
      const row = this.row(scope, id)
      if (row.lease_token !== token || row.lease_until! <= this.now()) return null
      const task: StoredTask = JSON.parse(row.data)
      const run = task.lastRun!
      if (task.status === 'active' && task.deadlineAt && Date.parse(task.deadlineAt) <= this.now()) {
        result = { status: 'failed', summary: 'Followup deadline reached', facts: { reason: 'deadline' } }
      }
      const changed = task.lastResult?.status !== result.status || (facts !== undefined && facts !== task.comparisonFacts)
      run.result = result; task.lastResult = result
      if (facts !== undefined) task.comparisonFacts = facts
      const eligible = task.status === 'active'
      if (eligible) {
        if (task.deadlineAt && Date.parse(task.deadlineAt) <= this.now()) task.status = 'expired'
        else if (result.status === 'completed' || result.status === 'needs_attention') task.status = result.status
      }
      task.failureCount = result.status === 'failed' ? task.failureCount + 1 : 0
      task.deferralCount = 0
      task.nextRunAt = task.status === 'active' ? new Date(this.now() + this.delay(task)).toISOString() : null
      const notify = eligible && (task.status === 'expired' || task.notificationPolicy === 'every' || (task.notificationPolicy === 'change' && changed) || result.status === 'completed' || result.status === 'needs_attention' || (task.notificationPolicy === 'terminal' && result.status === 'failed'))
      run.phase = notify ? 'notifying' : 'finished'; run.finishedAt = notify ? null : new Date(this.now()).toISOString()
      task.revision++; task.updatedAt = new Date(this.now()).toISOString(); this.save(task)
      if (!notify) this.release(id, token)
      return { task: this.view(task), run, notify }
    })
  }
  private delay(task: FollowupTask, retryCount = task.failureCount): number { return Math.max(task.intervalMinutes * 60_000, retryCount ? Math.min(3_600_000, 60_000 * 2 ** Math.min(retryCount - 1, 10)) : 0) }
  private release(id: string, token: string): void { this.db.prepare('UPDATE followup_tasks SET lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?').run(id, token) }
  finish(scope: FollowupScope, id: string, token: string, outcome: { outboxId: string } | { deferred: true; error?: string } | { attention: true; error?: string }): void {
    this.transaction(() => {
      const row = this.row(scope, id)
      if (row.lease_token !== token || row.lease_until! <= this.now()) return
      const task: StoredTask = JSON.parse(row.data)
      const run = task.lastRun!
      run.error = 'error' in outcome ? outcome.error?.slice(0, 2000) ?? null : null
      if ('outboxId' in outcome) { run.outboxId = outcome.outboxId; run.phase = 'finished'; delete task.notificationRetryStatus }
      else if ('deferred' in outcome) {
        run.phase = 'deferred'
        task.deferralCount++
        task.nextRunAt = task.status === 'active' ? new Date(this.now() + this.delay(task, task.deferralCount)).toISOString() : null
      } else {
        const stopped = ['cancelled', 'paused'].includes(task.status)
        if (stopped) delete task.notificationRetryStatus
        else if (run.phase === 'notifying') task.notificationRetryStatus = task.status
        run.phase = stopped ? 'finished' : 'interrupted'
        if (!['cancelled', 'paused'].includes(task.status)) task.status = 'needs_attention'
        task.nextRunAt = null
      }
      run.finishedAt = new Date(this.now()).toISOString(); task.revision++; task.updatedAt = run.finishedAt; this.save(task); this.release(id, token)
    })
  }
}

export interface FollowupSchedulerOptions {
  /** Required server boundary; a worker never claims another server's tasks. */
  serverId: string
  execute: (task: FollowupTask, run: FollowupRun) => Promise<FollowupResult>
  notify: (task: FollowupTask, run: FollowupRun) => Promise<string>
  leaseMs?: number
  pollMs?: number
  onError?: (error: unknown) => void
}
export class FollowupScheduler {
  private timer?: ReturnType<typeof setInterval>
  private running: Promise<void> | null = null
  private readonly leaseMs: number
  constructor(private readonly repository: FollowupRepository, private readonly options: FollowupSchedulerOptions) {
    this.leaseMs = options.leaseMs ?? 60_000
    if (!options.serverId?.trim() || !Number.isFinite(this.leaseMs) || this.leaseMs < 30 || !Number.isFinite(options.pollMs ?? 1_000) || (options.pollMs ?? 1_000) < 1) throw new Error('Invalid scheduler options')
  }
  tick(): Promise<void> {
    if (this.running) return this.running
    this.running = this.work().finally(() => { this.running = null })
    return this.running
  }
  private async work(): Promise<void> {
    const claimed = this.repository.claim(this.options.serverId, this.leaseMs)
    if (!claimed) return
    const { task, run, token } = claimed
    const heartbeat = setInterval(() => {
      try { this.repository.heartbeat(task.id, token, this.leaseMs) } catch (error) { this.options.onError?.(error) }
    }, Math.max(10, Math.floor(this.leaseMs / 3)))
    heartbeat.unref()
    let notifying = false
    try {
      const recorded = run.phase === 'notifying' ? { task, run, notify: true } : this.repository.recordResult(task, task.id, token, await this.options.execute(task, run))
      if (recorded?.notify) {
        notifying = true
        const outboxId = await this.options.notify(recorded.task, recorded.run)
        if (typeof outboxId !== 'string' || !outboxId.trim()) throw new Error('Notification must return a durable outboxId')
        this.repository.finish(task, task.id, token, { outboxId })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.finish(task, task.id, token, !notifying && error instanceof FollowupDeferredError ? { deferred: true, error: message } : { attention: true, error: message })
      this.options.onError?.(error)
    } finally { clearInterval(heartbeat) }
  }
  start(): void {
    if (this.timer) return
    const tick = () => { void this.tick().catch(error => this.options.onError?.(error)) }
    this.timer = setInterval(tick, this.options.pollMs ?? 1_000); this.timer.unref(); tick()
  }
  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.running }
}

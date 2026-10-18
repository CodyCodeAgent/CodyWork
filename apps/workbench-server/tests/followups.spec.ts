import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalFollowupFacts, FollowupConflictError, FollowupDeferredError, FollowupNotFoundError, FollowupRepository, FollowupScheduler } from '../src/services/followups.js'
import type { FollowupInput, FollowupResult, FollowupScope } from '../src/services/followups.js'

const scope: FollowupScope = { serverId: 'server', workspaceId: 'workspace', sourceConversationId: 'source' }
const input: FollowupInput = { name: 'Watch build', prompt: 'Check build', completionCondition: 'Build succeeds', intervalMinutes: 1, deadlineAt: null, notificationPolicy: 'change' }
const pending: FollowupResult = { status: 'pending', summary: 'Building', facts: { b: 2, a: 1 } }
const cleanup: (() => void)[] = []
afterEach(() => { vi.useRealTimers(); cleanup.splice(0).reverse().forEach(fn => fn()) })
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path)
  cleanup.push(() => db.close())
  db.exec(`CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
    INSERT OR IGNORE INTO conversations VALUES ('source', 'workspace'), ('fork', 'workspace'), ('other', 'elsewhere');`)
  let now = Date.parse('2026-10-18T00:00:00Z')
  const repo = new FollowupRepository(db, { now: () => now })
  const execute = vi.fn(async () => pending)
  const notify = vi.fn(async () => 'outbox-1')
  const scheduler = new FollowupScheduler(repo, { serverId: scope.serverId, execute, notify })
  return { db, repo, execute, notify, scheduler, advance: (ms = 60_000) => { now += ms }, due: (options: Partial<FollowupInput> = {}) => {
    const task = repo.create(scope, { ...input, ...options }); return repo.runNow(scope, task.id, task.revision)
  } }
}

describe('followup repository', () => {
  it.each(['rejected', 'expired'] as const)('preserves resumability when a paused notification is %s', mode => {
    const f = fixture(), task = f.due(), claim = f.repo.claim(scope.serverId, 60_000)!
    f.repo.recordResult(scope, task.id, claim.token, pending)
    const current = f.repo.get(scope, task.id)
    f.repo.pause(scope, task.id, current.revision)
    if (mode === 'rejected') f.repo.finish(scope, task.id, claim.token, { attention: true })
    else { f.advance(60_001); f.repo.claim(scope.serverId, 60_000) }
    const paused = f.repo.get(scope, task.id)
    expect(paused.status).toBe('paused')
    expect(f.repo.resume(scope, task.id, paused.revision).status).toBe('active')
  })
  it('creates its tables idempotently, lists scoped tasks and retains only metadata', () => {
    const f = fixture(); new FollowupRepository(f.db)
    const task = f.repo.create(scope, { ...input, creationTurnId: 'turn', backgroundConversationId: 'fork' })
    expect(task).toMatchObject({ revision: 1, status: 'active', creationTurnId: 'turn', backgroundConversationId: 'fork', lastRun: null })
    expect(task.nextRunAt).toBe('2026-10-18T00:01:00.000Z')
    expect(f.repo.list(scope)).toEqual([task])
    for (const foreign of [{ ...scope, serverId: 'foreign' }, { ...scope, workspaceId: 'elsewhere' }, { ...scope, sourceConversationId: 'other' }]) {
      expect(f.repo.list(foreign)).toEqual([])
      expect(() => f.repo.get(foreign, task.id)).toThrow(FollowupNotFoundError)
      expect(() => f.repo.cancel(foreign, task.id, 1)).toThrow(FollowupNotFoundError)
      expect(() => f.repo.listRuns(foreign, task.id)).toThrow(FollowupNotFoundError)
    }
    expect(f.repo.listRuns(scope, task.id)).toEqual([])
  })
  it('enforces ownership, input constraints and optional external identity validation', () => {
    const f = fixture()
    for (const patch of [{ name: '' }, { prompt: '' }, { completionCondition: '' }, { intervalMinutes: 0 }, { intervalMinutes: 1.5 }, { intervalMinutes: Infinity }, { notificationPolicy: 'bogus' }, { deadlineAt: 'bad' }, { deadlineAt: '2020-01-01' }, { backgroundConversationId: 'other' }, { accountId: '' }]) {
      expect(() => f.repo.create(scope, { ...input, ...patch } as FollowupInput)).toThrow()
    }
    expect(() => f.repo.create({ ...scope, workspaceId: 'wrong' }, input)).toThrow(FollowupNotFoundError)
    const validator = vi.fn(() => { throw new Error('account denied') })
    const repo = new FollowupRepository(f.db, { validateIdentity: validator })
    expect(() => repo.create(scope, input)).toThrow('account denied')
    expect(validator).toHaveBeenCalledWith(scope, input)
  })
  it('ignores malicious state fields, checks revisions and implements lifecycle transitions', () => {
    const f = fixture(); let task = f.repo.create(scope, { ...input, status: 'completed', revision: 99, serverId: 'other' } as FollowupInput)
    expect(task).toMatchObject({ status: 'active', revision: 1, serverId: 'server' })
    task = f.repo.update(scope, task.id, 1, { name: 'Renamed', status: 'completed' } as Partial<FollowupInput>)
    expect(task).toMatchObject({ name: 'Renamed', status: 'active', revision: 2 })
    expect(() => f.repo.pause(scope, task.id, 1)).toThrow(FollowupConflictError)
    task = f.repo.pause(scope, task.id, task.revision)
    expect(task.nextRunAt).toBeNull()
    expect(() => f.repo.runNow(scope, task.id, task.revision)).toThrow(FollowupConflictError)
    task = f.repo.resume(scope, task.id, task.revision)
    task = f.repo.runNow(scope, task.id, task.revision)
    expect(task.nextRunAt).toBe('2026-10-18T00:00:00.000Z')
    task = f.repo.cancel(scope, task.id, task.revision)
    expect(task.status).toBe('cancelled')
    expect(() => f.repo.resume(scope, task.id, task.revision)).toThrow(FollowupConflictError)
    expect(() => f.repo.update(scope, task.id, task.revision, { name: 'no' })).toThrow(FollowupConflictError)
  })
  it('canonicalizes nested facts without conflating arrays, values or invalid JSON', () => {
    expect(canonicalFollowupFacts({ z: [{ b: 2, a: 1 }], a: null })).toBe(canonicalFollowupFacts({ a: null, z: [{ a: 1, b: 2 }] }))
    expect(canonicalFollowupFacts([1, 2])).not.toBe(canonicalFollowupFacts([2, 1]))
    for (const value of [NaN, Infinity, undefined, new Date(), { a: undefined }, new Array(2)]) expect(() => canonicalFollowupFacts(value as never)).toThrow()
    const cyclic: Record<string, any> = {}; cyclic.self = cyclic
    expect(() => canonicalFollowupFacts(cyclic)).toThrow()
  })
})

describe('followup scheduler', () => {
  it('does not execute before due and fences server scopes', async () => {
    const f = fixture(); const task = f.repo.create(scope, input)
    await f.scheduler.tick(); expect(f.execute).not.toHaveBeenCalled()
    f.advance()
    await new FollowupScheduler(f.repo, { serverId: 'foreign', execute: f.execute, notify: f.notify }).tick()
    expect(f.execute).not.toHaveBeenCalled()
    await f.scheduler.tick()
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.execute.mock.calls[0]![1]).toMatchObject({ taskId: task.id, phase: 'executing' })
    expect(f.repo.listRuns(scope, task.id)[0]).toMatchObject({ phase: 'finished', outboxId: 'outbox-1', result: pending })
  })
  it('compares canonical facts and status, ignores prose-only changes and preserves absent facts', async () => {
    const f = fixture(); const task = f.due()
    await f.scheduler.tick()
    f.execute.mockResolvedValue({ ...pending, summary: 'Different prose', facts: { a: 1, b: 2 } })
    f.advance(); await f.scheduler.tick(); expect(f.notify).toHaveBeenCalledTimes(1)
    f.execute.mockResolvedValue({ status: 'pending', summary: 'No facts' })
    f.advance(); await f.scheduler.tick(); expect(f.notify).toHaveBeenCalledTimes(1)
    f.execute.mockResolvedValue({ ...pending, status: 'failed' })
    f.advance(); await f.scheduler.tick(); expect(f.notify).toHaveBeenCalledTimes(2)
    expect(f.repo.get(scope, task.id).failureCount).toBe(1)
    f.execute.mockResolvedValue({ ...pending, status: 'completed' })
    f.advance(); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'completed', nextRunAt: null, failureCount: 0 })
    f.advance(); await f.scheduler.tick(); expect(f.execute).toHaveBeenCalledTimes(5)
  })
  it.each(['every', 'change', 'terminal'] as const)('honors %s notifications and always reports completion', async policy => {
    const f = fixture(); f.due({ notificationPolicy: policy })
    await f.scheduler.tick(); f.advance(); await f.scheduler.tick()
    expect(f.notify).toHaveBeenCalledTimes(policy === 'every' ? 2 : policy === 'change' ? 1 : 0)
    f.execute.mockResolvedValue({ status: 'completed', summary: 'Done' })
    f.advance(); await f.scheduler.tick()
    expect(f.notify).toHaveBeenCalledTimes(policy === 'every' ? 3 : policy === 'change' ? 2 : 1)
  })
  it('backs off structured failures and known non-admission deferrals, resets on success', async () => {
    const f = fixture(); const task = f.due({ notificationPolicy: 'terminal' })
    f.execute.mockResolvedValue({ status: 'failed', summary: 'Build failed' })
    await f.scheduler.tick(); f.advance(); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'active', failureCount: 2, nextRunAt: '2026-10-18T00:03:00.000Z' })
    expect(f.notify).toHaveBeenCalledTimes(2)
    f.advance(); await f.scheduler.tick(); expect(f.execute).toHaveBeenCalledTimes(2)
    f.execute.mockRejectedValueOnce(new FollowupDeferredError('Source busy'))
    f.advance(); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ failureCount: 2, deferralCount: 1, lastRun: { phase: 'deferred' } })
    expect(f.notify).toHaveBeenCalledTimes(2)
    f.execute.mockResolvedValue(pending); f.advance(240_000); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id).failureCount).toBe(0)
  })
  it.each(['execute', 'notify', 'invalid-result', 'invalid-outbox'] as const)('never silently retries uncertain %s admission', async failure => {
    const f = fixture(); const task = f.due()
    if (failure === 'execute') f.execute.mockRejectedValue(new Error('unknown admission'))
    if (failure === 'notify') f.notify.mockRejectedValue(new FollowupDeferredError('unknown outbox admission'))
    if (failure === 'invalid-result') f.execute.mockResolvedValue({ status: 'bogus' } as never)
    if (failure === 'invalid-outbox') f.notify.mockResolvedValue('')
    await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'needs_attention', nextRunAt: null, lastRun: { phase: 'interrupted' } })
    f.advance(1_000_000); await f.scheduler.tick(); expect(f.execute).toHaveBeenCalledOnce()
  })
  it('stops for approvals and permits explicit resume', async () => {
    const f = fixture(); const task = f.due({ notificationPolicy: 'terminal' })
    f.execute.mockResolvedValue({ status: 'needs_attention', summary: 'Approval required' })
    await f.scheduler.tick()
    const saved = f.repo.get(scope, task.id)
    expect(saved.status).toBe('needs_attention'); expect(f.notify).toHaveBeenCalledOnce()
    expect(f.repo.resume(scope, task.id, saved.revision).status).toBe('active')
  })
  it.each(['pending', 'completed'] as const)('explicitly retries %s notification with the same run id and no execute', async status => {
    const f = fixture(); const task = f.due()
    f.execute.mockResolvedValue({ ...pending, status })
    f.notify.mockRejectedValueOnce(new Error('uncertain admission'))
    await f.scheduler.tick()
    const attention = f.repo.get(scope, task.id)
    expect(attention.status).toBe('needs_attention')
    expect(() => f.repo.resume(scope, task.id, attention.revision)).toThrow(FollowupConflictError)
    expect(() => f.repo.retryNotification(scope, task.id, task.revision)).toThrow(FollowupConflictError)
    const queued = f.repo.retryNotification(scope, task.id, attention.revision)
    expect(() => f.repo.retryNotification(scope, task.id, queued.revision)).toThrow(FollowupConflictError)
    // A new worker can consume the persisted retry marker.
    const repo = new FollowupRepository(f.db, { now: f.repo.now })
    await new FollowupScheduler(repo, { serverId: scope.serverId, execute: f.execute, notify: f.notify }).tick()
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.notify).toHaveBeenCalledTimes(2)
    expect(f.notify.mock.calls[1]![1].id).toBe(attention.lastRun!.id)
    expect(repo.listRuns(scope, task.id)).toHaveLength(1)
    expect(repo.get(scope, task.id)).toMatchObject({ status: status === 'completed' ? 'completed' : 'active', lastRun: { phase: 'finished', outboxId: 'outbox-1' } })
  })
  it('rejects notification-only retry for uncertain execute or a foreign scope', async () => {
    const f = fixture(); const task = f.due()
    f.execute.mockRejectedValue(new Error('admission unknown')); await f.scheduler.tick()
    const saved = f.repo.get(scope, task.id)
    expect(() => f.repo.retryNotification(scope, task.id, saved.revision)).toThrow(FollowupConflictError)
    expect(() => f.repo.retryNotification({ ...scope, serverId: 'other' }, task.id, saved.revision)).toThrow(FollowupNotFoundError)
  })
  it('allows terminal deadline notification retry without executing or creating a new run', async () => {
    const f = fixture(); const task = f.repo.create(scope, { ...input, deadlineAt: '2026-10-18T00:00:30Z' })
    f.notify.mockRejectedValueOnce(new Error('outbox unavailable'))
    f.advance(); await f.scheduler.tick()
    const saved = f.repo.get(scope, task.id)
    f.repo.retryNotification(scope, task.id, saved.revision)
    await f.scheduler.tick(); await f.scheduler.tick()
    expect(f.execute).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledTimes(2)
    expect(f.notify.mock.calls[1]![1].id).toBe(saved.lastRun!.id)
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'expired', nextRunAt: null, lastRun: { phase: 'finished' } })
  })
  it('tracks busy-source deferrals separately from business failures', async () => {
    const f = fixture(); const task = f.due()
    f.execute.mockRejectedValue(new FollowupDeferredError('Source busy'))
    await f.scheduler.tick(); f.advance(); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'active', failureCount: 0, deferralCount: 2, lastResult: null, nextRunAt: '2026-10-18T00:03:00.000Z' })
    expect(f.notify).not.toHaveBeenCalled()
  })
  it('expires deadlines with one terminal notification and no model admission', async () => {
    const f = fixture(); const task = f.repo.create(scope, { ...input, notificationPolicy: 'terminal', deadlineAt: '2026-10-18T00:00:30Z' })
    f.advance(); await f.scheduler.tick(); await f.scheduler.tick()
    expect(f.execute).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledOnce()
    expect(f.notify.mock.calls[0]![0].status).toBe('expired')
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'expired', nextRunAt: null, lastRun: { outboxId: 'outbox-1' } })
  })
  it('preserves fork writes and concurrent pause/cancel during execution', async () => {
    for (const action of ['pause', 'cancel'] as const) {
      const f = fixture(); const task = f.due()
      f.execute.mockImplementation(async () => {
        const updated = f.repo.setBackgroundConversationId(scope, task.id, 'fork')
        f.repo[action](scope, task.id, updated.revision)
        return { status: 'completed', summary: 'Done' }
      })
      await f.scheduler.tick()
      expect(f.repo.get(scope, task.id)).toMatchObject({ backgroundConversationId: 'fork', status: action === 'pause' ? 'paused' : 'cancelled', nextRunAt: null })
      expect(f.notify).not.toHaveBeenCalled()
    }
  })
  it('rejects edits/run-now while leased, and prevents replacing an assigned fork', () => {
    const f = fixture(); const task = f.due(); f.repo.claim(scope.serverId, 1000)
    const current = f.repo.get(scope, task.id)
    expect(() => f.repo.update(scope, task.id, current.revision, { name: 'change' })).toThrow(FollowupConflictError)
    expect(() => f.repo.runNow(scope, task.id, current.revision)).toThrow(FollowupConflictError)
    f.repo.setBackgroundConversationId(scope, task.id, 'fork')
    expect(() => f.repo.setBackgroundConversationId(scope, task.id, 'source')).toThrow(FollowupConflictError)
  })
  it('uses a terminal deadline result when execution crosses the deadline', async () => {
    const f = fixture(); const task = f.due({ deadlineAt: '2026-10-18T00:00:30Z' })
    f.execute.mockImplementation(async () => { f.advance(31_000); return pending })
    await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'expired', lastRun: { result: { status: 'failed', facts: { reason: 'deadline' } }, outboxId: 'outbox-1' } })
    expect(f.notify).toHaveBeenCalledOnce()
  })
  it('never resends an uncertain deadline notification after its lease expires', async () => {
    const f = fixture(); const task = f.repo.create(scope, { ...input, deadlineAt: '2026-10-18T00:00:30Z' })
    f.advance()
    const claim = f.repo.claim(scope.serverId, 100)!
    expect(claim.run.phase).toBe('notifying')
    f.advance(101); await f.scheduler.tick(); await f.scheduler.tick()
    expect(f.repo.get(scope, task.id)).toMatchObject({ status: 'needs_attention', lastRun: { phase: 'interrupted' } })
    expect(f.notify).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  })
  it('strips callback extension fields and copies facts before persisting results', async () => {
    const f = fixture(); const task = f.due()
    const result = { ...pending, transcript: ['do not persist'], facts: { count: 1 } }
    f.execute.mockResolvedValue(result)
    await f.scheduler.tick(); result.facts.count = 99
    expect(f.repo.get(scope, task.id).lastResult).toEqual({ status: 'pending', summary: 'Building', facts: { count: 1 } })
    const data = (f.db.prepare('SELECT data FROM followup_tasks').get() as { data: string }).data
    expect(data).not.toContain('transcript'); expect(data).not.toContain('do not persist')
  })
  it('prevents overlap across workers and heartbeats slow callbacks', async () => {
    vi.useFakeTimers()
    const f = fixture(); const task = f.due()
    let resolve!: (result: FollowupResult) => void
    f.execute.mockImplementation(() => new Promise(done => { resolve = done }))
    const scheduler = new FollowupScheduler(f.repo, { serverId: scope.serverId, execute: f.execute, notify: f.notify, leaseMs: 300 })
    const other = new FollowupScheduler(f.repo, { serverId: scope.serverId, execute: f.execute, notify: f.notify, leaseMs: 300 })
    const running = scheduler.tick(); expect(scheduler.tick()).toBe(running)
    for (let i = 0; i < 10; i++) { f.advance(100); await vi.advanceTimersByTimeAsync(100); await other.tick() }
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.repo.get(scope, task.id).status).toBe('active')
    resolve(pending); await running
    expect(f.repo.get(scope, task.id).lastRun?.phase).toBe('finished')
  })
  it.each(['executing', 'notifying'] as const)('recovers expired %s leases on restart without resending or accepting stale writers', async phase => {
    const root = mkdtempSync(join(tmpdir(), 'followup-test-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }))
    const f = fixture(join(root, 'db.sqlite')); const task = f.due()
    const claim = f.repo.claim(scope.serverId, 100)!
    if (phase === 'notifying') f.repo.recordResult(scope, task.id, claim.token, pending)
    const secondDb = new DatabaseSync(join(root, 'db.sqlite')); cleanup.push(() => secondDb.close())
    const reopened = new FollowupRepository(secondDb, { now: f.repo.now })
    expect(reopened.get(scope, task.id).status).toBe('active')
    expect(reopened.claim(scope.serverId, 100)).toBeNull()
    f.advance(101)
    expect(reopened.claim(scope.serverId, 100)).toBeNull()
    expect(reopened.get(scope, task.id)).toMatchObject({ status: 'needs_attention', lastRun: { phase: 'interrupted', outboxId: null } })
    expect(reopened.recordResult(scope, task.id, claim.token, pending)).toBeNull()
    reopened.finish(scope, task.id, claim.token, { outboxId: 'stale' })
    expect(reopened.get(scope, task.id).lastRun?.outboxId).toBeNull()
    expect(f.execute).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled()
    if (phase === 'notifying') {
      const saved = reopened.get(scope, task.id)
      reopened.retryNotification(scope, task.id, saved.revision)
      await new FollowupScheduler(reopened, { serverId: scope.serverId, execute: f.execute, notify: f.notify }).tick()
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.notify.mock.calls[0]![1].id).toBe(claim.run.id)
      expect(reopened.get(scope, task.id).lastRun?.outboxId).toBe('outbox-1')
    }
  })
  it('starts idempotently and stop waits for in-flight work', async () => {
    const f = fixture(); f.due()
    let resolve!: (result: FollowupResult) => void
    f.execute.mockImplementation(() => new Promise(done => { resolve = done }))
    f.scheduler.start(); f.scheduler.start()
    let stopped = false
    const stop = f.scheduler.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false)
    resolve(pending); await stop
    expect(stopped).toBe(true); expect(f.execute).toHaveBeenCalledOnce()
  })
})

import { once } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { ConversationService } from '../src/services/conversations.js'
import { startServer } from '../src/routes/index.js'

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cody-conversations-'))
  mkdirSync(join(root, 'services', 'demo'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'specs'), { recursive: true })
  mkdirSync(join(root, 'worktrees', 'verify', 'services', 'demo'), { recursive: true })
  const db = new WorkbenchDb(':memory:')
  const now = nowIso()
  const workspaceId = makeId('ws')
  const demandId = makeId('demand')
  const repositoryId = makeId('repo')
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspaceId, 'Conversation Test', root, now, now)
  db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(repositoryId, workspaceId, 'demo', join(root, 'services', 'demo'), null, null, now)
  db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(demandId, workspaceId, 'Verify chat', 'verify', 'verify', 'in_progress', now, now)
  db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(demandId, repositoryId, 'verify', join(root, 'worktrees', 'verify', 'services', 'demo'), 'HEAD', 'test', now)
  return { root, db, workspaceId, demandId }
}

describe('conversation websocket control plane', () => {
  it('never replaces the process owner when Runtime settings are saved', async () => {
    class TrackingRuntime extends TestRuntimeAdapter {
      closeCalls = 0
      override async close(): Promise<void> { this.closeCalls += 1; await super.close() }
    }
    const test = await fixture()
    const runtime = new TrackingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const server = startServer({ db: test.db, conversations }, { host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const before = test.db.db.prepare('SELECT updated_at FROM runtime_settings WHERE id = 1').get() as { updated_at: string }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/settings/runtime`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '   ' }),
    })
    expect(response.ok).toBe(true)
    expect(runtime.closeCalls).toBe(0)
    expect(test.db.db.prepare('SELECT updated_at FROM runtime_settings WHERE id = 1').get()).toEqual(before)

    const changed = await fetch(`http://127.0.0.1:${address.port}/api/settings/runtime`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'codex app-server --stdio --new-owner-after-deploy' }),
    })
    expect(changed.ok).toBe(true)
    await expect(changed.json()).resolves.toMatchObject({ ok: true, data: { restartRequired: true } })
    expect(runtime.closeCalls).toBe(0)

    server.close()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('does not present persisted SQLite status as native Runtime state', async () => {
    class PendingApprovalRuntime extends TestRuntimeAdapter {
      override async readConversationSnapshot(request: Parameters<TestRuntimeAdapter['readConversationSnapshot']>[0]) {
        const timestamp = nowIso()
        return { watermark: 0, events: [
          { id: 'user', type: 'user.completed' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: { text: 'inspect this' } },
          { id: 'started', type: 'turn.started' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: {} },
          { id: 'approval', type: 'approval.requested' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: { approvalId: 'approval-stale' } },
        ] }
      }
    }
    const test = await fixture()
    const conversations = new ConversationService(test.db, new PendingApprovalRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Interrupted owner')
    test.db.db.prepare("UPDATE conversations SET status = 'awaiting_approval' WHERE id = ?").run(conversation.id)

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('idle')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toMatchObject({ events: [
      expect.objectContaining({ type: 'user.completed', turnId: 'turn-pending' }),
      expect.objectContaining({ type: 'turn.started', turnId: 'turn-pending' }),
      expect.objectContaining({ type: 'approval.requested', turnId: 'turn-pending' }),
    ] })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('passes clean text, structured selected skills and steer mode to the Runtime', async () => {
    class CapturingRuntime extends TestRuntimeAdapter {
      requests: Parameters<TestRuntimeAdapter['submitTurn']>[0][] = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.requests.push(request)
        return super.submitTurn(request)
      }
    }
    const test = await fixture()
    const skillPath = join(test.root, '.agents', 'skills', 'e2e-sample', 'SKILL.md')
    mkdirSync(join(test.root, '.agents', 'skills', 'e2e-sample'), { recursive: true })
    writeFileSync(skillPath, '# E2E sample')
    const runtime = new CapturingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Structured skill')

    await conversations.send(test.workspaceId, conversation.id, 'Keep this user message clean', 'steer', { skills: [realpathSync(skillPath)] })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.requests[0]).toMatchObject({
      prompt: 'Keep this user message clean',
      mode: 'steer',
      settings: { skills: [{ name: 'e2e-sample', path: realpathSync(skillPath) }] },
    })
    await conversations.send(test.workspaceId, conversation.id, '', 'queue', { skills: [realpathSync(skillPath)] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runtime.requests[1]).toMatchObject({
      prompt: '',
      mode: 'queue',
      settings: { skills: [{ name: 'e2e-sample', path: realpathSync(skillPath) }] },
    })
    await expect(conversations.send(test.workspaceId, conversation.id, 'unknown skill', 'queue', { skills: ['missing'] })).rejects.toThrow('Skill 不存在')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('includes unresolved Core requests in the owner snapshot, not a second realtime replay', async () => {
    class PendingRuntime extends TestRuntimeAdapter {
      override async readConversationSnapshot(conversation: Parameters<TestRuntimeAdapter['readConversationSnapshot']>[0]) {
        const timestamp = nowIso()
        return { watermark: 4, events: [{
          id: 'approval-live', type: 'approval.requested' as const, conversationId: conversation.conversationId,
          threadId: conversation.nativeId, turnId: 'turn-live', timestamp, atIso: timestamp,
          data: { approvalId: 'approval-live' },
        }] }
      }
    }
    const test = await fixture()
    const conversations = new ConversationService(test.db, new PendingRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Pending request')
    const snapshot = await conversations.history(test.workspaceId, conversation.id)
    expect(snapshot).toMatchObject({ watermark: 4, events: [expect.objectContaining({ type: 'approval.requested' })] })
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('passes collaboration mode as turn-scoped input without persisting a second owner', async () => {
    class StateRuntime extends TestRuntimeAdapter {
      requests: Array<Parameters<TestRuntimeAdapter['submitTurn']>[0]> = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.requests.push(request)
        return super.submitTurn(request)
      }
    }
    const test = await fixture()
    const runtime = new StateRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Structured state')

    await conversations.send(test.workspaceId, conversation.id, 'plan this', 'queue', { collaborationMode: 'plan' })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.requests).toHaveLength(1)
    expect(runtime.requests[0]?.settings).toMatchObject({ collaborationMode: 'plan' })
    const columns = test.db.db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]
    expect(columns.map(column => column.name)).not.toEqual(expect.arrayContaining(['goal_json', 'plan_json']))

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('binds an existing Codex thread to one Demand and persists the policy-scoped mapping', async () => {
    class ResumeTrackingRuntime extends TestRuntimeAdapter {
      resumeCalls = 0
      override async resumeConversation(request: Parameters<TestRuntimeAdapter['resumeConversation']>[0]) {
        this.resumeCalls += 1
        return super.resumeConversation(request)
      }
    }
    const test = await fixture()
    const runtime = new ResumeTrackingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const bound = await conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123', title: 'Existing context' })
    expect(bound.nativeId).toBe('thread-existing-123')
    expect(bound.title).toBe('Existing context')
    await expect(conversations.history(test.workspaceId, bound.id)).resolves.toEqual({ events: [], watermark: 0 })
    // Reading is now an owner snapshot, so the first history load attaches
    // the native thread before it returns its watermark.
    expect(runtime.resumeCalls).toBe(1)
    await expect(conversations.listAvailableNativeThreads(test.workspaceId, test.demandId)).resolves.toEqual([
      expect.objectContaining({ nativeId: 'thread-existing-123', bound: true }),
      expect.objectContaining({ nativeId: 'thread-unbound-456', bound: false }),
    ])
    await expect(conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123' })).rejects.toThrow('已绑定到当前 Demand')
    await conversations.send(test.workspaceId, bound.id, 'attach only when execution starts')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runtime.resumeCalls).toBe(1)
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('deletes an inactive local session while retaining another Demand session', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const first = await conversations.create(test.workspaceId, test.demandId, 'Keep this session')
    const removed = await conversations.create(test.workspaceId, test.demandId, 'Remove this session')

    await expect(conversations.history(test.workspaceId, removed.id)).resolves.toEqual({ events: [], watermark: 0 })
    await expect(conversations.remove(test.workspaceId, removed.id)).resolves.toEqual({ deleted: true })
    expect(conversations.list(test.workspaceId, test.demandId).map(conversation => conversation.id)).toEqual([first.id])
    await expect(conversations.history(test.workspaceId, removed.id)).rejects.toThrow('会话不存在')
    await expect(conversations.remove(test.workspaceId, first.id)).rejects.toThrow('至少保留一个会话')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('renames the native Codex thread before committing the local title', async () => {
    class RenameRuntime extends TestRuntimeAdapter {
      renames: Array<{ nativeId: string; title: string }> = []
      failNext = false

      override async renameConversation(conversation: Parameters<TestRuntimeAdapter['renameConversation']>[0], title: string): Promise<void> {
        if (this.failNext) throw new Error('native rename failed')
        await super.renameConversation(conversation, title)
        this.renames.push({ nativeId: conversation.nativeId, title })
      }
    }

    const test = await fixture()
    const runtime = new RenameRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Before')

    await expect(conversations.rename(test.workspaceId, conversation.id, '  After  ')).resolves.toMatchObject({ title: 'After' })
    expect(runtime.renames).toEqual([{ nativeId: conversation.nativeId, title: 'After' }])

    runtime.failNext = true
    await expect(conversations.rename(test.workspaceId, conversation.id, 'Must not persist')).rejects.toThrow('native rename failed')
    expect(conversations.get(test.workspaceId, conversation.id).title).toBe('After')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('refuses to delete a running session', async () => {
    class LiveStateRuntime extends TestRuntimeAdapter {
      activeTurnId = ''
      sessionSnapshot(conversation: { id: string; nativeId: string }) {
        return {
          bindingId: conversation.id,
          threadId: conversation.nativeId,
          activeTurnId: this.activeTurnId,
          pendingRequestCount: 0,
          attached: true,
          runtimeAvailable: true,
        }
      }
    }
    const test = await fixture()
    const runtime = new LiveStateRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const running = await conversations.create(test.workspaceId, test.demandId, 'Running session')
    await conversations.create(test.workspaceId, test.demandId, 'Other session')
    runtime.activeTurnId = 'turn-live'

    await expect(conversations.remove(test.workspaceId, running.id)).rejects.toThrow('正在执行或等待确认')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('streams live events over WebSocket while history is read from the native thread', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const server = startServer({ db: test.db, conversations }, { host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}`
    const first = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string } }
    const second = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string } }
    expect(second.data.id).not.toBe(first.data.id)
    const events: string[] = []
    const secondTabEvents: string[] = []
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${first.data.id}/events`)
    const secondTab = new WebSocket(`ws://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${first.data.id}/events`)
    socket.on('message', (data) => { const message = JSON.parse(String(data)) as { event?: { type: string } }; if (message.event) events.push(message.event.type) })
    secondTab.on('message', (data) => { const message = JSON.parse(String(data)) as { event?: { type: string } }; if (message.event) secondTabEvents.push(message.event.type) })
    await Promise.all([once(socket, 'open'), once(secondTab, 'open')])
    await fetch(`${base}/conversations/${first.data.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toEqual(['command.queued', 'command.bound', 'user.completed', 'turn.started', 'tool.started', 'assistant.delta', 'tool.completed', 'turn.completed'])
    expect(secondTabEvents).toEqual(events)
    expect(test.db.db.prepare('SELECT status FROM conversations WHERE id = ?').get(first.data.id)).toEqual({ status: 'idle' })
    const firstTabClosed = once(socket, 'close')
    socket.close(1000, 'first tab closed')
    await firstTabClosed
    await fetch(`${base}/conversations/${first.data.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'second tab remains connected' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toHaveLength(8)
    expect(secondTabEvents).toHaveLength(16)
    const history = await (await fetch(`${base}/conversations/${first.data.id}/history`)).json() as { data: { events: { type: string }[] } }
    expect(history.data.events.some(event => event.type === 'assistant.delta')).toBe(true)
    const deletion = await (await fetch(`${base}/conversations/${second.data.id}`, { method: 'DELETE' })).json() as { data: { deleted: boolean } }
    expect(deletion.data).toEqual({ deleted: true })
    secondTab.close()
    server.close()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('does not automatically replay a command rejected before native turn binding', async () => {
    class RejectingRuntime extends TestRuntimeAdapter {
      submitCalls = 0

      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.submitCalls += 1
        const clientCommandId = request.clientCommandId ?? 'command-rejected'
        const timestamp = nowIso()
        request.onEvent?.({
          id: 'command-failed', type: 'command.failed', conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, timestamp, atIso: timestamp,
          data: { clientCommandId, error: 'Codex conversation runtime is not available' },
        })
        const failure = Promise.reject(new Error('Codex conversation runtime is not available'))
        void failure.catch(() => undefined)
        return { clientCommandId, started: failure, completed: failure }
      }
    }

    const test = await fixture()
    const runtime = new RejectingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Do not replay')

    await conversations.send(test.workspaceId, conversation.id, 'must require an explicit retry')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.submitCalls).toBe(1)
    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('idle')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'runtime.resumed'").get(conversation.id)).toBeUndefined()

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('does not reconstruct native history from SQLite failure audits', async () => {
    class FailingRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const clientCommandId = request.clientCommandId ?? 'command-failed'
        const timestamp = nowIso()
        request.onEvent?.({
          id: 'failed-before-turn', type: 'command.failed', conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, timestamp, atIso: timestamp,
          data: { clientCommandId, error: 'response stream disconnected' },
        })
        const failure = Promise.reject(new Error('response stream disconnected'))
        void failure.catch(() => undefined)
        return { clientCommandId, started: failure, completed: failure }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new FailingRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Show runtime failure')
    await conversations.send(test.workspaceId, conversation.id, 'do not lose the reason')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('idle')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'command.failed'").get(conversation.id)).toEqual({ action: 'command.failed' })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('keeps an upstream operational disconnect distinct from a native terminal failure', async () => {
    class UpstreamFailureRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const timestamp = nowIso()
        const event = {
          id: 'upstream-disconnected', type: 'turn.disconnected' as const, conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, turnId: 'turn-upstream', timestamp, atIso: timestamp,
          data: {
            cause: 'upstream_response_stream_unrecoverable',
            error: 'Codex 上游响应流恢复失败，未自动重发。',
          },
        }
        request.onEvent?.(event)
        return {
          clientCommandId: request.clientCommandId ?? 'command-upstream',
          started: Promise.resolve({ threadId: request.conversation.nativeId, turnId: 'turn-upstream' }),
          completed: Promise.resolve({ conversation: request.conversation, finalText: '', events: [event] }),
        }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new UpstreamFailureRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Keep failed outbox')

    await conversations.send(test.workspaceId, conversation.id, 'do not silently resend')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('idle')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('returns an interrupted turn to idle without recording a Runtime failure', async () => {
    class InterruptedRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const timestamp = nowIso()
        const event = {
          id: 'turn-interrupted', type: 'turn.interrupted' as const, conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, turnId: 'turn-1',
          timestamp, atIso: timestamp, data: { status: 'interrupted' },
        }
        request.onEvent?.(event)
        return {
          clientCommandId: request.clientCommandId ?? 'command-interrupted',
          started: Promise.resolve({ threadId: request.conversation.nativeId, turnId: 'turn-1' }),
          completed: Promise.resolve({ conversation: request.conversation, finalText: '', events: [event] }),
        }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new InterruptedRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Stop cleanly')
    await conversations.send(test.workspaceId, conversation.id, 'stop this turn')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('idle')
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'turn.failed'").get(conversation.id)).toBeUndefined()

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })
})

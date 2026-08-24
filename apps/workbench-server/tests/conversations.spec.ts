import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
  it('binds an existing provider thread to one Demand and persists the policy-scoped mapping', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const bound = await conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123', title: 'Existing context' })
    expect(bound.nativeId).toBe('thread-existing-123')
    expect(bound.title).toBe('Existing context')
    expect(conversations.history(test.workspaceId, bound.id).map(event => event.type)).toEqual(['conversation.bound'])
    await expect(conversations.listAvailableNativeThreads(test.workspaceId, test.demandId)).resolves.toEqual([
      expect.objectContaining({ nativeId: 'thread-existing-123', bound: true }),
      expect.objectContaining({ nativeId: 'thread-unbound-456', bound: false }),
    ])
    await expect(conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123' })).rejects.toThrow('已绑定到当前 Demand')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('deletes an inactive local session with its durable history but retains another Demand session', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const first = await conversations.create(test.workspaceId, test.demandId, 'Keep this session')
    const removed = await conversations.create(test.workspaceId, test.demandId, 'Remove this session')

    expect(conversations.history(test.workspaceId, removed.id).map(event => event.type)).toEqual(['conversation.created'])
    expect(conversations.remove(test.workspaceId, removed.id)).toEqual({ deleted: true })
    expect(conversations.list(test.workspaceId, test.demandId).map(conversation => conversation.id)).toEqual([first.id])
    expect(() => conversations.history(test.workspaceId, removed.id)).toThrow('会话不存在')
    expect(() => conversations.remove(test.workspaceId, first.id)).toThrow('至少保留一个会话')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('refuses to delete a running session', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const running = await conversations.create(test.workspaceId, test.demandId, 'Running session')
    await conversations.create(test.workspaceId, test.demandId, 'Other session')
    test.db.db.prepare("UPDATE conversations SET status = 'running' WHERE id = ?").run(running.id)

    expect(() => conversations.remove(test.workspaceId, running.id)).toThrow('正在执行或等待确认')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('persists multiple sessions and streams events over WebSocket with cursor replay', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const server = startServer({ db: test.db, conversations }, 0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}`
    const first = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string; lastEventId: number } }
    const second = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string } }
    expect(second.data.id).not.toBe(first.data.id)
    const events: string[] = []
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${first.data.id}/events?after=${first.data.lastEventId}`)
    socket.on('message', (data) => { const message = JSON.parse(String(data)) as { event?: { type: string } }; if (message.event) events.push(message.event.type) })
    await once(socket, 'open')
    await fetch(`${base}/conversations/${first.data.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toEqual(['message.user', 'turn.started', 'item.started', 'message.delta', 'item.completed', 'turn.completed'])
    const history = await (await fetch(`${base}/conversations/${first.data.id}/history`)).json() as { data: { events: { type: string }[] } }
    expect(history.data.events.some(event => event.type === 'message.delta')).toBe(true)
    const deletion = await (await fetch(`${base}/conversations/${second.data.id}`, { method: 'DELETE' })).json() as { data: { deleted: boolean } }
    expect(deletion.data).toEqual({ deleted: true })
    socket.close()
    server.close()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })
})

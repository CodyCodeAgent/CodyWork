import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkbenchDb, nowIso } from '../src/db/index.js'
import { CodyWorkCodexRuntime } from '../src/runtime/codex.js'
import { ConversationService } from '../src/services/conversations.js'
import { FollowupService, parseFollowupResult } from '../src/services/followupService.js'
import { ChannelStore } from '../src/services/channelStore.js'
import type { CodyWorkChannelService } from '../src/services/channelBot.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { ConversationEventHub } from '../src/services/conversationEventHub.js'
import { AgentFollowupTools } from '../src/services/agentFollowups.js'
import { NotificationCenter } from '../src/services/notificationCenter.js'

describe('Followup product integration', () => {
  it('finishes with a local inbox receipt without a bot, and resends the stored result without another check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'followup-local-inbox-')), db = new WorkbenchDb(':memory:')
    const runtime = new CodyWorkCodexRuntime({ command: `${process.execPath} ${fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))}` })
    const conversations = new ConversationService(db, runtime)
    let service: FollowupService | undefined
    try {
      const now = nowIso()
      db.db.prepare('INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES(?,?,?,?,?)').run('ws', 'Fixture', root, now, now)
      const queue = vi.fn(async () => ({ id: 'delivery-fixture' })), resolve = vi.fn(async (_id, email) => ({ email, openId: 'ou_fixture' }))
      const center = new NotificationCenter(db, { queue, resolve })
      const channels = { notificationCenter: center, publishNotification: (input: Parameters<NotificationCenter['publish']>[0]) => center.publish(input), smartNotificationSettings: () => ({ feishuEnabled: false }) } as unknown as CodyWorkChannelService
      service = new FollowupService(db, conversations, () => channels, () => '')
      const source = await conversations.createWorkspace('ws', 'Local only')
      const task = service.create('ws', { conversationId: source.id, name: 'Local result', prompt: 'Read fixture', completionCondition: 'done', intervalMinutes: 1, deadlineAt: new Date(Date.now() + 3_600_000).toISOString() })
      await expect.poll(() => service!.list('ws').items[0]?.backgroundConversationId).toBeTruthy()
      const ready = service.list('ws').items[0]!
      service.action('ws', task.id, 'run-now', ready.revision); await service.scheduler.tick()
      expect(service.list('ws').items[0]?.status).toBe('completed')
      expect(center.list('ws')).toMatchObject({ unreadCount: 1, items: [{ deliveryStatus: 'local_only' }] })
      expect(service.runs('ws', task.id).items[0]?.notificationId).toBe(center.list('ws').items[0]!.id)
      expect(queue).not.toHaveBeenCalled()
      const check = vi.spyOn(conversations, 'submitScheduledCommand')
      await service.resendResult('ws', task.id, { expectedRevision: service.list('ws').items[0]!.revision, accountId: 'bot', email: 'fixture@example.test' })
      expect(check).not.toHaveBeenCalled(); expect(queue).toHaveBeenCalledTimes(1)
      expect(service.runs('ws', task.id).items).toHaveLength(1)
    } finally { await service?.close(); await conversations.closeRuntimes(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('creates through the real skill helper on a resumed old thread without dynamic tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'followup-old-skill-'))
    const db = new WorkbenchDb(':memory:')
    const runtime = new CodyWorkCodexRuntime({ command: `${process.execPath} ${fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))}` })
    const conversations = new ConversationService(db, runtime)
    let service: FollowupService | undefined
    try {
      const now = nowIso()
      db.db.prepare('INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES(?,?,?,?,?)').run('ws', 'Fixture', root, now, now)
      db.db.prepare("INSERT INTO channel_accounts(id,provider,name,app_id,secret_cipher,enabled,created_at,updated_at) VALUES('account','feishu','Fixture','fixture','synthetic',1,?,?)").run(now, now)
      db.db.prepare("INSERT INTO conversations(id,scope,workspace_id,native_id,title,created_via,status,permission_mode,policy_hash,instruction_hash,created_at,updated_at) VALUES('old','workspace','ws','old-native','Old','browser','completed','yolo','','',?,?)").run(now, now)
      const channels = { smartNotificationSettings: () => ({ accountId: 'account', recipientOpenId: 'ou_fixture' }) } as unknown as CodyWorkChannelService
      service = new FollowupService(db, conversations, () => channels, () => '')
      conversations.followupSkillHandler = call => new AgentFollowupTools(db, () => service!, () => ({})).handle(call)
      await conversations.submitCommand({ workspaceId: 'ws', conversationId: 'old', origin: { kind: 'browser' }, prompt: '$codywork-followup SKILL_FOLLOWUP_CREATE EXPECT_YOLO' })
      await expect.poll(() => service!.list('ws', 'old').items.length).toBe(1)
      await expect.poll(() => conversations.get('ws', 'old').status).toBe('completed')
      expect(service.list('ws', 'old').items[0]).toMatchObject({ sourceConversationId: 'old', name: 'Skill followup', notification: { mode: 'change' } })
      expect(JSON.stringify((await conversations.historyCanonical('ws', 'old')).events)).not.toContain('本轮跟进执行桥接')
    } finally { await service?.close(); await conversations.closeRuntimes(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('does not admit a command cancelled while runtime context preparation is waiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'followup-abort-'))
    const db = new WorkbenchDb(':memory:')
    const runtime = new TestRuntimeAdapter()
    const conversations = new ConversationService(db, runtime)
    try {
      const now = nowIso()
      db.db.prepare('INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES(?,?,?,?,?)').run('ws', 'Fixture', root, now, now)
      const source = await conversations.createWorkspace('ws', 'Abort fixture')
      let release!: () => void
      const skillWait = vi.spyOn(runtime, 'resolveSkills').mockImplementation(() => new Promise(resolve => { release = () => resolve([]) }))
      const submit = vi.spyOn(runtime, 'submitTurn')
      const controller = new AbortController()
      const result = conversations.submitScheduledCommand({ workspaceId: 'ws', conversationId: source.id, origin: { kind: 'schedule', taskId: 'task', runId: 'run' }, prompt: 'Read fixture', signal: controller.signal })
      const rejected = expect(result).rejects.toThrow()
      await expect.poll(() => skillWait.mock.calls.length).toBe(1)
      controller.abort(); release()
      await rejected
      expect(submit).not.toHaveBeenCalled()
    } finally { await conversations.closeRuntimes(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('does not submit a check if cancelled while its fork is still being created', async () => {
    const db = new WorkbenchDb(':memory:')
    let service: FollowupService | undefined
    try {
      db.db.exec("INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES('ws','Fixture','/tmp/followup-fork-race','now','now'); INSERT INTO channel_accounts(id,provider,name,app_id,secret_cipher,enabled,created_at,updated_at) VALUES('account','feishu','Fixture','fixture','synthetic',1,'now','now'); INSERT INTO conversations(id,scope,workspace_id,native_id,title,created_via,status,permission_mode,policy_hash,instruction_hash,created_at,updated_at) VALUES('source','workspace','ws','source-native','Source','browser','completed','read-only','','','now','now'),('background','workspace','ws','bg-native','Background','browser','completed','read-only','','','now','now')")
      let release!: () => void
      const submit = vi.fn()
      const conversations = { events: new ConversationEventHub(), get: () => ({ runtimeType: 'codex', status: 'completed' }), getRuntime: () => ({ forkConversation: () => {} }), forkForFollowup: () => new Promise(resolve => { release = () => resolve({ id: 'background' }) }), submitScheduledCommand: submit } as unknown as ConversationService
      const channels = { smartNotificationSettings: () => ({ accountId: 'account', recipientOpenId: 'ou_fixture' }) } as unknown as CodyWorkChannelService
      service = new FollowupService(db, conversations, () => channels, () => '')
      const task = service.create('ws', { conversationId: 'source', name: 'race', prompt: 'read', completionCondition: 'done', intervalMinutes: 1, deadlineAt: new Date(Date.now() + 3_600_000).toISOString() })
      service.action('ws', task.id, 'run-now', task.revision)
      const pending = service.scheduler.tick()
      const active = service.list('ws').items[0]!
      service.action('ws', task.id, 'cancel', active.revision)
      release(); await pending
      expect(submit).not.toHaveBeenCalled()
      expect(service.list('ws').items[0]?.status).toBe('cancelled')
    } finally { await service?.close(); db.close() }
  })
  it('forks a read-only check, preserves source history and queues one durable notification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'followup-integration-'))
    const db = new WorkbenchDb(':memory:')
    const runtime = new CodyWorkCodexRuntime({ command: `${process.execPath} ${fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))}` })
    const conversations = new ConversationService(db, runtime)
    let service: FollowupService | undefined
    try {
      const now = nowIso()
      db.db.prepare('INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES(?,?,?,?,?)').run('ws', 'Fixture', root, now, now)
      db.db.prepare("INSERT INTO channel_accounts(id,provider,name,app_id,secret_cipher,enabled,created_at,updated_at) VALUES('account','feishu','Fixture','fixture','synthetic',1,?,?)").run(now, now)
      const source = await conversations.createWorkspace('ws', 'Source')
      await conversations.submitCommand({ workspaceId: 'ws', conversationId: source.id, origin: { kind: 'browser' }, prompt: 'EXPECT_YOLO source-context' })
      await expect.poll(() => conversations.get('ws', source.id).status).toBe('completed')
      const outbox = new ChannelStore(db)
      const channels = { smartNotificationSettings: () => ({ accountId: 'account', recipientOpenId: 'ou_fixture' }), queueNotification: (accountId: string, targetId: string, card: unknown, dedupeKey: string) => outbox.enqueue({ id: 'delivery', provider: 'feishu', accountId, targetId, kind: 'send_user_card', payload: { card }, dedupeKey, terminal: true }) } as unknown as CodyWorkChannelService
      service = new FollowupService(db, conversations, () => channels, () => 'http://localhost/?conversation=source')
      const task = service.create('ws', { conversationId: source.id, name: 'Check', prompt: 'Query fixture status', completionCondition: 'Fixture done', intervalMinutes: 10, deadlineAt: new Date(Date.now() + 3_600_000).toISOString() })
      await expect.poll(() => service!.list('ws').items[0]?.backgroundConversationId).toBeTruthy()
      const ready = service.list('ws').items[0]!
      expect(ready.notification.mode).toBe('change')
      expect(conversations.get('ws', ready.backgroundConversationId!).permissionMode).toBe('read-only')
      service.action('ws', task.id, 'run-now', ready.revision)
      await service.scheduler.tick()
      const done = service.list('ws').items[0]!
      expect(done.status).toBe('completed')
      expect(service.runs('ws', task.id).items[0]).toMatchObject({ status: 'completed', outboxId: 'delivery', deliveryStatus: 'pending' })
      expect(JSON.stringify((await conversations.historyCanonical('ws', source.id)).events)).not.toContain('CODYWORK_FOLLOWUP_CHECK')
      expect(JSON.stringify((await conversations.historyCanonical('ws', ready.backgroundConversationId!)).events)).toContain('CODYWORK_FOLLOWUP_CHECK')
      await service.scheduler.tick()
      expect(service.runs('ws', task.id).items).toHaveLength(1)
      expect(() => service!.create('ws', { conversationId: source.id, name: 'invalid', prompt: 'x', completionCondition: 'y', intervalMinutes: 0 })).toThrow()
      expect(() => service!.action('other-workspace', task.id, 'cancel', done.revision)).toThrow()
    } finally { await service?.close(); await conversations.closeRuntimes(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects unstructured model output rather than inventing successful checks', () => {
    expect(() => parseFollowupResult('all done')).toThrow()
    expect(() => parseFollowupResult('{"status":"completed","summary":"ok"}')).toThrow()
    expect(parseFollowupResult('```json\n{"status":"pending","summary":"waiting","facts":{"id":"pending"}}\n```')).toMatchObject({ status: 'pending' })
  })
})

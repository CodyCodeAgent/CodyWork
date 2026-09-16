import { describe, expect, it, vi } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { ConversationEventHub } from '../src/services/conversationEventHub.js'
import { ChannelStore } from '../src/services/channelStore.js'
import { SmartNotificationService, analyzeSmartTask, smartNotificationCard } from '../src/services/smartNotifications.js'
import { WorkspaceRegistry } from '../src/services/workspaceRegistry.js'
import type { ConversationEvent } from '../src/services/conversations.js'

const workspaceId = 'workspace-smart'
const conversationId = 'conversation-smart'
const turnId = 'turn-smart'

function event(id: string, type: ConversationEvent['type'], minute: number, data: Record<string, unknown> = {}, itemId?: string): ConversationEvent {
  const atIso = new Date(Date.UTC(2026, 8, 14, 8, minute)).toISOString()
  return { id, type, conversationId, threadId: 'thread-smart', turnId, ...(itemId ? { itemId } : {}), atIso, timestamp: atIso, data }
}

function complexTurn(): ConversationEvent[] {
  return [
    event('started', 'turn.started', 0),
    event('user', 'user.completed', 0, { text: '实现复杂功能并验证' }),
    event('tool-1', 'tool.started', 2, { tool: { kind: 'command', title: 'inspect code' } }, 'tool-1'),
    event('file', 'fileChange.updated', 18, { tool: { kind: 'fileChange', title: 'edit files' } }, 'file-change'),
    event('tool-2', 'tool.completed', 35, { tool: { kind: 'command', title: 'pnpm test' } }, 'tool-2'),
    event('assistant', 'assistant.completed', 39, { text: '功能已经完成，并通过类型检查、单元测试和端到端验证。' }),
    event('done', 'turn.completed', 40, { durationMs: 2_400_000 }),
  ]
}

function insertFixture(db: WorkbenchDb): void {
  const now = '2026-09-14T08:00:00.000Z'
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspaceId, 'AI Hub', '/tmp/ai-hub', now, now)
  db.db.prepare(`INSERT INTO channel_accounts (
    id, provider, name, app_id, secret_cipher, enabled, created_at, updated_at
  ) VALUES (?, 'feishu', ?, ?, ?, 1, ?, ?)`).run('account-smart', 'Cody Work', 'cli_smart', 'cipher', now, now)
  db.db.prepare(`INSERT INTO conversations (
    id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at
  ) VALUES (?, 'workspace', NULL, ?, ?, ?, 'browser', 'completed', 'yolo', 'policy', 'instructions', ?, ?)`)
    .run(conversationId, workspaceId, 'thread-smart', '复杂任务', now, now)
}

describe('smart completion notifications', () => {
  it('subtracts approval waiting time and ignores ordinary short replies', () => {
    const events = complexTurn()
    events.splice(3, 0,
      event('approval', 'approval.requested', 5, { requestId: 'approval-1' }),
      event('resolved', 'approval.resolved', 20, { requestId: 'approval-1' }),
    )
    const analysis = analyzeSmartTask(events, turnId, 30)
    expect(analysis).toMatchObject({ eligible: false, wallDurationMs: 2_400_000, waitingDurationMs: 900_000, activeDurationMs: 1_500_000 })

    const chat = [event('start-chat', 'turn.started', 0), event('answer-chat', 'assistant.completed', 31, { text: '这是一次普通聊天回复。' }), event('done-chat', 'turn.completed', 32)]
    expect(analyzeSmartTask(chat, turnId, 30)?.eligible).toBe(false)
  })

  it('queues one durable private card per qualifying Turn with a stable dedupe key', async () => {
    const db = new WorkbenchDb(':memory:')
    insertFixture(db)
    const events = new ConversationEventHub()
    const history = complexTurn()
    const store = new ChannelStore(db)
    const queue = vi.fn(async (accountId: string, input: { kind: string; targetId: string; payload: unknown; dedupeKey: string; terminal?: boolean }) => store.enqueue({
      id: `outbox-${Math.random()}`, provider: 'feishu', accountId, ...input,
    }))
    const audit = vi.fn()
    const service = new SmartNotificationService(db, { events, historyCanonical: vi.fn(async () => ({ events: history, watermark: history.length })) } as never, new WorkspaceRegistry(db), {
      queue, account: () => ({ id: 'account-smart', name: 'Cody Work', enabled: true }), audit,
      openUrl: () => 'http://127.0.0.1:3001/?workspace=workspace-smart&conversation=conversation-smart',
    })
    service.save(workspaceId, { enabled: true, accountId: 'account-smart', recipientOpenId: 'ou_receiver', minActiveMinutes: 30, notifyDemand: true, notifyWorkspace: true })

    events.publish(history.at(-1)!)
    events.publish(history.at(-1)!)
    await vi.waitFor(() => expect(queue).toHaveBeenCalledTimes(2))
    expect(queue.mock.calls[0]?.[1]).toMatchObject({ kind: 'send_user_card', targetId: 'ou_receiver', dedupeKey: `smart-notification:${workspaceId}:${conversationId}:${turnId}`, terminal: true })
    expect((db.db.prepare('SELECT COUNT(*) AS value FROM channel_outbox').get() as { value: number }).value).toBe(1)
    expect(JSON.stringify(queue.mock.calls[0]?.[1].payload)).toContain('长任务已完成')
    expect(audit).toHaveBeenCalledWith('account-smart', 'smart_notification.queued', 'conversation_turn', `${conversationId}:${turnId}`, true, expect.objectContaining({ activeDurationMs: 2_400_000 }))
    service.close()
    db.close()
  })

  it('renders failures distinctly and validates enabled settings', () => {
    const analysis = analyzeSmartTask([
      event('start-fail', 'turn.started', 0),
      event('failure', 'turn.failed', 31, { message: '构建失败' }),
    ], turnId, 30)!
    expect(analysis).toMatchObject({ eligible: true, status: 'failed' })
    expect(JSON.stringify(smartNotificationCard({ workspaceName: 'AI Hub', conversationTitle: '构建生产包', analysis }))).toContain('长任务执行失败')

    const db = new WorkbenchDb(':memory:')
    insertFixture(db)
    const service = new SmartNotificationService(db, { events: new ConversationEventHub() } as never, new WorkspaceRegistry(db), {
      queue: vi.fn(), account: () => ({ id: 'account-smart', name: 'Cody Work', enabled: true }), audit: vi.fn(), openUrl: () => '',
    })
    expect(() => service.save(workspaceId, { enabled: true, accountId: '', recipientOpenId: '', minActiveMinutes: 30 })).toThrow('请选择用于发送通知的飞书机器人')
    service.close()
    db.close()
  })
})

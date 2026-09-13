import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexEvent } from '@codycodeagent/cody-web-core/conversation'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { CodyWorkChannelService } from '../src/services/channelBot.js'
import { ChannelStore } from '../src/services/channelStore.js'
import {
  buildConversationShareDocument,
  cleanConvertedFeishuBlock,
  conversationShareEntries,
  type ConversationDocumentPublisher,
  type ConversationShareDocument,
} from '../src/services/conversationSharing.js'
import { ConversationService } from '../src/services/conversations.js'
import { WorkspaceRegistry } from '../src/services/workspaceRegistry.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'

function event(id: string, type: CodexEvent['type'], data: Record<string, unknown>, turnId = 'turn-1'): CodexEvent {
  return { id, type, data, turnId, threadId: 'thread-1', atIso: '2026-09-11T08:00:00.000Z' }
}

describe('conversation Feishu document sharing', () => {
  it('keeps table cell relationships while removing converted read-only fields', () => {
    expect(cleanConvertedFeishuBlock({
      block_id: 'table-1',
      parent_id: 'temporary-parent',
      block_type: 31,
      children: ['cell-1'],
      table: {
        cells: ['cell-1'],
        property: {
          column_size: 1,
          row_size: 1,
          merge_info: [{ col_span: 1, row_span: 1 }],
        },
      },
    })).toEqual({
      block_id: 'table-1',
      block_type: 31,
      children: ['cell-1'],
      table: {
        cells: ['cell-1'],
        property: { column_size: 1, row_size: 1 },
      },
    })
  })

  it('rejects empty snapshots before contacting the document publisher', () => {
    expect(() => buildConversationShareDocument({
      workspaceName: 'AI Hub', conversationTitle: 'Empty conversation', events: [],
    })).toThrow('当前会话还没有可导出的用户或 AI 文字消息')
  })

  it('keeps only protocol-ordered user and assistant text and marks interrupted output', () => {
    const events: CodexEvent[] = [
      event('user-1', 'user.completed', { text: '请检查 `demo`。', images: ['/tmp/private.png'] }),
      event('turn-1', 'turn.started', {}),
      event('reasoning', 'reasoning.delta', { text: '不应导出的思考' }),
      event('tool', 'tool.completed', { tool: { kind: 'command', title: 'cat secret', output: '不应导出的日志' } }),
      event('assistant-1', 'assistant.completed', { text: '检查完成。\n\n```ts\nconst ok = true\n```' }),
      event('done-1', 'turn.completed', {}),
      event('user-2', 'user.completed', { text: '继续' }, 'turn-2'),
      event('turn-2', 'turn.started', {}, 'turn-2'),
      event('partial', 'assistant.delta', { text: '这是一段中断的回复' }, 'turn-2'),
      event('interrupted', 'turn.interrupted', {}, 'turn-2'),
    ]

    expect(conversationShareEntries(events)).toEqual([
      { role: 'user', text: '请检查 `demo`。', interrupted: false },
      { role: 'assistant', text: '检查完成。\n\n```ts\nconst ok = true\n```', interrupted: false },
      { role: 'user', text: '继续', interrupted: false },
      { role: 'assistant', text: '这是一段中断的回复', interrupted: true },
    ])
    const document = buildConversationShareDocument({
      workspaceName: 'AI Hub', demandName: '导出会话', conversationTitle: '需求沟通', events,
      exportedAt: new Date('2026-09-11T08:00:00.000Z'),
    })
    expect(document.title).toBe('【会话分享】导出会话 - 需求沟通')
    expect(document.messageCount).toBe(4)
    expect(document.markdown).toContain('## CodyWork AI（回复已中断）')
    expect(document.markdown).toContain('const ok = true')
    expect(document.markdown).not.toContain('不应导出的思考')
    expect(document.markdown).not.toContain('不应导出的日志')
    expect(document.markdown).not.toContain('/tmp/private.png')
  })

  it('publishes an authoritative native snapshot with the selected configured bot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-share-conversation-'))
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'services'), { recursive: true })
    mkdirSync(join(root, 'worktrees', 'share'), { recursive: true })
    const db = new WorkbenchDb(':memory:')
    const workspaceId = makeId('ws')
    const demandId = makeId('demand')
    const now = nowIso()
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceId, 'Share Workspace', root, now, now)
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(demandId, workspaceId, 'Share Demand', 'share', 'share', 'in_progress', now, now)
    const conversations = new ConversationService(db, new TestRuntimeAdapter())
    const conversation = await conversations.create(workspaceId, demandId, 'Review result')
    await conversations.send(workspaceId, conversation.id, 'ONLY_USER_TEXT')
    await new Promise(resolve => setTimeout(resolve, 10))

    const store = new ChannelStore(db)
    const account = store.saveAccount(null, {
      name: 'Share Bot', appId: 'cli_share', appSecret: 'not-a-real-secret', enabled: false,
      allowAllUsers: false, allowAllConversations: false,
    })
    db.db.prepare('UPDATE channel_accounts SET enabled = 1 WHERE id = ?').run(account.id)
    let captured: ConversationShareDocument | null = null
    const publisher: ConversationDocumentPublisher = {
      async publish(_account, document) {
        captured = document
        return { documentId: 'docx-share', url: 'https://feishu.cn/docx/docx-share' }
      },
    }
    const service = new CodyWorkChannelService(db, conversations, new WorkspaceRegistry(db), {
      documentPublisher: publisher,
      now: () => new Date('2026-09-11T08:00:00.000Z'),
    })
    try {
      await expect(service.shareConversation({ workspaceId, conversationId: conversation.id, accountId: account.id }))
        .resolves.toMatchObject({ documentId: 'docx-share', messageCount: 2, title: '【会话分享】Share Demand - Review result' })
      expect(captured?.markdown).toContain('ONLY_USER_TEXT')
      expect(captured?.markdown).toContain('Test runtime received: ONLY_USER_TEXT')
      expect(captured?.markdown).not.toContain('Policy check')
      expect(db.db.prepare("SELECT success FROM channel_audit_events WHERE action = 'conversation.document.shared'").get()).toEqual({ success: 1 })
    } finally {
      await service.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

import * as Lark from '@larksuiteoapi/node-sdk'
import {
  conversationFeedFromState,
  createConversationState,
  reduceConversationEvents,
  type CodexEvent,
} from '@codycodeagent/cody-web-core/conversation'
import type { ChannelAccountSecret } from './channelStore.js'
import { feishuApiError } from './feishuPermissions.js'

export type ConversationShareEntry = {
  role: 'user' | 'assistant'
  text: string
  interrupted: boolean
}

export type ConversationShareDocument = {
  title: string
  markdown: string
  messageCount: number
}

export type PublishedFeishuDocument = {
  documentId: string
  url: string
}

export interface ConversationDocumentPublisher {
  publish(account: ChannelAccountSecret, document: ConversationShareDocument): Promise<PublishedFeishuDocument>
}

type FeishuBlock = Record<string, unknown> & { block_id?: string; children?: string[] | string; block_type?: number }

function cleanBlock(block: FeishuBlock): FeishuBlock {
  const { parent_id: _parentId, ...cleaned } = block
  if (typeof cleaned.children === 'string') cleaned.children = [cleaned.children]
  const table = cleaned.table
  if (table && typeof table === 'object' && !Array.isArray(table)) {
    const { merge_info: _mergeInfo, cells: _cells, ...rest } = table as Record<string, unknown>
    cleaned.table = rest
  }
  return cleaned
}

function batchesForDescendantInsert(blocks: FeishuBlock[], firstLevelIds: string[], limit = 1_000): Array<{ ids: string[]; blocks: FeishuBlock[] }> {
  const byId = new Map(blocks.flatMap(block => block.block_id ? [[block.block_id, block] as const] : []))
  const collected = new Set<string>()
  const collect = (rootId: string): FeishuBlock[] => {
    const rows: FeishuBlock[] = []
    const visit = (id: string): void => {
      if (collected.has(id)) return
      const block = byId.get(id)
      if (!block) return
      collected.add(id)
      rows.push(block)
      for (const child of Array.isArray(block.children) ? block.children : typeof block.children === 'string' ? [block.children] : []) visit(child)
    }
    visit(rootId)
    return rows
  }
  const batches: Array<{ ids: string[]; blocks: FeishuBlock[] }> = []
  let current = { ids: [] as string[], blocks: [] as FeishuBlock[] }
  for (const id of firstLevelIds) {
    const subtree = collect(id)
    if (subtree.length > limit) throw new Error('会话内容中的单个文档块过大，无法写入飞书文档')
    if (current.blocks.length && current.blocks.length + subtree.length > limit) {
      batches.push(current)
      current = { ids: [], blocks: [] }
    }
    current.ids.push(id)
    current.blocks.push(...subtree)
  }
  if (current.blocks.length) batches.push(current)
  return batches
}

function feishuError(action: string, response: { code?: number; msg?: string }): Error {
  const detail = response.msg || '飞书返回未知错误'
  const permissionHint = /permission|scope|access denied|权限/iu.test(detail)
    ? '。请到“设置 → 飞书机器人”检查并一次性申请 CodyWork 完整权限'
    : ''
  return new Error(`${action}失败：${detail}（${response.code ?? 'unknown'}）${permissionHint}`)
}

async function feishuCall<T>(action: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw feishuApiError(action, error)
  }
}

async function discardIncompleteDocument(client: Lark.Client, documentId: string): Promise<void> {
  try {
    await client.drive.file.delete({ path: { file_token: documentId }, params: { type: 'docx', async: false } })
  } catch {
    // The original publish error is more useful to the user. Cleanup is best
    // effort because some tenants grant document creation without Drive delete.
  }
}

/** Publishes one immutable conversation snapshot using the configured bot identity. */
export class FeishuConversationDocumentPublisher implements ConversationDocumentPublisher {
  async publish(account: ChannelAccountSecret, document: ConversationShareDocument): Promise<PublishedFeishuDocument> {
    const client = new Lark.Client({
      appId: account.appId,
      appSecret: account.appSecret,
      domain: account.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, trace: () => undefined },
    })
    const created = await feishuCall('创建飞书文档', () => client.docx.document.create({ data: { title: document.title } }))
    const documentId = created.data?.document?.document_id
    if (created.code !== 0 || !documentId) throw feishuError('创建飞书文档', created)
    try {
      const converted = await feishuCall('转换会话内容', () => client.docx.document.convert({ data: { content_type: 'markdown', content: document.markdown } }))
      const blocks = (converted.data?.blocks ?? []) as FeishuBlock[]
      const firstLevelIds = converted.data?.first_level_block_ids ?? []
      if (converted.code !== 0 || !blocks.length || !firstLevelIds.length) throw feishuError('转换会话内容', converted)

      let index = 0
      for (const batch of batchesForDescendantInsert(blocks, firstLevelIds)) {
        const inserted = await feishuCall('写入会话内容', () => client.docx.documentBlockDescendant.create({
          path: { document_id: documentId, block_id: documentId },
          params: { document_revision_id: -1 },
          data: { children_id: batch.ids, descendants: batch.blocks.map(cleanBlock) as never[], index },
        }))
        if (inserted.code !== 0) throw feishuError('写入会话内容', inserted)
        index += batch.ids.length
      }

      const permission = await feishuCall('设置飞书文档访问权限', () => client.drive.v2.permissionPublic.patch({
        path: { token: documentId },
        params: { type: 'docx' },
        data: {
          external_access_entity: 'closed',
          link_share_entity: 'tenant_readable',
          share_entity: 'same_tenant',
        },
      }))
      if (permission.code !== 0) throw feishuError('设置飞书文档访问权限', permission)
    } catch (error) {
      await discardIncompleteDocument(client, documentId)
      throw error
    }

    const host = account.domain === 'lark' ? 'https://www.larksuite.com' : 'https://feishu.cn'
    return { documentId, url: `${host}/docx/${encodeURIComponent(documentId)}` }
  }
}

function eventText(event: CodexEvent): string {
  return typeof event.data.text === 'string' ? event.data.text.trim() : ''
}

export function conversationShareEntries(events: readonly CodexEvent[]): ConversationShareEntry[] {
  const threadId = events.find(event => event.threadId)?.threadId ?? ''
  const state = reduceConversationEvents(createConversationState(threadId), events)
  return conversationFeedFromState(state).flatMap(entry => {
    if (entry.kind !== 'message') return []
    if (entry.message.role !== 'user' && entry.message.role !== 'assistant') return []
    const text = entry.message.text.trim()
    if (!text) return []
    const interrupted = entry.message.role === 'assistant'
      && Boolean(entry.message.turnId)
      && state.turns[entry.message.turnId!]?.lifecycle === 'interrupted'
      && !events.some(event => event.type === 'assistant.completed' && event.turnId === entry.message.turnId && eventText(event) === text)
    return [{ role: entry.message.role, text, interrupted }]
  })
}

function safeTitlePart(value: string): string {
  return value.replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function formatExportTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

export function buildConversationShareDocument(input: {
  workspaceName: string
  demandName?: string | null
  conversationTitle: string
  events: readonly CodexEvent[]
  exportedAt?: Date
  title?: string
}): ConversationShareDocument {
  const entries = conversationShareEntries(input.events)
  if (!entries.length) throw new Error('当前会话还没有可导出的用户或 AI 文字消息')
  const generatedTitle = `【会话分享】${input.demandName ? `${safeTitlePart(input.demandName)} - ` : ''}${safeTitlePart(input.conversationTitle)}`
  const title = safeTitlePart(input.title || generatedTitle).slice(0, 200)
  if (!title) throw new Error('飞书文档名称不能为空')
  const metadata = [
    `- **Workspace：** ${safeTitlePart(input.workspaceName)}`,
    ...(input.demandName ? [`- **需求：** ${safeTitlePart(input.demandName)}`] : []),
    `- **会话：** ${safeTitlePart(input.conversationTitle)}`,
    `- **导出时间：** ${formatExportTime(input.exportedAt ?? new Date())}`,
    '- **内容范围：** 仅用户文字输入与 AI 文字输出',
  ]
  const messages = entries.flatMap(entry => [
    '---',
    `## ${entry.role === 'user' ? '你' : entry.interrupted ? 'CodyWork AI（回复已中断）' : 'CodyWork AI'}`,
    '',
    entry.text,
    '',
  ])
  return { title, messageCount: entries.length, markdown: [...metadata, '', ...messages].join('\n').trim() }
}

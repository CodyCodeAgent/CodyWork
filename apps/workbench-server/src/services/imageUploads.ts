import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_COMPOSER_IMAGE_POLICY, validateComposerImage } from '@codycodeagent/cody-web-core/composer'
import { WorkbenchDb, nowIso } from '../db/index.js'

export type UploadedConversationImage = {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
}

type StoredConversationImage = {
  id: string
  workspace_id: string
  conversation_id: string
  name: string
  mime_type: string
  byte_length: number
  file_path: string
  created_at: string
}

const MAX_DATA_URL_BYTES = Math.ceil(DEFAULT_COMPOSER_IMAGE_POLICY.maxBytes * 4 / 3) + 1024
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  return `.${mimeType.slice('image/'.length)}`
}

function safeImageName(name: string, mimeType: string): string {
  const compact = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').slice(0, 160)
  return compact || `image${extensionFor(mimeType)}`
}

function parseDataUrl(dataUrl: string, name: string): { bytes: Buffer; mimeType: string; name: string } {
  if (dataUrl.length > MAX_DATA_URL_BYTES) throw new Error('图片不能超过 20MB')
  const match = IMAGE_DATA_URL.exec(dataUrl)
  if (!match) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片')
  const mimeType = match[1]!
  const encoded = match[2]!
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error('图片数据无效')
  const validation = validateComposerImage({ name, type: mimeType, size: bytes.length })
  if (!validation.accepted) throw new Error(validation.reason === 'too_large' ? '图片不能超过 20MB' : '仅支持 PNG、JPEG、WebP 或 GIF 图片')
  return { bytes, mimeType, name: safeImageName(name, mimeType) }
}

/**
 * Durable metadata + private on-disk bytes for Composer images. URLs only
 * expose opaque ids; the absolute Codex path never reaches the browser.
 */
export class ConversationImageUploads {
  private readonly root: string

  constructor(private readonly db: WorkbenchDb, storageRoot?: string) {
    this.root = storageRoot ?? join(dirname(db.path === ':memory:' ? join(process.cwd(), '.runtime', 'workspace.db') : db.path), 'uploads')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }

  upload(workspaceId: string, conversationId: string, input: { name: string; dataUrl: string }): UploadedConversationImage {
    const parsed = parseDataUrl(input.dataUrl, input.name)
    const id = `image_${randomUUID()}`
    const filePath = join(this.root, `${id}${extensionFor(parsed.mimeType)}`)
    writeFileSync(filePath, parsed.bytes, { mode: 0o600, flag: 'wx' })
    try {
      this.db.db.prepare('INSERT INTO conversation_images (id, workspace_id, conversation_id, name, mime_type, byte_length, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, workspaceId, conversationId, parsed.name, parsed.mimeType, parsed.bytes.length, filePath, nowIso())
    } catch (error) {
      rmSync(filePath, { force: true })
      throw error
    }
    return this.publicImage({ id, workspace_id: workspaceId, conversation_id: conversationId, name: parsed.name, mime_type: parsed.mimeType, byte_length: parsed.bytes.length, file_path: filePath, created_at: nowIso() })
  }

  resolveForTurn(workspaceId: string, conversationId: string, ids: readonly string[]): Array<{ id: string; path: string; url: string }> {
    const uniqueIds = [...new Set(ids.map(id => id.trim()).filter(Boolean))]
    if (uniqueIds.length > DEFAULT_COMPOSER_IMAGE_POLICY.maxCount) throw new Error(`每条消息最多附加 ${DEFAULT_COMPOSER_IMAGE_POLICY.maxCount} 张图片`)
    return uniqueIds.map(id => {
      const row = this.find(workspaceId, conversationId, id)
      if (!row || !existsSync(row.file_path)) throw new Error('图片不存在、已过期或不属于当前会话')
      return { id: row.id, path: row.file_path, url: this.url(row.workspace_id, row.conversation_id, row.id) }
    })
  }

  read(workspaceId: string, conversationId: string, imageId: string): { bytes: Buffer; mimeType: string; name: string } {
    const row = this.find(workspaceId, conversationId, imageId)
    if (!row || !existsSync(row.file_path)) throw new Error('图片不存在或已过期')
    const stat = statSync(row.file_path)
    if (!stat.isFile() || stat.size !== row.byte_length) throw new Error('图片文件不可用')
    return { bytes: readFileSync(row.file_path), mimeType: row.mime_type, name: row.name }
  }

  urlForPath(workspaceId: string, conversationId: string, path: string): string | null {
    const row = this.db.db.prepare('SELECT * FROM conversation_images WHERE workspace_id = ? AND conversation_id = ? AND file_path = ?').get(workspaceId, conversationId, path) as StoredConversationImage | undefined
    return row ? this.url(workspaceId, conversationId, row.id) : null
  }

  removeConversation(workspaceId: string, conversationId: string): void {
    const rows = this.db.db.prepare('SELECT * FROM conversation_images WHERE workspace_id = ? AND conversation_id = ?').all(workspaceId, conversationId) as unknown as StoredConversationImage[]
    for (const row of rows) rmSync(row.file_path, { force: true })
    this.db.db.prepare('DELETE FROM conversation_images WHERE workspace_id = ? AND conversation_id = ?').run(workspaceId, conversationId)
  }

  private find(workspaceId: string, conversationId: string, id: string): StoredConversationImage | undefined {
    return this.db.db.prepare('SELECT * FROM conversation_images WHERE id = ? AND workspace_id = ? AND conversation_id = ?').get(id, workspaceId, conversationId) as StoredConversationImage | undefined
  }

  private url(workspaceId: string, conversationId: string, imageId: string): string {
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/images/${encodeURIComponent(imageId)}`
  }

  private publicImage(row: StoredConversationImage): UploadedConversationImage {
    return { id: row.id, name: row.name, mimeType: row.mime_type, size: row.byte_length, url: this.url(row.workspace_id, row.conversation_id, row.id) }
  }
}

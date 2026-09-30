import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { accessSync, closeSync, constants, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AiReportReceiptRow, WorkbenchDb } from '../db/index.js'
import { nowIso } from '../db/index.js'
import type { WorkspaceRow } from '../db/index.js'
import { getDemand } from './demands.js'

const execFileAsync = promisify(execFile)
// The reporter's Codex integration emits only these three lifecycle events.
// Requiring generic Codex hooks here would present a healthy installation as
// incomplete even though those extra events cannot produce report receipts.
const REQUIRED_CODEX_HOOKS = ['PostToolUse', 'Stop', 'SubagentStop'] as const
const MAX_LOG_BYTES_PER_SCAN = 128 * 1024 * 1024
const MAX_QUEUE_RECORDS_PER_DIRECTORY = 10_000
const MAX_RECENT_RECEIPTS = 120

type JsonRecord = Record<string, unknown>

export type AiReportCapabilityState = 'not_installed' | 'partial' | 'ready' | 'unavailable'
export type AiReportState = 'not_installed' | 'empty' | 'healthy' | 'pending' | 'retrying' | 'degraded'

export interface AiReportCapability {
  state: AiReportCapabilityState
  hooks: string[]
  missingHooks: string[]
  exportAvailable: boolean
  retryAvailable: boolean
  message: string
}

export interface AiReportConversationSummary {
  conversationId: string
  nativeSessionId: string
  title: string
  acceptedEvents: number
  acceptedCodeEvents: number
  additions: number
  deletions: number
  lastSuccessAt: string | null
}

export interface AiReportReceiptView {
  deliveryId: string
  conversationId: string
  conversationTitle: string
  eventType: string
  toolName: string
  model: string
  filePath: string
  status: string
  additions: number
  deletions: number
  eventTime: string
  receivedAt: string
}

export interface AiReportDemandSummary {
  state: AiReportState
  capability: AiReportCapability
  acceptedEvents: number
  acceptedCodeEvents: number
  additions: number
  deletions: number
  netLines: number
  effectiveLines: number | null
  effectiveLinesNote: string
  pending: number
  retrying: number
  lastSuccessAt: string | null
  conversations: AiReportConversationSummary[]
  recent: AiReportReceiptView[]
  refreshedAt: string
  warning: string
}

export interface AiReportManualResult {
  action: 'backfill' | 'retry'
  processed: number
  message: string
  output: string
}

interface AiReportServiceOptions {
  home?: string
  codexHome?: string
  reportHome?: string
  exportBin?: string
  outboxBin?: string
}

interface DemandConversationRow {
  id: string
  native_id: string
  title: string
}

interface DemandRepositoryRow {
  id: string
  name: string
  worktree_path: string
  base_commit: string
}

interface ReporterQueueRecord {
  session_id?: unknown
  params?: { session_id?: unknown }
  payload?: { session_id?: unknown; params?: { session_id?: unknown } }
  report?: { session_id?: unknown; params?: { session_id?: unknown } }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function lineHash(line: string): string {
  return createHash('sha256').update(line).digest('hex')
}

export function patchLineStats(patch: string): { additions: number; deletions: number; addedLineHashes: string[] } {
  let additions = 0
  let deletions = 0
  const addedLineHashes: string[] = []
  for (const rawLine of patch.split(/\r?\n/u)) {
    if (rawLine.startsWith('+++ ') || rawLine.startsWith('--- ')) continue
    if (rawLine.startsWith('+')) {
      additions += 1
      const line = rawLine.slice(1)
      if (line.trim()) addedLineHashes.push(lineHash(line))
    } else if (rawLine.startsWith('-')) {
      deletions += 1
    }
  }
  return { additions, deletions, addedLineHashes }
}

function findExecutable(command: string | undefined): string | null {
  const explicit = command?.trim()
  if (!explicit) return null
  if (isAbsolute(explicit) || explicit.includes(sep)) {
    try { accessSync(explicit, constants.X_OK); return explicit } catch { return null }
  }
  const pathValue = process.env.PATH ?? ''
  for (const directory of pathValue.split(':').filter(Boolean)) {
    const candidate = join(directory, explicit)
    try { accessSync(candidate, constants.X_OK); return candidate } catch { /* keep searching */ }
  }
  return null
}

function hookCommands(config: unknown): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const hooks = asObject(asObject(config)?.hooks)
  if (!hooks) return result
  for (const [name, registrations] of Object.entries(hooks)) {
    if (!Array.isArray(registrations)) continue
    const commands: string[] = []
    for (const registration of registrations) {
      const nested = asObject(registration)?.hooks
      if (!Array.isArray(nested)) continue
      for (const hook of nested) {
        const command = asString(asObject(hook)?.command)
        if (command) commands.push(command)
      }
    }
    result.set(name, commands)
  }
  return result
}

function isAiReportCommand(command: string): boolean {
  return /(?:ai-code-report|ai-report-hook|ai_report_hook)/iu.test(command)
}

function relativeDisplayPath(filePath: string): string {
  if (!filePath || filePath === '(unknown)') return ''
  if (!isAbsolute(filePath)) return filePath
  const pieces = filePath.split(sep).filter(Boolean)
  return pieces.slice(Math.max(0, pieces.length - 4)).join('/')
}

function parseReporterLogLine(line: string): JsonRecord | null {
  const separator = line.indexOf(' | {')
  const raw = separator >= 0 ? line.slice(separator + 3) : line.trim()
  if (!raw.startsWith('{')) return null
  try { return asObject(JSON.parse(raw)) } catch { return null }
}

function sessionIdFromQueueRecord(record: ReporterQueueRecord): string {
  return asString(record.session_id)
    || asString(record.params?.session_id)
    || asString(record.payload?.session_id)
    || asString(record.payload?.params?.session_id)
    || asString(record.report?.session_id)
    || asString(record.report?.params?.session_id)
}

function increment(map: Map<string, number>, key: string, count = 1): void {
  map.set(key, (map.get(key) ?? 0) + count)
}

function countIntersection(left: Map<string, number>, right: Map<string, number>): number {
  let total = 0
  for (const [key, count] of left) total += Math.min(count, right.get(key) ?? 0)
  return total
}

function parseGitDiffAddedLines(diff: string): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  let file = ''
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('+++ ')) {
      const marker = line.slice(4).trim()
      file = marker === '/dev/null' ? '' : marker.replace(/^b\//u, '')
      continue
    }
    if (!file || !line.startsWith('+')) continue
    const value = line.slice(1)
    if (!value.trim()) continue
    const lines = result.get(file) ?? new Map<string, number>()
    increment(lines, lineHash(value))
    result.set(file, lines)
  }
  return result
}

function normalizeRepoRelativePath(filePath: string, repository: DemandRepositoryRow, diffFiles: Set<string>): string | null {
  if (!filePath || filePath === '(unknown)') return null
  const normalized = filePath.replaceAll('\\', '/')
  if (isAbsolute(filePath)) {
    const candidate = relative(repository.worktree_path, filePath).replaceAll('\\', '/')
    return candidate && !candidate.startsWith('../') && candidate !== '..' ? candidate : null
  }
  const candidates = [normalized, normalized.replace(/^\.\//u, ''), normalized.replace(new RegExp(`^${repository.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/`, 'u'), '')]
  for (const candidate of candidates) if (diffFiles.has(candidate) || existsSync(join(repository.worktree_path, candidate))) return candidate
  return null
}

export class AiCodeReportService {
  readonly home: string
  readonly codexHome: string
  readonly reportHome: string
  private readonly exportBinOverride?: string
  private readonly outboxBinOverride?: string
  private manualAction: Promise<AiReportManualResult> | null = null

  constructor(private readonly database: WorkbenchDb, options: AiReportServiceOptions = {}) {
    this.home = options.home ?? process.env.CODYWORK_AI_REPORT_USER_HOME?.trim() ?? homedir()
    this.codexHome = options.codexHome ?? process.env.CODYWORK_CODEX_HOME?.trim() ?? join(this.home, '.codex')
    this.reportHome = options.reportHome ?? process.env.CODYWORK_AI_REPORT_HOME?.trim() ?? join(this.home, '.ai-code-report')
    this.exportBinOverride = options.exportBin ?? process.env.CODYWORK_AI_REPORT_EXPORT_BIN?.trim()
    this.outboxBinOverride = options.outboxBin ?? process.env.CODYWORK_AI_REPORT_OUTBOX_BIN?.trim()
  }

  capability(): AiReportCapability {
    const configPath = join(this.codexHome, 'hooks.json')
    let commands = new Map<string, string[]>()
    try { commands = hookCommands(JSON.parse(readFileSync(configPath, 'utf8'))) } catch { /* optional capability */ }
    const hooks = REQUIRED_CODEX_HOOKS.filter(name => (commands.get(name) ?? []).some(isAiReportCommand))
    const missingHooks = REQUIRED_CODEX_HOOKS.filter(name => !hooks.includes(name))
    const exportAvailable = Boolean(this.exportBin())
    const retryAvailable = Boolean(this.outboxBin())
    if (hooks.length === 0) {
      return { state: 'not_installed', hooks: [], missingHooks: [...REQUIRED_CODEX_HOOKS], exportAvailable, retryAvailable, message: '当前机器没有启用 AI 代码上报 Hook；不影响 CodyWork 使用。' }
    }
    if (missingHooks.length > 0) {
      return { state: 'partial', hooks, missingHooks, exportAvailable, retryAvailable, message: `上报 Hook 不完整，缺少 ${missingHooks.join('、')}；部分命令行修改可能无法采集。` }
    }
    if (!exportAvailable) {
      return { state: 'unavailable', hooks, missingHooks: [], exportAvailable, retryAvailable, message: '上报 Hook 已配置，但本机缺少手动补报命令。自动上报不受影响。' }
    }
    return { state: 'ready', hooks, missingHooks: [], exportAvailable, retryAvailable, message: '完整 Hook 已启用；CodyWork 只读取本地回执和派生统计。' }
  }

  summary(workspace: WorkspaceRow, demandId: string): AiReportDemandSummary {
    getDemand(this.database, workspace, demandId)
    const capability = this.capability()
    let warning = ''
    try { this.ingestReceipts() } catch (error) { warning = error instanceof Error ? error.message : String(error) }
    const conversations = this.demandConversations(workspace.id, demandId)
    const nativeIds = new Set(conversations.map(item => item.native_id))
    const receiptRows = nativeIds.size === 0 ? [] : this.receiptsForSessions([...nativeIds])
    const successful = receiptRows.filter(row => row.report_status === 'ok' && row.event_type !== 'dev_agent_trace')
    const codeRows = successful.filter(row => row.event_type === 'dev_agent_tool_call' && row.additions + row.deletions > 0)
    const queue = this.queueCounts(nativeIds)
    const conversationByNativeId = new Map(conversations.map(item => [item.native_id, item]))
    const byConversation = conversations.map(conversation => {
      const rows = successful.filter(row => row.native_session_id === conversation.native_id)
      const code = rows.filter(row => row.event_type === 'dev_agent_tool_call' && row.additions + row.deletions > 0)
      return {
        conversationId: conversation.id,
        nativeSessionId: conversation.native_id,
        title: conversation.title,
        acceptedEvents: rows.length,
        acceptedCodeEvents: code.length,
        additions: code.reduce((sum, row) => sum + row.additions, 0),
        deletions: code.reduce((sum, row) => sum + row.deletions, 0),
        lastSuccessAt: rows.map(row => row.received_at).sort().at(-1) ?? null,
      }
    }).sort((left, right) => (right.lastSuccessAt ?? '').localeCompare(left.lastSuccessAt ?? ''))
    const additions = codeRows.reduce((sum, row) => sum + row.additions, 0)
    const deletions = codeRows.reduce((sum, row) => sum + row.deletions, 0)
    const effective = this.effectiveLines(demandId, codeRows)
    const recent = successful.slice(0, MAX_RECENT_RECEIPTS).map(row => {
      const conversation = conversationByNativeId.get(row.native_session_id)
      return {
        deliveryId: row.delivery_id,
        conversationId: conversation?.id ?? '',
        conversationTitle: conversation?.title ?? row.native_session_id,
        eventType: row.event_type,
        toolName: row.tool_name,
        model: row.model,
        filePath: relativeDisplayPath(row.file_path),
        status: row.report_status,
        additions: row.additions,
        deletions: row.deletions,
        eventTime: row.event_time,
        receivedAt: row.received_at,
      }
    })
    let state: AiReportState = successful.length > 0 ? 'healthy' : 'empty'
    if (capability.state === 'not_installed') state = 'not_installed'
    else if (queue.retrying > 0) state = 'retrying'
    else if (queue.pending > 0) state = 'pending'
    else if (capability.state !== 'ready') state = 'degraded'
    return {
      state,
      capability,
      acceptedEvents: successful.length,
      acceptedCodeEvents: codeRows.length,
      additions,
      deletions,
      netLines: additions - deletions,
      effectiveLines: effective.lines,
      effectiveLinesNote: effective.note,
      pending: queue.pending,
      retrying: queue.retrying,
      lastSuccessAt: successful.map(row => row.received_at).sort().at(-1) ?? null,
      conversations: byConversation,
      recent,
      refreshedAt: nowIso(),
      warning,
    }
  }

  async backfill(workspace: WorkspaceRow, demandId: string): Promise<AiReportManualResult> {
    getDemand(this.database, workspace, demandId)
    const executable = this.exportBin()
    if (!executable) throw new Error('当前机器未安装 ai-report-export，无法手动补报。')
    if (this.manualAction) throw new Error('已有代码上报操作正在执行，请稍后再试。')
    const conversations = this.demandConversations(workspace.id, demandId)
    const task = this.runBackfill(executable, conversations)
    this.manualAction = task
    try { return await task } finally { this.manualAction = null }
  }

  async retry(): Promise<AiReportManualResult> {
    const outbox = this.outboxBin()
    if (!outbox) throw new Error('当前机器缺少 ai-report-outbox，无法重试。')
    if (this.manualAction) throw new Error('已有代码上报操作正在执行，请稍后再试。')
    const task = this.runRetry(outbox)
    this.manualAction = task
    try { return await task } finally { this.manualAction = null }
  }

  private demandConversations(workspaceId: string, demandId: string): DemandConversationRow[] {
    return this.database.db.prepare("SELECT id, native_id, title FROM conversations WHERE workspace_id = ? AND demand_id = ? AND scope = 'demand' ORDER BY created_at")
      .all(workspaceId, demandId) as unknown as DemandConversationRow[]
  }

  private receiptsForSessions(sessionIds: string[]): AiReportReceiptRow[] {
    const placeholders = sessionIds.map(() => '?').join(',')
    return this.database.db.prepare(`SELECT * FROM ai_report_receipts WHERE native_session_id IN (${placeholders}) ORDER BY received_at DESC, event_time DESC`)
      .all(...sessionIds) as unknown as AiReportReceiptRow[]
  }

  private ingestReceipts(): void {
    if (!existsSync(this.reportHome)) return
    const files = readdirSync(this.reportHome).filter(name => /^tea-reporter-events-\d{4}-\d{2}-\d{2}\.log$/u.test(name)).sort()
    for (const name of files) this.ingestLogFile(join(this.reportHome, name))
  }

  private ingestLogFile(path: string): void {
    const stat = statSync(path)
    const inode = String(stat.ino)
    const cursor = this.database.db.prepare('SELECT inode, byte_offset FROM ai_report_log_cursors WHERE path = ?').get(path) as { inode: string; byte_offset: number } | undefined
    let offset = cursor?.inode === inode && cursor.byte_offset <= stat.size ? cursor.byte_offset : 0
    if (offset === stat.size) return
    const bytesToRead = Math.min(stat.size - offset, MAX_LOG_BYTES_PER_SCAN)
    const buffer = Buffer.allocUnsafe(bytesToRead)
    const file = openSync(path, 'r')
    let read = 0
    try { read = readSync(file, buffer, 0, bytesToRead, offset) } finally { closeSync(file) }
    let chunk = buffer.subarray(0, read).toString('utf8')
    const lastNewline = chunk.lastIndexOf('\n')
    if (lastNewline < 0) return
    chunk = chunk.slice(0, lastNewline + 1)
    const consumed = Buffer.byteLength(chunk)
    this.database.db.exec('BEGIN IMMEDIATE')
    try {
      for (const line of chunk.split('\n')) {
        const payload = parseReporterLogLine(line)
        if (payload?.phase === 'report_result') this.upsertReceipt(payload)
      }
      this.database.db.prepare(`INSERT INTO ai_report_log_cursors (path, inode, byte_offset, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET inode = excluded.inode, byte_offset = excluded.byte_offset, updated_at = excluded.updated_at`)
        .run(path, inode, offset + consumed, nowIso())
      this.database.db.exec('COMMIT')
    } catch (error) {
      this.database.db.exec('ROLLBACK')
      throw error
    }
  }

  private upsertReceipt(payload: JsonRecord): void {
    if (asString(payload.event) === 'dev_agent_trace') return
    const deliveryId = asString(payload.delivery_id) || asString(payload.uuid)
    const nativeSessionId = asString(payload.session_id) || asString(payload.conversation_id)
    if (!deliveryId || !nativeSessionId) return
    const patch = asString(payload.patch)
    const stats = patchLineStats(patch)
    const receivedAt = asString(payload.ts) || asString(payload.ts_local) || nowIso()
    const eventTime = asString(payload.event_time) || asString(payload.timestamp) || receivedAt
    this.database.db.prepare(`INSERT INTO ai_report_receipts (
      delivery_id, native_session_id, event_type, tool_name, source, model, user_id, file_path,
      report_status, capture_status, capture_reason, additions, deletions, added_line_hashes_json,
      event_time, received_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(delivery_id) DO UPDATE SET
      native_session_id = excluded.native_session_id, event_type = excluded.event_type,
      tool_name = excluded.tool_name, source = excluded.source, model = excluded.model,
      user_id = excluded.user_id, file_path = excluded.file_path, report_status = excluded.report_status,
      capture_status = excluded.capture_status, capture_reason = excluded.capture_reason,
      additions = excluded.additions, deletions = excluded.deletions,
      added_line_hashes_json = excluded.added_line_hashes_json, event_time = excluded.event_time,
      received_at = excluded.received_at, updated_at = excluded.updated_at`)
      .run(
        deliveryId, nativeSessionId, asString(payload.event), asString(payload.name), asString(payload.source),
        asString(payload.model) || asString(payload.model_name), asString(payload.user_unique_id) || asString(payload.user),
        asString(payload.file_path), asString(payload.report_status), asString(payload.capture_status), asString(payload.capture_reason),
        stats.additions, stats.deletions, JSON.stringify(stats.addedLineHashes), eventTime, receivedAt, nowIso(),
      )
  }

  private queueCounts(sessionIds: Set<string>): { pending: number; retrying: number } {
    return {
      pending: this.countQueueDirectory(join(this.reportHome, 'pending'), sessionIds),
      retrying: this.countQueueDirectory(join(this.reportHome, 'outbox'), sessionIds),
    }
  }

  private countQueueDirectory(directory: string, sessionIds: Set<string>): number {
    if (!existsSync(directory) || sessionIds.size === 0) return 0
    let count = 0
    for (const name of readdirSync(directory).slice(0, MAX_QUEUE_RECORDS_PER_DIRECTORY)) {
      const path = join(directory, name)
      try {
        const stat = statSync(path)
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue
        const record = JSON.parse(readFileSync(path, 'utf8')) as ReporterQueueRecord
        if (sessionIds.has(sessionIdFromQueueRecord(record))) count += 1
      } catch { /* one corrupt queue entry must not break CodyWork */ }
    }
    return count
  }

  private effectiveLines(demandId: string, receipts: AiReportReceiptRow[]): { lines: number | null; note: string } {
    if (receipts.length === 0) return { lines: 0, note: '当前没有已接收的代码 patch。' }
    const repositories = this.database.db.prepare(`SELECT repositories.id, repositories.name, demand_repositories.worktree_path, demand_repositories.base_commit
      FROM demand_repositories JOIN repositories ON repositories.id = demand_repositories.repository_id
      WHERE demand_repositories.demand_id = ? ORDER BY repositories.name`)
      .all(demandId) as unknown as DemandRepositoryRow[]
    if (repositories.length === 0) return { lines: null, note: '需求没有可用于核对的 Git Worktree。' }
    const states: Array<{ repository: DemandRepositoryRow; current: Map<string, Map<string, number>>; diffFiles: Set<string> }> = []
    for (const repository of repositories) {
      try {
        const { stdout } = execFileSyncSafe('git', ['-C', repository.worktree_path, 'diff', '--unified=0', '--no-color', '--find-renames', repository.base_commit, '--', '.'])
        const current = parseGitDiffAddedLines(stdout)
        states.push({ repository, current, diffFiles: new Set(current.keys()) })
      } catch { /* report a partial calculation below */ }
    }
    if (states.length === 0) return { lines: null, note: '无法读取 Worktree Git diff，暂不能计算当前有效行数。' }
    const reportedByRepository = new Map<string, Map<string, Map<string, number>>>()
    for (const receipt of receipts) {
      const candidates = states.flatMap(state => {
        const relativePath = normalizeRepoRelativePath(receipt.file_path, state.repository, state.diffFiles)
        return relativePath ? [{ state, relativePath }] : []
      })
      const changedCandidates = candidates.filter(candidate => candidate.state.diffFiles.has(candidate.relativePath))
      const candidate = changedCandidates.length === 1 ? changedCandidates[0] : candidates.length === 1 ? candidates[0] : null
      if (!candidate) continue
      let hashes: unknown
      try { hashes = JSON.parse(receipt.added_line_hashes_json) } catch { hashes = [] }
      if (!Array.isArray(hashes)) continue
      const repositoryFiles = reportedByRepository.get(candidate.state.repository.id) ?? new Map<string, Map<string, number>>()
      const aggregate = repositoryFiles.get(candidate.relativePath) ?? new Map<string, number>()
      for (const hash of hashes) if (typeof hash === 'string') increment(aggregate, hash)
      repositoryFiles.set(candidate.relativePath, aggregate)
      reportedByRepository.set(candidate.state.repository.id, repositoryFiles)
    }
    let total = 0
    for (const state of states) {
      const files = reportedByRepository.get(state.repository.id) ?? new Map()
      for (const [file, reported] of files) total += countIntersection(reported, state.current.get(file) ?? new Map())
    }
    const qualifier = states.length < repositories.length ? `；${repositories.length - states.length} 个 Repo 暂时无法核对` : ''
    return { lines: total, note: `按 TEA 已接收 patch 与需求基线 diff 的非空行交集计算${qualifier}。` }
  }

  private exportBin(): string | null {
    return findExecutable(this.exportBinOverride || 'ai-report-export')
  }

  private outboxBin(): string | null {
    return findExecutable(this.outboxBinOverride || 'ai-report-outbox')
  }

  private async runBackfill(executable: string, conversations: DemandConversationRow[]): Promise<AiReportManualResult> {
    const sessionRoot = join(this.codexHome, 'sessions')
    const transcriptBySession = this.findTranscripts(sessionRoot, new Set(conversations.map(item => item.native_id)))
    if (transcriptBySession.size === 0) return { action: 'backfill', processed: 0, message: '没有找到当前需求会话对应的本地 Codex Transcript。', output: '' }
    const outputs: string[] = []
    let processed = 0
    for (const conversation of conversations) {
      const transcript = transcriptBySession.get(conversation.native_id)
      if (!transcript) continue
      const result = await execFileAsync(executable, ['codex', '--path', transcript], {
        env: { ...process.env, TEA_APP_ID: process.env.TEA_APP_ID || '1013111', TEA_CHANNEL: process.env.TEA_CHANNEL || 'cn' },
        timeout: 5 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      })
      processed += 1
      outputs.push(`${conversation.title}: ${(result.stdout || result.stderr || '').trim()}`)
    }
    return { action: 'backfill', processed, message: `已补扫 ${processed} 个会话；TEA 接收回执会异步更新。`, output: outputs.join('\n').slice(-12_000) }
  }

  private async runRetry(outbox: string): Promise<AiReportManualResult> {
    const outboxResult = await execFileAsync(outbox, ['resend'], { timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 })
    const output = [outboxResult.stdout, outboxResult.stderr].filter(Boolean).join('\n').trim()
    return { action: 'retry', processed: 1, message: '已触发本机 outbox 重试；回执会异步更新。', output: output.slice(-12_000) }
  }

  private findTranscripts(directory: string, sessionIds: Set<string>): Map<string, string> {
    const result = new Map<string, string>()
    if (!existsSync(directory) || sessionIds.size === 0) return result
    const visit = (current: string): void => {
      if (result.size === sessionIds.size) return
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (entry.isFile() && /^rollout-.*\.jsonl$/u.test(entry.name)) {
          for (const id of sessionIds) if (!result.has(id) && entry.name.includes(id)) result.set(id, path)
        }
      }
    }
    visit(directory)
    return result
  }
}

function execFileSyncSafe(command: string, args: string[]): { stdout: string } {
  return { stdout: execFileSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }) }
}

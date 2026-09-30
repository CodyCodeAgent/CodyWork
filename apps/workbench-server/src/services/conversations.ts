import { composerHasContent } from '@codycodeagent/cody-web-core/composer'
import { RuntimeRegistry } from '@codycodeagent/cody-web-core/runtime'
import {
  ConversationEventJournalCoordinator,
  conversationHandoffTranscript,
  createConversationHandoffReplay,
  type ConversationEventJournalStore,
} from '@codycodeagent/cody-web-core/conversation'
import { WorkbenchDb, ConversationCreatedVia, ConversationPermissionMode, ConversationRow, ConversationRuntimeType, nowIso, makeId } from '../db/index.js'
import type {
  ConversationHandle,
  CodyWorkRuntime,
  CodyWorkRuntimeCapabilities,
  NativeThreadSummary,
  RuntimeEvent,
  RuntimeComposerOptions,
  RuntimeConversationSnapshot,
  RuntimeDescriptorView,
  RuntimeSubmitMode,
} from '../runtime/protocol.js'
import type { CodyWorkRuntimeRegistry } from '../runtime/registry.js'
import { ConversationEventHub } from './conversationEventHub.js'
import { ConversationContextResolver } from './conversationContext.js'
import { ConversationRepository } from './conversationRepository.js'
import type { TraeConversationCacheInfo } from './conversationRepository.js'
import type {
  ConversationAction,
  ConversationActionResult,
  ConversationCommand,
  ConversationCommandGateway,
  ConversationCommandReceipt,
  ConversationCommandSettings,
} from './conversationGateway.js'

export interface ConversationView {
  id: string
  scope: ConversationRow['scope']
  demandId: string | null
  nativeId: string
  runtimeType: ConversationRuntimeType
  title: string
  createdVia: ConversationCreatedVia
  status: ConversationRow['status']
  permissionMode: ConversationPermissionMode
  policyHash: string
  instructionHash: string
  createdAt: string
  updatedAt: string
}

export interface ConversationEvent extends RuntimeEvent {
  id: string
  type: RuntimeEvent['type']
  conversationId: string
  turnId?: string
  itemId?: string
}

export interface AvailableNativeThread extends NativeThreadSummary {
  bound: boolean
}

export interface TraeCacheView extends Omit<TraeConversationCacheInfo, 'nativeEventsAfter'> {
  kind: 'trae'
  /** Cache events are only CodyWork's replay/display copy, not the native Session. */
  clears: '本地消息与过程回放缓存'
  preserves: 'Trae 原生 Session、Workspace 文件与会话绑定'
}

type Listener = (event: ConversationEvent) => void

type ConversationSendSettings = ConversationCommandSettings

type RuntimeTurnSettings = {
  model?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: 'default' | 'plan'
  skills?: Array<{ name: string; path: string }>
}

function toView(row: ConversationRow): ConversationView {
  return {
    id: row.id,
    scope: row.scope,
    demandId: row.demand_id,
    nativeId: row.native_id,
    runtimeType: row.runtime_type,
    title: row.title,
    createdVia: row.created_via,
    status: row.status,
    permissionMode: row.permission_mode,
    policyHash: row.policy_hash,
    instructionHash: row.instruction_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function persistedStatusForEvent(event: RuntimeEvent): ConversationRow['status'] | null {
  if (event.type === 'command.queued' || event.type === 'command.bound' || event.type === 'turn.started'
    || event.type === 'turn.activity' || event.type === 'turn.retrying') return 'running'
  if (event.type === 'approval.requested' || event.type === 'question.requested') return 'awaiting_approval'
  if (event.type === 'approval.resolved' || event.type === 'question.resolved') return 'running'
  if (event.type === 'turn.completed' || event.type === 'turn.interrupted') return 'completed'
  if (event.type === 'command.failed' || event.type === 'turn.failed') return 'failed'
  if (event.type === 'turn.disconnected') return 'disconnected'
  return null
}

/** Provides durable CodyWork conversation metadata and a reconnectable event stream. */
export class ConversationService implements ConversationCommandGateway {
  private readonly handles = new Map<string, ConversationHandle>()
  private readonly runtimeSubscriptions = new Map<string, () => void>()
  private readonly repository: ConversationRepository
  /** Product storage port used by Core's provider-neutral replay semantics. */
  private readonly traeJournal: ConversationEventJournalCoordinator<RuntimeEvent>
  private readonly contexts: ConversationContextResolver
  private readonly runtimes: CodyWorkRuntimeRegistry
  private readonly defaultRuntimeType: () => ConversationRuntimeType
  private readonly onTurnFinished?: (workspaceId: string) => void
  private readonly imageUrlForPath?: (workspaceId: string, conversationId: string, path: string) => string | null
  private readonly onConversationRemoving?: (workspaceId: string, conversationId: string) => void
  readonly events = new ConversationEventHub()

  constructor(
    db: WorkbenchDb,
    runtimes: CodyWorkRuntimeRegistry | CodyWorkRuntime,
    defaultRuntimeTypeOrOnTurnFinished?: (() => ConversationRuntimeType) | ((workspaceId: string) => void),
    onTurnFinishedOrImageUrl?: ((workspaceId: string) => void) | ((workspaceId: string, conversationId: string, path: string) => string | null),
    imageUrlOrOnConversationRemoving?: ((workspaceId: string, conversationId: string, path: string) => string | null) | ((workspaceId: string, conversationId: string) => void),
    onConversationRemoving?: (workspaceId: string, conversationId: string) => void,
  ) {
    // Keeping the single-runtime form lets the isolated protocol/service
    // fixtures keep asserting Codex behavior. Production always provides the
    // explicit registry, which is the only form that can select Trae.
    const isRegistry = 'list' in runtimes && 'require' in runtimes
    this.runtimes = isRegistry
      ? runtimes
      : new RuntimeRegistry<CodyWorkRuntime, void, CodyWorkRuntimeCapabilities>({
          defaultId: 'codex',
          descriptors: [{ id: 'codex', label: 'Codex', create: () => runtimes }],
        })
    if (isRegistry) {
      this.defaultRuntimeType = (defaultRuntimeTypeOrOnTurnFinished as (() => ConversationRuntimeType) | undefined) ?? (() => this.runtimes.defaultId)
      this.onTurnFinished = onTurnFinishedOrImageUrl as ((workspaceId: string) => void) | undefined
      this.imageUrlForPath = imageUrlOrOnConversationRemoving as ((workspaceId: string, conversationId: string, path: string) => string | null) | undefined
      this.onConversationRemoving = onConversationRemoving
    } else {
      this.defaultRuntimeType = () => 'codex'
      this.onTurnFinished = defaultRuntimeTypeOrOnTurnFinished as ((workspaceId: string) => void) | undefined
      this.imageUrlForPath = onTurnFinishedOrImageUrl as ((workspaceId: string, conversationId: string, path: string) => string | null) | undefined
      this.onConversationRemoving = imageUrlOrOnConversationRemoving as ((workspaceId: string, conversationId: string) => void) | undefined
    }
    this.repository = new ConversationRepository(db)
    const traeJournalStore: ConversationEventJournalStore<RuntimeEvent> = {
      append: (conversationId, event) => this.repository.appendTraeEvent(conversationId, event),
      read: (conversationId) => {
        const info = this.repository.traeCacheInfo(conversationId)
        return {
          events: this.repository.listTraeEvents(conversationId),
          nativeEventsAfterIso: info.nativeEventsAfter,
          compactedAtIso: info.compactedAt,
        }
      },
      replace: (conversationId, journal) => this.repository.replaceTraeEvents(
        conversationId,
        [...journal.events],
        journal.nativeEventsAfterIso,
        journal.compactedAtIso,
      ),
    }
    this.traeJournal = new ConversationEventJournalCoordinator(traeJournalStore)
    this.contexts = new ConversationContextResolver(db)
  }

  getRuntime(type?: ConversationRuntimeType): CodyWorkRuntime { return this.runtimes.create(this.resolveRuntimeType(type), undefined) }

  runtimeDescriptors(): RuntimeDescriptorView[] {
    return this.runtimes.list().map(({ id, label, description, capabilities }) => ({ id, label, ...(description ? { description } : {}), ...(capabilities ? { capabilities } : {}) }))
  }

  /** Resolves an explicit per-operation Runtime while retaining the saved
   * default for legacy callers. Runtime selection must happen before a native
   * Thread or ACP Session is created or bound. */
  private resolveRuntimeType(runtimeType?: ConversationRuntimeType): ConversationRuntimeType {
    const selected = runtimeType ?? this.defaultRuntimeType()
    if (this.runtimes.has(selected)) return selected
    if (runtimeType === undefined) return this.runtimes.defaultId
    throw new Error('请选择已启用的 Runtime')
  }

  /** Closes every registered owner exactly once during service shutdown. */
  async closeRuntimes(): Promise<void> {
    await Promise.all([...new Set(this.runtimes.list().map(descriptor => descriptor.create(undefined)))].map(runtime => runtime.close()))
  }

  private runtimeFor(row: ConversationRow): CodyWorkRuntime { return this.getRuntime(row.runtime_type) }

  diagnostics() { return this.getRuntime().diagnostics?.() ?? null }
  failureReport() { return this.getRuntime().failureReport?.() ?? null }

  async reloadMcpServers(): Promise<void> {
    const runtime = this.getRuntime()
    if (!runtime.reloadMcpServers) throw new Error('当前 Runtime 不支持刷新 MCP Server')
    await runtime.reloadMcpServers()
  }

  accountRateLimits() {
    const runtime = this.getRuntime()
    if (!runtime.readAccountRateLimits) throw new Error('当前 Runtime 不支持读取账户用量')
    return runtime.readAccountRateLimits()
  }

  list(workspaceId: string, demandId: string): ConversationView[] {
    return this.repository.listDemand(workspaceId, demandId).map(toView)
  }

  listWorkspace(workspaceId: string): ConversationView[] {
    this.contexts.workspacePath(workspaceId)
    return this.repository.listWorkspace(workspaceId).map(toView)
  }

  /** Returns recent Codex threads that may be resumed under this Demand's policy. */
  async listAvailableNativeThreads(workspaceId: string, demandId: string, requestedRuntimeType?: ConversationRuntimeType): Promise<AvailableNativeThread[]> {
    const demand = this.requireDemand(workspaceId, demandId)
    const runtimeType = this.resolveRuntimeType(requestedRuntimeType)
    const threads = await this.getRuntime(runtimeType).listNativeThreads({ context: this.contexts.demandContext(demand, 'workspace-write') })
    const bound = new Set(this.repository.listNativeIds(runtimeType))
    return threads.map(thread => ({ ...thread, bound: bound.has(thread.nativeId) }))
  }

  get(workspaceId: string, conversationId: string): ConversationView {
    const row = this.repository.get(workspaceId, conversationId)
    if (!row) throw new Error('会话不存在')
    return toView(row)
  }

  async history(workspaceId: string, conversationId: string): Promise<RuntimeConversationSnapshot> {
    const snapshot = await this.historyCanonical(workspaceId, conversationId)
    return { ...snapshot, events: snapshot.events.map(event => this.withPublicImageUrls(event)) }
  }

  /** Canonical native-path snapshot for server-side projections. */
  async historyCanonical(workspaceId: string, conversationId: string): Promise<RuntimeConversationSnapshot> {
    let row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    // A non-persistent provider can replace a missing native session during
    // ensureHandle. Read the durable binding again before asking it for a
    // snapshot so the just-created session is the one being queried.
    row = this.requireConversation(workspaceId, conversationId)
    const context = this.contexts.forRow(row)
    const snapshot = await this.runtimeFor(row).readConversationSnapshot({ conversationId, nativeId: row.native_id, context })
    if (row.runtime_type !== 'trae') return snapshot
    const merged = await this.traeJournal.snapshot(conversationId, snapshot)
    return { ...merged, events: [...merged.events] }
  }

  traeCache(workspaceId: string, conversationId: string): TraeCacheView | null {
    const row = this.requireConversation(workspaceId, conversationId)
    if (row.runtime_type !== 'trae') return null
    const { nativeEventsAfter: _nativeEventsAfter, ...cache } = this.repository.traeCacheInfo(conversationId)
    return { ...cache, kind: 'trae', clears: '本地消息与过程回放缓存', preserves: 'Trae 原生 Session、Workspace 文件与会话绑定' }
  }

  /** Replaces verbose local replay data with a native-Session handoff. The
   * handoff is a normal Trae turn so the provider itself receives the context;
   * only after it completes do we compact the local display cache. */
  async compactTraeCache(workspaceId: string, conversationId: string, confirmed: boolean): Promise<TraeCacheView> {
    if (!confirmed) throw new Error('压缩 Trae 缓存需要明确确认')
    const row = this.requireConversation(workspaceId, conversationId)
    if (row.runtime_type !== 'trae') throw new Error('只有 Trae 会话使用本地回放缓存')
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    const session = this.runtimeFor(row).sessionSnapshot?.(handle)
    if (session?.activeTurnId || session?.pendingRequestCount) throw new Error('会话正在执行或等待确认，请在完成后再压缩缓存')
    const before = this.repository.traeCacheInfo(conversationId)
    const history = await this.historyCanonical(workspaceId, conversationId)
    const handoffPrompt = buildTraeCacheHandoff(conversationHandoffTranscript(history.events))
    const runtime = this.runtimeFor(row)
    const result = await runtime.sendTurn({
      conversation: handle,
      prompt: handoffPrompt,
      mode: 'queue',
      executionProfile: { permissionMode: row.permission_mode },
      ...(!this.runtimeSubscriptions.has(conversationId) ? { onEvent: (event: RuntimeEvent) => this.appendRuntimeEvent(event) } : {}),
    })
    const cutoff = nowIso()
    const turnId = makeId('cache_handoff')
    const compactedEvents = createConversationHandoffReplay<RuntimeEvent>({
      threadId: row.native_id,
      turnId,
      atIso: cutoff,
      summary: (result.finalText || 'Trae 已接收交接上下文。').slice(0, 24_000),
      notice: 'CodyWork 已在清理本地详细过程前，将会话压缩为以下交接摘要。',
      createId: (kind) => makeId(`cache_handoff_${kind}`),
      decorate: (event) => ({ ...event, conversationId: row.id, timestamp: cutoff }),
    })
    await this.traeJournal.replace(conversationId, {
      events: compactedEvents,
      nativeEventsAfterIso: cutoff,
      compactedAtIso: cutoff,
    })
    this.repository.updateStatus(conversationId, 'completed', cutoff)
    this.audit(conversationId, 'conversation.trae_cache_compacted', {
      previousEventCount: before.eventCount,
      previousByteLength: before.byteLength,
      retainedEventCount: compactedEvents.length,
    })
    return this.traeCache(workspaceId, conversationId)!
  }

  async clearTraeCache(workspaceId: string, conversationId: string, confirmed: boolean): Promise<TraeCacheView> {
    if (!confirmed) throw new Error('清除 Trae 缓存需要明确确认')
    const row = this.requireConversation(workspaceId, conversationId)
    if (row.runtime_type !== 'trae') throw new Error('只有 Trae 会话使用本地回放缓存')
    const handle = this.handles.get(conversationId)
    const session = handle ? this.runtimeFor(row).sessionSnapshot?.(handle) : null
    if (session?.activeTurnId || session?.pendingRequestCount) throw new Error('会话正在执行或等待确认，请在完成后再清除缓存')
    const before = this.repository.traeCacheInfo(conversationId)
    const cutoff = nowIso()
    await this.traeJournal.clear(conversationId, cutoff)
    this.audit(conversationId, 'conversation.trae_cache_cleared', { previousEventCount: before.eventCount, previousByteLength: before.byteLength })
    return this.traeCache(workspaceId, conversationId)!
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    return this.events.subscribe({ conversationId }, event => listener(this.withPublicImageUrls(event)))
  }

  async create(workspaceId: string, demandId: string, title?: string, createdVia: ConversationCreatedVia = 'browser', requestedRuntimeType?: ConversationRuntimeType): Promise<ConversationView> {
    const demand = this.requireDemand(workspaceId, demandId)
    const context = this.contexts.demandContext(demand, 'workspace-write')
    const id = makeId('conversation')
    const runtimeType = this.resolveRuntimeType(requestedRuntimeType)
    const handle = await this.getRuntime(runtimeType).createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'demand',
      demand_id: demand.id,
      workspace_id: workspaceId,
      native_id: handle.nativeId,
      runtime_type: runtimeType,
      title: title?.trim() || '新会话',
      created_via: createdVia,
      status: 'idle',
      permission_mode: 'workspace-write',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.repository.insert(row)
    this.handles.set(id, handle)
    this.attachRuntimeStream(handle)
    return this.get(workspaceId, id)
  }

  async createWorkspace(workspaceId: string, title?: string, createdVia: ConversationCreatedVia = 'browser', requestedRuntimeType?: ConversationRuntimeType): Promise<ConversationView> {
    const context = this.contexts.workspaceContext(workspaceId, 'yolo')
    const id = makeId('conversation')
    const runtimeType = this.resolveRuntimeType(requestedRuntimeType)
    const handle = await this.getRuntime(runtimeType).createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'workspace',
      demand_id: null,
      workspace_id: workspaceId,
      native_id: handle.nativeId,
      runtime_type: runtimeType,
      title: title?.trim() || 'Workspace 会话',
      created_via: createdVia,
      status: 'idle',
      permission_mode: 'yolo',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.repository.insert(row)
    this.handles.set(id, handle)
    this.attachRuntimeStream(handle)
    this.audit(id, 'conversation.workspace_created', { workspaceId, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  /**
   * Starts a new native conversation on the other Runtime with a bounded,
   * visible-history handoff. Native Codex Threads and ACP Sessions use
   * different identities and cannot be converted in place without losing
   * their provider guarantees, so the source binding is deliberately kept.
   */
  async migrateRuntime(
    workspaceId: string,
    sourceConversationId: string,
    targetRuntimeType: ConversationRuntimeType,
    confirmed: boolean,
  ): Promise<ConversationView> {
    if (!confirmed) throw new Error('切换 Runtime 需要明确确认')
    this.resolveRuntimeType(targetRuntimeType)

    const source = this.requireConversation(workspaceId, sourceConversationId)
    if (source.runtime_type === targetRuntimeType) throw new Error('当前会话已使用目标 Runtime')
    await this.ensureHandle(source)
    const sourceState = this.runtimeFor(source).sessionSnapshot?.(this.handleFor(source)) ?? null
    if (source.status === 'running' || source.status === 'awaiting_approval' || sourceState?.activeTurnId || sourceState?.pendingRequestCount) {
      throw new Error('会话正在执行或等待确认，请在完成后再切换 Runtime')
    }

    const history = await this.historyCanonical(workspaceId, sourceConversationId)
    const transcript = conversationHandoffTranscript(history.events)
    const context = this.contexts.forRow(source)
    const id = makeId('conversation')
    const targetRuntime = this.getRuntime(targetRuntimeType)
    const handle = await targetRuntime.createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: source.scope,
      demand_id: source.demand_id,
      workspace_id: source.workspace_id,
      native_id: handle.nativeId,
      runtime_type: targetRuntimeType,
      title: migratedConversationTitle(source.title, targetRuntimeType),
      created_via: source.created_via,
      status: 'idle',
      permission_mode: source.permission_mode,
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.repository.insert(row)
    this.handles.set(id, handle)
    this.attachRuntimeStream(handle)

    const migration = {
      sourceConversationId,
      sourceRuntimeType: source.runtime_type,
      targetConversationId: id,
      targetRuntimeType,
    }
    this.audit(sourceConversationId, 'conversation.runtime_migration_started', migration)
    this.audit(id, 'conversation.runtime_migrated', migration)

    try {
      await this.submitCommand({
        workspaceId,
        conversationId: id,
        origin: { kind: 'browser' },
        prompt: buildRuntimeMigrationHandoff(source.runtime_type, targetRuntimeType, transcript),
        submitMode: 'queue',
        executionProfile: { permissionMode: source.permission_mode },
      })
    } catch (error) {
      this.audit(id, 'conversation.runtime_migration_handoff_failed', {
        ...migration,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    return this.get(workspaceId, id)
  }

  /** Binds a native Thread or ACP Session to this Demand without weakening its Worktree policy. */
  async bind(workspaceId: string, demandId: string, input: { nativeId: string; title?: string; runtimeType?: ConversationRuntimeType }): Promise<ConversationView> {
    const nativeId = input.nativeId.trim()
    if (!nativeId) throw new Error('请输入 Thread 或 Session ID')
    if (nativeId.length > 240) throw new Error('Thread 或 Session ID 过长')
    const demand = this.requireDemand(workspaceId, demandId)
    const runtimeType = this.resolveRuntimeType(input.runtimeType)
    const existing = this.repository.getByNativeId(runtimeType, nativeId)
    if (existing) {
      if (existing.workspace_id === workspaceId && existing.demand_id === demandId) throw new Error('这个 Thread 已绑定到当前 Demand')
      throw new Error('这个 Thread 已绑定到另一个 Demand，不能跨 Worktree 复用')
    }
    const context = this.contexts.demandContext(demand, 'workspace-write')
    const id = makeId('conversation')
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'demand',
      demand_id: demand.id,
      workspace_id: workspaceId,
      native_id: nativeId,
      runtime_type: runtimeType,
      title: input.title?.trim() || `已绑定 Thread ${nativeId.slice(0, 8)}`,
      created_via: 'browser',
      status: 'idle',
      permission_mode: 'workspace-write',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.repository.insert(row)
    this.audit(id, 'conversation.bound', { nativeId, demandId: demand.id, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  async composerOptions(workspaceId: string, demandId: string, conversationId?: string, requestedRuntimeType?: ConversationRuntimeType): Promise<RuntimeComposerOptions> {
    const demand = this.requireDemand(workspaceId, demandId)
    const row = conversationId ? this.requireConversation(workspaceId, conversationId) : null
    if (row && (row.scope !== 'demand' || row.demand_id !== demandId)) throw new Error('会话不属于当前 Demand')
    const runtime = row ? this.runtimeFor(row) : this.getRuntime(this.resolveRuntimeType(requestedRuntimeType))
    return runtime.getComposerOptions(this.contexts.demandContext(demand, 'workspace-write'))
  }

  async workspaceComposerOptions(workspaceId: string, conversationId?: string): Promise<RuntimeComposerOptions> {
    const row = conversationId ? this.requireConversation(workspaceId, conversationId) : null
    if (row && row.scope !== 'workspace') throw new Error('会话不属于 Workspace 范围')
    const runtime = row ? this.runtimeFor(row) : this.getRuntime()
    return runtime.getComposerOptions(this.contexts.workspaceContext(workspaceId))
  }

  /**
   * A Demand can gain another Repo after its conversations were attached.
   * Keep the persisted policy fingerprint and every live Runtime session in
   * sync so the next Turn can use the new Worktree immediately.
   */
  async refreshDemandContexts(workspaceId: string, demandId: string): Promise<void> {
    const demand = this.requireDemand(workspaceId, demandId)
    const rows = this.repository.listDemandRows(workspaceId, demandId)
    const updatedAt = nowIso()

    for (const row of rows) {
      // The Runtime context is the immutable Demand scope ceiling. Approval
      // behavior is selected per command and must not erase writable roots.
      const context = this.contexts.demandContext(demand, 'workspace-write')
      this.repository.updateContext(row.id, context.effectivePolicy.hash, context.instructionBundle.sha256, updatedAt)
      const handle = this.handles.get(row.id)
      if (!handle) continue
      await this.runtimeFor(row).updateContext(handle, context)
    }
  }

  async send(
    workspaceId: string,
    conversationId: string,
    prompt: string,
    mode: RuntimeSubmitMode = 'queue',
    settings?: ConversationSendSettings,
    requestedCommandId?: string,
    localImages: Array<{ path: string }> = [],
  ): Promise<{ accepted: true; commandId: string }> {
    const row = this.requireConversation(workspaceId, conversationId)
    return this.submitCommand({
      id: requestedCommandId,
      workspaceId,
      conversationId,
      origin: { kind: 'browser' },
      prompt,
      submitMode: mode,
      executionProfile: { permissionMode: row.permission_mode },
      settings,
      localImages,
    })
  }

  async submitCommand(command: ConversationCommand): Promise<ConversationCommandReceipt> {
    const { workspaceId, conversationId } = command
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const text = command.prompt.trim()
    const localImages = command.localImages ?? []
    const requestedSkills = (command.settings?.skills ?? []).filter(skill => typeof skill === 'string' && skill.trim()).map(skill => skill.trim()).slice(0, 20)
    if (!composerHasContent({ text, skills: requestedSkills, images: localImages })) throw new Error('消息不能为空')
    const commandId = command.id?.trim().slice(0, 200) || makeId('command')
    const permissionMode = command.executionProfile?.permissionMode ?? row.permission_mode
    const context = this.contexts.forRow(row)
    const runtime = this.runtimeFor(row)
    const selectedSkills = await runtime.resolveSkills(context, requestedSkills)
    const runtimeSettings: RuntimeTurnSettings = {
      ...(command.settings?.model ? { model: command.settings.model } : {}),
      ...(command.settings?.reasoningEffort ? { reasoningEffort: command.settings.reasoningEffort } : {}),
      ...(command.settings?.collaborationMode ? { collaborationMode: command.settings.collaborationMode } : {}),
      ...(selectedSkills.length ? { skills: selectedSkills } : {}),
    }
    this.repository.touch(conversationId)
    const submission = runtime.submitTurn({
      conversation: this.handleFor(row),
      prompt: text,
      ...(localImages.length ? { localImages } : {}),
      mode: command.submitMode ?? 'queue',
      clientCommandId: commandId,
      executionProfile: { permissionMode },
      ...(Object.keys(runtimeSettings).length ? { settings: runtimeSettings } : {}),
      ...(!this.runtimeSubscriptions.has(conversationId) ? { onEvent: (event: RuntimeEvent) => this.appendRuntimeEvent(event) } : {}),
    })
    void submission.started.then((handle) => {
      this.audit(conversationId, 'turn.bound', { commandId, nativeTurnId: handle.turnId, origin: command.origin, executionProfile: { permissionMode } })
    }).catch((error: unknown) => {
      this.audit(conversationId, 'command.failed', { commandId, error: error instanceof Error ? error.message : String(error) })
    })
    void submission.completed.then(
      () => this.onTurnFinished?.(row.workspace_id),
      () => this.onTurnFinished?.(row.workspace_id),
    )
    return { accepted: true, commandId: submission.clientCommandId }
  }

  async setPermission(workspaceId: string, conversationId: string, mode: ConversationPermissionMode): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    await this.runtimeFor(row).setPermission(this.handleFor(row), mode)
    this.repository.updatePermission(conversationId, mode)
    this.audit(conversationId, 'permission.changed', { mode })
    return this.get(workspaceId, conversationId)
  }

  async interrupt(workspaceId: string, conversationId: string): Promise<{ supported: boolean }> {
    const result = await this.executeAction({ kind: 'interrupt', workspaceId, conversationId, origin: { kind: 'browser' } })
    return { supported: result.kind === 'interrupt' && result.supported }
  }

  async compact(workspaceId: string, conversationId: string): Promise<void> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    const runtime = this.runtimeFor(row)
    const state = runtime.sessionSnapshot?.(handle) ?? null
    if (state?.activeTurnId || state?.pendingRequestCount) throw new Error('会话正在执行或等待确认，不能压缩上下文')
    if (!runtime.compactConversation) throw new Error('当前 Runtime 不支持手动压缩上下文')
    await runtime.compactConversation(handle)
    this.audit(conversationId, 'conversation.compacted', { nativeId: row.native_id })
  }

  async approve(workspaceId: string, conversationId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    await this.executeAction({ kind: 'approval.resolve', workspaceId, conversationId, origin: { kind: 'browser' }, requestId: approvalId, outcome })
  }

  async answer(workspaceId: string, conversationId: string, requestId: string, answer: unknown): Promise<void> {
    await this.executeAction({ kind: 'question.resolve', workspaceId, conversationId, origin: { kind: 'browser' }, requestId, answer })
  }

  async executeAction(action: ConversationAction): Promise<ConversationActionResult> {
    const row = this.requireConversation(action.workspaceId, action.conversationId)
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    if (action.kind === 'interrupt') {
      const result = await this.runtimeFor(row).interrupt(handle)
      this.audit(action.conversationId, 'turn.interrupt', { ...result, origin: action.origin })
      return { kind: 'interrupt', supported: result.supported }
    }
    if (action.kind === 'approval.resolve') {
      await this.runtimeFor(row).respondApproval(handle, action.requestId, action.outcome)
      this.audit(action.conversationId, 'approval.resolved', { approvalId: action.requestId, outcome: action.outcome, origin: action.origin })
      return { kind: 'resolved' }
    }
    await this.runtimeFor(row).respondQuestion(handle, action.requestId, action.answer)
    this.audit(action.conversationId, 'question.resolved', { requestId: action.requestId, answer: action.answer, origin: action.origin })
    return { kind: 'resolved' }
  }

  async rename(workspaceId: string, conversationId: string, title: string): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    const value = title.trim()
    if (!value) throw new Error('会话标题不能为空')
    if (value.length > 120) throw new Error('会话标题不能超过 120 个字符')
    if (value === row.title) return toView(row)
    await this.ensureHandle(row)
    await this.runtimeFor(row).renameConversation(this.handleFor(row), value)
    this.repository.updateTitle(conversationId, value)
    this.audit(conversationId, 'conversation.renamed', { title: value })
    return this.get(workspaceId, conversationId)
  }

  /** Removes CodyWork's local record only. The native Codex Thread is intentionally retained. */
  async remove(workspaceId: string, conversationId: string): Promise<{ deleted: true }> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    const state = this.runtimeFor(row).sessionSnapshot?.(handle) ?? null
    if (state?.activeTurnId || state?.pendingRequestCount) {
      throw new Error('会话正在执行或等待确认，请先停止后再删除')
    }
    if (row.scope === 'demand') {
      if (this.repository.demandCount(workspaceId, row.demand_id) <= 1) throw new Error('每个 Demand 至少保留一个会话')
    }

    this.onConversationRemoving?.(workspaceId, conversationId)
    // Local audit records are deleted through their foreign-key cascade; native Thread is retained.
    this.repository.delete(workspaceId, conversationId)
    this.handles.delete(conversationId)
    this.events.clear(conversationId)
    this.runtimeSubscriptions.get(conversationId)?.()
    this.runtimeSubscriptions.delete(conversationId)
    return { deleted: true }
  }

  private appendRuntimeEvent(event: RuntimeEvent): void {
    const row = this.repository.getById(event.conversationId)
    if (row?.runtime_type === 'trae') void this.traeJournal.append(event.conversationId, event)
    const status = persistedStatusForEvent(event)
    if (status) {
      this.repository.updateStatus(event.conversationId, status, event.timestamp || nowIso())
    }
    this.events.publish(event)
  }

  private withPublicImageUrls(event: RuntimeEvent): RuntimeEvent {
    if (!this.imageUrlForPath || !Array.isArray(event.data.images)) return event
    const resolveImageUrl = this.imageUrlForPath
    const workspaceId = this.requireConversationById(event.conversationId).workspace_id
    const images = event.data.images.map(image => typeof image === 'string'
      ? resolveImageUrl(workspaceId, event.conversationId, image) ?? image
      : image)
    return { ...event, data: { ...event.data, images } }
  }

  private requireConversationById(conversationId: string): ConversationRow {
    const row = this.repository.getById(conversationId)
    if (!row) throw new Error('会话不存在')
    return row
  }

  private audit(conversationId: string, action: string, data: unknown): void {
    this.repository.audit(conversationId, action, data)
  }

  private requireDemand(workspaceId: string, demandId: string) {
    return this.contexts.demand(workspaceId, demandId)
  }

  private requireConversation(workspaceId: string, conversationId: string): ConversationRow {
    const row = this.repository.get(workspaceId, conversationId)
    if (!row) throw new Error('会话不存在')
    return row
  }

  private async ensureHandle(row: ConversationRow): Promise<void> {
    const handle = this.handles.get(row.id)
    if (handle) {
      // Forced Trae cancellation releases its one-session ACP process. Drop
      // this product-side handle too, so the next operation restores the
      // native Session (or invokes the existing missing-session recovery).
      const snapshot = row.runtime_type === 'trae' ? this.runtimeFor(row).sessionSnapshot?.(handle) : undefined
      if (snapshot !== null) return
      this.handles.delete(row.id)
      this.runtimeSubscriptions.get(row.id)?.()
      this.runtimeSubscriptions.delete(row.id)
    }
    await this.restore(row)
    if (!this.handles.has(row.id)) throw new Error('会话尚未连接 Runtime，请刷新后重试')
  }

  private handleFor(row: ConversationRow): ConversationHandle {
    const handle = this.handles.get(row.id)
    if (!handle) throw new Error('会话尚未连接 Runtime，请刷新后重试')
    return handle
  }

  private async restore(row: ConversationRow): Promise<void> {
    if (this.handles.has(row.id)) return
    const context = this.contexts.forRow(row)
    let handle: ConversationHandle
    try {
      handle = await this.runtimeFor(row).resumeConversation({ conversationId: row.id, nativeId: row.native_id, context })
    } catch (error) {
      // `traex acp serve` may report a previously-created session as missing
      // after the ACP process is restarted. Codex threads remain durable and
      // must keep their normal error behavior; only this precise Trae signal
      // can safely start a fresh native session under the same CodyWork row.
      if (row.runtime_type !== 'trae' || !isMissingTraeSession(error)) throw error
      handle = await this.runtimeFor(row).createConversation({ conversationId: row.id, context })
      this.repository.replaceNativeId(row.id, handle.nativeId)
      this.audit(row.id, 'conversation.trae_session_recreated', {
        previousNativeId: row.native_id,
        nativeId: handle.nativeId,
        reason: 'provider session missing after restart',
      })
      console.warn(`[codywork] recreated missing Trae ACP session for conversation ${row.id}`)
    }
    this.handles.set(row.id, handle)
    this.attachRuntimeStream(handle)
  }

  private attachRuntimeStream(handle: ConversationHandle): void {
    const runtime = this.runtimeFor(this.requireConversationById(handle.id))
    if (this.runtimeSubscriptions.has(handle.id) || !runtime.subscribeConversation) return
    this.runtimeSubscriptions.set(handle.id, runtime.subscribeConversation(handle, event => this.appendRuntimeEvent(event)))
  }

}

function buildTraeCacheHandoff(transcript: string): string {
  return [
    '这是一次 CodyWork 本地 UI 历史缓存压缩前的交接。',
    '不要执行命令、修改文件、调用工具或开始新的任务。请只基于下方可见历史，输出一份中文、结构化且简明的交接摘要：目标与当前状态、已完成/关键结论、待办与风险、需要保留的上下文。',
    '这份摘要会作为后续继续此 Trae Session 的交接锚点。',
    '',
    transcript || '当前没有可用于归纳的可见消息；请说明尚无历史上下文。',
  ].join('\n')
}

function migratedConversationTitle(sourceTitle: string, targetRuntimeType: ConversationRuntimeType): string {
  const suffix = ` · 切换到 ${targetRuntimeType === 'trae' ? 'Trae' : 'Codex'}`
  return `${sourceTitle.slice(0, Math.max(1, 120 - suffix.length)).trim() || '会话'}${suffix}`
}

function buildRuntimeMigrationHandoff(
  sourceRuntimeType: ConversationRuntimeType,
  targetRuntimeType: ConversationRuntimeType,
  transcript: string,
): string {
  return [
    '这是一次 CodyWork 跨 Runtime 切换交接。',
    `源 Runtime：${sourceRuntimeType === 'trae' ? 'Trae ACP Session' : 'Codex Thread'}；目标 Runtime：${targetRuntimeType === 'trae' ? 'Trae ACP Session' : 'Codex Thread'}。`,
    '不要执行命令、修改文件、调用工具或开始新的任务。请仅基于以下可见历史，确认已接收上下文，并输出简明中文交接摘要：目标和当前状态、已完成/关键结论、待办与风险、需要保留的上下文。',
    '源会话会被保留；这是一份有限长度的可见历史，不应把未出现的信息当作事实。',
    '',
    transcript || '当前没有可用于归纳的可见消息；请说明尚无历史上下文。',
  ].join('\n')
}

function isMissingTraeSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\bresource not found\b/i.test(message)
}

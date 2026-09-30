import type { WorkbenchDb } from '../db/index.js'
import type { ReasoningEffort, RuntimeModelOption } from '../runtime/protocol.js'
import type { ConversationService } from './conversations.js'
import { listDemands } from './demands.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'
import type { CodyWorkChannelBinding } from './channelStore.js'
import type { WorkspaceRegistry } from './workspaceRegistry.js'

export type ChannelExecutionContext = {
  runtimeType: string
  runtimeLabel: string
  model: string
  modelLabel: string
  reasoningEffort: ReasoningEffort | ''
  reasoningLabel: string
  permissionLabel: string
  workspaceName: string
  demandName?: string
}

export type ChannelModelSettings = ChannelExecutionContext & { models: RuntimeModelOption[]; reasoningSupported: boolean }

const reasoningLabels: Record<ReasoningEffort, string> = {
  none: '无推理', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高',
}

function permissionLabel(mode: CodyWorkChannelBinding['permissionMode']): string {
  if (mode === 'read-only') return '只读'
  if (mode === 'yolo') return 'YOLO'
  return 'Normal'
}

/** Provider-authoritative model selection shared by Feishu presentation and execution. */
export class ChannelSessionSettingsService {
  private readonly cache = new Map<string, { expiresAt: number; models: RuntimeModelOption[] }>()

  constructor(
    private readonly database: WorkbenchDb,
    private readonly repositories: ChannelRepositoryPorts,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
  ) {}

  async resolve(binding: CodyWorkChannelBinding): Promise<ChannelModelSettings> {
    let models: RuntimeModelOption[] = []
    try { models = await this.models(binding) } catch { /* submission can still use the native Runtime default */ }
    const selected = models.find(model => model.id === binding.model) ?? models.find(model => model.isDefault) ?? models[0]
    // A binding can outlive a provider/model switch. In particular, Trae ACP
    // models deliberately expose no reasoning selector, so a prior Codex
    // selection such as "medium" must never be restored for that model.
    const effort = selected
      ? selected.supportedReasoningEfforts.length === 0
        ? ''
        : selected.supportedReasoningEfforts.includes(binding.reasoningEffort as ReasoningEffort)
          ? binding.reasoningEffort as ReasoningEffort
          : selected.defaultReasoningEffort
      : ''
    const storedEffort = validReasoningEffort(binding.reasoningEffort)
    const effectiveEffort = selected ? effort : storedEffort
    const workspace = this.workspaces.get(binding.workspaceId)
    const demand = binding.demandId ? listDemands(this.database, workspace).find(item => item.id === binding.demandId) : null
    const conversation = this.conversations.get(binding.workspaceId, binding.conversationId)
    return {
      runtimeType: conversation.runtimeType,
      runtimeLabel: this.conversations.runtimeDescriptors().find(runtime => runtime.id === conversation.runtimeType)?.label ?? conversation.runtimeType,
      models,
      model: selected?.id ?? binding.model, modelLabel: selected?.label || selected?.id || binding.model || 'Default',
      reasoningEffort: effectiveEffort,
      reasoningLabel: effectiveEffort ? reasoningLabels[effectiveEffort] : '默认',
      reasoningSupported: Boolean(selected?.supportedReasoningEfforts.length),
      permissionLabel: permissionLabel(binding.permissionMode), workspaceName: workspace.name,
      ...(demand ? { demandName: demand.name } : {}),
    }
  }

  async select(bindingId: string, actorId: string, modelId: string, effort: string): Promise<ChannelModelSettings> {
    const binding = this.repositories.bindings.get(bindingId)
    if (binding.ownerIdentity !== actorId) throw new Error('只有此绑定的创建者可以切换模型')
    const models = await this.models(binding, true)
    const model = models.find(item => item.id === modelId)
    if (!model) throw new Error('所选模型已不可用，请重新发送 /model')
    if (model.supportedReasoningEfforts.length === 0) {
      if (effort) throw new Error('当前 Runtime 未提供推理程度配置')
    } else if (!model.supportedReasoningEfforts.includes(effort as ReasoningEffort)) throw new Error('该模型不支持所选推理程度，请重新选择')
    const updated = this.repositories.bindings.updateModel(binding.accountId, binding.id, model.id, effort)
    this.repositories.audit.record(binding.accountId, 'channel.model.updated', 'channel_binding', binding.id, true, {
      actorId, model: model.id, reasoningEffort: effort,
    })
    return this.resolve(updated)
  }

  async model(bindingId: string, actorId: string, modelId: string): Promise<{ binding: CodyWorkChannelBinding; model: RuntimeModelOption }> {
    const binding = this.repositories.bindings.get(bindingId)
    if (binding.ownerIdentity !== actorId) throw new Error('只有此绑定的创建者可以切换模型')
    const model = (await this.models(binding, true)).find(item => item.id === modelId)
    if (!model) throw new Error('所选模型已不可用，请重新发送 /model')
    return { binding, model }
  }

  private async models(binding: CodyWorkChannelBinding, force = false): Promise<RuntimeModelOption[]> {
    // Models and capabilities belong to the persisted conversation provider,
    // not merely to its Workspace/Demand. A switched default must not poison
    // a historical binding's cached settings.
    const key = `${binding.workspaceId}:${binding.demandId ?? 'workspace'}:${binding.conversationId}`
    const cached = this.cache.get(key)
    if (!force && cached && cached.expiresAt > Date.now()) return cached.models
    const options = binding.demandId
      ? await this.conversations.composerOptions(binding.workspaceId, binding.demandId, binding.conversationId)
      : await this.conversations.workspaceComposerOptions(binding.workspaceId, binding.conversationId)
    this.cache.set(key, { expiresAt: Date.now() + 300_000, models: options.models })
    return options.models
  }
}

export function channelReasoningLabel(value: ReasoningEffort): string { return reasoningLabels[value] }

function validReasoningEffort(value: string): ReasoningEffort | '' {
  return value in reasoningLabels ? value as ReasoningEffort : ''
}

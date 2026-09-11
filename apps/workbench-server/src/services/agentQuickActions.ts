import type { ConversationRow, WorkbenchDb, WorkspaceRow } from '../db/index.js'
import type { SkillCatalogEntry } from './skills.js'
import { createQuickAction, listQuickActions, updateQuickAction } from './quickActions.js'

export const QUICK_ACTION_TOOL_NAMESPACE = 'codywork_quick_actions'

export const QUICK_ACTION_DYNAMIC_TOOLS = [{
  type: 'namespace' as const,
  name: QUICK_ACTION_TOOL_NAMESPACE,
  description: '管理当前 CodyWork Workspace 的快捷指令。快捷指令会在需求开发工具箱中显示并可一键发送。',
  tools: [{
    type: 'function' as const,
    name: 'list',
    description: '列出当前 Workspace 的快捷指令。更新现有指令前先调用，以取得 actionId 和当前版本。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '可选，按名称或 Prompt 过滤。' } },
      additionalProperties: false,
    },
  }, {
    type: 'function' as const,
    name: 'find_skills',
    description: '按名称、描述、来源或路径搜索可绑定到快捷指令的 Skill。只有需要绑定 Skill 时调用。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Skill 名称、描述、来源或路径关键词。' } },
      required: ['query'],
      additionalProperties: false,
    },
  }, {
    type: 'function' as const,
    name: 'save',
    description: '创建或更新快捷指令。用户说“把……沉淀成快捷指令”属于明确授权；此时只保存，不要立即执行被沉淀的指令内容。仅讨论某段 Prompt 是否好用不构成授权。没有指定名称时，从指令内容提炼简短名称；更新时必须先 list，并提供 actionId 和 expectedRevision。',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', description: '更新现有指令时必填；创建时省略。' },
        expectedRevision: { type: 'integer', minimum: 1, description: '更新现有指令时必填，使用 list 返回的 revision，防止覆盖其他编辑。' },
        name: { type: 'string', description: '简短、可识别的指令名称。' },
        prompt: { type: 'string', description: '点击快捷指令后直接发送给 AI 的完整 Prompt。不要包含本次对话才成立的隐含上下文。' },
        skills: { type: 'array', items: { type: 'string' }, description: '可选，保存用户在指令内容中明确引用的 Skill。先调用 find_skills；重名时使用其返回的精确 id。Skill 应结构化保存，不要只拼进 Prompt 文本。创建时省略表示无 Skill；更新时省略表示保持原值，传空数组才会清空。' },
        enabled: { type: 'boolean', description: '是否立即在需求开发工具箱中启用。创建时默认 true；更新时省略表示保持原值。' },
      },
      required: ['name', 'prompt'],
      additionalProperties: false,
    },
  }],
}]

export interface AgentQuickActionCall {
  conversationId: string
  threadId: string
  turnId: string
  tool: string
  arguments: unknown
}

type SkillProvider = (workspace: WorkspaceRow) => Promise<SkillCatalogEntry[]>

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    : []
}

function requireConversation(db: WorkbenchDb, conversationId: string): { conversation: ConversationRow; workspace: WorkspaceRow } {
  const conversation = db.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as ConversationRow | undefined
  if (!conversation) throw new Error('当前 CodyWork 会话不存在，无法保存快捷指令')
  if (conversation.scope !== 'demand') throw new Error('快捷指令目前只支持从需求会话创建')
  const workspace = db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(conversation.workspace_id) as WorkspaceRow | undefined
  if (!workspace) throw new Error('当前 Workspace 不存在')
  return { conversation, workspace }
}

function resolveSkillIds(skills: SkillCatalogEntry[], requested: string[]): string[] {
  return requested.map((requestedSkill) => {
    const exact = skills.find(skill => skill.id === requestedSkill)
    if (exact) return exact.id
    const named = skills.filter(skill => skill.name === requestedSkill || skill.displayName === requestedSkill)
    if (named.length === 0) throw new Error(`Skill 不存在：${requestedSkill}`)
    if (named.length > 1) throw new Error(`Skill 名称“${requestedSkill}”不唯一，请使用 find_skills 返回的精确 id`)
    return named[0]!.id
  })
}

/** Product-owned dynamic tools exposed to Codex demand conversations. */
export class AgentQuickActionTools {
  constructor(private readonly db: WorkbenchDb, private readonly skills: SkillProvider) {}

  async handle(call: AgentQuickActionCall): Promise<unknown> {
    const { workspace } = requireConversation(this.db, call.conversationId)
    const args = objectValue(call.arguments)
    if (call.tool === 'list') {
      const query = text(args.query).toLocaleLowerCase()
      const actions = listQuickActions(this.db, workspace, await this.skills(workspace))
        .filter(action => !query || `${action.name}\n${action.prompt}`.toLocaleLowerCase().includes(query))
        .map(action => ({ id: action.id, revision: action.revision, name: action.name, prompt: action.prompt, enabled: action.enabled, skillIds: action.skillIds }))
      return { workspaceId: workspace.id, scene: 'demand-development', actions }
    }
    if (call.tool === 'find_skills') {
      const query = text(args.query).toLocaleLowerCase()
      if (!query) throw new Error('请输入 Skill 搜索词')
      const matches = (await this.skills(workspace))
        .filter(skill => `${skill.name}\n${skill.displayName}\n${skill.description}\n${skill.source}\n${skill.path}`.toLocaleLowerCase().includes(query))
        .slice(0, 20)
        .map(skill => ({ id: skill.id, name: skill.name, displayName: skill.displayName, description: skill.description, source: skill.source, status: skill.status }))
      return { query, matches }
    }
    if (call.tool !== 'save') throw new Error(`不支持的快捷指令工具：${call.tool}`)

    const catalog = await this.skills(workspace)
    const actionId = text(args.actionId)
    const existing = actionId
      ? listQuickActions(this.db, workspace, catalog).find(action => action.id === actionId)
      : undefined
    if (actionId && !existing) throw new Error('快捷指令不存在，请重新调用 list')
    if (existing) {
      const expectedRevision = typeof args.expectedRevision === 'number' && Number.isInteger(args.expectedRevision)
        ? args.expectedRevision
        : 0
      if (!expectedRevision) throw new Error('更新快捷指令必须提供 list 返回的 expectedRevision')
      if (expectedRevision !== existing.revision) throw new Error(`快捷指令版本已变化：期望 v${expectedRevision}，当前 v${existing.revision}。请重新调用 list 后再更新`)
    }
    const input = {
      name: text(args.name),
      prompt: text(args.prompt),
      skillIds: args.skills === undefined && existing
        ? existing.skillIds
        : resolveSkillIds(catalog, stringArray(args.skills)),
      scenes: ['demand-development'],
      enabled: typeof args.enabled === 'boolean' ? args.enabled : existing?.enabled ?? true,
    }
    const source = { via: 'agent' as const, conversationId: call.conversationId, turnId: call.turnId }
    const saved = actionId
      ? updateQuickAction(this.db, workspace, catalog, actionId, input, source)
      : createQuickAction(this.db, workspace, catalog, input, source)
    return {
      saved: true,
      action: { id: saved.id, revision: saved.revision, name: saved.name, enabled: saved.enabled, skillIds: saved.skillIds, scene: 'demand-development' },
      message: `快捷指令“${saved.name}”已${actionId ? '更新' : '创建'}，可在需求开发工具箱中使用。`,
    }
  }
}

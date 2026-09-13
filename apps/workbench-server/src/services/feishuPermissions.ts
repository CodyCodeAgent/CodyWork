import * as Lark from '@larksuiteoapi/node-sdk'
import type { ChannelAccountSecret } from './channelStore.js'

export type FeishuRequiredScope = {
  name: string
  label: string
}

/**
 * CodyWork robots use one fixed permission template. The product deliberately
 * does not expose per-capability switches: every configured app is expected to
 * support the complete messaging, administration, attachment, and document
 * sharing surface.
 */
export const CODYWORK_FEISHU_REQUIRED_SCOPES: readonly FeishuRequiredScope[] = [
  { name: 'application:application:self_manage', label: '读取应用所有者与管理员' },
  { name: 'application:bot.basic_info:read', label: '读取机器人身份' },
  { name: 'im:chat:read', label: '读取群聊与话题模式' },
  { name: 'im:message:readonly', label: '读取消息' },
  { name: 'im:message:send_as_bot', label: '以机器人身份发送消息' },
  { name: 'im:message:update', label: '更新执行卡片' },
  { name: 'im:message.group_at_msg:readonly', label: '接收群聊中 @ 机器人的消息' },
  { name: 'im:message.p2p_msg:readonly', label: '接收私聊消息' },
  { name: 'im:resource', label: '收发图片与文件' },
  { name: 'cardkit:card:read', label: '读取交互卡片' },
  { name: 'cardkit:card:write', label: '创建和更新交互卡片' },
  { name: 'docx:document:create', label: '创建飞书文档' },
  { name: 'docx:document:write_only', label: '编辑飞书文档' },
  { name: 'docx:document:readonly', label: '读取飞书文档' },
  { name: 'docx:document.block:convert', label: '将 Markdown 转换为文档块' },
  { name: 'docs:permission.setting:write_only', label: '设置云文档访问权限' },
  { name: 'space:document:delete', label: '清理创建失败的云文档' },
] as const

export type FeishuPermissionTemplate = {
  requiredScopes: FeishuRequiredScope[]
}

export type FeishuPermissionStatus = FeishuPermissionTemplate & {
  state: 'complete' | 'incomplete' | 'unavailable'
  grantedScopes: string[]
  pendingScopes: string[]
  missingScopes: string[]
  authorizationUrl: string
  checkedAt: string
  error: string
}

type ScopeGrant = {
  scope_name: string
  grant_status: number
  scope_type?: 'user' | 'tenant'
}

type ScopeListClient = {
  application: {
    scope: {
      list(payload?: Record<string, never>): Promise<{ code?: number; msg?: string; data?: { scopes?: ScopeGrant[] } }>
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function feishuPermissionTemplate(): FeishuPermissionTemplate {
  return { requiredScopes: CODYWORK_FEISHU_REQUIRED_SCOPES.map(scope => ({ ...scope })) }
}

export function feishuAuthorizationUrl(appId: string, domain: 'feishu' | 'lark'): string {
  if (!/^cli_[A-Za-z0-9_-]+$/u.test(appId.trim())) return ''
  const host = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const scopes = CODYWORK_FEISHU_REQUIRED_SCOPES.map(scope => scope.name).join(',')
  return `${host}/page/scope-apply?clientID=${encodeURIComponent(appId.trim())}&scopes=${encodeURIComponent(scopes)}`
}

export function summarizeFeishuPermissions(
  grants: readonly ScopeGrant[],
  appId: string,
  domain: 'feishu' | 'lark',
  checkedAt = new Date().toISOString(),
): FeishuPermissionStatus {
  const byName = new Map<string, ScopeGrant[]>()
  for (const grant of grants) {
    const rows = byName.get(grant.scope_name) ?? []
    rows.push(grant)
    byName.set(grant.scope_name, rows)
  }
  const grantedScopes: string[] = []
  const pendingScopes: string[] = []
  const missingScopes: string[] = []
  for (const required of CODYWORK_FEISHU_REQUIRED_SCOPES) {
    const matches = byName.get(required.name) ?? []
    if (matches.some(grant => grant.grant_status === 1 && grant.scope_type !== 'user')) grantedScopes.push(required.name)
    else if (matches.length) pendingScopes.push(required.name)
    else missingScopes.push(required.name)
  }
  return {
    ...feishuPermissionTemplate(),
    state: pendingScopes.length || missingScopes.length ? 'incomplete' : 'complete',
    grantedScopes,
    pendingScopes,
    missingScopes,
    authorizationUrl: feishuAuthorizationUrl(appId, domain),
    checkedAt,
    error: '',
  }
}

/** Convert SDK/Axios failures into bounded, actionable product errors. */
export function feishuApiError(action: string, error: unknown): Error {
  const row = record(error)
  const response = record(row?.response)
  const data = record(response?.data)
  const code = number(data?.code ?? row?.code)
  const httpStatus = number(response?.status)
  const detail = string(data?.msg) || string(data?.message) || string(row?.message) || '飞书返回未知错误'
  if (code === 99991672) {
    return new Error(`${action}失败：${detail.slice(0, 600)}（99991672）。机器人缺少 CodyWork 完整权限中的该步骤所需权限，请在“设置 → 飞书机器人”一次性申请全部权限，发布应用版本并完成管理员授权。`)
  }
  const suffix = code !== null ? `（飞书错误码 ${code}）` : httpStatus !== null ? `（HTTP ${httpStatus}）` : ''
  return new Error(`${action}失败：${detail.slice(0, 600)}${suffix}`)
}

export class FeishuPermissionInspector {
  constructor(private readonly clientFactory: (account: ChannelAccountSecret) => ScopeListClient = account => new Lark.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    domain: account.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, trace: () => undefined },
  }) as ScopeListClient) {}

  async inspect(account: ChannelAccountSecret): Promise<FeishuPermissionStatus> {
    const checkedAt = new Date().toISOString()
    try {
      const response = await this.clientFactory(account).application.scope.list()
      if (response.code !== 0) throw new Error(response.msg || `飞书返回错误 ${response.code ?? 'unknown'}`)
      return summarizeFeishuPermissions(response.data?.scopes ?? [], account.appId, account.domain, checkedAt)
    } catch (error) {
      return {
        ...feishuPermissionTemplate(),
        state: 'unavailable',
        grantedScopes: [],
        pendingScopes: [],
        missingScopes: [],
        authorizationUrl: feishuAuthorizationUrl(account.appId, account.domain),
        checkedAt,
        error: feishuApiError('检查飞书权限', error).message,
      }
    }
  }
}

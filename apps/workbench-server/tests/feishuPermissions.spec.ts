import { describe, expect, it } from 'vitest'
import type { ChannelAccountSecret } from '../src/services/channelStore.js'
import {
  CODYWORK_FEISHU_REQUIRED_SCOPES,
  FeishuPermissionInspector,
  feishuApiError,
  feishuAuthorizationUrl,
  summarizeFeishuPermissions,
} from '../src/services/feishuPermissions.js'

function account(): ChannelAccountSecret {
  return {
    id: 'channel-test', provider: 'feishu', name: 'Test bot', appId: 'cli_test', appSecret: 'secret-value',
    appSecretConfigured: true, domain: 'feishu', enabled: false, allowAllUsers: false, allowAllConversations: false,
    allowedUserIds: [], allowedConversationIds: [], groupMentionMode: 'always', privateConversationMode: 'chat',
    botOpenId: '', botName: '', connectionState: 'idle', lastError: '', lastCloseCode: null, lastCloseReason: '',
    lastDisconnectedAt: null, reconnectAttempts: 0, nextReconnectAt: null, connectedAt: null, lastEventAt: null,
    lastDeliveryAt: null, createdAt: '', updatedAt: '',
  }
}

describe('CodyWork Feishu permission template', () => {
  it('contains messaging and all document permissions in one non-optional request URL', () => {
    const names = CODYWORK_FEISHU_REQUIRED_SCOPES.map(scope => scope.name)
    expect(names).toEqual(expect.arrayContaining([
      'im:message:send_as_bot',
      'docx:document:create',
      'docx:document:write_only',
      'docx:document:readonly',
      'docx:document.block:convert',
      'docs:permission.setting:write_only',
      'space:document:delete',
    ]))
    const url = new URL(feishuAuthorizationUrl('cli_test', 'feishu'))
    expect(url.hostname).toBe('open.feishu.cn')
    expect(url.pathname).toBe('/page/scope-apply')
    expect(url.searchParams.get('clientID')).toBe('cli_test')
    expect(url.searchParams.get('scopes')?.split(',')).toEqual(names)
  })

  it('separates granted, pending, and absent tenant scopes', () => {
    const first = CODYWORK_FEISHU_REQUIRED_SCOPES[0]!.name
    const second = CODYWORK_FEISHU_REQUIRED_SCOPES[1]!.name
    const status = summarizeFeishuPermissions([
      { scope_name: first, grant_status: 1, scope_type: 'tenant' },
      { scope_name: second, grant_status: 0, scope_type: 'tenant' },
    ], 'cli_test', 'feishu', '2026-09-13T00:00:00.000Z')

    expect(status.state).toBe('incomplete')
    expect(status.grantedScopes).toContain(first)
    expect(status.pendingScopes).toContain(second)
    expect(status.missingScopes).toContain('docx:document:create')
  })

  it('reads the live tenant grant list without exposing the app secret', async () => {
    const grants = CODYWORK_FEISHU_REQUIRED_SCOPES.map(scope => ({ scope_name: scope.name, grant_status: 1, scope_type: 'tenant' as const }))
    const inspector = new FeishuPermissionInspector(() => ({
      application: { scope: { list: async () => ({ code: 0, data: { scopes: grants } }) } },
    }))

    const status = await inspector.inspect(account())
    expect(status.state).toBe('complete')
    expect(JSON.stringify(status)).not.toContain('secret-value')
  })

  it('turns Feishu missing-scope Axios failures into an actionable product error', () => {
    const error = feishuApiError('创建飞书文档', {
      message: 'Request failed with status code 400',
      response: { status: 400, data: { code: 99991672, msg: 'Access denied' } },
    })
    expect(error.message).toContain('机器人缺少 CodyWork 完整权限')
    expect(error.message).toContain('Access denied')
    expect(error.message).toContain('设置 → 飞书机器人')
    expect(error.message).not.toContain('status code 400')
  })

  it('preserves the failing operation, Feishu detail, and code for non-scope API errors', () => {
    const error = feishuApiError('设置飞书文档访问权限', {
      message: 'Request failed with status code 400',
      response: { status: 400, data: { code: 1063003, msg: 'Invalid operation' } },
    })
    expect(error.message).toBe('设置飞书文档访问权限失败：Invalid operation（飞书错误码 1063003）')
  })
})

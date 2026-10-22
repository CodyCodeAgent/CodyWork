import * as Lark from '@larksuiteoapi/node-sdk'
import type { ChannelAccountSecret } from './channelStore.js'

export function normalizeNotificationEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())) throw new Error('请输入有效的企业邮箱')
  return value.trim().toLowerCase()
}
export class NotificationRecipientResolver {
  constructor(private readonly client = (account: ChannelAccountSecret) => new Lark.Client({ appId: account.appId, appSecret: account.appSecret, domain: account.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu, logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} } })) {}
  async resolve(account: ChannelAccountSecret, value: unknown) {
    if (!account.enabled) throw new Error('请选择已启用的机器人')
    const email = normalizeNotificationEmail(value)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        this.client(account).contact.user.batchGetId({ params: { user_id_type: 'open_id' }, data: { emails: [email], include_resigned: false } }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('邮箱校验超时，请稍后重试')), 12_000) }),
      ])
      if (response.code !== 0) throw new Error(`邮箱解析失败：请检查 contact:user.id:readonly 权限与通讯录可见范围（${response.code ?? '未知错误'}）`)
      const users = response.data?.user_list?.filter(user => user.email?.toLowerCase() === email && user.user_id?.startsWith('ou_') && !user.status?.is_resigned && !user.status?.is_exited) ?? []
      if (users.length !== 1) throw new Error('所选机器人查不到唯一的有效接收人，请检查邮箱及通讯录可见范围')
      return { email, openId: users[0]!.user_id! }
    } catch (error) {
      if (error instanceof Error && /邮箱|接收人/u.test(error.message)) throw error
      throw new Error('无法校验邮箱，请检查机器人凭据、网络及通讯录权限')
    } finally { clearTimeout(timer) }
  }
}

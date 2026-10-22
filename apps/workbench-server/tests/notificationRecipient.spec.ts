import { describe, expect, it, vi } from 'vitest'
import { NotificationRecipientResolver } from '../src/services/notificationRecipient.js'
import type { ChannelAccountSecret } from '../src/services/channelStore.js'
const account = { id: 'bot', appId: 'fixture-app', enabled: true } as ChannelAccountSecret
describe('email recipient resolution', () => {
  it('resolves under the selected app identity and requests open_id explicitly', async () => {
    const batchGetId = vi.fn(async () => ({ code: 0, data: { user_list: [{ email: 'fixture@example.test', user_id: 'ou_for_app' }] } }))
    const factory = vi.fn(() => ({ contact: { user: { batchGetId } } }))
    const resolver = new NotificationRecipientResolver(factory as never)
    expect(await resolver.resolve(account, ' Fixture@Example.Test ')).toEqual({ email: 'fixture@example.test', openId: 'ou_for_app' })
    expect(factory).toHaveBeenCalledWith(account)
    expect(batchGetId).toHaveBeenCalledWith({ params: { user_id_type: 'open_id' }, data: { emails: ['fixture@example.test'], include_resigned: false } })
  })
  it.each([
    { code: 99991672 }, { code: 0, data: { user_list: [] } },
    { code: 0, data: { user_list: [{ email: 'other@example.test', user_id: 'ou_other' }] } },
    { code: 0, data: { user_list: [{ email: 'fixture@example.test', user_id: 'ou_former', status: { is_resigned: true } }] } },
  ])('rejects missing permission, invisible or invalid recipient %#', async response => {
    const resolver = new NotificationRecipientResolver(() => ({ contact: { user: { batchGetId: async () => response } } }) as never)
    await expect(resolver.resolve(account, 'fixture@example.test')).rejects.toThrow()
  })
})

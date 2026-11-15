import { afterEach, describe, expect, it, vi } from 'vitest'
import { collaborationEventFromContent, type ChannelInboundMessage, type CollaborationEvent } from '@codycodeagent/cody-web-core/channel'
import { WorkbenchDb } from '../src/db/index.js'
import { ChannelStore } from '../src/services/channelStore.js'
import { ChannelRepositories } from '../src/services/channelRepositories.js'
import { ChannelCollaborationService, type CollaborationRunRef } from '../src/services/channelCollaboration.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
function fixture(self: number, maxRounds = 3) {
  const db = new WorkbenchDb(':memory:')
  const store = new ChannelStore(db), repos = new ChannelRepositories(store)
  let now = new Date()
  const account = store.saveAccount(null, { name: `Bot ${self}`, appId: `cli_${self}`, appSecret: 'synthetic', enabled: true, allowAllUsers: false, allowedUserIds: ['ou_human'], allowedConversationIds: ['oc_test'] })
  const date = now.toISOString()
  db.db.prepare('INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES (?,?,?,?,?)').run('ws','test','/tmp/collaboration-test',date,date)
  db.db.prepare('INSERT INTO conversations(id,scope,workspace_id,native_id,title,status,permission_mode,policy_hash,instruction_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('conversation','workspace','ws','native','discussion','idle','yolo','policy','instructions',date,date)
  const human = (id = 'human-1'): ChannelInboundMessage => ({ provider: 'feishu', accountId: account.id, messageId: id, eventId: id, conversation: { id: 'oc_test', scope: 'topic', rootId: 'topic' }, sender: { id: 'ou_human', type: 'user' }, text: '讨论方案', addressedToAgent: true, mentionsOtherRecipient: true, attachments: [], mentions: [0,1].map(slot => ({ id: `ou_observer${self}_bot${slot}`, idType: 'open_id', type: 'user', name: `Bot ${slot}`, isAgent: slot === self })), createdAtIso: date })
  const binding = store.createBinding({ message: human(), targetType: 'codywork-workspace', workspaceId: 'ws', demandId: null, conversationId: 'conversation', threadId: 'native', ownerIdentity: 'ou_human', permissionMode: 'read-only', notificationPolicy: 'origin-only' })
  const sent: CollaborationEvent[] = [], submitted: Array<{ ref: CollaborationRunRef; prompt: string }> = []
  const queue = vi.fn(async (_account, input) => { const event = collaborationEventFromContent(input.payload.card); if (event && !sent.some(item => item.kind === event.kind && item.round === event.round)) sent.push(event); return { id: input.dedupeKey } })
  const interrupt = vi.fn(async () => undefined)
  const hooks = {
    provider: () => ({ chatBots: async () => [0,1,2].map(slot => ({ id: `ou_observer${self}_bot${slot}`, name: `Bot ${slot}` })), messageDetail: async () => human() }),
    queue, interrupt,
    submit: async (id: string) => { const inbox = repos.inbox.get(id); submitted.push({ ref: (inbox.message as ChannelInboundMessage & { collaboration: CollaborationRunRef }).collaboration, prompt: inbox.message.text }); repos.inbox.update(id, 'submitted') },
  }
  let service = new ChannelCollaborationService(db, repos, hooks as never, () => now)
  const receive = (event: CollaborationEvent, senderSlot = event.slot) => service.handle({ ...human(), sender: { id: `ou_observer${self}_bot${senderSlot}`, type: 'app' }, messageId: `wire-${event.kind}-${event.slot}-${event.round}`, eventId: 'provider-redelivery', content: { type: 'interactive', raw: { value: { codywork_collaboration: event } } }, text: 'peer' })
  cleanup.push(async () => { await service.close(); db.close() })
  return { db, store, repos, account, binding, human, sent, submitted, interrupt, queue, receive, hooks,
    get service() { return service },
    configure: () => service.saveConfig(account.id, { chatId: 'oc_test', bindingId: binding.id, enabled: true, maxRounds, maxMinutes: 15 }),
    restart: async () => { await service.close(); service = new ChannelCollaborationService(db, repos, hooks as never, () => now); await service.tick() },
    expire: () => { now = new Date(now.getTime() + 16 * 60000) },
  }
}
const result = (action: string) => JSON.stringify({ action, reply: action === 'reply' ? '方案及待验证问题' : '', pendingIssues: action === 'reply' ? ['验证边界'] : [], reason: action === 'done' ? '无待解决问题' : '需要补充' })
describe('group-scoped decentralized Bot collaboration', () => {
  it('runs two independent hosts with observer-scoped identities, joins, multiple rounds and no acknowledgment loop', async () => {
    const a = fixture(0), b = fixture(1)
    await a.configure(); await b.configure()
    await a.service.handle(a.human()); await b.service.handle(b.human())
    expect(a.submitted).toHaveLength(0)
    await a.receive(b.sent[0]!); await b.receive(a.sent[0]!)
    expect(a.submitted).toHaveLength(1); expect(b.submitted).toHaveLength(1)
    await a.service.complete(a.submitted[0]!.ref, result('reply'))
    await b.service.complete(b.submitted[0]!.ref, result('reply'))
    await a.receive(b.sent[1]!); await b.receive(a.sent[1]!)
    expect(a.submitted).toHaveLength(2); expect(b.submitted).toHaveLength(2)
    await a.service.complete(a.submitted[1]!.ref, result('done'))
    await b.service.complete(b.submitted[1]!.ref, result('done'))
    await a.receive(b.sent[2]!); await b.receive(a.sent[2]!)
    expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('completed')
    expect(b.service.sessions(b.account.id)[0]!.state.status).toBe('completed')
    await a.receive(b.sent[2]!); await a.service.tick()
    expect(a.submitted).toHaveLength(2)
  })
  it('does not admit unmentioned bots, unauthorized humans or unconfigured groups', async () => {
    const a = fixture(0); await a.configure()
    expect(await a.service.handle({ ...a.human(), sender: { id: 'ou_stranger', type: 'user' } })).toBe(false)
    expect(await a.service.handle({ ...a.human(), conversation: { id: 'oc_other', scope: 'group' } })).toBe(false)
    expect(await a.service.handle({ ...a.human(), addressedToAgent: false })).toBe(false)
    expect(await a.service.handle({ ...a.human(), mentions: a.human().mentions?.filter(item => item.isAgent) })).toBe(false)
    await a.service.handle(a.human())
    const join = { ...a.sent[0]!, slot: 1 }
    await a.receive(join, 2)
    expect(a.submitted).toHaveLength(0)
    await a.receive(join)
    expect(a.submitted).toHaveLength(1)
  })
  it('uses smaller peer caps and hard-stops even if the model wants to continue', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    await a.receive({ ...a.sent[0]!, slot: 1, maxRounds: 1 })
    await a.service.complete(a.submitted[0]!.ref, result('reply'))
    await a.receive({ ...a.sent[1]!, slot: 1 })
    expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('round_limit')
    expect(a.submitted).toHaveLength(1)
  })
  it('retains limits on human supplements, deduplicates after restart and starts a fresh batch after closure', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    await a.receive({ ...a.sent[0]!, slot: 1 })
    await a.service.handle({ ...a.human('human-2'), text: '补充一个边界' })
    expect(a.service.sessions(a.account.id)[0]!.supplements).toHaveLength(1)
    await a.restart(); await a.receive({ ...a.sent[0]!, slot: 1 })
    expect(a.submitted).toHaveLength(1)
    const id = a.service.sessions(a.account.id)[0]!.id
    await a.service.stop(a.account.id, id)
    expect(() => a.service.assertActive(a.submitted[0]!.ref)).toThrow()
    await a.service.complete(a.submitted[0]!.ref, result('reply'))
    await a.service.handle(a.human('human-new'))
    expect(a.service.sessions(a.account.id)).toHaveLength(2)
    expect(a.service.sessions(a.account.id)[0]!.state.round).toBe(1)
    expect(a.interrupt).toHaveBeenCalled()
  })
  it('expires silent peers and surfaces invalid model output as needs-human', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human()); a.expire(); await a.service.tick()
    expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('expired')
    const b = fixture(0); await b.configure(); await b.service.handle(b.human()); await b.receive({ ...b.sent[0]!, slot: 1 })
    await b.service.complete(b.submitted[0]!.ref, '我懂了')
    expect(b.service.sessions(b.account.id)[0]).toMatchObject({ state: { status: 'needs_human' }, lastError: expect.stringContaining('有效协作判断') })
  })
  it('handles join-before-human delivery using an authenticated human message lookup', async () => {
    const a = fixture(0), b = fixture(1); await a.configure(); await b.configure()
    await b.service.handle(b.human())
    await a.receive(b.sent[0]!)
    expect(a.submitted).toHaveLength(1)
    await a.service.handle(a.human())
    expect(a.service.sessions(a.account.id)).toHaveLength(1)
  })
  it('recognizes stop/restart following normalized peer mentions', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    await a.service.handle({ ...a.human('restart'), text: '@Bot 1 /协作重开 重新讨论' })
    expect(a.service.sessions(a.account.id).map(row => row.state.status)).toEqual(['joining', 'stopped'])
    await a.service.handle({ ...a.human('stop'), text: '@Bot 1 /协作停止' })
    expect(a.service.sessions(a.account.id).every(row => row.state.status === 'stopped')).toBe(true)
  })
  it('authenticates protocol senders by participant identity and rejects cross-chat/topic replay', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    const join = { ...a.sent[0]!, slot: 1 }
    const wire = { ...a.human(), sender: { id: 'ou_observer0_bot1', type: 'user' as const }, content: { type: 'interactive', raw: { codywork_collaboration: join } } }
    await a.service.handle({ ...wire, conversation: { id: 'oc_test', scope: 'topic', rootId: 'other' } })
    expect(a.submitted).toHaveLength(0)
    await a.service.handle(wire)
    expect(a.submitted).toHaveLength(1)
  })
  it('fences queued deliveries after stop and expiry', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    const item = { accountId: a.account.id, payload: { card: { codywork_collaboration: a.sent[0] } } } as never
    expect(() => a.service.assertDelivery(item)).not.toThrow()
    await a.service.stop(a.account.id, a.service.sessions(a.account.id)[0]!.id)
    expect(() => a.service.assertDelivery(item)).toThrow('失效')
    const b = fixture(0); await b.configure(); await b.service.handle(b.human())
    b.expire()
    expect(() => b.service.assertDelivery({ accountId: b.account.id, payload: { card: { codywork_collaboration: b.sent[0] } } } as never)).toThrow('失效')
  })
  it('does not close with a stale done judgment when a human supplements after it was sent', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human()); await a.receive({ ...a.sent[0]!, slot: 1 })
    await a.service.complete(a.submitted[0]!.ref, result('done'))
    await a.service.handle({ ...a.human('extra'), text: '还有一个边界没考虑' })
    await a.receive({ ...a.sent[1]!, slot: 1 })
    expect(a.service.sessions(a.account.id)[0]).toMatchObject({ state: { status: 'stopped' }, lastError: expect.stringContaining('新补充') })
  })
  it('does not lose active sessions beyond the display history limit', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    const session = a.service.sessions(a.account.id)[0]!
    for (let i = 0; i < 201; i++) a.db.db.prepare('INSERT INTO channel_collaboration_sessions VALUES (?,?,?,?,?,?)').run(`archived-${i}`, a.account.id, 'oc_test', `other-${i}`, 'completed', JSON.stringify({ ...session, id: `archived-${i}`, state: { ...session.state, status: 'completed', topic: `other-${i}` } }))
    await a.service.handle({ ...a.human('stop'), text: '/stop' })
    const row = a.db.db.prepare('SELECT status FROM channel_collaboration_sessions WHERE id=?').get(session.id)
    expect(row).toMatchObject({ status: 'stopped' })
  })
  it('rejects runtimes without per-turn readonly policy and stops after runtime migration', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    a.db.db.prepare("UPDATE conversations SET runtime_type='trae' WHERE id='conversation'").run()
    await expect(a.configure()).rejects.toThrow('Codex')
    await a.service.tick()
    expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('stopped')
    expect(a.submitted).toHaveLength(0)
  })
  it('records preparation errors instead of retrying attachment/setup failures on every tick', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    const submit = vi.spyOn(a.hooks, 'submit').mockRejectedValue(new Error('attachment unavailable'))
    await a.receive({ ...a.sent[0]!, slot: 1 })
    await vi.waitFor(() => expect(a.repos.inbox.pending(a.account.id)).toHaveLength(0))
    await a.service.tick()
    expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('needs_human')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps stop responsive while native preparation is pending', async () => {
    const a = fixture(0); await a.configure(); await a.service.handle(a.human())
    let finish!: () => void
    vi.spyOn(a.hooks, 'submit').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    await a.receive({ ...a.sent[0]!, slot: 1 })
    const id = a.service.sessions(a.account.id)[0]!.id
    try {
      await a.service.stop(a.account.id, id)
      expect(a.service.sessions(a.account.id)[0]!.state.status).toBe('stopped')
      expect(() => a.service.assertActive({ id, round: 1 })).toThrow()
    } finally { finish() }
  })

})

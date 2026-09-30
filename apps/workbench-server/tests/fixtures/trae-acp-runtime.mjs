import * as acp from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

let nextSession = 1
const sessions = new Map()

function configOptions() {
  return [{
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'trae-fixture',
    options: [{
      value: 'trae-fixture', name: 'Trae Fixture', description: 'Fixture model',
      _meta: {
        trae: {
          contextWindow: 272000,
          maxContextWindow: 800000,
          supportsMaxMode: true,
          load: { percent: 54 },
          weeklyQuota: { applies: true, isDepleted: false, usedPercent: 12, remainingPercent: 88, resetTime: 1791129599 },
        },
      },
    }],
  }]
}
async function update(client, sessionId, update) { await client.notify(acp.methods.client.session.update, { sessionId, update }) }

const app = acp.agent({ name: 'trae-acp-fixture' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: 'Trae ACP fixture', version: '1.0' },
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { list: {}, resume: {}, close: {} } },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = `trae-fixture-${process.pid}-${nextSession++}`
    sessions.set(sessionId, { cwd: params.cwd, cancelled: false, model: 'trae-fixture', appendRejected: false })
    return { sessionId, configOptions: configOptions() }
  })
  .onRequest(acp.methods.agent.session.load, ({ params }) => {
    sessions.set(params.sessionId, { cwd: params.cwd, cancelled: false, model: 'trae-fixture', appendRejected: false })
    return { configOptions: configOptions() }
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    sessions.set(params.sessionId, { cwd: params.cwd, cancelled: false, model: 'trae-fixture', appendRejected: false })
    return { configOptions: configOptions() }
  })
  .onRequest(acp.methods.agent.session.list, () => ({ sessions: [{ sessionId: 'trae-saved-thread', title: 'Trae saved session', cwd: '/tmp' }] }))
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => ({}))
  .onRequest(acp.methods.agent.session.close, ({ params }) => { sessions.delete(params.sessionId); return {} })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => { const session = sessions.get(params.sessionId); if (session) session.cancelled = true })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const session = sessions.get(params.sessionId)
    if (!session) throw new Error('Unknown fixture session')
    const text = params.prompt.find(item => item.type === 'text')?.text ?? ''
    if (text.includes('REJECT_APPEND_ONCE') && !session.appendRejected) {
      session.appendRejected = true
      throw new Error('SESSION_BUSY')
    }
    await update(client, params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } })
    if (text.includes('APPROVAL')) {
      const permission = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'fixture-write', title: 'Write fixture file', kind: 'edit', status: 'pending' },
        options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' }],
      })
      await update(client, params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: permission.outcome.outcome === 'selected' && permission.outcome.optionId === 'allow-once' ? 'TRAE_APPROVED' : 'TRAE_REJECTED' } })
    } else if (text.includes('LONG_RUNNING')) {
      await new Promise(resolve => setTimeout(resolve, 100))
      await update(client, params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: session.cancelled ? 'TRAE_CANCELLED' : 'TRAE_FIXTURE_OK' } })
      return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' }
    } else if (text.includes('HANG_AFTER_CANCEL')) {
      // Simulate an ACP agent that accepts the cancellation notification but
      // never settles the in-flight prompt. CodyWork must force-release it.
      await new Promise(() => {})
    } else {
      await update(client, params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'fixture-read', title: 'Read fixture', kind: 'read', status: 'in_progress' })
      await update(client, params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'TRAE_FIXTURE_OK' } })
      await update(client, params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'fixture-read', status: 'completed' })
    }
    return { stopReason: 'end_turn' }
  })

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))

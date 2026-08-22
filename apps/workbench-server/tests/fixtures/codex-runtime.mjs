import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
let goal = { objective: '', status: 'active' }
let turnSequence = 0

function write(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }
function notify(method, params) { write({ method, params }) }

function emitTurn(prompt) {
  const turnId = `turn-${++turnSequence}`
  const itemId = `item-${turnSequence}`
  notify('turn/started', { turn: { id: turnId } })
  if (prompt.includes('APPROVAL')) {
    write({ id: 900 + turnSequence, method: 'item/commandExecution/requestApproval', params: { approvalId: `approval-${turnSequence}`, reason: 'fixture approval', command: ['touch', 'fixture.txt'], cwd: process.cwd() } })
    return
  }
  if (prompt.includes('QUESTION')) {
    write({ id: 800 + turnSequence, method: 'item/tool/requestUserInput', params: { threadId: 'native-fixture-thread', turnId, itemId, questions: [{ id: 'q1', header: 'Fixture', question: '继续吗？', isOther: false, isSecret: false, options: null }], isBlocking: true } })
    return
  }
  const text = prompt.includes('REAL') ? 'CODEX_FIXTURE_REAL' : 'CODEX_FIXTURE_OK'
  notify('item/agentMessage/delta', { itemId, delta: text.slice(0, 5) })
  notify('item/agentMessage/delta', { itemId, delta: text.slice(5) })
  notify('item/completed', { item: { id: itemId, type: 'agentMessage', text } })
  notify('turn/completed', { turn: { id: turnId }, status: 'completed' })
}

rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') write({ id: message.id, result: { serverInfo: { name: 'codex-fixture', version: '1' } } })
  else if (message.method === 'thread/start') write({ id: message.id, result: { thread: { id: 'native-fixture-thread' } } })
  else if (message.method === 'thread/resume') write({ id: message.id, result: { thread: { id: message.params?.threadId ?? 'native-fixture-thread' } } })
  else if (message.method === 'thread/settings/update') write({ id: message.id, result: {} })
  else if (message.method === 'thread/goal/get') write({ id: message.id, result: { goal } })
  else if (message.method === 'thread/goal/set') {
    goal = { objective: message.params?.objective ?? '', status: message.params?.status ?? 'active' }
    write({ id: message.id, result: { goal } }); notify('thread/goal/updated', { goal })
  } else if (message.method === 'thread/goal/clear') {
    goal = { objective: '', status: 'complete' }
    write({ id: message.id, result: {} }); notify('thread/goal/cleared', { threadId: message.params?.threadId })
  } else if (message.method === 'turn/start') {
    write({ id: message.id, result: { turn: { id: `turn-${turnSequence + 1}` } } })
    const prompt = String(message.params?.input?.[0]?.text ?? '')
    if (prompt.includes('APPROVAL')) setTimeout(() => emitTurn(prompt), 5)
    else setTimeout(() => emitTurn(prompt), 5)
  } else if (message.method === 'turn/interrupt') write({ id: message.id, result: {} })
  else if (message.id === 900 + turnSequence) {
    write({ id: message.id, result: { decision: 'approved' } })
    const turnId = `turn-${turnSequence}`
    const itemId = `item-${turnSequence}`
    notify('item/agentMessage/delta', { itemId, delta: 'APPROVED' })
    notify('item/completed', { item: { id: itemId, type: 'agentMessage', text: 'APPROVED' } })
    notify('turn/completed', { turn: { id: turnId }, status: 'completed' })
  } else if (message.id === 800 + turnSequence) {
    write({ id: message.id, result: {} })
    const turnId = `turn-${turnSequence}`
    notify('item/agentMessage/delta', { itemId: `item-${turnSequence}`, delta: 'ANSWERED' })
    notify('turn/completed', { turn: { id: turnId }, status: 'completed' })
  }
})

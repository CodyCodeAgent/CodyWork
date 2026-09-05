import readline from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'

const rl = readline.createInterface({ input: process.stdin })
const catalogHistory = [{
  id: 'turn-history', status: 'completed', error: null, itemsView: 'full',
  startedAt: 1_700_000_001, completedAt: 1_700_000_002, durationMs: 1_000,
  items: [
    { id: 'user-history', type: 'userMessage', content: [{ type: 'text', text: 'historical prompt' }] },
    { id: 'command-history', type: 'commandExecution', command: 'pnpm test', status: 'completed', aggregatedOutput: 'all green' },
    { id: 'agent-history', type: 'agentMessage', text: 'historical answer' },
  ],
}]
const statePath = process.env.CODY_FIXTURE_STATE?.trim()
let restoredState
try {
  restoredState = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined
} catch {
  restoredState = undefined
}
let turnSequence = Number(restoredState?.turnSequence ?? 0)
let threadSequence = Number(restoredState?.threadSequence ?? 0)
let lastThreadCwd = ''
const threadHistories = new Map(restoredState?.threadHistories ?? [['native-fixture-thread', catalogHistory]])
const pendingTurns = new Map()
let initialized = false
const fixtureSkills = [{
  name: 'fixture-skill', description: 'Fixture skill', path: '/skills/fixture-skill/SKILL.md',
  scope: 'repo', enabled: true,
}, {
  name: 'global-review', description: 'Global fixture review skill', path: '/skills/global-review/SKILL.md',
  scope: 'user', enabled: true,
}, {
  name: 'fixture-skill', description: 'Global variant of the fixture skill', path: '/skills/global-fixture-skill/SKILL.md',
  scope: 'user', enabled: true,
}, {
  name: 'runtime-research', description: 'System fixture research skill', path: '/skills/runtime-research/SKILL.md',
  scope: 'system', enabled: true,
}].filter(skill => process.env.CODY_FIXTURE_DISABLED_SKILL !== skill.name)

function write(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }
function notify(method, params) { write({ method, params }) }
function persistState() {
  if (!statePath) return
  writeFileSync(statePath, JSON.stringify({ turnSequence, threadSequence, threadHistories: [...threadHistories.entries()] }))
}
function recordTurn(threadId, turnId, itemId, prompt, text) {
  const history = threadHistories.get(threadId) ?? []
  history.push({
    id: turnId, status: 'completed', error: null, itemsView: 'full',
    startedAt: 1_700_000_100 + turnSequence * 2,
    completedAt: 1_700_000_101 + turnSequence * 2,
    durationMs: 1_000,
    items: [
      { id: `user-${turnId}`, type: 'userMessage', content: [{ type: 'text', text: prompt }] },
      { id: itemId, type: 'agentMessage', text },
    ],
  })
  threadHistories.set(threadId, history)
  pendingTurns.delete(turnId)
  persistState()
}
function recordFailedTurn(threadId, prompt) {
  const turnId = `turn-${++turnSequence}`
  const history = threadHistories.get(threadId) ?? []
  history.push({
    id: turnId, status: 'failed', error: { message: 'fixture disconnect' }, itemsView: 'full',
    startedAt: 1_700_000_100 + turnSequence * 2,
    completedAt: 1_700_000_101 + turnSequence * 2,
    durationMs: 1_000,
    items: [{ id: `user-${turnId}`, type: 'userMessage', content: [{ type: 'text', text: prompt }] }],
  })
  threadHistories.set(threadId, history)
  persistState()
}

function emitTurn(threadId, prompt, turnCwd = '') {
  const turnId = `turn-${++turnSequence}`
  const itemId = `item-${turnSequence}`
  pendingTurns.set(turnId, { threadId, prompt, itemId })
  notify('turn/started', { threadId, turnId, turn: { id: turnId } })
  if (prompt.includes('APPROVAL')) {
    write({ id: 900 + turnSequence, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId, approvalId: `approval-${turnSequence}`, reason: 'fixture approval', command: ['touch', 'fixture.txt'], cwd: process.cwd() } })
    return
  }
  if (prompt.includes('QUESTION')) {
    write({ id: 800 + turnSequence, method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId, questions: [{ id: 'q1', header: 'Fixture', question: '继续吗？', isOther: false, isSecret: false, options: null }], isBlocking: true } })
    return
  }
  const text = prompt.includes('SERVER_CWD') ? process.cwd()
    : prompt.includes('THREAD_CWD') ? lastThreadCwd
      : prompt.includes('TURN_CWD') ? turnCwd
        : prompt.includes('REAL') ? 'CODEX_FIXTURE_REAL' : 'CODEX_FIXTURE_OK'
  notify('item/agentMessage/delta', { threadId, turnId, itemId, delta: text.slice(0, 5) })
  notify('item/agentMessage/delta', { threadId, turnId, itemId, delta: text.slice(5) })
  notify('item/completed', { threadId, turnId, item: { id: itemId, type: 'agentMessage', text } })
  notify('turn/completed', { threadId, turnId, turn: { id: turnId, status: 'completed' } })
  recordTurn(threadId, turnId, itemId, prompt, text)
}

function emitPendingTurn(threadId, prompt, turnCwd = '') {
  const turnId = `turn-${++turnSequence}`
  const itemId = `item-${turnSequence}`
  pendingTurns.set(turnId, { threadId, prompt, itemId })
  notify('turn/started', { threadId, turnId, turn: { id: turnId } })
  notify('item/started', {
    threadId,
    turnId,
    item: {
      id: itemId,
      type: 'commandExecution',
      command: '/usr/bin/sleep 180',
      cwd: turnCwd,
      status: 'inProgress',
      aggregatedOutput: '',
    },
  })
  notify('item/commandExecution/outputDelta', { threadId, turnId, itemId, delta: 'fixture long-running command started\n' })
}

rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') {
    initialized = true
    write({ id: message.id, result: { serverInfo: { name: 'codex-fixture', version: '1' } } })
  }
  else if (typeof message.method === 'string' && !initialized) write({ id: message.id, error: { code: -32002, message: 'fixture app-server is not initialized' } })
  else if (message.method === 'thread/start') {
    const serialized = JSON.stringify(message.params)
    if (serialized.includes('readOnlyAccess') || serialized.includes('persistExtendedHistory')) {
      write({ id: message.id, error: { code: -32602, message: 'legacy Codex fields are forbidden' } })
    } else if (message.params?.ephemeral !== false) {
      write({ id: message.id, error: { code: -32602, message: 'CodyWork threads must be durable' } })
    } else if (!Array.isArray(message.params?.runtimeWorkspaceRoots) || message.params.runtimeWorkspaceRoots.length === 0) {
      write({ id: message.id, error: { code: -32602, message: 'missing runtime workspace roots' } })
    } else {
      lastThreadCwd = String(message.params?.cwd ?? '')
      const threadId = `native-fixture-thread-${++threadSequence}`
      threadHistories.set(threadId, [])
      persistState()
      write({ id: message.id, result: { thread: { id: threadId } } })
    }
  }
  else if (message.method === 'thread/resume') {
    const threadId = message.params?.threadId ?? 'native-fixture-thread'
    if (!threadHistories.has(threadId)) {
      threadHistories.set(threadId, [])
      persistState()
    }
    write({ id: message.id, result: { thread: { id: threadId } } })
  }
  else if (message.method === 'thread/list') write({ id: message.id, result: { data: [...threadHistories.keys()].map(threadId => ({
    id: threadId,
    extra: null,
    sessionId: 'fixture-session',
    forkedFromId: null,
    parentThreadId: null,
    preview: threadId === 'native-fixture-thread' ? ' Fixture catalog thread ' : ` Fixture created thread ${threadId} `,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: 'paginated',
    name: threadId === 'native-fixture-thread' ? 'Fixture thread' : 'Created fixture thread',
    cwd: process.cwd(),
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    recencyAt: 1_700_000_100,
    status: { type: 'idle' },
    path: null,
    modelProvider: 'openai',
    cliVersion: 'fixture',
    source: { vscode: {} },
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    turns: [],
  })), nextCursor: null } })
  else if (message.method === 'thread/read') {
    const threadId = message.params?.threadId ?? 'native-fixture-thread'
    write({ id: message.id, result: { thread: {
    id: threadId, extra: null, sessionId: 'fixture-session', forkedFromId: null, parentThreadId: null,
    preview: 'Fixture history', ephemeral: false, section: null, sectionEnteredAt: null, historyMode: 'paginated',
    modelProvider: 'openai', createdAt: 1_700_000_000, updatedAt: 1_700_000_100, recencyAt: 1_700_000_100,
    status: { type: 'idle' }, path: null, cwd: process.cwd(), cliVersion: 'fixture', source: 'appServer',
    canAcceptDirectInput: true, threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: 'Fixture thread',
    turns: threadHistories.get(threadId) ?? [],
  } } })
  }
  else if (message.method === 'model/list') write({ id: message.id, result: { data: [{
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT 5.6 Sol',
    description: 'fixture model',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: '' },
      { reasoningEffort: 'high', description: '' },
    ],
  }], nextCursor: null } })
  else if (message.method === 'collaborationMode/list') write({ id: message.id, result: { data: [{
    name: 'plan',
    mode: 'plan',
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
  }] } })
  else if (message.method === 'skills/list') write({ id: message.id, result: { data: [{
    cwd: process.cwd(),
    skills: fixtureSkills,
    errors: [],
  }] } })
  else if (message.method === 'turn/start') {
    const input = Array.isArray(message.params?.input) ? message.params.input : []
    const prompt = String(input.find(item => item?.type === 'text')?.text ?? '')
    const threadId = String(message.params?.threadId ?? 'native-fixture-thread')
    if (!threadHistories.has(threadId)) threadHistories.set(threadId, [])
    if (prompt.includes('SKILL_ORDER')) {
      const skillInputs = input.filter(item => item?.type === 'skill')
      const skillIndex = input.findIndex(item => item?.type === 'skill')
      const textIndex = input.findIndex(item => item?.type === 'text')
      const selectedSkill = skillInputs[0]
      if (
        skillInputs.length !== 1
        || selectedSkill?.name !== 'e2e-sample'
        || selectedSkill?.path !== '/skills/e2e-sample/SKILL.md'
        || skillIndex < 0
        || textIndex < 0
        || skillIndex > textIndex
      ) {
        write({ id: message.id, error: { code: -32602, message: 'Exactly the selected Skill must precede text input' } })
        return
      }
    }
    const policy = message.params?.sandboxPolicy
    const invalidWritePolicy = !prompt.includes('EXPECT_READ_ONLY') && (
      policy?.type !== 'workspaceWrite'
      || !Array.isArray(policy?.writableRoots)
      || policy.writableRoots.length === 0
      || policy.networkAccess !== true
      || Object.hasOwn(policy, 'readOnlyAccess')
    )
    const invalidReadPolicy = prompt.includes('EXPECT_READ_ONLY') && (policy?.type !== 'readOnly' || policy?.networkAccess !== true)
    const invalidCollaborationMode = prompt.includes('REAL') && message.params?.collaborationMode?.mode !== 'plan'
    if (invalidWritePolicy || invalidReadPolicy || invalidCollaborationMode) {
      write({ id: message.id, error: { code: -32602, message: 'invalid current Codex sandbox policy' } })
      return
    }
    write({ id: message.id, result: { turn: { id: `turn-${turnSequence + 1}` } } })
    const turnCwd = String(message.params?.cwd ?? '')
    if (prompt.includes('PAUSE_E2E')) setTimeout(() => emitPendingTurn(threadId, prompt, turnCwd), 5)
    else if (prompt.includes('DISCONNECT')) setTimeout(() => { recordFailedTurn(threadId, prompt); process.exit(23) }, 5)
    else if (prompt.includes('APPROVAL')) setTimeout(() => emitTurn(threadId, prompt, turnCwd), 5)
    else setTimeout(() => emitTurn(threadId, prompt, turnCwd), 5)
  } else if (message.method === 'turn/interrupt') write({ id: message.id, result: {} })
  else if (message.id === 900 + turnSequence) {
    write({ id: message.id, result: { decision: 'approved' } })
    const turnId = `turn-${turnSequence}`
    const pending = pendingTurns.get(turnId) ?? { threadId: 'native-fixture-thread', prompt: 'APPROVAL', itemId: `item-${turnSequence}` }
    notify('item/agentMessage/delta', { threadId: pending.threadId, turnId, itemId: pending.itemId, delta: 'APPROVED' })
    notify('item/completed', { threadId: pending.threadId, turnId, item: { id: pending.itemId, type: 'agentMessage', text: 'APPROVED' } })
    notify('turn/completed', { threadId: pending.threadId, turnId, turn: { id: turnId, status: 'completed' } })
    recordTurn(pending.threadId, turnId, pending.itemId, pending.prompt, 'APPROVED')
  } else if (message.id === 800 + turnSequence) {
    write({ id: message.id, result: {} })
    const turnId = `turn-${turnSequence}`
    const pending = pendingTurns.get(turnId) ?? { threadId: 'native-fixture-thread', prompt: 'QUESTION', itemId: `item-${turnSequence}` }
    notify('item/agentMessage/delta', { threadId: pending.threadId, turnId, itemId: pending.itemId, delta: 'ANSWERED' })
    notify('turn/completed', { threadId: pending.threadId, turnId, turn: { id: turnId, status: 'completed' } })
    recordTurn(pending.threadId, turnId, pending.itemId, pending.prompt, 'ANSWERED')
  }
})

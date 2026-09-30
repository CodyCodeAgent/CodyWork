import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { isWithinRoot, resolveEffectivePolicy, resolveInstructionBundle } from '../src/runtime/policy.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION, type RuntimeEvent } from '../src/runtime/protocol.js'
import { CodyWorkCodexRuntime } from '../src/runtime/codex.js'
import { CodyWorkTraeRuntime, presentTraeFailure } from '../src/runtime/trae.js'
import { CODY_WEB_CORE_VERSION } from '@codycodeagent/cody-web-core/runtime'
import { createConversationState, reduceConversationEvents } from '@codycodeagent/cody-web-core/conversation'

describe('generic runtime protocol', () => {
  it('normalizes context roots without treating them as a CodyWork sandbox', () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-runtime-'))
    mkdirSync(join(root, '.agents', 'skills', 'csr'), { recursive: true })
    writeFileSync(join(root, 'CONSTITUTION.md'), '# CSR')
    writeFileSync(join(root, 'AGENTS.md'), 'Read the charter first')
    writeFileSync(join(root, '.agents', 'skills', 'csr', 'SKILL.md'), '# Skill')
    const bundle = resolveInstructionBundle({ workspacePath: root })
    expect(bundle.sources.map(source => source.kind)).toEqual(['charter', 'workspace', 'skill'])
    expect(bundle.skills[0]?.name).toBe('csr')
    expect(bundle.systemInstructions).not.toContain('## Workspace skills')
    expect(bundle.systemInstructions).not.toContain('csr:')
    const policy = resolveEffectivePolicy({ workspacePath: root, writableRoots: [join(root, 'worktrees', 'coupon', 'docs')] })
    expect(policy.shell).toBe('disabled')
    expect(policy.readableRoots).toEqual([])
    expect(policy.writableRoots[0]).toContain('worktrees/coupon/docs')
    expect(policy.hash).toHaveLength(64)
    expect(isWithinRoot(root, join(root, 'worktrees'))).toBe(true)
    expect(resolveEffectivePolicy({ workspacePath: root, readableRoots: [join(root, '..', 'shared')], writableRoots: [] }).readableRoots[0]).toContain('shared')
    expect(resolveEffectivePolicy({ workspacePath: root, writableRoots: [join(root, '..', 'shared-write')] }).writableRoots[0]).toContain('shared-write')
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps App Server instructions below its payload limit without adding a skill catalog', () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-instruction-limit-'))
    mkdirSync(join(root, '.agents', 'skills', 'large'), { recursive: true })
    writeFileSync(join(root, '.agents', 'skills', 'large', 'SKILL.md'), `# Large skill\n${'x'.repeat(1_200_000)}`)
    const bundle = resolveInstructionBundle({ workspacePath: root })
    expect(bundle.sources.find(source => source.kind === 'skill')?.content.length).toBeGreaterThan(1_000_000)
    expect(bundle.systemInstructions.length).toBeLessThan(800_000)
    expect(bundle.systemInstructions).not.toContain('large:')
    expect(bundle.systemInstructions).not.toContain('x'.repeat(10_000))
    rmSync(root, { recursive: true, force: true })
  })

  it('loads current Demand docs for a new conversation and excludes archived documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-demand-docs-'))
    const demand = join(root, 'worktrees', 'checkout')
    mkdirSync(join(demand, 'docs', 'history'), { recursive: true })
    mkdirSync(join(root, 'docs', 'guides'), { recursive: true })
    writeFileSync(join(demand, 'docs', 'context.md'), '# Current demand context')
    writeFileSync(join(demand, 'docs', 'progress.md'), '# Current progress')
    writeFileSync(join(demand, 'docs', 'decisions.yaml'), 'decision: keep-current-contract')
    writeFileSync(join(demand, 'docs', 'history', 'previous.md'), '# Stale archived progress')
    writeFileSync(join(root, 'docs', 'guides', 'evaluation.md'), '# 评估单排查\n\n只在需要排查评估单时读取完整文档。')
    const bundle = resolveInstructionBundle({ workspacePath: root, demandPath: demand })
    expect(bundle.sources.filter(source => source.kind === 'demand').map(source => source.label)).toEqual([
      'demand document: context.md',
      'demand document: decisions.yaml',
      'demand document: progress.md',
    ])
    expect(bundle.systemInstructions).toContain('# Current demand context')
    expect(bundle.systemInstructions).toContain('# Current progress')
    expect(bundle.systemInstructions).toContain('keep-current-contract')
    expect(bundle.systemInstructions).not.toContain('Stale archived progress')
    expect(bundle.sources.find(source => source.kind === 'knowledge')).toMatchObject({ label: 'workspace knowledge catalog' })
    expect(bundle.systemInstructions).toContain('docs/guides/evaluation.md')
    expect(bundle.systemInstructions).toContain('CodyWork demand startup')
    expect(bundle.systemInstructions).not.toContain('只在需要排查评估单时读取完整文档。')
    rmSync(root, { recursive: true, force: true })
  })

  it('indexes Workspace knowledge and guides unrestricted sessions to applicable AGENTS files', () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-workspace-search-'))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '# Workspace rules\nFollow root policy.')
    writeFileSync(join(root, 'docs', 'operations.md'), '# Operations handbook\nDo not inline the whole document.')
    const bundle = resolveInstructionBundle({ workspacePath: root, workspaceSession: true })
    expect(bundle.systemInstructions).toContain('Workspace 级会话')
    expect(bundle.systemInstructions).toContain('运行命令、Git 与其他 CLI')
    expect(bundle.systemInstructions).toContain('Follow root policy.')
    expect(bundle.systemInstructions).toContain('从 Workspace 根到目标目录逐级查找并读取适用的 AGENTS.md')
    expect(bundle.systemInstructions).not.toContain('严禁在任何位置创建、修改、移动或删除文件')
    expect(bundle.systemInstructions).toContain('docs/operations.md')
    expect(bundle.systemInstructions).not.toContain('Do not inline the whole document.')
    rmSync(root, { recursive: true, force: true })
  })

  it('exposes standard capabilities and events through the test adapter', async () => {
    const runtime = new TestRuntimeAdapter()
    const info = await runtime.getInfo()
    expect(info.protocolVersion).toBe(WORKBENCH_RUNTIME_PROTOCOL_VERSION)
    const conversation = await runtime.createConversation({
      context: {
        workspacePath: '/tmp/workspace',
        instructionBundle: { systemInstructions: '', sources: [], skills: [], sha256: '' },
        effectivePolicy: { readableRoots: ['/tmp/workspace'], writableRoots: ['/tmp/workspace/worktrees/x'], deniedRoots: [], shell: 'disabled', approval: 'workbench', hash: '' },
      },
    })
    const result = await runtime.sendTurn({ conversation, prompt: 'hello' })
    expect(result.finalText).toContain('hello')
    expect(result.events.map(event => event.type)).toEqual(['user.completed', 'turn.started', 'tool.started', 'assistant.delta', 'assistant.completed', 'tool.completed', 'turn.completed'])
    await runtime.close()
  })

  it('drives a Codex App Server session, turn-scoped collaboration and runtime approvals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-codex-adapter-'))
    const appServerCwd = mkdtempSync(join(tmpdir(), 'cody-app-server-owner-'))
    const fixture = fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))
    const productToolCalls: Array<{ conversationId: string; threadId: string; turnId: string; tool: string; arguments: unknown }> = []
    const runtime = new CodyWorkCodexRuntime({
      command: `${process.execPath} ${fixture}`,
      appServerCwd,
      productToolHandler: async (call) => {
        productToolCalls.push(call)
        return { saved: true, name: 'Fixture shortcut' }
      },
    })
    expect((await runtime.getInfo()).runtimeVersion).toBe(`cody-web-core/${CODY_WEB_CORE_VERSION}`)
    expect(runtime.diagnostics()).toBeNull()
    const context = {
      workspacePath: root,
      demandPath: root,
      instructionBundle: { systemInstructions: 'CSR', sources: [], skills: [], sha256: 'instructions' },
      effectivePolicy: { readableRoots: [root], writableRoots: [join(root, 'worktrees', 'demo', 'docs')], deniedRoots: [], shell: 'allowlist' as const, approval: 'workbench' as const, hash: 'policy' },
    }
    const conversation = await runtime.createConversation({ context })
    expect(runtime.diagnostics()).toMatchObject({ status: 'running', initialized: true })
    await expect(runtime.sendTurn({ conversation, prompt: 'THREAD_CWD' })).resolves.toMatchObject({ finalText: realpathSync(appServerCwd) })
    await expect(runtime.sendTurn({ conversation, prompt: 'TURN_CWD' })).resolves.toMatchObject({ finalText: realpathSync(root) })
    await expect(runtime.listNativeThreads({ context })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({
      nativeId: 'native-fixture-thread',
      preview: 'Fixture catalog thread',
      source: 'vscode',
    })]))
    await expect(runtime.getComposerOptions(context)).resolves.toEqual({
      provider: { type: 'codex', label: 'Codex' },
      capabilities: {
        modelSelection: true, reasoning: true, structuredSkills: true,
        imageInput: true, nativeSessionList: true, planMode: true,
        steer: true, append: false, questions: true, aiCodeReports: true,
      },
      models: [{
        id: 'gpt-5.6-sol',
        label: 'GPT 5.6 Sol',
        description: 'fixture model',
        isDefault: true,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: ['medium', 'high'],
      }],
      skills: [{
        id: '/skills/fixture-skill/SKILL.md',
        name: 'fixture-skill',
        label: 'fixture-skill',
        description: 'Fixture skill',
        path: '/skills/fixture-skill/SKILL.md',
        scope: 'repo',
        enabled: true,
      }, {
        id: '/skills/global-fixture-skill/SKILL.md',
        name: 'fixture-skill',
        label: 'fixture-skill',
        description: 'Global variant of the fixture skill',
        path: '/skills/global-fixture-skill/SKILL.md',
        scope: 'user',
        enabled: true,
      }, {
        id: '/skills/global-review/SKILL.md',
        name: 'global-review',
        label: 'global-review',
        description: 'Global fixture review skill',
        path: '/skills/global-review/SKILL.md',
        scope: 'user',
        enabled: true,
      }, {
        id: '/skills/runtime-research/SKILL.md',
        name: 'runtime-research',
        label: 'runtime-research',
        description: 'System fixture research skill',
        path: '/skills/runtime-research/SKILL.md',
        scope: 'system',
        enabled: true,
      }],
      collaborationModes: [{
        name: 'plan',
        mode: 'plan',
        label: 'plan',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      }],
    })
    await expect(runtime.listSkillCatalog({ workspacePath: root, forceReload: true })).resolves.toEqual([
      {
        id: '/skills/fixture-skill/SKILL.md',
        name: 'fixture-skill',
        label: 'fixture-skill',
        description: 'Fixture skill',
        path: '/skills/fixture-skill/SKILL.md',
        scope: 'repo',
        enabled: true,
      },
      {
        id: '/skills/global-fixture-skill/SKILL.md',
        name: 'fixture-skill',
        label: 'fixture-skill',
        description: 'Global variant of the fixture skill',
        path: '/skills/global-fixture-skill/SKILL.md',
        scope: 'user',
        enabled: true,
      },
      {
        id: '/skills/global-review/SKILL.md',
        name: 'global-review',
        label: 'global-review',
        description: 'Global fixture review skill',
        path: '/skills/global-review/SKILL.md',
        scope: 'user',
        enabled: true,
      },
      {
        id: '/skills/runtime-research/SKILL.md',
        name: 'runtime-research',
        label: 'runtime-research',
        description: 'System fixture research skill',
        path: '/skills/runtime-research/SKILL.md',
        scope: 'system',
        enabled: true,
      },
    ])
    await expect(runtime.resolveSkills(context, ['/skills/fixture-skill/SKILL.md'])).resolves.toEqual([
      { name: 'fixture-skill', path: '/skills/fixture-skill/SKILL.md' },
    ])
    await expect(runtime.resolveSkills(context, ['/skills/missing/SKILL.md'])).rejects.toThrow('不适用于当前上下文')
    const result = await runtime.sendTurn({ conversation, prompt: 'hello' })
    expect(result.finalText).toBe('CODEX_FIXTURE_OK')
    expect(result.events.map(event => event.type)).toContain('assistant.delta')
    expect(result.events.at(-1)?.type).toBe('turn.completed')
    const dynamicToolResult = await runtime.sendTurn({ conversation, prompt: 'DYNAMIC_QUICK_ACTION' })
    expect(JSON.parse(dynamicToolResult.finalText)).toEqual({ saved: true, name: 'Fixture shortcut' })
    expect(productToolCalls).toEqual([expect.objectContaining({
      conversationId: conversation.id,
      threadId: conversation.nativeId,
      tool: 'save',
      arguments: { name: 'Fixture shortcut', prompt: 'Run fixture verification.' },
    })])
    const queuedFirst = runtime.submitTurn({ conversation, prompt: 'queued first', mode: 'queue' })
    const queuedSecond = runtime.submitTurn({ conversation, prompt: 'queued second', mode: 'queue' })
    const [queuedFirstResult, queuedSecondResult] = await Promise.all([queuedFirst.completed, queuedSecond.completed])
    const firstTurnIds = new Set(queuedFirstResult.events.map(event => event.turnId).filter(Boolean))
    const secondTurnIds = new Set(queuedSecondResult.events.map(event => event.turnId).filter(Boolean))
    expect(firstTurnIds.size).toBe(1)
    expect(secondTurnIds.size).toBe(1)
    expect([...firstTurnIds][0]).not.toBe([...secondTurnIds][0])
    await expect(runtime.sendTurn({ conversation, prompt: 'SERVER_CWD' })).resolves.toMatchObject({ finalText: realpathSync(appServerCwd) })
    const nativeHistory = (await runtime.readConversationSnapshot({ conversationId: conversation.id, nativeId: conversation.nativeId, context })).events
    expect(nativeHistory.slice(0, 4).map(event => event.type)).toEqual(['turn.started', 'user.completed', 'assistant.completed', 'turn.completed'])
    expect(nativeHistory.find(event => event.type === 'assistant.completed' && event.data.text === 'CODEX_FIXTURE_OK')).toMatchObject({
      type: 'assistant.completed',
      data: { text: 'CODEX_FIXTURE_OK' },
    })
    // A snapshot is scoped to the owner binding. It deliberately cannot read
    // a second native thread under the same product conversation id.

    await expect(runtime.sendTurn({
      conversation,
      prompt: 'SKILL_ORDER',
      settings: { skills: [{ name: 'e2e-sample', path: '/skills/e2e-sample/SKILL.md' }] },
    })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })

    const planResult = await runtime.sendTurn({ conversation, prompt: 'REAL', settings: { collaborationMode: 'plan' } })
    expect(planResult.finalText).toBe('CODEX_FIXTURE_REAL')
    const approvalEvents: string[] = []
    let pendingApprovalId = ''
    let signalApproval!: () => void
    const approvalRequested = new Promise<void>((resolve) => { signalApproval = resolve })
    const approvalTurn = runtime.sendTurn({ conversation, prompt: 'APPROVAL', onEvent: (event) => {
      approvalEvents.push(event.type)
      if (event.type === 'approval.requested') {
        pendingApprovalId = String(event.data.approvalId ?? '')
        signalApproval()
      }
    } })
    await approvalRequested
    const pendingHistory = (await runtime.readConversationSnapshot({ conversationId: conversation.id, nativeId: conversation.nativeId, context })).events
    // Owner snapshots include volatile approvals so a reconnect has one
    // authoritative recovery path instead of a separate websocket replay.
    expect(pendingHistory.some(event => event.type === 'approval.requested')).toBe(true)
    expect(pendingApprovalId).not.toBe('')
    await runtime.respondApproval(conversation, pendingApprovalId, 'allowed-once')
    const approvalResult = await approvalTurn
    expect(approvalEvents).toContain('approval.requested')
    expect(approvalResult.finalText).toBe('APPROVED')
    expect(approvalResult.events.some(event => event.type === 'turn.completed')).toBe(true)
    const questionEvents: string[] = []
    const questionTurn = runtime.sendTurn({ conversation, prompt: 'QUESTION', onEvent: (event) => {
      questionEvents.push(event.type)
      if (event.type === 'question.requested') void runtime.respondQuestion(conversation, String(event.data.requestId), '继续')
    } })
    const questionResult = await questionTurn
    expect(questionEvents).toContain('question.requested')
    expect(questionResult.events.some(event => event.type === 'turn.completed')).toBe(true)
    await runtime.setPermission(conversation, 'read-only')
    await expect(runtime.sendTurn({ conversation, prompt: 'EXPECT_READ_ONLY' })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })
    await runtime.setPermission(conversation, 'yolo')
    await expect(runtime.sendTurn({ conversation, prompt: 'EXPECT_YOLO' })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })

    // Browser and channel sources may share one native Thread while choosing
    // different execution profiles. A restrictive channel command must not
    // mutate the default used by the next browser command.
    await expect(runtime.sendTurn({
      conversation,
      prompt: 'EXPECT_READ_ONLY SOURCE_SCOPED',
      executionProfile: { permissionMode: 'read-only' },
    })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })
    await expect(runtime.sendTurn({
      conversation,
      prompt: 'SOURCE_SCOPED_DEFAULT_REMAINS_WRITE',
    })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })

    await expect(runtime.sendTurn({ conversation, prompt: 'DISCONNECT EXPECT_YOLO' })).rejects.toThrow('exited')
    expect(runtime.diagnostics()).toMatchObject({ lifecycle: 'unavailable', startCount: 1 })
    await expect(runtime.resumeConversation({ context, conversationId: conversation.id, nativeId: conversation.nativeId }))
      .rejects.toThrow('will not be restarted automatically')
    await expect(runtime.sendTurn({ conversation, prompt: 'still unavailable' }))
      .rejects.toThrow('unavailable')
    expect(runtime.diagnostics()).toMatchObject({ lifecycle: 'unavailable', startCount: 1 })
    await runtime.close()

    // A new owning service lifecycle may start one fresh App Server process.
    // The failed runtime itself must never supervise or respawn the process.
    const restartedRuntime = new CodyWorkCodexRuntime({ command: `${process.execPath} ${fixture}`, appServerCwd })
    const restored = await restartedRuntime.resumeConversation({ context, conversationId: conversation.id, nativeId: conversation.nativeId })
    const recovered = await restartedRuntime.sendTurn({ conversation: restored, prompt: 'hello after service restart' })
    expect(recovered.finalText).toBe('CODEX_FIXTURE_OK')
    expect(restartedRuntime.diagnostics()).toMatchObject({ lifecycle: 'running', startCount: 1 })
    await restartedRuntime.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(appServerCwd, { recursive: true, force: true })
  })

  it('drives independent Trae ACP sessions without changing the Codex runtime contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-trae-adapter-'))
    const fixture = fileURLToPath(new URL('./fixtures/trae-acp-runtime.mjs', import.meta.url))
    const runtime = new CodyWorkTraeRuntime({ command: `${process.execPath} ${fixture}` })
    const context = {
      workspacePath: root, demandPath: root,
      instructionBundle: { systemInstructions: 'CSR', sources: [], skills: [], sha256: 'instructions' },
      effectivePolicy: { readableRoots: [root], writableRoots: [root], deniedRoots: [], shell: 'allowlist' as const, approval: 'workbench' as const, hash: 'policy' },
    }
    const first = await runtime.createConversation({ context })
    const second = await runtime.createConversation({ context })
    expect(first.nativeId).not.toBe(second.nativeId)
    const [firstResult, secondResult] = await Promise.all([
      runtime.sendTurn({ conversation: first, prompt: 'hello', settings: { model: 'Trae Fixture' } }),
      runtime.sendTurn({ conversation: second, prompt: 'hello' }),
    ])
    expect(firstResult.finalText).toBe('TRAE_FIXTURE_OK')
    expect(secondResult.events.map(event => event.type)).toEqual(expect.arrayContaining(['turn.started', 'tool.started', 'assistant.delta', 'assistant.completed', 'tool.completed', 'turn.completed']))
    const firstTurnStarted = firstResult.events.find(event => event.type === 'turn.started')
    const firstUserCompleted = firstResult.events.find(event => event.type === 'user.completed')
    const firstTurnCompleted = firstResult.events.find(event => event.type === 'turn.completed')
    const firstAssistantCompleted = firstResult.events.find(event => event.type === 'assistant.completed')
    expect(firstTurnStarted).toMatchObject({ id: expect.any(String), threadId: first.nativeId, turnId: expect.any(String) })
    expect(firstUserCompleted).toMatchObject({ id: expect.any(String), threadId: first.nativeId, turnId: firstTurnStarted?.turnId, itemId: firstTurnStarted?.turnId })
    expect(firstTurnCompleted).toMatchObject({ id: expect.any(String), threadId: first.nativeId, turnId: firstTurnStarted?.turnId })
    expect(firstAssistantCompleted).toMatchObject({ threadId: first.nativeId, turnId: firstTurnStarted?.turnId, data: { text: 'TRAE_FIXTURE_OK' } })
    const browserCommandId = 'browser-command'
    const browserTurn = runtime.submitTurn({ conversation: first, prompt: 'browser projection', clientCommandId: browserCommandId })
    const browserResult = await browserTurn.completed
    expect(browserResult.events.find(event => event.type === 'command.bound')).toMatchObject({
      threadId: first.nativeId, turnId: browserCommandId, itemId: browserCommandId,
      data: { clientCommandId: browserCommandId, nativeTurnId: browserCommandId },
    })
    const browserProjection = reduceConversationEvents(createConversationState(first.nativeId), [
      {
        id: `local-outbox:${browserCommandId}`,
        type: 'user.completed',
        threadId: first.nativeId,
        itemId: browserCommandId,
        atIso: new Date().toISOString(),
        data: { text: 'browser projection', optimistic: true, localOutbox: 'queued' },
      },
      ...browserResult.events,
    ])
    expect(browserProjection.messages.find(message => message.id === `user:${browserCommandId}`)?.outbox).toBeUndefined()
    const appendEvents: RuntimeEvent[] = []
    const active = runtime.submitTurn({ conversation: first, prompt: 'LONG_RUNNING', onEvent: event => appendEvents.push(event) })
    await vi.waitFor(() => expect(appendEvents.some(event => event.type === 'turn.started')).toBe(true))
    const supplemental = runtime.submitTurn({ conversation: first, prompt: 'supplement the current task', mode: 'append', clientCommandId: 'append-command', onEvent: event => appendEvents.push(event) })
    await expect(supplemental.started).resolves.toEqual({ threadId: first.nativeId, turnId: expect.any(String) })
    await expect(supplemental.completed).resolves.toMatchObject({ conversation: first })
    expect(appendEvents).toContainEqual(expect.objectContaining({ type: 'command.appended', itemId: 'append-command', data: { clientCommandId: 'append-command', delivery: 'acp_prompt' } }))
    await expect(active.completed).resolves.toMatchObject({ conversation: first })

    const fallbackEvents: RuntimeEvent[] = []
    const activeForFallback = runtime.submitTurn({ conversation: first, prompt: 'LONG_RUNNING', onEvent: event => fallbackEvents.push(event) })
    await vi.waitFor(() => expect(fallbackEvents.some(event => event.type === 'turn.started')).toBe(true))
    const supplementalFallback = runtime.submitTurn({ conversation: first, prompt: 'REJECT_APPEND_ONCE', mode: 'append', clientCommandId: 'append-fallback', onEvent: event => fallbackEvents.push(event) })
    await expect(supplementalFallback.completed).resolves.toMatchObject({ conversation: first })
    expect(fallbackEvents).toContainEqual(expect.objectContaining({ type: 'command.requeued', itemId: 'append-fallback', data: expect.objectContaining({ reason: expect.stringContaining('已转入队列') }) }))
    expect(fallbackEvents).toContainEqual(expect.objectContaining({ type: 'command.bound', itemId: 'append-fallback' }))
    await expect(activeForFallback.completed).resolves.toMatchObject({ conversation: first })
    const cancelledEvents: RuntimeEvent[] = []
    const cancellable = runtime.submitTurn({ conversation: first, prompt: 'LONG_RUNNING', onEvent: event => cancelledEvents.push(event) })
    await vi.waitFor(() => expect(cancelledEvents.some(event => event.type === 'turn.started')).toBe(true))
    await expect(runtime.interrupt(first)).resolves.toEqual({ supported: true })
    await expect(cancellable.completed).resolves.toMatchObject({ conversation: first })
    expect(cancelledEvents.filter(event => event.type === 'turn.interrupted')).toHaveLength(1)
    expect(cancelledEvents.some(event => event.type === 'turn.failed')).toBe(false)

    const hungEvents: RuntimeEvent[] = []
    const hung = runtime.submitTurn({ conversation: first, prompt: 'HANG_AFTER_CANCEL', onEvent: event => hungEvents.push(event) })
    await vi.waitFor(() => expect(hungEvents.some(event => event.type === 'turn.started')).toBe(true))
    await expect(runtime.interrupt(first)).resolves.toEqual({ supported: true })
    await expect(hung.completed).resolves.toMatchObject({ conversation: first })
    expect(hungEvents.filter(event => event.type === 'turn.interrupted')).toHaveLength(1)
    expect(hungEvents.find(event => event.type === 'turn.interrupted')).toMatchObject({ data: { cause: 'cancel_timeout' } })
    expect(hungEvents.some(event => event.type === 'turn.failed')).toBe(false)
    await expect(runtime.resumeConversation({ conversationId: first.id, nativeId: first.nativeId, context })).resolves.toMatchObject({ id: first.id })
    await expect(runtime.checkConnection()).resolves.toMatchObject({ runtimeVersion: 'traecli-acp', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION })
    await expect(runtime.getComposerOptions(context)).resolves.toMatchObject({
      provider: { type: 'trae', label: 'Trae ACP' },
      capabilities: {
        modelSelection: true, reasoning: false, structuredSkills: false,
        imageInput: true, nativeSessionList: true, planMode: false,
        steer: false, append: true, questions: false, aiCodeReports: true,
      },
      models: [expect.objectContaining({
        id: 'trae-fixture', isDefault: true, supportedReasoningEfforts: [],
        metadata: {
          contextWindow: 272000, maxContextWindow: 800000, supportsMaxMode: true, loadPercent: 54,
          weeklyQuota: { applies: true, isDepleted: false, usedPercent: 12, remainingPercent: 88, resetTime: 1791129599 },
        },
      })],
    })
    const rejectedEvents: Array<{ type: string; threadId: string; turnId?: string; itemId?: string }> = []
    await expect(runtime.sendTurn({ conversation: first, prompt: 'invalid model', settings: { model: 'missing-model' }, onEvent: event => rejectedEvents.push(event) })).rejects.toThrow('当前 Trae ACP 不支持模型')
    expect(rejectedEvents.map(event => event.type)).toEqual(expect.arrayContaining(['command.failed', 'turn.failed']))
    const failedCommand = rejectedEvents.find(event => event.type === 'command.failed')
    expect(failedCommand).toMatchObject({ threadId: first.nativeId, turnId: expect.any(String), itemId: expect.any(String) })
    expect(failedCommand?.itemId).toBe(failedCommand?.turnId)
    const networkFailureEvents: RuntimeEvent[] = []
    await expect(runtime.sendTurn({ conversation: first, prompt: 'NETWORK_REQUEST_FAILURE', onEvent: event => networkFailureEvents.push(event) }))
      .rejects.toThrow('Trae 模型网络连接失败')
    expect(networkFailureEvents.filter(event => event.type === 'turn.failed')).toEqual([
      expect.objectContaining({ data: { error: expect.stringContaining('NO_PROXY'), code: 'trae_model_network_connection_failed' } }),
    ])
    await expect(runtime.sendTurn({ conversation: first, prompt: 'no synthetic reasoning', settings: { reasoningEffort: 'medium' } })).rejects.toThrow('未提供推理程度配置')
    await expect(runtime.sendTurn({ conversation: first, prompt: 'no synthetic plan', settings: { collaborationMode: 'plan' } })).rejects.toThrow('未提供 Plan 模式配置')
    await expect(runtime.listNativeThreads({ context })).resolves.toEqual([expect.objectContaining({ nativeId: 'trae-saved-thread', preview: 'Trae saved session' })])
    let approvalId = ''
    const approvalEvents: RuntimeEvent[] = []
    const approval = runtime.sendTurn({ conversation: first, prompt: 'APPROVAL', onEvent: event => {
      approvalEvents.push(event)
      if (event.type === 'approval.requested') approvalId = String(event.data.approvalId)
    } })
    await vi.waitFor(() => expect(approvalId).not.toBe(''))
    await runtime.respondApproval(first, approvalId, 'allowed-once')
    await expect(approval).resolves.toMatchObject({ finalText: 'TRAE_APPROVED' })
    expect(approvalEvents.find(event => event.type === 'approval.resolved')).toMatchObject({
      threadId: first.nativeId,
      turnId: expect.any(String),
      data: { approvalId, outcome: 'allowed-once', nativeOutcome: 'selected', optionId: 'allow-once' },
    })
    // The shared conversation reducer drives the approval card. Its pending
    // list must settle as soon as the browser decision is accepted, before
    // the native agent finishes its follow-up work.
    expect(reduceConversationEvents(createConversationState(first.nativeId), approvalEvents).pendingRequests).toEqual([])
    await expect(runtime.respondApproval(first, approvalId, 'allowed-once')).rejects.toThrow('待处理的 Trae 授权请求不存在')
    await runtime.setPermission(first, 'yolo')
    await expect(runtime.sendTurn({ conversation: first, prompt: 'APPROVAL' })).resolves.toMatchObject({ finalText: 'TRAE_APPROVED' })
    await runtime.setPermission(first, 'read-only')
    await expect(runtime.sendTurn({ conversation: first, prompt: 'APPROVAL' })).resolves.toMatchObject({ finalText: 'TRAE_REJECTED' })
    const snapshot = await runtime.readConversationSnapshot({ conversationId: first.id, nativeId: first.nativeId, context })
    expect(snapshot.events.some(event => event.type === 'assistant.delta')).toBe(true)
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('presents normalized Trae transport failures as actionable network recovery', () => {
    expect(presentTraeFailure(new Error('Connection failed: error sending request'))).toEqual({
      message: expect.stringContaining('Trae 模型网络连接失败'),
      code: 'trae_model_network_connection_failed',
    })
    // The JSON-RPC bridge may erase the original transport message. Keep the
    // product recovery actionable even when ACP exposes only this standard
    // error string.
    expect(presentTraeFailure(new Error('Internal error'))).toEqual({
      message: expect.stringContaining('Trae 模型网络连接失败'),
      code: 'trae_model_network_connection_failed',
    })
    expect(presentTraeFailure(new Error('当前 Trae ACP 不支持模型'))).toEqual({
      message: '当前 Trae ACP 不支持模型',
    })
  })
})

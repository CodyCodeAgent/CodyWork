import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { isWithinRoot, resolveEffectivePolicy, resolveInstructionBundle } from '../src/runtime/policy.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from '../src/runtime/protocol.js'
import { CodyWorkCodexRuntime } from '../src/runtime/codex.js'
import { CODY_WEB_CORE_VERSION } from '@codycodeagent/cody-web-core/runtime'

describe('generic runtime protocol', () => {
  it('compiles policy roots and instruction sources without widening writes', () => {
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
    expect(policy.writableRoots[0]).toContain('worktrees/coupon/docs')
    expect(policy.hash).toHaveLength(64)
    expect(isWithinRoot(root, join(root, 'worktrees'))).toBe(true)
    expect(() => resolveEffectivePolicy({ workspacePath: root, writableRoots: [join(root, '..', 'escape')] })).toThrow('outside')
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
    expect(result.events.map(event => event.type)).toEqual(['user.completed', 'turn.started', 'tool.started', 'assistant.delta', 'tool.completed', 'turn.completed'])
    await runtime.close()
  })

  it('drives a Codex App Server session, turn-scoped collaboration and runtime approvals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-codex-adapter-'))
    const appServerCwd = mkdtempSync(join(tmpdir(), 'cody-app-server-owner-'))
    const fixture = fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))
    const runtime = new CodyWorkCodexRuntime({ command: `${process.execPath} ${fixture}`, appServerCwd })
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
      models: ['gpt-5.6-sol'],
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

    await expect(runtime.sendTurn({ conversation, prompt: 'DISCONNECT' })).rejects.toThrow('exited')
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
})

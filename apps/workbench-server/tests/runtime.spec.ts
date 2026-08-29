import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { isWithinRoot, resolveEffectivePolicy, resolveInstructionBundle } from '../src/runtime/policy.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from '../src/runtime/protocol.js'
import { RuntimeManager } from '../src/runtime/manager.js'
import { CodexRuntimeAdapter } from '../src/runtime/codex.js'

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

  it('exposes standard capabilities and events through the test adapter', async () => {
    const runtime = new TestRuntimeAdapter()
    const manifest = await runtime.getManifest()
    expect(manifest.protocolVersion).toBe(WORKBENCH_RUNTIME_PROTOCOL_VERSION)
    expect(manifest.writePolicy).toBe('roots')
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

  it('selects a runtime by semantic capability instead of provider-specific names', async () => {
    const manager = new RuntimeManager()
    const runtime = new TestRuntimeAdapter()
    manager.register(runtime)
    await expect(manager.select({ streaming: true, writePolicy: 'roots' })).resolves.toBe(runtime)
    await expect(manager.select({ interrupt: false })).rejects.toThrow('no runtime adapter')
    await manager.close()
  })

  it('drives a Codex App Server session, goal commands and runtime approvals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-codex-adapter-'))
    const fixture = fileURLToPath(new URL('./fixtures/codex-runtime.mjs', import.meta.url))
    const runtime = new CodexRuntimeAdapter({ command: `${process.execPath} ${fixture}` })
    expect((await runtime.getManifest()).runtimeVersion).toBe('cody-web-core/0.11.1')
    expect(runtime.diagnostics()).toBeNull()
    const context = {
      workspacePath: root,
      demandPath: root,
      instructionBundle: { systemInstructions: 'CSR', sources: [], skills: [], sha256: 'instructions' },
      effectivePolicy: { readableRoots: [root], writableRoots: [join(root, 'worktrees', 'demo', 'docs')], deniedRoots: [], shell: 'allowlist' as const, approval: 'workbench' as const, hash: 'policy' },
    }
    const conversation = await runtime.createConversation({ context })
    expect(runtime.diagnostics()).toMatchObject({ status: 'running', initialized: true })
    const result = await runtime.sendTurn({ conversation, prompt: 'hello' })
    expect(result.finalText).toBe('CODEX_FIXTURE_OK')
    expect(result.events.map(event => event.type)).toContain('assistant.delta')
    expect(result.events.at(-1)?.type).toBe('turn.completed')
    const nativeHistory = await runtime.readConversation({ conversation, context })
    expect(nativeHistory.map(event => event.type)).toEqual(['turn.started', 'user.completed', 'tool.completed', 'assistant.completed', 'turn.completed'])
    expect(nativeHistory.find(event => event.itemId === 'command-history')?.data.item).toEqual(expect.objectContaining({ type: 'commandExecution', command: 'pnpm test' }))

    await expect(runtime.sendTurn({
      conversation,
      prompt: 'SKILL_ORDER',
      settings: { skills: [{ name: 'e2e-sample', path: '/skills/e2e-sample/SKILL.md' }] },
    })).resolves.toMatchObject({ finalText: 'CODEX_FIXTURE_OK' })

    await runtime.sendCommand({ conversation, prompt: '/plan on' })
    const planResult = await runtime.sendTurn({ conversation, prompt: 'REAL' })
    expect(planResult.finalText).toBe('CODEX_FIXTURE_REAL')
    await runtime.sendCommand({ conversation, prompt: '/goal ship it' })
    await runtime.sendCommand({ conversation, prompt: '/goal pause' })
    const approvalEvents: string[] = []
    const approvalTurn = runtime.sendTurn({ conversation, prompt: 'APPROVAL', onEvent: (event) => {
      approvalEvents.push(event.type)
      if (event.type === 'approval.requested') void runtime.respondApproval(conversation, String(event.data.approvalId), 'allowed-once')
    } })
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
    const restored = await runtime.resumeConversation({ context, conversationId: conversation.id, nativeId: conversation.nativeId })
    const recovered = await runtime.sendTurn({ conversation: restored, prompt: 'hello after reconnect' })
    expect(recovered.finalText).toBe('CODEX_FIXTURE_OK')

    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  })
})

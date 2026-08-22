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
    const policy = resolveEffectivePolicy({ workspacePath: root, writableRoots: [join(root, 'worktrees', 'coupon', 'docs')] })
    expect(policy.shell).toBe('disabled')
    expect(policy.writableRoots[0]).toContain('worktrees/coupon/docs')
    expect(policy.hash).toHaveLength(64)
    expect(isWithinRoot(root, join(root, 'worktrees'))).toBe(true)
    expect(() => resolveEffectivePolicy({ workspacePath: root, writableRoots: [join(root, '..', 'escape')] })).toThrow('outside')
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
    expect(result.events.map(event => event.type)).toEqual(['turn.started', 'item.started', 'message.delta', 'item.completed', 'turn.completed'])
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
    const context = {
      workspacePath: root,
      demandPath: root,
      instructionBundle: { systemInstructions: 'CSR', sources: [], skills: [], sha256: 'instructions' },
      effectivePolicy: { readableRoots: [root], writableRoots: [join(root, 'worktrees', 'demo', 'docs')], deniedRoots: [], shell: 'allowlist' as const, approval: 'workbench' as const, hash: 'policy' },
    }
    const conversation = await runtime.createConversation({ context })
    const result = await runtime.sendTurn({ conversation, prompt: 'hello' })
    expect(result.finalText).toBe('CODEX_FIXTURE_OK')
    expect(result.events.map(event => event.type)).toContain('message.delta')
    expect(result.events.at(-1)?.type).toBe('turn.completed')

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
    await runtime.setPermission(conversation, 'yolo')
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  })
})

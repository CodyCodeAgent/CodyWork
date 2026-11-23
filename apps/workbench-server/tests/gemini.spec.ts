import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CodyWorkGeminiRuntime, DEFAULT_ANTIGRAVITY_CLI_COMMAND, presentGeminiFailure } from '../src/runtime/gemini.js'
import { createCodyWorkRuntimeRegistry, runtimeDescriptorViews } from '../src/runtime/registry.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from '../src/runtime/policy.js'
import type { RuntimeContext } from '../src/runtime/protocol.js'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeWorkspace(): RuntimeContext {
  const workspacePath = mkdtempSync(join(tmpdir(), 'codywork-gemini-'))
  tempDirs.push(workspacePath)
  return {
    workspacePath,
    instructionBundle: resolveInstructionBundle({ workspacePath }),
    effectivePolicy: resolveEffectivePolicy({ workspacePath, writableRoots: [workspacePath], shell: 'allowlist', approval: 'none' }),
  }
}

describe('CodyWorkGeminiRuntime (Antigravity CLI ACP)', () => {
  it('registers gemini (Antigravity) alongside codex and trae in the runtime registry', () => {
    expect(DEFAULT_ANTIGRAVITY_CLI_COMMAND).toBe('agy acp')
    const gemini = new CodyWorkGeminiRuntime({ command: 'agy acp' })
    const registry = createCodyWorkRuntimeRegistry('gemini', {
      codex: gemini,
      gemini,
      trae: gemini,
    })
    const views = runtimeDescriptorViews(registry)
    expect(views.map(v => v.id)).toEqual(['codex', 'gemini', 'trae'])
    expect(registry.defaultId).toBe('gemini')
    expect(views.find(v => v.id === 'gemini')?.label).toBe('Gemini (Antigravity)')
  })

  it('connects, lists composer options, and streams a turn through ACP', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/trae-acp-runtime.mjs', import.meta.url))
    const runtime = new CodyWorkGeminiRuntime({ command: `${process.execPath} ${fixture}` })
    const context = makeWorkspace()
    const skillDir = join(context.workspacePath, '.agents/skills/fixture-review')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    writeFileSync(skillPath, '---\nname: fixture-review\ndescription: Review fixture code\n---\nReview the fixture.\n')
    try {
      const info = await runtime.checkConnection()
      expect(info.runtimeVersion).toBe('antigravity-cli-acp')

      const options = await runtime.getComposerOptions(context)
      expect(options.provider).toEqual({ type: 'gemini', label: 'Gemini (Antigravity)' })
      expect(options.capabilities.append).toBe(true)
      expect(options.skills.map(skill => skill.name)).toEqual(['fixture-review'])
      expect(await runtime.checkModelAccess()).toEqual({ installed: true, connected: true, modelReady: true })

      const conversation = await runtime.createConversation({ context })
      const streamed: string[] = []
      const result = await runtime.sendTurn({
        conversation,
        prompt: 'hello antigravity acp',
        onEvent(event) {
          if (event.type === 'assistant.delta') streamed.push(String(event.data.text ?? ''))
        },
      })
      expect(result.finalText.length).toBeGreaterThan(0)
      expect(streamed.join('')).toBe(result.finalText)
      expect(result.events.some(e => e.type === 'turn.completed')).toBe(true)
      const skills = await runtime.resolveSkills(context, [realpathSync(skillPath)])
      const withSkill = await runtime.sendTurn({ conversation, prompt: 'review this', settings: { skills } })
      expect(withSkill.finalText).toBe('FIXTURE_SKILL_OK')
      expect(withSkill.events.filter(event => event.type === 'user.completed').map(event => event.data)).toEqual([
        { text: 'review this', skills },
      ])
    } finally {
      await runtime.close()
    }
  })

  it('classifies missing CLI, auth, and network errors cleanly without crashing', async () => {
    expect(presentGeminiFailure(new Error('spawn agy ENOENT')).code).toBe('gemini_cli_not_found')
    expect(presentGeminiFailure(new Error('401 UNAUTHENTICATED: invalid API key')).code).toBe('gemini_auth_failed')
    expect(presentGeminiFailure(new Error('fetch failed: ECONNREFUSED')).code).toBe('gemini_network_failed')

    const missing = new CodyWorkGeminiRuntime({ command: 'definitely-missing-agy-binary acp' })
    const context = makeWorkspace()
    await expect(missing.createConversation({ context })).rejects.toThrow('未找到 Antigravity CLI 可执行文件')
  })

  it('delivers initial context once per native session and keeps it pending after a failed prompt', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/trae-acp-runtime.mjs', import.meta.url))
    const initialized = new Set<string>()
    const options = {
      command: `${process.execPath} ${fixture}`,
      env: { CODY_FIXTURE_ACP_ECHO_PROMPT: '1' },
      initialContext: {
        isSent: ({ nativeId }: { nativeId: string }) => initialized.has(nativeId),
        markSent: ({ nativeId }: { nativeId: string }) => { initialized.add(nativeId) },
      },
    }
    const runtime = new CodyWorkGeminiRuntime(options)
    const restored = new CodyWorkGeminiRuntime(options)
    const context = makeWorkspace()
    writeFileSync(join(context.workspacePath, 'AGENTS.md'), 'Synthetic initialization instruction.')
    context.instructionBundle = resolveInstructionBundle({ workspacePath: context.workspacePath, workspaceSession: true })
    try {
      const conversation = await runtime.createConversation({ context })
      await expect(runtime.sendTurn({ conversation, prompt: 'NETWORK_REQUEST_FAILURE' })).rejects.toThrow('Internal error')
      expect(initialized.has(conversation.nativeId)).toBe(false)

      const first = await runtime.sendTurn({ conversation, prompt: 'First user message' })
      expect(first.finalText).toMatch(/^First user message[\s\S]*Synthetic initialization instruction\./)
      expect(first.events.find(event => event.type === 'user.completed')?.data.text).toBe('First user message')
      expect((await runtime.sendTurn({ conversation, prompt: 'Second user message' })).finalText).toBe('Second user message')
      await runtime.close()

      const resumed = await restored.resumeConversation({ context, conversationId: conversation.id, nativeId: conversation.nativeId })
      expect((await restored.sendTurn({ conversation: resumed, prompt: 'After resume' })).finalText).toBe('After resume')
      restored.releaseConversation(resumed)
      const replacement = await restored.createConversation({ context, conversationId: conversation.id })
      expect(replacement.nativeId).not.toBe(resumed.nativeId)
      expect((await restored.sendTurn({ conversation: replacement, prompt: 'New native session' })).finalText).toContain('Synthetic initialization instruction.')
    } finally {
      await Promise.all([runtime.close(), restored.close()])
    }
  })

  it('does not report a model as ready when ACP streams an eligibility error as text', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/trae-acp-runtime.mjs', import.meta.url))
    const runtime = new CodyWorkGeminiRuntime({
      command: `${process.execPath} ${fixture}`,
      env: { CODY_FIXTURE_ACP_HEALTH_RESULT: 'FAILED_PRECONDITION: User location is not supported for the API use.' },
    })
    expect(await runtime.checkModelAccess()).toMatchObject({
      installed: true, connected: true, modelReady: false, code: 'gemini_location_ineligible',
    })
  })
})

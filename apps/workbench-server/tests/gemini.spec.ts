import { mkdtempSync, rmSync } from 'node:fs'
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
    try {
      const info = await runtime.checkConnection()
      expect(info.runtimeVersion).toBe('antigravity-cli-acp')

      const options = await runtime.getComposerOptions(context)
      expect(options.provider).toEqual({ type: 'gemini', label: 'Gemini (Antigravity)' })
      expect(options.capabilities.append).toBe(true)

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
})

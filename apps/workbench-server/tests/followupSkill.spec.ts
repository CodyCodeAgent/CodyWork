import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openFollowupBridge } from '../src/services/followupSkill.js'

const run = promisify(execFile)
const helper = fileURLToPath(new URL('../skills/codywork-followup/scripts/invoke.mjs', import.meta.url))
describe('built-in followup skill bridge', () => {
  it('does not write after the turn closes during asynchronous email validation', async () => {
    let release!: () => void
    const write = vi.fn()
    const bridge = await openFollowupBridge(async (_tool, _args, assertActive) => {
      await new Promise<void>(resolve => { release = resolve })
      assertActive(); write(); return { saved: true }
    })
    bridge.activate()
    const socket = JSON.parse(bridge.instruction.match(/node "[^"]+" ("[^"]+") list/)![1]!) as string
    const request = run(process.execPath, [helper, socket, 'create', '{}'])
    const failed = expect(request).rejects.toMatchObject({ stdout: expect.stringContaining('未执行写入') })
    try { await vi.waitFor(() => expect(release).toBeTypeOf('function')); bridge.close(); release(); await failed; expect(write).not.toHaveBeenCalled() }
    finally { bridge.close() }
  })
  it('executes the real helper over a private local socket and revokes on close', async () => {
    const invoke = vi.fn(async (tool, args) => ({ taskId: 'synthetic-task', tool, args }))
    const bridge = await openFollowupBridge(invoke)
    const socket = JSON.parse(bridge.instruction.match(/node "[^"]+" ("[^"]+") list/)![1]!) as string
    try {
      expect(statSync(socket).mode & 0o777).toBe(0o600)
      await expect(run(process.execPath, [helper, socket, 'list'])).rejects.toThrow()
      expect(invoke).not.toHaveBeenCalled()
      bridge.activate()
      const result = await run(process.execPath, [helper, socket, 'create', JSON.stringify({ name: 'Fixture' })])
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { taskId: 'synthetic-task' } })
      expect(invoke).toHaveBeenCalledExactlyOnceWith('create', { name: 'Fixture' }, expect.any(Function))
    } finally { bridge.close() }
    expect(existsSync(socket)).toBe(false)
    await expect(run(process.execPath, [helper, socket, 'list'])).rejects.toThrow()
  })
  it('returns a failed receipt rather than fabricating task success', async () => {
    const bridge = await openFollowupBridge(async () => { throw new Error('missing notification target') })
    bridge.activate()
    const socket = JSON.parse(bridge.instruction.match(/node "[^"]+" ("[^"]+") list/)![1]!) as string
    try {
      await expect(run(process.execPath, [helper, socket, 'create', '{}'])).rejects.toMatchObject({ stdout: expect.stringContaining('missing notification target') })
    } finally { bridge.close() }
  })
})

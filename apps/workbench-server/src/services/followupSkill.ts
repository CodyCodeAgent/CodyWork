import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import type { RuntimeSkillCatalogEntry } from '../runtime/protocol.js'

export const FOLLOWUP_SKILL_NAME = 'codywork-followup'
export const FOLLOWUP_SKILL_PATH = fileURLToPath(new URL('../../skills/codywork-followup/SKILL.md', import.meta.url))
export const FOLLOWUP_SKILL: RuntimeSkillCatalogEntry = {
  id: FOLLOWUP_SKILL_PATH, path: FOLLOWUP_SKILL_PATH, name: FOLLOWUP_SKILL_NAME,
  label: 'CodyWork 定时跟进', description: '创建和管理当前会话的定时跟进，支持旧会话。', scope: 'system', enabled: true,
}

/** Local, per-command capability. No browser password or public HTTP bypass. */
export async function openFollowupBridge(invoke: (tool: string, args: unknown) => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'cw-followup-'))
  chmodSync(directory, 0o700)
  const socketPath = join(directory, 'bridge.sock')
  let closed = false
  let active = false
  let expiry: ReturnType<typeof setTimeout> | undefined
  const server = createServer({ allowHalfOpen: true }, socket => {
    let input = ''
    socket.setTimeout(15_000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', chunk => { input += chunk; if (input.length > 65_536) socket.destroy() })
    socket.on('end', () => {
      void (async () => {
        try {
          if (closed || !active || input.length > 65_536) throw new Error('跟进桥接未进入执行轮次、已失效或请求过大')
          const request = JSON.parse(input) as { tool?: unknown; arguments?: unknown }
          if (typeof request.tool !== 'string' || !['list', 'create', 'update', 'pause', 'resume', 'cancel', 'run_now'].includes(request.tool)) throw new Error('未知跟进操作')
          const result = await invoke(request.tool, request.arguments)
          socket.end(JSON.stringify({ ok: true, data: result }))
        } catch (error) { socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })) }
      })()
    })
  })
  const close = () => { if (closed) return; closed = true; clearTimeout(expiry); server.close(); rmSync(directory, { recursive: true, force: true }) }
  const activate = () => {
    if (closed || active) return
    active = true
    expiry = setTimeout(close, 2 * 60 * 60 * 1000)
    expiry.unref()
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { chmodSync(socketPath, 0o600); resolve() }) })
  } catch (error) { close(); throw error }
  const helper = fileURLToPath(new URL('../../skills/codywork-followup/scripts/invoke.mjs', import.meta.url))
  const instruction = `\n\n[CodyWork 本轮跟进执行桥接]\n已加载 $${FOLLOWUP_SKILL_NAME}。旧会话无需 dynamic tools。使用 node ${JSON.stringify(helper)} ${JSON.stringify(socketPath)} list '{}' 读取任务与默认值；将 list 替换为 create/update/pause/resume/cancel/run_now 并传 JSON 参数即可操作。此桥接仅本轮有效，绑定当前会话，不能用于其他 API；不要输出或持久化 socket 路径。`
  const skillPath = join(directory, 'SKILL.md')
  try { writeFileSync(skillPath, readFileSync(FOLLOWUP_SKILL_PATH, 'utf8') + instruction, { mode: 0o600 }) }
  catch (error) { close(); throw error }
  return { close, activate, instruction, skillPath }
}

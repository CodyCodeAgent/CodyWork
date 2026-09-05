import { describe, expect, it } from 'vitest'
import { formatSkillInstallDuration, presentSkillInstallEvents, skillInstallIsActive, skillInstallStatusLabel } from './skillInstallPresentation'

describe('Skill install presentation', () => {
  it('turns runtime events into readable agent output and merges streaming chunks', () => {
    const rows = presentSkillInstallEvents([
      { type: 'reasoning.delta', timestamp: '2026-09-05T01:02:03.000Z', data: { text: '先检查' } },
      { type: 'reasoning.delta', timestamp: '2026-09-05T01:02:04.000Z', data: { text: '目录' } },
      { type: 'tool.completed', timestamp: '2026-09-05T01:02:05.000Z', data: { tool: { title: 'Command execution', summary: 'ls', details: ['exit: 0'], output: 'SKILL.md' } } },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ label: 'Agent 思考', text: '先检查目录', tone: 'active' })
    expect(rows[1]?.text).toBe('ls\nexit: 0\nSKILL.md')
  })

  it('labels active and terminal states without inventing a timeout', () => {
    expect(skillInstallIsActive('running')).toBe(true)
    expect(skillInstallIsActive('pausing')).toBe(true)
    expect(skillInstallIsActive('paused')).toBe(false)
    expect(skillInstallStatusLabel('paused')).toBe('已暂停')
    expect(formatSkillInstallDuration('2026-09-05T00:00:00.000Z', undefined, Date.parse('2026-09-05T00:02:07.000Z'))).toBe('2 分 7 秒')
  })
})

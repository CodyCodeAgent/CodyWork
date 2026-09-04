import { describe, expect, it } from 'vitest'
import type { QuickAction } from './api'
import { quickActionsForScene, resolveQuickActionSkills } from './quickActions'

function action(patch: Partial<QuickAction> = {}): QuickAction {
  return {
    id: 'action-1', workspaceId: 'workspace-1', name: '检查实现', prompt: '检查实现', enabled: true,
    sortOrder: 0, skillIds: [], skills: [], missingSkillIds: [], scenes: ['demand-development'],
    createdAt: '', updatedAt: '', ...patch,
  }
}

describe('quick action rules', () => {
  it('only exposes enabled actions for the current scene in stable order', () => {
    const actions = [action({ id: 'b', name: 'B', sortOrder: 2 }), action({ id: 'a', name: 'A', sortOrder: 1 }), action({ id: 'off', enabled: false })]
    expect(quickActionsForScene(actions, 'demand-development').map(item => item.id)).toEqual(['a', 'b'])
  })

  it('maps configured workspace Skills to runtime paths and reports stale references', () => {
    const configured = action({ skills: [
      { id: 'workspace:review', name: 'review', status: 'available' },
      { id: 'workspace:gone', name: 'gone', status: 'missing' },
    ] })
    expect(resolveQuickActionSkills(configured, [{ id: '/repo/.agents/skills/review/SKILL.md', name: 'review', label: 'Review', description: '' }])).toEqual({
      ids: ['/repo/.agents/skills/review/SKILL.md'], missing: ['gone'],
    })
  })
})

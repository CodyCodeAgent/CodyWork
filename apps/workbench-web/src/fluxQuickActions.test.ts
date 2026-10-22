import { describe, expect, it } from 'vitest'
import type { ComposerOptions, Demand } from './api'
import { FLUX_SKILL_INSTALL_SOURCE, fluxIntegrationForDemand } from './fluxQuickActions'

const demand: Demand = {
  id: 'demand-1',
  name: '钱效平台增量来源复盘',
  branchName: 'feature/money-efficiency',
  worktreeKey: 'feature__money-efficiency',
  path: '/workspace/worktrees/feature__money-efficiency',
  status: 'in_progress',
  fluxBinding: {
    deliveryId: '95455704273397855',
    spaceId: '91115103721654403',
    url: 'https://flux.bytedance.net/home/91115103721654403/collaboration/95455704273397855?preview_task=95458484711183219',
    previewTaskId: '95458484711183219',
  },
  createdAt: '',
  updatedAt: '',
  repositories: [{ id: 'repo-1', name: 'market-admin', worktreePath: '/workspace/worktrees/feature__money-efficiency/services/market-admin' }],
}

describe('Flux built-in quick actions', () => {
  it('is absent for a local-only Demand', () => {
    expect(fluxIntegrationForDemand({ ...demand, fluxBinding: null }, [])).toBeNull()
  })

  it('requires the official Skill instead of sending an unstructured fallback', () => {
    const integration = fluxIntegrationForDemand(demand, [])!
    expect(integration.status).toBe('missing-skill')
    expect(integration.instructions.every(action => action.skillIds.length === 0)).toBe(true)
    expect(FLUX_SKILL_INSTALL_SOURCE).toContain('--skill flux-collab')
  })

  it('injects binding context and structurally attaches the preferred official Skill', () => {
    const runtimeSkills: ComposerOptions['skills'] = [
      { id: '/user/flux/SKILL.md', name: 'flux-collab', label: 'User Flux', description: '', path: '/user/flux/SKILL.md', scope: 'user', enabled: true },
      { id: '/workspace/.agents/skills/flux-collab/SKILL.md', name: 'flux-collab', label: 'Workspace Flux', description: '', path: '/workspace/.agents/skills/flux-collab/SKILL.md', scope: 'repo', enabled: true },
    ]
    const integration = fluxIntegrationForDemand(demand, runtimeSkills)!
    const actions = integration.instructions
    expect(integration.status).toBe('ready')
    expect(integration.skillLabel).toBe('Workspace Flux')
    expect(actions.map(action => action.name)).toEqual([
      '理解当前协作',
      '看看下一步做什么',
      '拉取最新需求与产物',
      '继续当前任务',
      '同步技术方案',
      '交付本轮结果',
    ])
    for (const action of actions) {
      expect(action.prompt).toContain('95455704273397855')
      expect(action.prompt).toContain('95458484711183219')
      expect(action.prompt).toContain('/workspace/worktrees/feature__money-efficiency')
      expect(action.prompt).toContain('market-admin')
      expect(action.prompt).toContain('完整读取 Skill 正文')
      expect(action.skillIds).toEqual(['/workspace/.agents/skills/flux-collab/SKILL.md'])
    }
  })

  it('expresses user intent without duplicating CLI syntax', () => {
    const actions = fluxIntegrationForDemand(demand, [{ id: 'flux', name: 'flux-collab', label: 'Flux', description: '', path: 'flux', scope: 'repo', enabled: true }])!.instructions
    expect(actions.find(action => action.id.endsWith(':sync-plan'))?.prompt).toContain('确认边界')
    expect(actions.find(action => action.id.endsWith(':deliver'))?.prompt).not.toContain('delivery push --check')
    expect(actions.find(action => action.id.endsWith(':deliver'))?.prompt).toContain('官方 Skill')
  })
})
